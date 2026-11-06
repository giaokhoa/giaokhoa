package com.giaokhoa.authorization.policy;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;

/**
 * The desired native policy graph for one target/scope pair. The root permission ANDs the common
 * gates (applied outside the OR, identity eligibility first of all) with the OR of the independent
 * sources; each source ANDs all of its mandatory gates. A gate is only ever a current realm group,
 * a concrete actor, or a validity window: prerequisite roles are projected as groups, so no gate
 * can reference a global realm role. A validity window {@code [validFrom, expiresAt)} is written as
 * a POSITIVE not-before at its start and a NEGATIVE not-before at its end.
 *
 * <p>The canonical descriptor is the deterministic serialization of the graph; its SHA-256 is the
 * desired hash recorded on the projection, so the same domain sources always rebuild the same
 * graph.
 */
public record PolicyGraph(
        String targetKey, String scope, List<Gate> commonGates, List<Source> sources) {

    public PolicyGraph {
        NativePolicyTemplates.TargetType type =
                NativePolicyTemplates.targetTypeOf(targetKey)
                        .orElseThrow(() ->
                                new IllegalArgumentException(
                                        "Target key matches no fixed template: " + targetKey));
        if (scope == null || !type.scopes().contains(scope)) {
            throw new IllegalArgumentException(
                    "Scope is not fixed for target " + targetKey + ": " + scope);
        }
        commonGates = List.copyOf(canonicalGates(commonGates));
        if (sources == null || sources.isEmpty()) {
            throw new IllegalArgumentException("At least one independent source is required");
        }
        sources =
                List.copyOf(
                        sources.stream()
                                .distinct()
                                .sorted((a, b) -> a.descriptor().compareTo(b.descriptor()))
                                .toList());
    }

    /** A graph without common gates. */
    public PolicyGraph(String targetKey, String scope, List<Source> sources) {
        this(targetKey, scope, List.of(), sources);
    }

    /** The common identity-eligibility gate plus the given independent sources. */
    public static PolicyGraph forEligibleActor(
            String targetKey, String scope, List<Source> sources) {
        return new PolicyGraph(
                targetKey,
                scope,
                List.of(new Gate.GroupMembership(NativePolicyTemplates.ELIGIBILITY_GROUP)),
                sources);
    }

    /** Canonical serialization; gate and source order in the input never changes it. */
    public String descriptor() {
        StringBuilder out =
                new StringBuilder("GRAPH|target=")
                        .append(targetKey)
                        .append("|scope=")
                        .append(scope);
        if (!commonGates.isEmpty()) {
            out.append("|common=").append(joinGates(commonGates));
        }
        for (Source source : sources) {
            out.append("|source=").append(source.descriptor());
        }
        return out.toString();
    }

    /** SHA-256 of the canonical descriptor, as recorded on the authorization projection. */
    public String desiredHash() {
        return sha256(descriptor());
    }

    /** One mandatory condition of a source or of the graph itself. */
    public sealed interface Gate permits Gate.GroupMembership, Gate.Actor, Gate.Validity {
        String descriptor();

        /** Membership of a current realm group, resolved by its fixed template path. */
        record GroupMembership(String groupPath) implements Gate {
            public GroupMembership {
                if (!NativePolicyTemplates.isGroupSource(groupPath)) {
                    throw new IllegalArgumentException(
                            "Group path matches no fixed template: " + groupPath);
                }
            }

            @Override
            public String descriptor() {
                return "GROUP|path=" + groupPath;
            }
        }

        /** A concrete Keycloak user: an individual owner or grant recipient. */
        record Actor(String keycloakUserId) implements Gate {
            public Actor {
                if (keycloakUserId == null || keycloakUserId.isBlank()) {
                    throw new IllegalArgumentException("Keycloak user ID is required");
                }
            }

            @Override
            public String descriptor() {
                return "USER|subject=" + keycloakUserId;
            }
        }

        /** A {@code [validFrom, expiresAt)} window; either bound may stand alone. */
        record Validity(Instant validFrom, Instant expiresAt) implements Gate {
            public Validity {
                if (validFrom == null && expiresAt == null) {
                    throw new IllegalArgumentException("A validity window needs a bound");
                }
                if (validFrom != null && expiresAt != null && !validFrom.isBefore(expiresAt)) {
                    throw new IllegalArgumentException("Validity start must precede its end");
                }
            }

            @Override
            public String descriptor() {
                return "VALIDITY|from="
                        + (validFrom == null ? "-" : validFrom)
                        + "|until="
                        + (expiresAt == null ? "-" : expiresAt);
            }
        }
    }

    /** One independent way to be granted: every gate of the source must hold together. */
    public record Source(List<Gate> gates) {
        public Source {
            gates = List.copyOf(canonicalGates(gates));
            if (gates.isEmpty()) {
                throw new IllegalArgumentException("A source needs at least one gate");
            }
        }

        public static Source of(Gate... gates) {
            return new Source(List.of(gates));
        }

        public String descriptor() {
            return joinGates(gates);
        }

        /** Short stable identifier of this exact gate set, used in the native policy name. */
        public String descriptorHash() {
            return sha256(descriptor()).substring(0, 32);
        }
    }

    private static List<Gate> canonicalGates(List<Gate> gates) {
        if (gates == null) {
            return List.of();
        }
        return gates.stream()
                .distinct()
                .sorted((a, b) -> a.descriptor().compareTo(b.descriptor()))
                .toList();
    }

    private static String joinGates(List<Gate> gates) {
        StringBuilder out = new StringBuilder();
        for (Gate gate : gates) {
            if (!out.isEmpty()) {
                out.append('&');
            }
            out.append(gate.descriptor());
        }
        return out.toString();
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
}
