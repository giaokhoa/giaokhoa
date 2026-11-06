package com.giaokhoa.authorization.projection;

import com.giaokhoa.authorization.model.AuthorizationPartition;
import com.giaokhoa.authorization.model.AuthorizationProjection;
import com.giaokhoa.authorization.policy.NativePolicyTemplates;
import com.giaokhoa.authorization.policy.PolicyGraph;
import com.giaokhoa.authorization.policy.PolicyGraphWriter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.oauth2.core.OAuth2AuthorizationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClientException;

/**
 * Rebuilds the desired native graph of one fenced partition from durable rows, applies it through
 * the idempotent {@link PolicyGraphWriter} and only then publishes the partition READY at the
 * revision it verified. The desired state of a projection is its recorded {@code desired_hash}: the
 * SHA-256 of the canonical source descriptors rebuilt from the source rows, so a projection whose
 * source disappeared or changed can never be published from a stale graph. Failures leave the
 * partition fenced; nothing here opens a fence on partial evidence.
 */
@Component
public class ProjectionReconciler {
    public static final String ERROR_NO_RECORDED_PROJECTION = "NO_RECORDED_PROJECTION";
    public static final String ERROR_DESIRED_SOURCE_MISMATCH = "DESIRED_SOURCE_MISMATCH";
    public static final String ERROR_DEPENDENCY_NOT_READY = "DEPENDENCY_NOT_READY";
    public static final String ERROR_REVISION_SUPERSEDED = "REVISION_SUPERSEDED";

    private static final RowMapper<PartitionRow> PARTITION_MAPPER =
            (rs, row) ->
                    new PartitionRow(
                            rs.getObject("id", UUID.class),
                            rs.getLong("desired_revision"),
                            rs.getLong("applied_revision"),
                            AuthorizationPartition.State.valueOf(rs.getString("state")));
    private static final RowMapper<ProjectionRow> PROJECTION_MAPPER =
            (rs, row) ->
                    new ProjectionRow(
                            rs.getObject("id", UUID.class),
                            rs.getObject("partition_id", UUID.class),
                            rs.getString("target_key"),
                            rs.getString("keycloak_resource_id"),
                            stringList(rs, "policy_names"),
                            uuidList(rs, "dependency_partition_ids"),
                            rs.getString("desired_hash"),
                            rs.getString("applied_hash"),
                            AuthorizationProjection.State.valueOf(rs.getString("state")));

    private final JdbcTemplate jdbc;
    private final PolicyGraphWriter writer;
    private final TransactionTemplate transactions;

    public ProjectionReconciler(
            JdbcTemplate jdbc,
            PolicyGraphWriter writer,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.writer = writer;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /** A reconciliation failure carrying the durable error code recorded on the operation. */
    public static final class ReconciliationException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        private final String code;

        public ReconciliationException(String errorCode, String message) {
            super(message);
            this.code = errorCode;
        }

        public String errorCode() {
            return code;
        }
    }

    public record PartitionRow(
            UUID id,
            long desiredRevision,
            long appliedRevision,
            AuthorizationPartition.State state) {}

    public record ProjectionRow(
            UUID id,
            UUID partitionId,
            String targetKey,
            String keycloakResourceId,
            List<String> policyNames,
            List<UUID> dependencyPartitionIds,
            String desiredHash,
            String appliedHash,
            AuthorizationProjection.State state) {
        public ProjectionRow {
            policyNames = List.copyOf(policyNames);
            dependencyPartitionIds = List.copyOf(dependencyPartitionIds);
        }
    }

    private sealed interface Resolved {
        record Apply(String scope, PolicyGraph graph) implements Resolved {}

        record Retract(String scope) implements Resolved {}
    }

    private record Outcome(
            ProjectionRow projection, Resolved resolved, PolicyGraphWriter.AppliedGraph applied) {}

    public PartitionRow partition(UUID partitionId) {
        return jdbc.queryForObject(
                "SELECT id, desired_revision, applied_revision, state FROM authz_partition"
                        + " WHERE id = ?",
                PARTITION_MAPPER,
                partitionId);
    }

    public List<ProjectionRow> projectionsOf(UUID partitionId) {
        return jdbc.query(
                "SELECT id, partition_id, target_key, keycloak_resource_id, policy_names,"
                        + " dependency_partition_ids, desired_hash, applied_hash, state"
                        + " FROM authz_projection WHERE partition_id = ? ORDER BY target_key",
                PROJECTION_MAPPER,
                partitionId);
    }

    /** Reconciles the partition at whatever revision is currently desired. */
    public void reconcilePartition(UUID partitionId) {
        reconcile(partitionId, null);
    }

    /**
     * Reconciles the partition only if {@code expectedDesiredRevision} is still the desired one.
     */
    public void reconcilePartition(UUID partitionId, long expectedDesiredRevision) {
        reconcile(partitionId, expectedDesiredRevision);
    }

    private void reconcile(UUID partitionId, Long expectedDesiredRevision) {
        PartitionRow partition = partition(partitionId);
        if (expectedDesiredRevision != null
                && partition.desiredRevision() != expectedDesiredRevision) {
            throw new ReconciliationException(
                    ERROR_REVISION_SUPERSEDED,
                    "Partition desired revision moved past " + expectedDesiredRevision);
        }
        if (partition.state() == AuthorizationPartition.State.READY) {
            if (partition.appliedRevision() == partition.desiredRevision()) {
                return;
            }
            throw new ReconciliationException(
                    ERROR_REVISION_SUPERSEDED, "READY partition has an unapplied revision");
        }
        List<ProjectionRow> projections = projectionsOf(partitionId);
        if (projections.isEmpty()) {
            // Nothing recorded to verify against: publishing READY would be a guess, so the
            // fence stays closed and the operation keeps retrying within its attempt budget.
            throw new ReconciliationException(
                    ERROR_NO_RECORDED_PROJECTION,
                    "Partition has no recorded projection to reconcile: " + partitionId);
        }
        List<Resolved> resolved = new ArrayList<>();
        for (ProjectionRow projection : projections) {
            resolved.add(resolve(projection));
        }
        for (ProjectionRow projection : projections) {
            for (UUID dependency : projection.dependencyPartitionIds()) {
                PartitionRow dependencyPartition = partition(dependency);
                if (dependencyPartition.state() != AuthorizationPartition.State.READY
                        || dependencyPartition.appliedRevision()
                                != dependencyPartition.desiredRevision()) {
                    throw new ReconciliationException(
                            ERROR_DEPENDENCY_NOT_READY,
                            "Dependency partition is not READY: " + dependency);
                }
            }
        }
        List<Outcome> outcomes = new ArrayList<>();
        for (int i = 0; i < projections.size(); i++) {
            ProjectionRow projection = projections.get(i);
            Resolved step = resolved.get(i);
            if (step instanceof Resolved.Apply apply) {
                outcomes.add(new Outcome(projection, step, writer.apply(apply.graph())));
            } else if (step instanceof Resolved.Retract retract) {
                writer.retractRoot(projection.targetKey(), retract.scope());
                outcomes.add(new Outcome(projection, step, null));
            }
        }
        publish(partition, outcomes);
    }

    /** Fences a partition and its projections; used before repairing out-of-band drift. */
    public void fencePartition(UUID partitionId) {
        transactions.executeWithoutResult(status -> {
            jdbc.update(
                    "UPDATE authz_partition SET state = 'PENDING', updated_at = now()"
                            + " WHERE id = ? AND state = 'READY'",
                    partitionId);
            jdbc.update(
                    "UPDATE authz_projection SET state = 'PENDING'"
                            + " WHERE partition_id = ? AND state = 'READY'",
                    partitionId);
        });
    }

    /**
     * Drift check for a READY partition: false only when a projection whose desired state still
     * rebuilds exactly from durable rows is provably altered in Keycloak at the level {@link
     * PolicyGraphWriter#isGraphIntact} verifies — resource or recorded policy missing, or the root
     * permission no longer linking exactly the recorded policy set to the recorded resource. Rows
     * whose source no longer rebuilds, and any Keycloak read failure, are not proof of drift and
     * never fence the partition on their own.
     */
    public boolean verifyStoredGraph(UUID partitionId) {
        for (ProjectionRow projection : projectionsOf(partitionId)) {
            if (projection.appliedHash() == null || projection.keycloakResourceId() == null) {
                return false;
            }
            Resolved resolved;
            try {
                resolved = resolve(projection);
            } catch (ReconciliationException ex) {
                continue;
            }
            if (resolved instanceof Resolved.Retract) {
                return false;
            }
            Resolved.Apply apply = (Resolved.Apply) resolved;
            boolean intact;
            try {
                intact =
                        writer.isGraphIntact(
                                projection.targetKey(),
                                apply.scope(),
                                projection.keycloakResourceId(),
                                projection.policyNames());
            } catch (RestClientException
                    | IllegalStateException
                    | OAuth2AuthorizationException ex) {
                continue;
            }
            if (!intact) {
                return false;
            }
        }
        return true;
    }

    /**
     * Best-effort reconciliation for partitions without a live operation: returns false instead of
     * throwing when the partition cannot converge now, so the caller can move on and the fence
     * simply stays closed for the next cycle.
     */
    public boolean tryReconcilePartition(UUID partitionId) {
        try {
            reconcilePartition(partitionId);
            return true;
        } catch (ReconciliationException
                | RestClientException
                | DataAccessException
                | IllegalStateException
                | OAuth2AuthorizationException ex) {
            return false;
        }
    }

    private void publish(PartitionRow snapshot, List<Outcome> outcomes) {
        transactions.executeWithoutResult(status -> {
            PartitionRow current =
                    jdbc.queryForObject(
                            "SELECT id, desired_revision, applied_revision, state"
                                    + " FROM authz_partition WHERE id = ? FOR UPDATE",
                            PARTITION_MAPPER,
                            snapshot.id());
            if (current.desiredRevision() != snapshot.desiredRevision()) {
                throw new ReconciliationException(
                        ERROR_REVISION_SUPERSEDED,
                        "Desired revision changed during reconciliation");
            }
            for (Outcome outcome : outcomes) {
                ProjectionRow projection = outcome.projection();
                if (outcome.resolved() instanceof Resolved.Retract) {
                    jdbc.update("DELETE FROM authz_projection WHERE id = ?", projection.id());
                } else {
                    PolicyGraphWriter.AppliedGraph applied = outcome.applied();
                    jdbc.update(
                            "UPDATE authz_projection SET applied_hash = desired_hash,"
                                    + " keycloak_resource_id = ?, policy_names = ?,"
                                    + " state = 'READY' WHERE id = ?",
                            ps -> {
                                ps.setString(1, applied.resourceId());
                                ps.setArray(
                                        2,
                                        ps.getConnection()
                                                .createArrayOf(
                                                        "text",
                                                        applied.policyNames()
                                                                .toArray(new String[0])));
                                ps.setObject(3, projection.id());
                            });
                }
            }
            jdbc.update(
                    "UPDATE authz_partition SET applied_revision = ?, state = 'READY',"
                            + " updated_at = now() WHERE id = ?",
                    snapshot.desiredRevision(),
                    snapshot.id());
        });
    }

    private Resolved resolve(ProjectionRow projection) {
        NativePolicyTemplates.TargetType type =
                NativePolicyTemplates.targetTypeOf(projection.targetKey())
                        .orElseThrow(() ->
                                new ReconciliationException(
                                        ERROR_DESIRED_SOURCE_MISMATCH,
                                        "Target key matches no fixed template: "
                                                + projection.targetKey()));
        for (String scope : type.scopes()) {
            if (desiredHash(projection.targetKey(), scope, List.of())
                    .equals(projection.desiredHash())) {
                return new Resolved.Retract(scope);
            }
        }
        for (String scope : type.scopes()) {
            List<String> sources = reconstructSources(projection.targetKey(), type, scope);
            if (!sources.isEmpty()
                    && desiredHash(projection.targetKey(), scope, sources)
                            .equals(projection.desiredHash())) {
                return new Resolved.Apply(scope, graphFor(projection.targetKey(), scope, sources));
            }
        }
        throw new ReconciliationException(
                ERROR_DESIRED_SOURCE_MISMATCH,
                "Desired hash does not match any source rebuilt from durable rows: "
                        + projection.targetKey());
    }

    private List<String> reconstructSources(
            String targetKey, NativePolicyTemplates.TargetType type, String scope) {
        if (type != NativePolicyTemplates.TargetType.WORKSPACE) {
            return List.of();
        }
        UUID workspaceId = UUID.fromString(targetKey.substring("workspace:".length()));
        Optional<String> owner =
                jdbc
                        .query(
                                "SELECT u.id, u.keycloak_sub FROM workspace w"
                                        + " JOIN user_account u ON u.id = w.owner_user_id"
                                        + " WHERE w.id = ? AND w.kind = 'PERSONAL'"
                                        + " AND u.email_verified AND u.identity_state = 'ACTIVE'",
                                (rs, row) ->
                                        personalOwnerDescriptor(
                                                workspaceId,
                                                rs.getObject(1, UUID.class),
                                                rs.getString(2),
                                                targetKey,
                                                scope),
                                workspaceId)
                        .stream()
                        .findFirst();
        return owner.map(List::of).orElse(List.of());
    }

    /** The canonical personal-owner source descriptor, rebuilt from the durable owner rows. */
    public static String personalOwnerDescriptor(
            UUID workspaceId, UUID userId, String keycloakSubject, String targetKey, String scope) {
        return "PERSONAL_OWNER|workspace="
                + workspaceId
                + "|user="
                + userId
                + "|subject="
                + keycloakSubject
                + "|target="
                + targetKey
                + "|scope="
                + scope;
    }

    /** The canonical descriptor of a graph that must no longer exist for the pair. */
    public static String retractDescriptor(String targetKey, String scope) {
        return "RETRACT|target=" + targetKey + "|scope=" + scope;
    }

    /**
     * The desired hash recorded on a projection: SHA-256 of the canonical source descriptors,
     * sorted and joined by newline; an empty source set hashes the retract descriptor instead.
     */
    public static String desiredHash(
            String targetKey, String scope, List<String> sourceDescriptors) {
        List<String> sorted = sourceDescriptors.stream().sorted().distinct().toList();
        if (sorted.isEmpty()) {
            return sha256(retractDescriptor(targetKey, scope));
        }
        return sha256(String.join("\n", sorted));
    }

    /** Builds the native graph of one target/scope pair from its canonical source descriptors. */
    public static PolicyGraph graphFor(
            String targetKey, String scope, List<String> sourceDescriptors) {
        List<PolicyGraph.Source> sources = new ArrayList<>();
        for (String descriptor : sourceDescriptors) {
            sources.add(new PolicyGraph.Source(List.of(actorGate(descriptor))));
        }
        return new PolicyGraph(targetKey, scope, List.of(), sources);
    }

    private static PolicyGraph.Gate actorGate(String descriptor) {
        String[] parts = descriptor.split("\\|", -1);
        if (parts.length < 2 || !"PERSONAL_OWNER".equals(parts[0])) {
            throw new IllegalArgumentException("Unsupported source descriptor: " + descriptor);
        }
        for (String part : parts) {
            if (part.startsWith("subject=") && part.length() > "subject=".length()) {
                return new PolicyGraph.Gate.Actor(part.substring("subject=".length()));
            }
        }
        throw new IllegalArgumentException("Source descriptor has no subject: " + descriptor);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is required", ex);
        }
    }

    private static List<String> stringList(ResultSet rs, String column) throws SQLException {
        Array array = rs.getArray(column);
        if (array == null) {
            return List.of();
        }
        Object[] raw = (Object[]) array.getArray();
        List<String> out = new ArrayList<>(raw.length);
        for (Object item : raw) {
            out.add(String.valueOf(item));
        }
        return List.copyOf(out);
    }

    private static List<UUID> uuidList(ResultSet rs, String column) throws SQLException {
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
}
