package com.giaokhoa.authorization.fence;

import com.giaokhoa.authorization.fence.DependencyManifestResolver.Manifest;
import com.giaokhoa.shared.http.HttpProblemException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The transaction fence of a protected request. Acquiring a snapshot locks every manifest partition
 * {@code FOR SHARE} in one stable order inside a short transaction, confirms each one is READY at
 * its applied revision and records the revisions; the lock is released at commit, so no transaction
 * is ever held across a network call. If the dependency closure moved while resolving, acquisition
 * re-resolves and retries instead of locking a stale set. Before the caller materializes data,
 * {@link #atSnapshot} re-locks the same rows and proves the recorded revisions are unchanged; a
 * revocation committed in between bumps a revision or fences a partition and is therefore always
 * seen. Any partition PENDING or FAILED fails closed with 503.
 */
@Component
public class AuthorizationFence {
    static final int MAX_RESOLUTION_ATTEMPTS = 3;

    private final JdbcTemplate jdbc;
    private final DependencyManifestResolver resolver;
    private final TransactionTemplate transactions;

    public AuthorizationFence(
            JdbcTemplate jdbc,
            DependencyManifestResolver resolver,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.resolver = resolver;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /** The manifest plus the desired revision each of its partitions was verified at. */
    public record Snapshot(Manifest manifest, Map<UUID, Long> revisions) {
        public Snapshot {
            revisions = Map.copyOf(Objects.requireNonNull(revisions, "revisions"));
        }
    }

    /** The closure or a revision changed after the snapshot; the caller must re-resolve. */
    public static final class ClosureChangedException extends RuntimeException {
        private static final long serialVersionUID = 1L;
    }

    /** Locks and verifies the manifest, re-resolving a bounded number of times if it moved. */
    public Snapshot acquire(Manifest requested) {
        Manifest manifest = requested;
        for (int attempt = 1; ; attempt++) {
            Manifest current = manifest;
            try {
                return transactions.execute(status -> lockAndVerify(current, null));
            } catch (ClosureChangedException changed) {
                if (attempt >= MAX_RESOLUTION_ATTEMPTS) {
                    throw notReady(changed);
                }
                manifest =
                        resolver.resolve(
                                manifest.actorUserId(),
                                manifest.workspaceId(),
                                manifest.targetKeys());
            }
        }
    }

    /**
     * Runs {@code body} inside a transaction that re-locks the snapshot partitions and re-verifies
     * their recorded revisions, so the revision hold spans until this transaction commits.
     */
    public <T> T atSnapshot(Snapshot snapshot, Supplier<T> body) {
        return transactions.execute(status -> {
            lockAndVerify(snapshot.manifest(), snapshot.revisions());
            return body.get();
        });
    }

    private Snapshot lockAndVerify(Manifest manifest, Map<UUID, Long> expected) {
        Map<UUID, Long> revisions = new LinkedHashMap<>();
        for (UUID partitionId : manifest.partitionIds()) {
            List<Map<String, Object>> rows =
                    jdbc.queryForList(
                            "SELECT state, desired_revision, applied_revision"
                                    + " FROM authz_partition WHERE id = ? FOR SHARE",
                            partitionId);
            if (rows.isEmpty()) {
                throw notReady();
            }
            Map<String, Object> row = rows.getFirst();
            long desired = ((Number) row.get("desired_revision")).longValue();
            long applied = ((Number) row.get("applied_revision")).longValue();
            if (!"READY".equals(row.get("state")) || desired != applied) {
                throw notReady();
            }
            if (expected != null && !Objects.equals(expected.get(partitionId), desired)) {
                throw new ClosureChangedException();
            }
            revisions.put(partitionId, desired);
        }
        if (expected == null) {
            // Re-resolve under the locks: deciding on a closure that has already moved is
            // forbidden even when every locked row still reads READY.
            Manifest fresh =
                    resolver.resolve(
                            manifest.actorUserId(), manifest.workspaceId(), manifest.targetKeys());
            if (!fresh.partitionIds().equals(manifest.partitionIds())) {
                throw new ClosureChangedException();
            }
        }
        return new Snapshot(manifest, revisions);
    }

    /** The 503 every fence failure shares: PENDING/FAILED or a closure that will not settle. */
    public static HttpProblemException notReady() {
        return notReady(null);
    }

    public static HttpProblemException notReady(Throwable cause) {
        return new HttpProblemException(
                HttpStatus.SERVICE_UNAVAILABLE,
                DependencyManifestResolver.NOT_READY_CODE,
                DependencyManifestResolver.NOT_READY_DETAIL,
                cause);
    }
}
