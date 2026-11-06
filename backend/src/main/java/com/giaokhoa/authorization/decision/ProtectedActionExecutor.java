package com.giaokhoa.authorization.decision;

import com.giaokhoa.authorization.fence.AuthorizationFence;
import com.giaokhoa.authorization.fence.DependencyManifestResolver;
import com.giaokhoa.authorization.fence.DependencyManifestResolver.Manifest;
import com.giaokhoa.authorization.policy.NativePolicyTemplates;
import com.giaokhoa.authorization.policy.PolicyGraphWriter;
import com.giaokhoa.shared.http.HttpProblemException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

/**
 * The protected-action pipeline of the authorization contract: resolve the actor from the session,
 * resolve the dependency manifest, hold the transaction fence, ask the Keycloak PDP about every
 * required resource/scope pair with the user's own token — outside any database transaction — and
 * only then run the caller's read or mutation inside a second fence transaction that proves the
 * recorded revisions did not move. A closure or revision change restarts the pipeline with a fresh
 * manifest; a fenced partition or an unverifiable decision fails closed with 503, a native deny
 * with 403 for actions.
 */
@Component
public class ProtectedActionExecutor {
    private static final int MAX_ATTEMPTS = 3;

    private final DependencyManifestResolver resolver;
    private final AuthorizationFence fence;
    private final KeycloakDecisionClient decisions;
    private final PolicyGraphWriter writer;
    private final JdbcTemplate jdbc;

    public ProtectedActionExecutor(
            DependencyManifestResolver resolver,
            AuthorizationFence fence,
            KeycloakDecisionClient decisions,
            PolicyGraphWriter writer,
            JdbcTemplate jdbc) {
        this.resolver = resolver;
        this.fence = fence;
        this.decisions = decisions;
        this.writer = writer;
        this.jdbc = jdbc;
    }

    /** One target of a protected request and the fixed-template scopes it needs. */
    public record Target(String targetKey, List<String> scopes) {
        public Target {
            NativePolicyTemplates.TargetType type =
                    NativePolicyTemplates.targetTypeOf(targetKey)
                            .orElseThrow(() ->
                                    new IllegalArgumentException(
                                            "Target key matches no fixed template: " + targetKey));
            scopes = scopes == null ? List.of() : List.copyOf(scopes);
            if (scopes.isEmpty() || !type.scopes().containsAll(scopes)) {
                throw new IllegalArgumentException(
                        "Scopes are not fixed for target " + targetKey + ": " + scopes);
            }
        }
    }

    /** The PDP answer of every requested pair; a pair is allowed only on a native allow. */
    public record Decisions(Map<String, Map<String, Boolean>> byTarget) {
        public Decisions {
            byTarget = Map.copyOf(Objects.requireNonNull(byTarget, "byTarget"));
        }

        public boolean allowed(String targetKey, String scope) {
            return byTarget.getOrDefault(targetKey, Map.of()).getOrDefault(scope, false);
        }

        public boolean allAllowed() {
            return byTarget.values().stream()
                    .flatMap(perScope -> perScope.values().stream())
                    .allMatch(Boolean::booleanValue);
        }
    }

    /** Evaluates every pair and returns the decisions for display; never runs an action. */
    public Decisions evaluate(
            Authentication authentication,
            HttpServletRequest request,
            UUID workspaceId,
            List<Target> targets) {
        return run(authentication, request, workspaceId, targets, (snapshot, result) -> result);
    }

    /**
     * Evaluates every pair, then runs {@code action} inside the closing fence transaction. Any
     * native deny aborts with 403 before the action runs.
     */
    public <T> T execute(
            Authentication authentication,
            HttpServletRequest request,
            UUID workspaceId,
            List<Target> targets,
            Supplier<T> action) {
        return run(
                authentication,
                request,
                workspaceId,
                targets,
                (snapshot, result) -> {
                    if (!result.allAllowed()) {
                        throw new HttpProblemException(
                                HttpStatus.FORBIDDEN,
                                "PERMISSION_DENIED",
                                "Không có quyền thực hiện thao tác.");
                    }
                    return action.get();
                });
    }

    private <T> T run(
            Authentication authentication,
            HttpServletRequest request,
            UUID workspaceId,
            List<Target> targets,
            java.util.function.BiFunction<AuthorizationFence.Snapshot, Decisions, T> finisher) {
        if (targets == null || targets.isEmpty()) {
            throw new IllegalArgumentException("At least one target is required");
        }
        UUID actorUserId = actorUserId(authentication);
        List<String> targetKeys = targets.stream().map(Target::targetKey).toList();
        for (int attempt = 1; ; attempt++) {
            Manifest manifest = resolver.resolve(actorUserId, workspaceId, targetKeys);
            AuthorizationFence.Snapshot snapshot = fence.acquire(manifest);
            Decisions result = decide(authentication, request, manifest, targets);
            try {
                return fence.atSnapshot(snapshot, () -> finisher.apply(snapshot, result));
            } catch (AuthorizationFence.ClosureChangedException changed) {
                if (attempt >= MAX_ATTEMPTS) {
                    throw AuthorizationFence.notReady(changed);
                }
            }
        }
    }

    private Decisions decide(
            Authentication authentication,
            HttpServletRequest request,
            Manifest manifest,
            List<Target> targets) {
        Map<String, Map<String, Boolean>> byTarget = new LinkedHashMap<>();
        for (Target target : targets) {
            String resourceId = manifest.recordedResourceIds().get(target.targetKey());
            if (resourceId == null) {
                // Native resources are named by target key; the recorded projection ID wins
                // whenever one exists, this lookup only covers targets without a projection.
                resourceId = writer.findResourceId(target.targetKey()).orElse(null);
            }
            Map<String, Boolean> perScope = new LinkedHashMap<>();
            for (String scope : target.scopes()) {
                perScope.put(
                        scope,
                        resourceId != null
                                && decisions.isAllowed(
                                        authentication,
                                        request,
                                        RequiredPermissions.of(
                                                RequiredPermissions.require(resourceId, scope))));
            }
            byTarget.put(target.targetKey(), perScope);
        }
        return new Decisions(byTarget);
    }

    private UUID actorUserId(Authentication authentication) {
        if (authentication == null || authentication.getName() == null) {
            throw new HttpProblemException(
                    HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Cần đăng nhập.");
        }
        List<UUID> found =
                jdbc.queryForList(
                        "SELECT id FROM user_account WHERE keycloak_sub = ?",
                        UUID.class,
                        authentication.getName());
        if (found.isEmpty()) {
            // An authenticated session without a directory account has no ACCOUNT partition to
            // fence, so no protected decision may be taken for it.
            throw AuthorizationFence.notReady();
        }
        return found.getFirst();
    }
}
