package com.giaokhoa.authorization.projection;

import com.giaokhoa.authorization.model.AuthorizationPartition;
import java.sql.Array;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.oauth2.core.OAuth2AuthorizationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClientException;

/**
 * The durable projection worker: it claims due authorization operations in creation order (an
 * operation never overtakes an older one touching the same partition), reconciles every affected
 * partition at exactly the operation's revision through {@link ProjectionReconciler}, and marks the
 * operation SUCCEEDED only after the database confirms every partition READY at that revision.
 * Claims are atomic (rows locked {@code FOR UPDATE SKIP LOCKED} plus a guarded update), so two
 * application instances can never process the same operation. Failures retry with the same
 * idempotency payload and a bounded backoff; exhausting the attempt budget fails the operation and
 * its partitions without opening the fence. Partitions fenced without a live operation (dependency
 * fences, out-of-band drift repairs) are reconciled on the same loop under the same bounded
 * backoff, and READY partitions are periodically checked for console drift through a rotating scan
 * that reaches every partition.
 */
@Component
public class ProjectionWorker {
    static final int MAX_ATTEMPTS = 5;
    static final String ERROR_SUPERSEDED = "SUPERSEDED_BY_NEWER_REVISION";
    static final String ERROR_RECONCILE_FAILED = "PROJECTION_RECONCILE_FAILED";

    private static final int MAX_OPERATIONS_PER_CYCLE = 10;
    private static final int MAX_PARTITIONS_PER_CYCLE = 5;
    private static final Duration DRIFT_SCAN_INTERVAL = Duration.ofMinutes(1);

    private final JdbcTemplate jdbc;
    private final ProjectionReconciler reconciler;
    private final TransactionTemplate transactions;
    private final AtomicBoolean running = new AtomicBoolean();
    private final Map<UUID, OrphanRetry> orphanRetries = new ConcurrentHashMap<>();
    private Instant lastDriftScan = Instant.EPOCH;
    private UUID driftScanCursor;

    /** Rate-limit state of one fenced partition without a live operation. */
    private record OrphanRetry(int failures, Instant nextAttemptAt) {}

    public ProjectionWorker(
            JdbcTemplate jdbc,
            ProjectionReconciler reconciler,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.reconciler = reconciler;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    private record ClaimedOperation(
            UUID id, List<UUID> partitions, List<Long> revisions, int attemptCount) {}

    private static final class SupersededException extends RuntimeException {
        private static final long serialVersionUID = 1L;
    }

    /** Bounded retry delay: grows with the attempt count and is capped. */
    static Duration backoffFor(int attemptCount) {
        return Duration.ofSeconds(Math.min(60, 5L * Math.max(1, attemptCount)));
    }

    @Scheduled(fixedDelay = 1000, initialDelay = 1000)
    public void poll() {
        if (!running.compareAndSet(false, true)) {
            return;
        }
        try {
            drainQueue();
            reconcileOrphanedPartitions();
            repairDriftIfDue();
        } finally {
            running.set(false);
        }
    }

    private void drainQueue() {
        for (int processed = 0; processed < MAX_OPERATIONS_PER_CYCLE; processed++) {
            Optional<ClaimedOperation> claimed = claimNext();
            if (claimed.isEmpty()) {
                return;
            }
            process(claimed.get());
        }
    }

    private Optional<ClaimedOperation> claimNext() {
        return transactions.execute(status -> {
            List<QueueRow> queue =
                    jdbc.query(
                            "SELECT id, affected_partitions, affected_revisions,"
                                    + " attempt_count, state,"
                                    + " (next_attempt_at IS NULL"
                                    + " OR next_attempt_at <= now()) AS due,"
                                    + " (updated_at <= now() - INTERVAL '5 minutes')"
                                    + " AS stale"
                                    + " FROM authorization_operation"
                                    + " WHERE state IN ('PENDING', 'APPLYING',"
                                    + " 'RETRYABLE_FAILURE')"
                                    + " ORDER BY created_at, id",
                            (rs, row) -> {
                                boolean due =
                                        "APPLYING".equals(rs.getString("state"))
                                                ? rs.getBoolean("stale")
                                                : rs.getBoolean("due");
                                return new QueueRow(
                                        rs.getObject("id", UUID.class),
                                        uuidList(rs, "affected_partitions"),
                                        longList(rs, "affected_revisions"),
                                        rs.getInt("attempt_count"),
                                        due);
                            });
            // The PostgreSQL queue pattern: due rows are locked FOR UPDATE SKIP LOCKED, so
            // a row another instance is claiming never appears here; the guarded update
            // below, whose row count is the only proof of ownership, is the final check.
            Set<UUID> claimable =
                    new HashSet<>(
                            jdbc.queryForList(
                                    "SELECT id FROM authorization_operation"
                                            + " WHERE (state IN ('PENDING', 'RETRYABLE_FAILURE')"
                                            + " AND (next_attempt_at IS NULL"
                                            + " OR next_attempt_at <= now()))"
                                            + " OR (state = 'APPLYING'"
                                            + " AND updated_at <= now()"
                                            + " - INTERVAL '5 minutes')"
                                            + " ORDER BY created_at, id"
                                            + " FOR UPDATE SKIP LOCKED",
                                    UUID.class));
            Set<UUID> blocked = new HashSet<>();
            ClaimedOperation claimed = null;
            for (QueueRow row : queue) {
                boolean overlaps = row.partitions().stream().anyMatch(blocked::contains);
                blocked.addAll(row.partitions());
                if (claimed == null && row.due() && !overlaps && claimable.contains(row.id())) {
                    int updated =
                            jdbc.update(
                                    "UPDATE authorization_operation SET state = 'APPLYING',"
                                            + " attempt_count = attempt_count + 1,"
                                            + " next_attempt_at = NULL, last_error_code = NULL,"
                                            + " updated_at = now() WHERE id = ?"
                                            + " AND (state IN ('PENDING', 'RETRYABLE_FAILURE')"
                                            + " OR (state = 'APPLYING'"
                                            + " AND updated_at <= now()"
                                            + " - INTERVAL '5 minutes'))",
                                    row.id());
                    boolean claimedByThisInstance = updated == 1;
                    if (claimedByThisInstance) {
                        claimed =
                                new ClaimedOperation(
                                        row.id(),
                                        row.partitions(),
                                        row.revisions(),
                                        row.attemptCount() + 1);
                    }
                }
            }
            return Optional.ofNullable(claimed);
        });
    }

    private record QueueRow(
            UUID id, List<UUID> partitions, List<Long> revisions, int attemptCount, boolean due) {}

    private void process(ClaimedOperation operation) {
        try {
            for (int i = 0; i < operation.partitions().size(); i++) {
                UUID partitionId = operation.partitions().get(i);
                long revision = operation.revisions().get(i);
                ProjectionReconciler.PartitionRow partition = reconciler.partition(partitionId);
                if (partition.desiredRevision() != revision) {
                    throw new SupersededException();
                }
                if (partition.state() != AuthorizationPartition.State.READY
                        || partition.appliedRevision() != revision) {
                    reconciler.reconcilePartition(partitionId, revision);
                }
            }
            transactions.executeWithoutResult(status -> {
                // Re-read the desired revisions in the same transaction that records
                // success: a mutation that bumped a partition after the checks above makes
                // this operation superseded, not a reconcile failure, and the partitions it
                // fenced now belong to the newer operation.
                for (int i = 0; i < operation.partitions().size(); i++) {
                    List<Long> current =
                            jdbc.queryForList(
                                    "SELECT desired_revision FROM authz_partition WHERE id = ?",
                                    Long.class,
                                    operation.partitions().get(i));
                    if (current.isEmpty()
                            || current.getFirst().longValue()
                                    != operation.revisions().get(i).longValue()) {
                        throw new SupersededException();
                    }
                }
                jdbc.update(
                        "UPDATE authorization_operation SET state = 'SUCCEEDED',"
                                + " next_attempt_at = NULL, last_error_code = NULL,"
                                + " updated_at = now()"
                                + " WHERE id = ? AND state = 'APPLYING'",
                        operation.id());
            });
        } catch (SupersededException ex) {
            recordFailure(operation, ERROR_SUPERSEDED, true, false);
        } catch (ProjectionReconciler.ReconciliationException ex) {
            recordFailure(
                    operation, ex.errorCode(), operation.attemptCount() >= MAX_ATTEMPTS, true);
        } catch (RestClientException
                | DataAccessException
                | IllegalStateException
                | OAuth2AuthorizationException ex) {
            recordFailure(
                    operation,
                    ERROR_RECONCILE_FAILED,
                    operation.attemptCount() >= MAX_ATTEMPTS,
                    true);
        }
    }

    private void recordFailure(
            ClaimedOperation operation,
            String errorCode,
            boolean terminal,
            boolean fencePartitions) {
        transactions.executeWithoutResult(status -> {
            // Guarded by the claimed state: an instance that lost the operation to another
            // claim records nothing, so it can never fail an operation that already succeeded.
            jdbc.update(
                    "UPDATE authorization_operation SET state = ?, next_attempt_at = ?,"
                            + " last_error_code = ?, updated_at = now()"
                            + " WHERE id = ? AND state = 'APPLYING'",
                    terminal ? "FAILED" : "RETRYABLE_FAILURE",
                    terminal
                            ? null
                            : Timestamp.from(
                                    Instant.now().plus(backoffFor(operation.attemptCount()))),
                    errorCode,
                    operation.id());
            if (fencePartitions && terminal) {
                for (UUID partitionId : operation.partitions()) {
                    jdbc.update(
                            "UPDATE authz_partition SET state = 'FAILED'"
                                    + " WHERE id = ? AND state = 'PENDING'",
                            partitionId);
                    jdbc.update(
                            "UPDATE authz_projection SET state = 'FAILED'"
                                    + " WHERE partition_id = ? AND state = 'PENDING'",
                            partitionId);
                }
            }
        });
    }

    /**
     * Partitions fenced without a live operation still converge: verify and reopen, or stay fenced.
     * Retries are rate-limited with the same bounded backoff as the operation path, so a partition
     * that cannot converge (for example while Keycloak is down) is not retried on every one-second
     * poll.
     */
    void reconcileOrphanedPartitions() {
        List<UUID> orphaned =
                jdbc.queryForList(
                        "SELECT p.id FROM authz_partition p WHERE p.state = 'PENDING'"
                                + " AND NOT EXISTS (SELECT 1 FROM authorization_operation o"
                                + " WHERE o.state IN ('PENDING', 'APPLYING', 'RETRYABLE_FAILURE')"
                                + " AND p.id = ANY(o.affected_partitions))"
                                + " ORDER BY p.created_at LIMIT ?",
                        UUID.class,
                        MAX_PARTITIONS_PER_CYCLE);
        orphanRetries
                .keySet()
                .retainAll(
                        new HashSet<>(
                                jdbc.queryForList(
                                        "SELECT id FROM authz_partition"
                                                + " WHERE state = 'PENDING'",
                                        UUID.class)));
        Instant now = Instant.now();
        for (UUID partitionId : orphaned) {
            OrphanRetry retry = orphanRetries.get(partitionId);
            if (retry != null && now.isBefore(retry.nextAttemptAt())) {
                continue;
            }
            // Fail-closed: a partition that cannot converge stays PENDING until its next
            // scheduled attempt.
            if (reconciler.tryReconcilePartition(partitionId)) {
                orphanRetries.remove(partitionId);
            } else {
                int failures = retry == null ? 1 : retry.failures() + 1;
                orphanRetries.put(
                        partitionId, new OrphanRetry(failures, now.plus(backoffFor(failures))));
            }
        }
    }

    /**
     * Out-of-band console edits are not synced instantly: on a slow cadence READY partitions are
     * checked against Keycloak, and a drifted partition is fenced first, reconciled, verified and
     * only then reopened by the normal publish path. The scan rotates through the whole READY set
     * instead of rechecking the same oldest partitions forever.
     */
    private void repairDriftIfDue() {
        Instant now = Instant.now();
        if (now.isBefore(lastDriftScan.plus(DRIFT_SCAN_INTERVAL))) {
            return;
        }
        lastDriftScan = now;
        List<UUID> ready =
                new ArrayList<>(
                        jdbc.queryForList(
                                "SELECT id FROM authz_partition WHERE state = 'READY'",
                                UUID.class));
        ready.sort(Comparator.comparing(UUID::toString));
        List<UUID> batch = scanWindow(ready, driftScanCursor, MAX_PARTITIONS_PER_CYCLE);
        if (!batch.isEmpty()) {
            driftScanCursor = batch.getLast();
        }
        for (UUID partitionId : batch) {
            boolean intact;
            try {
                intact = reconciler.verifyStoredGraph(partitionId);
            } catch (DataAccessException ex) {
                continue;
            }
            if (!intact) {
                reconciler.fencePartition(partitionId);
                // A failed repair stays fenced; the orphan path keeps retrying it.
                reconciler.tryReconcilePartition(partitionId);
            }
        }
    }

    /**
     * The rotating drift-scan window over the READY set in stable UUID-string order: up to {@code
     * limit} IDs strictly after {@code after}, wrapping to the head of the list, so every READY
     * partition is reached within a bounded number of scans.
     */
    static List<UUID> scanWindow(List<UUID> orderedIds, UUID after, int limit) {
        List<UUID> window = new ArrayList<>();
        for (UUID id : orderedIds) {
            if (window.size() >= limit) {
                break;
            }
            if (after == null || id.toString().compareTo(after.toString()) > 0) {
                window.add(id);
            }
        }
        for (UUID id : orderedIds) {
            if (window.size() >= limit) {
                break;
            }
            if (after != null && id.toString().compareTo(after.toString()) <= 0) {
                window.add(id);
            }
        }
        return window;
    }

    private static List<UUID> uuidList(java.sql.ResultSet rs, String column)
            throws java.sql.SQLException {
        Array array = rs.getArray(column);
        if (array == null) {
            return List.of();
        }
        Object[] raw = (Object[]) array.getArray();
        List<UUID> out = new ArrayList<>(raw.length);
        for (Object item : raw) {
            out.add(item instanceof UUID uuid ? uuid : UUID.fromString(String.valueOf(item)));
        }
        return List.copyOf(out);
    }

    private static List<Long> longList(java.sql.ResultSet rs, String column)
            throws java.sql.SQLException {
        Array array = rs.getArray(column);
        if (array == null) {
            return List.of();
        }
        Object[] raw = (Object[]) array.getArray();
        List<Long> out = new ArrayList<>(raw.length);
        for (Object item : raw) {
            out.add(
                    item instanceof Number number
                            ? number.longValue()
                            : Long.parseLong(String.valueOf(item)));
        }
        return List.copyOf(out);
    }
}
