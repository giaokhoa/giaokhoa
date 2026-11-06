package com.giaokhoa.verification;

import com.giaokhoa.authorization.decision.ProtectedActionExecutor;
import com.giaokhoa.authorization.fence.AuthorizationFence;
import com.giaokhoa.authorization.operation.IdempotencyService;
import com.giaokhoa.authorization.policy.NativePolicyTemplates;
import com.giaokhoa.shared.http.HttpProblemException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sample actions of the verification contract. Every action runs through the same
 * manifest/fence/PDP pipeline as business actions and never accepts a substitute actor. Only the
 * fixed CREATE_RESOURCE discriminator is implemented in the foundation phase; it returns a stub
 * result because no sample-resource table exists yet. Unknown actions are rejected, never silently
 * allowed.
 */
@RestController
public class SampleActionController {
    private final ProtectedActionExecutor executor;
    private final IdempotencyService idempotency;
    private final JdbcTemplate jdbc;

    public SampleActionController(
            ProtectedActionExecutor executor, IdempotencyService idempotency, JdbcTemplate jdbc) {
        this.executor = executor;
        this.idempotency = idempotency;
        this.jdbc = jdbc;
    }

    public record SampleActionRequest(
            String action, UUID courseSubjectId, UUID subjectId, String kind, String label) {}

    public record SampleActionResult(
            UUID id, String state, boolean completed, String targetType, UUID targetId) {}

    @PostMapping("/api/workspaces/{workspaceId}/samples/actions")
    public ResponseEntity<SampleActionResult> act(
            @PathVariable UUID workspaceId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @RequestBody SampleActionRequest request,
            Authentication authentication,
            HttpServletRequest httpRequest) {
        idempotency.requireKey(idempotencyKey);
        if (request == null || !"CREATE_RESOURCE".equals(request.action())) {
            throw new HttpProblemException(
                    HttpStatus.BAD_REQUEST,
                    "UNSUPPORTED_SAMPLE_ACTION",
                    "Hành động mẫu chưa được hỗ trợ.");
        }
        if (request.subjectId() == null
                || request.kind() == null
                || request.kind().isBlank()
                || request.label() == null
                || request.label().isBlank()) {
            throw new HttpProblemException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_SAMPLE_ACTION",
                    "Hành động mẫu thiếu trường bắt buộc.");
        }
        SampleActionResult result =
                request.courseSubjectId() != null
                        ? createForCourseSubject(workspaceId, request, authentication, httpRequest)
                        : createForPersonalOwner(workspaceId, authentication, httpRequest);
        return ResponseEntity.status(HttpStatus.CREATED)
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(result);
    }

    private SampleActionResult createForCourseSubject(
            UUID workspaceId,
            SampleActionRequest request,
            Authentication authentication,
            HttpServletRequest httpRequest) {
        var target =
                new ProtectedActionExecutor.Target(
                        NativePolicyTemplates.courseSubjectKey(
                                workspaceId, request.courseSubjectId()),
                        List.of("resource.create"));
        return executor.execute(
                authentication, httpRequest, workspaceId, List.of(target), this::stubResult);
    }

    private SampleActionResult createForPersonalOwner(
            UUID workspaceId, Authentication authentication, HttpServletRequest httpRequest) {
        UUID actorUserId = actorUserId(authentication);
        List<Map<String, Object>> rows =
                jdbc.queryForList(
                        "SELECT kind, owner_user_id FROM workspace WHERE id = ?", workspaceId);
        if (rows.isEmpty()) {
            throw new HttpProblemException(
                    HttpStatus.NOT_FOUND, "NOT_FOUND", "Không tìm thấy tài nguyên.");
        }
        Map<String, Object> workspace = rows.getFirst();
        if (!"PERSONAL".equals(workspace.get("kind"))
                || !actorUserId.equals(workspace.get("owner_user_id"))) {
            throw new HttpProblemException(
                    HttpStatus.FORBIDDEN,
                    "PERMISSION_DENIED",
                    "Không có quyền thực hiện thao tác.");
        }
        var target =
                new ProtectedActionExecutor.Target(
                        NativePolicyTemplates.workspaceKey(workspaceId), List.of("enter"));
        return executor.execute(
                authentication,
                httpRequest,
                workspaceId,
                List.of(target),
                () -> {
                    // The personal branch of the contract is owner plus a live subscription
                    // period, checked inside the fence transaction so a period expiring
                    // mid-request cannot slip a stale allow through.
                    Integer active =
                            jdbc.queryForObject(
                                    "SELECT count(*) FROM subscription_period"
                                            + " WHERE workspace_id = ? AND valid_from <= now()"
                                            + " AND expires_at > now()",
                                    Integer.class,
                                    workspaceId);
                    if (active == null || active == 0) {
                        throw new HttpProblemException(
                                HttpStatus.FORBIDDEN,
                                "SUBSCRIPTION_INACTIVE",
                                "Gói sử dụng không còn hiệu lực.");
                    }
                    return stubResult();
                });
    }

    private SampleActionResult stubResult() {
        UUID id = UUID.randomUUID();
        return new SampleActionResult(id, "SUCCEEDED", true, "RESOURCE", id);
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
            throw AuthorizationFence.notReady();
        }
        return found.getFirst();
    }
}
