package com.giaokhoa.verification;

import com.giaokhoa.authorization.decision.ProtectedActionExecutor;
import com.giaokhoa.authorization.operation.IdempotencyService;
import com.giaokhoa.authorization.permission.PermissionCatalog;
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
 * Các sample action của hợp đồng verification. Mọi action chạy qua cùng pipeline manifest/fence/PDP
 * như business action và không bao giờ chấp nhận actor thay thế. Chỉ discriminator cố định
 * CREATE_RESOURCE được cài đặt; nó trả kết quả stub vì chưa có bảng sample-resource. Action lạ bị
 * từ chối, không bao giờ được lặng lẽ cho qua.
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
                        List.of(PermissionCatalog.CourseSubjectScope.RESOURCE_CREATE.scopeName()));
        return executor.execute(
                authentication, httpRequest, workspaceId, List.of(target), this::stubResult);
    }

    private SampleActionResult createForPersonalOwner(
            UUID workspaceId, Authentication authentication, HttpServletRequest httpRequest) {
        UUID actorUserId = executor.actorUserId(authentication);
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
                        NativePolicyTemplates.workspaceKey(workspaceId),
                        List.of(PermissionCatalog.WorkspaceScope.ENTER.scopeName()));
        return executor.execute(
                authentication,
                httpRequest,
                workspaceId,
                List.of(target),
                () -> {
                    // Nhánh personal của hợp đồng là owner cộng một kỳ subscription còn hiệu
                    // lực, được kiểm tra bên trong fence transaction để một kỳ hết hạn
                    // giữa request không thể lọt một allow đã cũ qua.
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
}
