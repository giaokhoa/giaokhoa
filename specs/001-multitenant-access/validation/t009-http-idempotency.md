# T009 — Problem Details, Idempotency, If-Match và audit

## Triển khai

- `ProblemDetailsAdvice`: lỗi `application/problem+json` với `type/title/status/code/detail/instance/traceId`; `violations` chỉ chứa tên trường, mã và thông báo an toàn, không chứa rejected value. Hỗ trợ validation thân request/tham số, xác thực 401, phân quyền 403, 404, lỗi bất ngờ và xung đột DB/version.
- `IdempotencyService`: chuẩn hóa JSON, băm SHA-256 cùng method/target; cùng actor + key + payload lấy lại `authorization_operation` hiện có; cùng key khác hash trả HTTP 409. Chèn operation bằng `ON CONFLICT DO NOTHING` trong transaction hiện có, dùng queue durable từ T007, không lập outbox khác.
- `If-Match`: strong ETag của row version (ví dụ `"3"`); thiếu header 428, version stale 409, wildcard/weak/không đúng định dạng 400. Caller phải kiểm tra dưới row lock/optimistic version trong mutation transaction.
- Operation `PENDING/APPLYING/RETRYABLE_FAILURE` trả HTTP 202, `completed=false`; chỉ `SUCCEEDED` trả 200 với `completed=true`; `FAILED` trả 503, không báo thành công.
- `V004__audit_events.sql` và `AuditEvent`: chỉ 9 trường actor/workspace/action/target/operation/outcome/time, không chứa payload, password, token, email hay nội dung bài làm; cấm update/delete/truncate để giữ lịch sử, lưu `PENDING` trước khi sync hoàn tất.

## Kết quả xác minh

- Spring Boot 4.1.2, Java 25, PostgreSQL 18.6 trên stack `giaokhoa-test`; không truy cập/reset DB hoặc realm DEV.
- `mvn -B -ntp -q -f backend/pom.xml verify`: **pass**.
- Unit tests (10): `IdempotencyServiceTest` (3), `ProblemDetailsAdviceTest` (6), `IntegrationEnvironmentTest` (1).
- Integration tests (70): `AuditEventSchemaIT` (5), `IdempotencyServiceIT` (3), `DirectorySchemaIT` (25), `AuthorizationControlSchemaIT` (30), `OidcSessionPersistenceIT` (6), `IntegrationEnvironmentIT` (1).
- Tổng: **80 ca, 0 failed, 0 errors**. Flyway áp dụng thành công V001 → V002 → V003 → V004; Hibernate xác nhận JPA mapping.
- DB TEST `public` đang có checksum V002 từ trước khác code hiện tại. Để không `repair` hay reset schema chung, integration được chạy trên schema riêng `gk_issue11_t009_v003` bằng cấu hình Flyway schema, Hibernate default schema và Hikari search_path. Không thay đổi schema `public`.
- CI được bổ sung `AuditEventSchemaIT`, `IdempotencyServiceIT` vào job integration.

## Ranh giới

- Chưa có mutation API/revision worker thật ở T017, vì vậy đây là lớp nền và phép thử DB/HTTP, không phải gate nghiệp vụ Keycloak hoặc tuyên bố dữ liệu đã đồng bộ. Caller phải resolve actor từ phiên, kiểm tra `findExisting` trước mutation, giữ lock/revision và ghi audit theo từng trạng thái.
- Không tạo endpoint, mock policy engine, broker/outbox khác, PR hoặc deploy. Chưa được coi là đã đạt acceptance native PDP/authorization.
