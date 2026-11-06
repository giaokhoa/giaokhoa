package com.giaokhoa.authorization.fence;

import com.giaokhoa.authorization.model.AuthorizationPartition;
import com.giaokhoa.shared.http.HttpProblemException;
import java.sql.Array;
import java.sql.SQLException;
import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Resolves the dependency manifest of a protected request: the actor's ACCOUNT partition, the
 * target WORKSPACE partition and the upstream source closure of the requested targets — the
 * partitions owning a target projection plus, transitively, every partition those projections
 * depend on. Partitions that merely depend on the same sources (an independent grant sharing the
 * workspace) are not part of the manifest, so fencing one source never fences the others. A missing
 * partition means the projection was never recorded: fail closed with 503 instead of deciding on an
 * incomplete set.
 */
@Component
public class DependencyManifestResolver {
    static final String NOT_READY_CODE = "AUTHORIZATION_NOT_READY";
    static final String NOT_READY_DETAIL = "Quyền đang được đồng bộ, thử lại sau.";

    private final JdbcTemplate jdbc;

    public DependencyManifestResolver(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** One resolved manifest; partition IDs are in the stable lock order used by the fence. */
    public record Manifest(
            UUID actorUserId,
            UUID workspaceId,
            List<String> targetKeys,
            Map<String, String> recordedResourceIds,
            List<UUID> partitionIds) {
        public Manifest {
            targetKeys = List.copyOf(targetKeys);
            recordedResourceIds =
                    Map.copyOf(Objects.requireNonNull(recordedResourceIds, "recordedResourceIds"));
            partitionIds = List.copyOf(partitionIds);
        }
    }

    private record ProjectionRow(
            UUID partitionId, String keycloakResourceId, List<UUID> dependencyPartitionIds) {}

    public Manifest resolve(UUID actorUserId, UUID workspaceId, Collection<String> targetKeys) {
        Objects.requireNonNull(actorUserId, "actorUserId");
        Objects.requireNonNull(workspaceId, "workspaceId");
        if (targetKeys == null || targetKeys.isEmpty()) {
            throw new IllegalArgumentException("At least one target key is required");
        }
        Set<UUID> partitions = new TreeSet<>(Comparator.comparing(UUID::toString));
        Deque<UUID> frontier = new ArrayDeque<>();
        include(
                partitions,
                frontier,
                partitionId(AuthorizationPartition.Kind.ACCOUNT, "account:" + actorUserId));
        include(
                partitions,
                frontier,
                partitionId(AuthorizationPartition.Kind.WORKSPACE, "workspace:" + workspaceId));

        Map<String, String> resourceIds = new LinkedHashMap<>();
        for (String targetKey : new LinkedHashSet<>(targetKeys)) {
            ProjectionRow target = projectionByTarget(targetKey);
            if (target == null) {
                continue;
            }
            if (target.keycloakResourceId() != null) {
                resourceIds.put(targetKey, target.keycloakResourceId());
            }
            include(partitions, frontier, target.partitionId());
            for (UUID dependency : target.dependencyPartitionIds()) {
                include(partitions, frontier, dependency);
            }
        }
        // Upstream closure: expand every partition in the set through the projections it owns.
        Set<UUID> expanded = new HashSet<>();
        while (!frontier.isEmpty()) {
            UUID owner = frontier.removeFirst();
            if (!expanded.add(owner)) {
                continue;
            }
            for (ProjectionRow owned : projectionsOwnedBy(owner)) {
                for (UUID dependency : owned.dependencyPartitionIds()) {
                    include(partitions, frontier, dependency);
                }
            }
        }
        return new Manifest(
                actorUserId,
                workspaceId,
                List.copyOf(targetKeys),
                resourceIds,
                List.copyOf(partitions));
    }

    private static void include(Set<UUID> partitions, Deque<UUID> frontier, UUID partitionId) {
        if (partitions.add(partitionId)) {
            frontier.add(partitionId);
        }
    }

    private UUID partitionId(AuthorizationPartition.Kind kind, String ownerKey) {
        List<UUID> found =
                jdbc.queryForList(
                        "SELECT id FROM authz_partition WHERE kind = ? AND owner_key = ?",
                        UUID.class,
                        kind.name(),
                        ownerKey);
        if (found.isEmpty()) {
            throw new HttpProblemException(
                    HttpStatus.SERVICE_UNAVAILABLE, NOT_READY_CODE, NOT_READY_DETAIL);
        }
        return found.getFirst();
    }

    private ProjectionRow projectionByTarget(String targetKey) {
        List<Map<String, Object>> rows =
                jdbc.queryForList(
                        "SELECT partition_id, keycloak_resource_id, dependency_partition_ids"
                                + " FROM authz_projection WHERE target_key = ?",
                        targetKey);
        return rows.isEmpty() ? null : toRow(rows.getFirst());
    }

    private List<ProjectionRow> projectionsOwnedBy(UUID partitionId) {
        return jdbc
                .queryForList(
                        "SELECT partition_id, keycloak_resource_id, dependency_partition_ids"
                                + " FROM authz_projection WHERE partition_id = ?",
                        partitionId)
                .stream()
                .map(DependencyManifestResolver::toRow)
                .toList();
    }

    private static ProjectionRow toRow(Map<String, Object> row) {
        return new ProjectionRow(
                (UUID) row.get("partition_id"),
                (String) row.get("keycloak_resource_id"),
                uuids(row.get("dependency_partition_ids")));
    }

    private static List<UUID> uuids(Object value) {
        if (value == null) {
            return List.of();
        }
        Object[] raw;
        if (value instanceof Array array) {
            try {
                raw = (Object[]) array.getArray();
            } catch (SQLException ex) {
                throw new IllegalStateException("Cannot read partition references", ex);
            }
        } else if (value instanceof Object[] objects) {
            raw = objects;
        } else {
            throw new IllegalStateException(
                    "Unexpected partition reference value: " + value.getClass());
        }
        return java.util.Arrays.stream(raw)
                .map(item ->
                        item instanceof UUID uuid ? uuid : UUID.fromString(String.valueOf(item)))
                .toList();
    }
}
