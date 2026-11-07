package com.giaokhoa.identity;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.giaokhoa.authorization.decision.KeycloakDecisionClient;
import com.giaokhoa.authorization.decision.ProtectedActionExecutor;
import com.giaokhoa.authorization.decision.RequiredPermissions;
import com.giaokhoa.authorization.permission.PermissionCatalog;
import com.giaokhoa.authorization.policy.NativePolicyTemplates;
import com.giaokhoa.authorization.policy.PolicyGraphWriter;
import com.giaokhoa.identity.RecoveryService.Decision;
import com.giaokhoa.identity.RecoveryService.RequestView;
import com.giaokhoa.shared.http.HttpProblemException;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Bề mặt HTTP của luồng hỗ trợ khôi phục danh tính: người dùng gửi yêu cầu, platform operator xem
 * hàng đợi và quyết định. Quyền operator không suy ra từ role nội bộ nào: mỗi lời gọi đều hỏi
 * Keycloak PDP bằng token của chính người gọi trên resource platform với scope account.recover,
 * đúng mô hình quyết định của control-plane (không qua fence nghiệp vụ của action thường).
 */
@RestController
public class RecoveryController {
    private final RecoveryService recovery;
    private final ProtectedActionExecutor executor;
    private final KeycloakDecisionClient decisions;
    private final PolicyGraphWriter policyWriter;

    public RecoveryController(
            RecoveryService recovery,
            ProtectedActionExecutor executor,
            KeycloakDecisionClient decisions,
            PolicyGraphWriter policyWriter) {
        this.recovery = recovery;
        this.executor = executor;
        this.decisions = decisions;
        this.policyWriter = policyWriter;
    }

    public record SubmitRequest(@Nullable UUID targetUserId, @Nullable UUID workspaceId) {}

    public record SubmitReceipt(
            UUID operationId, String state, boolean completed, String statusUrl) {}

    public record ResolveRequest(@Nullable String decision, @Nullable String verificationNote) {}

    public record ResolveReceipt(
            UUID id, String state, boolean completed, String targetType, UUID targetId) {}

    public record RequestItem(
            UUID id,
            UUID requesterUserId,
            @JsonInclude(JsonInclude.Include.NON_NULL) @Nullable UUID workspaceId,
            UUID targetUserId,
            String state,
            @JsonInclude(JsonInclude.Include.NON_NULL) @Nullable UUID verifiedBy,
            @JsonInclude(JsonInclude.Include.NON_NULL) @Nullable Instant resolvedAt,
            @JsonInclude(JsonInclude.Include.NON_NULL) @Nullable String verificationNote,
            Instant createdAt) {}

    @PostMapping("/api/me/recovery-requests")
    public ResponseEntity<SubmitReceipt> submit(
            Authentication authentication, @RequestBody @Nullable SubmitRequest body) {
        if (body == null || body.targetUserId() == null) {
            throw new HttpProblemException(
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_FAILED",
                    "Thiếu tài khoản đích của yêu cầu.");
        }
        UUID actor = executor.actorUserId(authentication);
        RequestView created =
                Objects.requireNonNull(
                        recovery.submit(actor, body.targetUserId(), body.workspaceId()));
        // Yêu cầu được ghi đồng bộ ngay trong lời gọi này nhưng vòng đời của nó chưa kết thúc:
        // biên nhận 202 mang chính ID của yêu cầu làm operationId để client poll qua endpoint
        // operations chung, nơi trạng thái yêu cầu được ánh xạ sang vòng đời operation.
        SubmitReceipt receipt =
                new SubmitReceipt(
                        created.id(), "PENDING", false, "/api/me/operations/" + created.id());
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(receipt);
    }

    @GetMapping("/api/platform/recovery-requests")
    public ResponseEntity<List<RequestItem>> list(
            Authentication authentication, HttpServletRequest request) {
        requirePlatformOperator(authentication, request);
        List<RequestItem> items =
                recovery.listRequests().stream().map(RecoveryController::item).toList();
        return protectedOk(items);
    }

    @PostMapping("/api/platform/recovery-requests/{requestId}/resolve")
    public ResponseEntity<ResolveReceipt> resolve(
            Authentication authentication,
            HttpServletRequest request,
            @PathVariable UUID requestId,
            @RequestBody @Nullable ResolveRequest body) {
        requirePlatformOperator(authentication, request);
        if (body == null || body.decision() == null) {
            throw new HttpProblemException(
                    HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Thiếu quyết định xử lý yêu cầu.");
        }
        Decision decision;
        try {
            decision = Decision.valueOf(body.decision());
        } catch (IllegalArgumentException ex) {
            throw new HttpProblemException(
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_FAILED",
                    "Quyết định xử lý không hợp lệ.",
                    ex);
        }
        UUID operator = executor.actorUserId(authentication);
        RequestView resolved =
                Objects.requireNonNull(
                        recovery.resolve(operator, requestId, decision, body.verificationNote()));
        ResolveReceipt receipt =
                new ResolveReceipt(
                        resolved.id(), "SUCCEEDED", true, "PROFILE", resolved.targetUserId());
        return protectedOk(receipt);
    }

    private void requirePlatformOperator(
            Authentication authentication, HttpServletRequest request) {
        Optional<String> resourceId;
        try {
            resourceId = policyWriter.findResourceId(NativePolicyTemplates.platformKey());
        } catch (IllegalStateException ex) {
            // Resource server chưa được bootstrap trong realm này thì chưa thể tồn tại grant
            // operator nào: từ chối như trường hợp không có resource, không coi là lỗi hệ thống.
            resourceId = Optional.empty();
        }
        boolean allowed =
                resourceId.isPresent()
                        && decisions.isAllowed(
                                authentication,
                                request,
                                RequiredPermissions.of(
                                        RequiredPermissions.require(
                                                resourceId.get(),
                                                PermissionCatalog.PlatformScope.ACCOUNT_RECOVER
                                                        .scopeName())));
        if (!allowed) {
            throw new HttpProblemException(
                    HttpStatus.FORBIDDEN,
                    "FORBIDDEN",
                    "Tài khoản không có quyền vận hành khôi phục danh tính.");
        }
    }

    private static RequestItem item(RequestView view) {
        return new RequestItem(
                view.id(),
                view.requesterUserId(),
                view.workspaceId(),
                view.targetUserId(),
                view.state().name(),
                view.verifiedBy(),
                view.resolvedAt(),
                view.verificationNote(),
                view.createdAt());
    }

    private static <T> ResponseEntity<T> protectedOk(T body) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(body);
    }
}
