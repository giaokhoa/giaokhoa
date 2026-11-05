# T009 — Problem Details, Idempotency, If-Match và audit

## Triển khai

- `ProblemDetailsAdvice`: lỗi `application/problem+json` với `type/title/status/code/detail/instance/traceId`; `violations` chỉ chứa tên trường, mã và thông báo an toàn, không chứa rejected value. Lỗi optimistic locking trả `409 VERSION_CONFLICT`; lỗi ràng buộc DB (bao gồm unique username) trả `409 DATA_CONFLICT` và thông báo không chứa constraint/value.
- `IdempotencyService`: chuẩn hóa JSON, băm SHA-256 cùng method/target; cùng actor + key + payload lấy lại `authorization_operation`, khác hash trả `409 IDEMPOTENCY_CONFLICT`. `executeOnce(operation, mutation)` yêu cầu transaction hiện hữu, khóa tất cả `affected_partitions` theo thứ tự hex UUID tương thích PostgreSQL, `INSERT ... ON CONFLICT DO NOTHING`, **chỉ gọi callback mutation khi insert mới**. Không còn đường `register()` có thể bị gọi sau thay đổi domain mà vẫn trả duplicate. Callback lỗi rollback operation và mọi desired-state write trong transaction.
- `If-Match`: strong ETag của row version (ví dụ `"3"`); thiếu header 428, version stale 409, wildcard/weak/không đúng định dạng 400. Caller vẫn phải kiểm tra row version khi giữ lock thích hợp trong transaction.
- Operation `PENDING/APPLYING/RETRYABLE_FAILURE` trả HTTP 202, `completed=false`; chỉ `SUCCEEDED` trả 200 với `completed=true`; `FAILED` trả 503.
- `V004__audit_events.sql` và `AuditEvent`: chỉ 9 trường actor/workspace/action/target/operation/outcome/time, không chứa payload, password, token, email hay nội dung bài làm; cấm update/delete/truncate để giữ lịch sử. **Chưa có writer nghiệp vụ tự ghi audit**.

## Kết quả review và kiểm chứng bổ sung

- Must fix #1: tách `DataIntegrityViolationException` khỏi `OptimisticLockingFailureException`; test kiểm tra cả status, code và thông báo an toàn, không echo constraint hoặc dữ liệu nhạy cảm.
- Must fix #2: hai request PostgreSQL thật chạy ở **hai transaction/threads riêng**; cả hai đã `findExisting == empty` trước khi cùng bắt đầu, gửi hai partition cùng tập nhưng thứ tự ngược nhau; chỉ một callback nâng `desired_revision` từ 0 lên 1, cả hai lấy đúng một `operationId`, đúng một operation trong DB. Test thứ hai chứng minh exception trong callback rollback cả operation và state. Test duplicate cùng payload/khác payload và actor độc lập vẫn đạt.
- Unit tests (12): `IdempotencyServiceTest` (3), `ProblemDetailsAdviceTest` (8), `IntegrationEnvironmentTest` (1).
- Integration tests (72): `AuditEventSchemaIT` (5), `IdempotencyServiceIT` (5), `DirectorySchemaIT` (25), `AuthorizationControlSchemaIT` (30), `OidcSessionPersistenceIT` (6), `IntegrationEnvironmentIT` (1).
- **Tổng 84 ca, 0 failed, 0 errors**; Spring Boot 4.1.2/Java 25/PostgreSQL 18.6, stack `giaokhoa-test`. Flyway/Hibernate pass V001 → V004.
- Chạy integration trên schema TEST riêng `gk_issue11_t009_v003` (Flyway/Hibernate/Hikari search_path), không sửa checksum/schema `public` hoặc DEV; dữ kiện concurrency đã commit ở schema TEST này.
- `mvn -B -ntp -q -f backend/pom.xml verify` chạy thành công (unit tests); CI integration có `IdempotencyServiceIT`, `AuditEventSchemaIT`.

## Điều kiện tích hợp chưa nghiệm thu

- **T011 — Security Filter Chain thực:** chạy full Spring context + Spring Security filter chain để xác minh lỗi 401/403 từ filter entry point/access-denied handler có đúng `application/problem+json`, code/traceId/no-store; MockMvc standalone trong T009 không kiểm chứng được đường filter.
- **T017 — Mutation/PAP/worker:** actor và target phải lấy từ server; compute hash từ đúng method/path/body; gọi `executeOnce` **trước bất cứ desired-state write nào**, trong cùng transaction, không gọi mạng khi giữ khóa, các partition khác phải khóa cùng thứ tự, kiểm tra optimistic version và gate Keycloak. Với operation tạo workspace/grant mới chưa có partition, T017 phải thiết kế bước staging/idempotency dưới partition cha hiện có trước khi ghi domain, thay vì gọi `executeOnce` sau khi đã thay state. Ghi audit actor/action/target/operation/outcome trong transaction domain và khi worker chuyển sang SUCCEEDED/FAILED; bảo đảm audit không chứa secret và không báo quyền đồng bộ khi operation còn PENDING.
- T009 chỉ cung cấp nền tảng và test control-plane, chưa có endpoint mutation sản phẩm hoặc Keycloak native gate; không tuyên bố đã đạt acceptance PDP, không tạo PR/merge/deploy.
