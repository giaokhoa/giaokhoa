package com.giaokhoa.authorization.policy;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * Desired native policy graph cho một cặp target/scope. Root permission AND các common gate (áp
 * ngoài OR, identity eligibility trước hết) với OR của các source độc lập; mỗi source AND mọi
 * mandatory gate của nó. Một gate chỉ có thể là một realm group hiện hành, một actor cụ thể, hoặc
 * một validity window: prerequisite role được chiếu thành group, nên không gate nào tham chiếu được
 * global realm role. Một validity window {@code [validFrom, expiresAt)} được viết thành một
 * not-before POSITIVE tại đầu và một not-before NEGATIVE tại cuối của nó.
 *
 * <p>Canonical descriptor là dạng serialization xác định của graph; SHA-256 của nó là desired hash
 * ghi trên projection, nên cùng các domain source luôn dựng lại cùng một graph.
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
        if (NativePolicyTemplates.requiresEligibility(type, scope)
                && !commonGates.contains(
                        new Gate.GroupMembership(NativePolicyTemplates.ELIGIBILITY_GROUP))) {
            throw new IllegalArgumentException(
                    "Business permissions must require the identity eligibility gate");
        }
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

    /** Constructor tiện ích an toàn cho nghiệp vụ: eligibility là common gate bắt buộc. */
    public PolicyGraph(String targetKey, String scope, List<Source> sources) {
        this(
                targetKey,
                scope,
                List.of(new Gate.GroupMembership(NativePolicyTemplates.ELIGIBILITY_GROUP)),
                sources);
    }

    /** Identity-eligibility gate chung cộng các source độc lập cho trước. */
    public static PolicyGraph forEligibleActor(
            String targetKey, String scope, List<Source> sources) {
        return new PolicyGraph(
                targetKey,
                scope,
                List.of(new Gate.GroupMembership(NativePolicyTemplates.ELIGIBILITY_GROUP)),
                sources);
    }

    /** Serialization canonical; thứ tự gate và source trong đầu vào không bao giờ thay đổi nó. */
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

    /** SHA-256 của canonical descriptor, như được ghi trên authorization projection. */
    public String desiredHash() {
        return sha256(descriptor());
    }

    /** Một điều kiện bắt buộc của một source hoặc của chính graph. */
    public sealed interface Gate permits Gate.GroupMembership, Gate.Actor, Gate.Validity {
        String descriptor();

        /**
         * Tư cách thành viên của một realm group hiện hành, resolve theo template path cố định của
         * nó.
         */
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

        /** Một user Keycloak cụ thể: một owner cá nhân hoặc người nhận grant. */
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

        /** Một cửa sổ {@code [validFrom, expiresAt)}; mỗi biên có thể đứng độc lập. */
        record Validity(@Nullable Instant validFrom, @Nullable Instant expiresAt) implements Gate {
            public Validity {
                if (validFrom == null && expiresAt == null) {
                    throw new IllegalArgumentException("A validity window needs a bound");
                }
                if ((validFrom != null && validFrom.getNano() != 0)
                        || (expiresAt != null && expiresAt.getNano() != 0)) {
                    throw new IllegalArgumentException(
                            "Native Keycloak time policies support whole-second boundaries only");
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

    /** Một cách độc lập để được cấp: mọi gate của source phải cùng thỏa. */
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

        /** Định danh ngắn ổn định của đúng tập gate này, dùng trong native policy name. */
        public String descriptorHash() {
            return sha256(descriptor()).substring(0, 32);
        }
    }

    private static List<Gate> canonicalGates(@Nullable List<Gate> gates) {
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
