package com.giaokhoa.identity;

import com.giaokhoa.identity.model.RecoveryRequest;
import com.giaokhoa.shared.http.HttpProblemException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Workflow yêu cầu hỗ trợ khôi phục danh tính cho tài khoản không tự khôi phục được qua email.
 * Người dùng chỉ gửi yêu cầu cho chính mình; quản lý center chỉ gửi được cho thành viên của center
 * mình quản lý — đích ngoài phạm vi và đích không tồn tại đều trả cùng một 404 để không lộ sự tồn
 * tại của tài khoản. Chỉ platform operator mới xác minh/resolve (quyết định PDP ở endpoint);
 * service này ép thứ tự vòng đời REQUESTED → VERIFIED → RESOLVED/REJECTED bằng UPDATE có điều kiện
 * trạng thái, vì tầng DB chỉ khóa tính nhất quán của verified_by/resolved_at chứ không khóa thứ tự
 * chuyển. Service không bao giờ chạm vào credential hay origin của tài khoản đích: resolve không
 * cấp lại mật khẩu cho danh tính đã có và không đổi origin; credential của tài khoản không email do
 * operator đặt trực tiếp trên Keycloak sau khi yêu cầu đã RESOLVED, không đi qua response của
 * workflow này và không bao giờ trả cho center đã gửi yêu cầu.
 */
@Service
public class RecoveryService {
    /** Độ dài tối đa của ghi chú xác minh và lý do cần hỗ trợ (khớp CHECK ở migration). */
    private static final int MAX_NOTE_LENGTH = 1000;

    private final JdbcTemplate jdbc;

    public RecoveryService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Quyết định của operator khi resolve, khớp hợp đồng resolve của platform recovery. */
    public enum Decision {
        APPROVE,
        REJECT
    }

    /** Ảnh chụp một yêu cầu hỗ trợ tại thời điểm đọc. */
    public record RequestView(
            UUID id,
            UUID requesterUserId,
            @Nullable UUID workspaceId,
            UUID targetUserId,
            @Nullable String reason,
            RecoveryRequest.State state,
            @Nullable UUID verifiedBy,
            @Nullable Instant resolvedAt,
            @Nullable String verificationNote,
            Instant createdAt) {}

    /**
     * Gửi yêu cầu hỗ trợ cho tài khoản đích. Không có workspace thì chỉ được gửi cho chính mình; có
     * workspace thì workspace phải là CENTER đang ACTIVE, tài khoản đích phải là thành viên của
     * center đó và người gửi phải là chính tài khoản đích hoặc OWNER/MANAGER ACTIVE của center.
     */
    @Transactional
    public RequestView submit(UUID requesterUserId, UUID targetUserId, @Nullable UUID workspaceId) {
        return submit(requesterUserId, targetUserId, workspaceId, null);
    }

    /**
     * Như {@link #submit(UUID, UUID, UUID)} nhưng giữ lại lý do người gửi cần hỗ trợ để operator
     * thấy được khi xử lý. Lý do trống được coi như không có; dài quá 1000 ký tự thì từ chối.
     */
    @Transactional
    public RequestView submit(
            UUID requesterUserId,
            UUID targetUserId,
            @Nullable UUID workspaceId,
            @Nullable String reason) {
        Objects.requireNonNull(requesterUserId, "requesterUserId");
        Objects.requireNonNull(targetUserId, "targetUserId");
        requireAccount(requesterUserId);

        boolean self = requesterUserId.equals(targetUserId);
        List<UUID> targets =
                jdbc.queryForList(
                        "SELECT id FROM user_account WHERE id = ?", UUID.class, targetUserId);
        if (targets.isEmpty()) {
            throw targetNotFound();
        }
        if (workspaceId == null) {
            if (!self) {
                throw targetNotFound();
            }
        } else {
            List<Map<String, Object>> workspaces =
                    jdbc.queryForList(
                            "SELECT kind, state FROM workspace WHERE id = ?", workspaceId);
            boolean centerActive =
                    !workspaces.isEmpty()
                            && "CENTER".equals(workspaces.getFirst().get("kind"))
                            && "ACTIVE".equals(workspaces.getFirst().get("state"));
            List<UUID> targetMemberships =
                    centerActive
                            ? jdbc.queryForList(
                                    "SELECT id FROM center_membership WHERE workspace_id = ?"
                                            + " AND user_id = ? AND state IN ('PENDING', 'ACTIVE')",
                                    UUID.class,
                                    workspaceId,
                                    targetUserId)
                            : List.of();
            if (targetMemberships.isEmpty()) {
                throw targetNotFound();
            }
            if (!self) {
                List<String> managerRoles =
                        jdbc.queryForList(
                                "SELECT r.role FROM center_membership m"
                                        + " JOIN membership_role r ON r.membership_id = m.id"
                                        + " WHERE m.workspace_id = ? AND m.user_id = ?"
                                        + " AND m.state = 'ACTIVE'"
                                        + " AND r.role IN ('OWNER', 'MANAGER')",
                                String.class,
                                workspaceId,
                                requesterUserId);
                if (managerRoles.isEmpty()) {
                    throw targetNotFound();
                }
            }
        }

        UUID id = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO recovery_request"
                        + " (id, requester_user_id, workspace_id, target_user_id, state, reason)"
                        + " VALUES (?, ?, ?, ?, 'REQUESTED', ?)",
                id,
                requesterUserId,
                workspaceId,
                targetUserId,
                normalizeReason(reason));
        return loadView(id);
    }

    /** Hàng đợi yêu cầu hỗ trợ cho platform operator, cũ nhất trước. */
    @Transactional(readOnly = true)
    public List<RequestView> listRequests() {
        return jdbc.query(
                "SELECT id, requester_user_id, workspace_id, target_user_id, reason, state,"
                        + " verified_by, resolved_at, verification_note, created_at"
                        + " FROM recovery_request ORDER BY created_at ASC, id ASC",
                REQUEST_MAPPER);
    }

    /**
     * Operator xác minh danh tính ngoài hệ thống và ghi nhận: chỉ chuyển được từ REQUESTED, ghi
     * verified_by là chính operator đang xử lý kèm ghi chú xác minh tối thiểu.
     */
    @Transactional
    public RequestView verify(
            UUID operatorUserId, UUID requestId, @Nullable String verificationNote) {
        Objects.requireNonNull(operatorUserId, "operatorUserId");
        Objects.requireNonNull(requestId, "requestId");
        requireAccount(operatorUserId);
        String note = normalizeNote(verificationNote);
        int updated =
                jdbc.update(
                        "UPDATE recovery_request SET state = 'VERIFIED', verified_by = ?,"
                                + " verification_note = ?, version = version + 1"
                                + " WHERE id = ? AND state = 'REQUESTED'",
                        operatorUserId,
                        note,
                        requestId);
        if (updated == 0) {
            throw stateConflict(requestId);
        }
        return loadView(requestId);
    }

    /**
     * Operator quyết định yêu cầu: APPROVE → RESOLVED, REJECT → REJECTED. Yêu cầu đang REQUESTED
     * được ghi bước xác minh (verified_by và ghi chú của chính lần gọi này) ngay trước bước quyết
     * định trong cùng transaction, nên resolved_at không bao giờ được ghi khi chưa có xác minh; yêu
     * cầu đã ở trạng thái cuối trả 409.
     */
    @Transactional
    public RequestView resolve(
            UUID operatorUserId,
            UUID requestId,
            Decision decision,
            @Nullable String verificationNote) {
        Objects.requireNonNull(operatorUserId, "operatorUserId");
        Objects.requireNonNull(requestId, "requestId");
        Objects.requireNonNull(decision, "decision");
        requireAccount(operatorUserId);
        String note = normalizeNote(verificationNote);

        RecoveryRequest.State current = currentState(requestId);
        if (current == RecoveryRequest.State.RESOLVED
                || current == RecoveryRequest.State.REJECTED) {
            throw invalidState(requestId);
        }
        if (current == RecoveryRequest.State.REQUESTED) {
            int verified =
                    jdbc.update(
                            "UPDATE recovery_request SET state = 'VERIFIED', verified_by = ?,"
                                    + " verification_note = ?, version = version + 1"
                                    + " WHERE id = ? AND state = 'REQUESTED'",
                            operatorUserId,
                            note,
                            requestId);
            if (verified == 0) {
                throw stateConflict(requestId);
            }
        }
        String resolvedState =
                decision == Decision.APPROVE
                        ? RecoveryRequest.State.RESOLVED.name()
                        : RecoveryRequest.State.REJECTED.name();
        int updated =
                jdbc.update(
                        "UPDATE recovery_request SET state = ?, resolved_at = now(),"
                                + " verification_note = COALESCE(?, verification_note),"
                                + " version = version + 1 WHERE id = ? AND state = 'VERIFIED'",
                        resolvedState,
                        note,
                        requestId);
        if (updated == 0) {
            throw stateConflict(requestId);
        }
        return loadView(requestId);
    }

    private void requireAccount(UUID userId) {
        List<UUID> accounts =
                jdbc.queryForList("SELECT id FROM user_account WHERE id = ?", UUID.class, userId);
        if (accounts.isEmpty()) {
            throw new HttpProblemException(
                    HttpStatus.NOT_FOUND,
                    "ACCOUNT_NOT_FOUND",
                    "Chưa có tài khoản cho danh tính này.");
        }
    }

    private RecoveryRequest.State currentState(UUID requestId) {
        List<String> states =
                jdbc.queryForList(
                        "SELECT state FROM recovery_request WHERE id = ?", String.class, requestId);
        if (states.isEmpty()) {
            throw requestNotFound();
        }
        return RecoveryRequest.State.valueOf(states.getFirst());
    }

    private RequestView loadView(UUID requestId) {
        List<RequestView> rows =
                jdbc.query(
                        "SELECT id, requester_user_id, workspace_id, target_user_id, reason, state,"
                                + " verified_by, resolved_at, verification_note, created_at"
                                + " FROM recovery_request WHERE id = ?",
                        REQUEST_MAPPER,
                        requestId);
        if (rows.isEmpty()) {
            throw requestNotFound();
        }
        return rows.getFirst();
    }

    private HttpProblemException stateConflict(UUID requestId) {
        // Phân biệt yêu cầu không tồn tại với yêu cầu đã rời trạng thái cho phép.
        List<String> states =
                jdbc.queryForList(
                        "SELECT state FROM recovery_request WHERE id = ?", String.class, requestId);
        if (states.isEmpty()) {
            return requestNotFound();
        }
        return invalidState(requestId);
    }

    private static HttpProblemException targetNotFound() {
        return new HttpProblemException(
                HttpStatus.NOT_FOUND,
                "RECOVERY_TARGET_NOT_FOUND",
                "Không tìm thấy tài khoản đích trong phạm vi yêu cầu hỗ trợ.");
    }

    private static HttpProblemException requestNotFound() {
        return new HttpProblemException(
                HttpStatus.NOT_FOUND,
                "RECOVERY_REQUEST_NOT_FOUND",
                "Không tìm thấy yêu cầu hỗ trợ.");
    }

    private static HttpProblemException invalidState(UUID requestId) {
        return new HttpProblemException(
                HttpStatus.CONFLICT,
                "RECOVERY_INVALID_STATE",
                "Yêu cầu hỗ trợ " + requestId + " không còn ở trạng thái cho phép thao tác này.");
    }

    private static @Nullable String normalizeNote(@Nullable String verificationNote) {
        if (verificationNote == null) {
            return null;
        }
        String trimmed = verificationNote.trim();
        if (trimmed.isEmpty() || trimmed.length() > MAX_NOTE_LENGTH) {
            throw new HttpProblemException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_VERIFICATION_NOTE",
                    "Ghi chú xác minh phải có từ 1 đến 1000 ký tự.");
        }
        return trimmed;
    }

    private static @Nullable String normalizeReason(@Nullable String reason) {
        if (reason == null) {
            return null;
        }
        String trimmed = reason.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        if (trimmed.length() > MAX_NOTE_LENGTH) {
            throw new HttpProblemException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_REASON",
                    "Lý do cần hỗ trợ phải có từ 1 đến 1000 ký tự.");
        }
        return trimmed;
    }

    // Đọc thẳng OffsetDateTime theo kiểu đích: để pgjdbc tự chuyển cột TIMESTAMPTZ thay vì
    // nhận java.sql.Timestamp qua Map rồi quy đổi thủ công.
    private static final RowMapper<RequestView> REQUEST_MAPPER =
            (rs, _) -> {
                OffsetDateTime resolvedAt = rs.getObject("resolved_at", OffsetDateTime.class);
                return new RequestView(
                        rs.getObject("id", UUID.class),
                        rs.getObject("requester_user_id", UUID.class),
                        rs.getObject("workspace_id", UUID.class),
                        rs.getObject("target_user_id", UUID.class),
                        rs.getString("reason"),
                        RecoveryRequest.State.valueOf(rs.getString("state")),
                        rs.getObject("verified_by", UUID.class),
                        resolvedAt == null ? null : resolvedAt.toInstant(),
                        rs.getString("verification_note"),
                        Objects.requireNonNull(rs.getObject("created_at", OffsetDateTime.class))
                                .toInstant());
            };
}
