package com.giaokhoa.authorization.operation;

import com.giaokhoa.authorization.model.AuthorizationOperation;
import com.giaokhoa.authorization.policy.NativePolicyTemplates;
import com.giaokhoa.authorization.projection.ProjectionReconciler;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Records an authorization mutation the durable way: inside one app-db transaction it bumps the
 * desired revision of every changed partition, fences those partitions and their projections,
 * fences every READY projection that depends on them (the dependency closure), stores the new
 * desired hashes and inserts the idempotent operation. The transaction commits before any network
 * call; {@link com.giaokhoa.authorization.projection.ProjectionWorker} applies the recorded state
 * afterwards. A replay with the same idempotency key returns the existing operation untouched.
 */
@Service
public class AuthorizationOperationService {
    private final JdbcTemplate jdbc;
    private final IdempotencyService idempotency;

    public AuthorizationOperationService(JdbcTemplate jdbc, IdempotencyService idempotency) {
        this.jdbc = jdbc;
        this.idempotency = idempotency;
    }

    /** One desired graph of a partition: its canonical source descriptors, or empty to retract. */
    public record DesiredProjection(
            String targetKey,
            String scope,
            List<String> sourceDescriptors,
            List<UUID> dependencyPartitionIds) {
        public DesiredProjection {
            sourceDescriptors =
                    sourceDescriptors == null ? List.of() : List.copyOf(sourceDescriptors);
            dependencyPartitionIds =
                    dependencyPartitionIds == null
                            ? List.of()
                            : List.copyOf(dependencyPartitionIds);
        }
    }

    /** All desired graphs one partition moves to at its next revision. */
    public record PartitionChange(UUID partitionId, List<DesiredProjection> projections) {
        public PartitionChange {
            projections = projections == null ? List.of() : List.copyOf(projections);
        }
    }

    /**
     * Fences the changed partitions plus their dependent closure and records the operation. The
     * caller lists partitions in dependency order; fenced dependents join the affected set after
     * them at their current revision, so the operation only completes once the whole closure is
     * consistent again.
     */
    @Transactional
    public AuthorizationOperation applyDesiredState(
            UUID initiatorUserId,
            UUID workspaceId,
            String idempotencyKey,
            String payloadHash,
            List<PartitionChange> changes) {
        idempotency.requireKey(idempotencyKey);
        validate(changes);

        List<UUID> primaries = changes.stream().map(PartitionChange::partitionId).toList();
        Closure closure = dependentClosure(primaries);
        // Lock primaries and the dependent closure in ONE global order — the same order
        // IdempotencyService locks in — so two mutations whose closures cross cannot
        // deadlock each other; an unfenced dependent created concurrently is still caught
        // by the deferred partition trigger at commit.
        Set<UUID> lockOrder = new TreeSet<>(Comparator.comparing(UUID::toString));
        lockOrder.addAll(primaries);
        lockOrder.addAll(closure.partitionIds());
        Map<UUID, Long> currentRevisions = new HashMap<>();
        for (UUID partitionId : lockOrder) {
            currentRevisions.put(partitionId, lockCurrentRevision(partitionId));
        }
        Map<UUID, Long> newRevisions = new LinkedHashMap<>();
        for (UUID partitionId : primaries) {
            newRevisions.put(partitionId, currentRevisions.get(partitionId) + 1);
        }
        Map<UUID, Long> dependentRevisions = new LinkedHashMap<>();
        for (UUID partitionId : sortedByUuidString(closure.partitionIds())) {
            dependentRevisions.put(partitionId, currentRevisions.get(partitionId));
        }

        List<UUID> affected = new ArrayList<>(primaries);
        affected.addAll(sortedByUuidString(closure.partitionIds()));
        List<Long> revisions = new ArrayList<>();
        for (UUID partitionId : primaries) {
            revisions.add(newRevisions.get(partitionId));
        }
        for (UUID partitionId : sortedByUuidString(closure.partitionIds())) {
            revisions.add(dependentRevisions.get(partitionId));
        }
        AuthorizationOperation operation =
                new AuthorizationOperation(
                        UUID.randomUUID(),
                        initiatorUserId,
                        workspaceId,
                        idempotencyKey,
                        payloadHash,
                        affected.toArray(new UUID[0]),
                        revisions.toArray(new Long[0]),
                        revisions.getFirst());
        return idempotency.executeOnce(
                operation, () -> applyFencesAndDesiredState(changes, newRevisions, closure));
    }

    private void applyFencesAndDesiredState(
            List<PartitionChange> changes, Map<UUID, Long> newRevisions, Closure closure) {
        Set<UUID> fenced = new HashSet<>();
        for (PartitionChange change : changes) {
            fenced.add(change.partitionId());
        }
        fenced.addAll(closure.partitionIds());
        // Fence every involved partition before any desired field changes: the database only
        // accepts desired edits under a fence.
        for (UUID partitionId : fenced) {
            jdbc.update("UPDATE authz_partition SET state = 'PENDING' WHERE id = ?", partitionId);
        }
        for (PartitionChange change : changes) {
            jdbc.update(
                    "UPDATE authz_projection SET state = 'PENDING'"
                            + " WHERE partition_id = ? AND state = 'READY'",
                    change.partitionId());
            jdbc.update(
                    "UPDATE authz_partition SET desired_revision = ? WHERE id = ?",
                    newRevisions.get(change.partitionId()),
                    change.partitionId());
        }
        for (UUID projectionId : closure.projectionIds()) {
            jdbc.update("UPDATE authz_projection SET state = 'PENDING' WHERE id = ?", projectionId);
        }
        for (PartitionChange change : changes) {
            for (DesiredProjection desired : change.projections()) {
                upsertDesired(change.partitionId(), desired);
            }
        }
    }

    private void upsertDesired(UUID partitionId, DesiredProjection desired) {
        String desiredHash =
                ProjectionReconciler.desiredHash(
                        desired.targetKey(), desired.scope(), desired.sourceDescriptors());
        List<Map<String, Object>> existing =
                jdbc.queryForList(
                        "SELECT id, partition_id FROM authz_projection WHERE target_key = ?",
                        desired.targetKey());
        if (!existing.isEmpty()) {
            if (!partitionId.equals(existing.getFirst().get("partition_id"))) {
                throw new IllegalStateException(
                        "Projection target belongs to another partition: " + desired.targetKey());
            }
            jdbc.update(
                    "UPDATE authz_projection SET desired_hash = ?, dependency_partition_ids = ?,"
                            + " state = 'PENDING' WHERE id = ?",
                    ps -> {
                        ps.setString(1, desiredHash);
                        ps.setArray(
                                2,
                                ps.getConnection()
                                        .createArrayOf(
                                                "uuid",
                                                desired.dependencyPartitionIds()
                                                        .toArray(new UUID[0])));
                        ps.setObject(3, existing.getFirst().get("id"));
                    });
            return;
        }
        jdbc.update(
                "INSERT INTO authz_projection"
                        + " (id, partition_id, target_key, dependency_partition_ids, desired_hash,"
                        + " state) VALUES (?, ?, ?, ?, ?, 'PENDING')",
                ps -> {
                    ps.setObject(1, UUID.randomUUID());
                    ps.setObject(2, partitionId);
                    ps.setString(3, desired.targetKey());
                    ps.setArray(
                            4,
                            ps.getConnection()
                                    .createArrayOf(
                                            "uuid",
                                            desired.dependencyPartitionIds().toArray(new UUID[0])));
                    ps.setString(5, desiredHash);
                });
    }

    private record Closure(Set<UUID> partitionIds, List<UUID> projectionIds) {}

    private record DependentRow(UUID projectionId, UUID partitionId) {}

    /** READY projections depending on the changed partitions, and recursively on their owners. */
    private Closure dependentClosure(List<UUID> primaries) {
        Set<UUID> owners = new HashSet<>();
        List<UUID> projectionIds = new ArrayList<>();
        Set<UUID> seenProjections = new HashSet<>();
        List<UUID> frontier = primaries;
        while (!frontier.isEmpty()) {
            List<UUID> level = frontier;
            List<DependentRow> dependents =
                    jdbc.query(
                            "SELECT id, partition_id FROM authz_projection"
                                    + " WHERE state = 'READY' AND dependency_partition_ids && ?",
                            ps ->
                                    ps.setArray(
                                            1,
                                            ps.getConnection()
                                                    .createArrayOf(
                                                            "uuid", level.toArray(new UUID[0]))),
                            (rs, row) ->
                                    new DependentRow(
                                            rs.getObject("id", UUID.class),
                                            rs.getObject("partition_id", UUID.class)));
            List<UUID> next = new ArrayList<>();
            for (DependentRow dependent : dependents) {
                if (seenProjections.add(dependent.projectionId())) {
                    projectionIds.add(dependent.projectionId());
                }
                if (!primaries.contains(dependent.partitionId())
                        && owners.add(dependent.partitionId())) {
                    next.add(dependent.partitionId());
                }
            }
            frontier = next;
        }
        return new Closure(owners, projectionIds);
    }

    private long lockCurrentRevision(UUID partitionId) {
        List<Long> current =
                jdbc.queryForList(
                        "SELECT desired_revision FROM authz_partition WHERE id = ? FOR UPDATE",
                        Long.class,
                        partitionId);
        if (current.isEmpty()) {
            throw new IllegalArgumentException("Unknown authorization partition: " + partitionId);
        }
        return current.getFirst();
    }

    private void validate(List<PartitionChange> changes) {
        if (changes == null || changes.isEmpty()) {
            throw new IllegalArgumentException("At least one partition change is required");
        }
        Set<UUID> partitions = new HashSet<>();
        Map<String, String> targets = new HashMap<>();
        for (PartitionChange change : changes) {
            if (change.partitionId() == null || !partitions.add(change.partitionId())) {
                throw new IllegalArgumentException("Partition changes must be distinct");
            }
            for (DesiredProjection desired : change.projections()) {
                NativePolicyTemplates.TargetType type =
                        NativePolicyTemplates.targetTypeOf(desired.targetKey())
                                .orElseThrow(() ->
                                        new IllegalArgumentException(
                                                "Target key matches no fixed template: "
                                                        + desired.targetKey()));
                if (desired.scope() == null || !type.scopes().contains(desired.scope())) {
                    throw new IllegalArgumentException(
                            "Scope is not fixed for target "
                                    + desired.targetKey()
                                    + ": "
                                    + desired.scope());
                }
                if (desired.dependencyPartitionIds().contains(change.partitionId())) {
                    throw new IllegalArgumentException(
                            "Projection cannot depend on its own partition: "
                                    + desired.targetKey());
                }
                String previous = targets.put(desired.targetKey(), desired.scope());
                if (previous != null && !previous.equals(desired.scope())) {
                    throw new IllegalArgumentException(
                            "Target key recorded with two scopes: " + desired.targetKey());
                }
            }
        }
    }

    private static List<UUID> sortedByUuidString(Set<UUID> ids) {
        return ids.stream().sorted(Comparator.comparing(UUID::toString)).toList();
    }
}
