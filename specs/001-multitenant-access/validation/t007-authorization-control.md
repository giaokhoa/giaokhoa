# T007 — Schema revision, projection và durable authorization operation

## Phạm vi đã hoàn thành

- Flyway `V002__authorization_control.sql`: `authz_partition`, `authz_projection` và `authorization_operation`. Một operation vừa lưu trạng thái vừa là mục hàng đợi có chỉ mục retry; không dùng outbox/broker thứ hai.
- Tự tạo `ACCOUNT` và `WORKSPACE` partition ở trạng thái `PENDING` khi insert directory, backfill phạm vi có sẵn; `GRANT` partition sẽ do luồng cấp quyền tương ứng tạo khi bảng grant xuất hiện.
- UUID nghiệp vụ tách khỏi Keycloak locator opaque. Projection chỉ lưu key/metadata/hash/policies/dependencies, không lưu body, bài làm, token hoặc password.
- Ràng buộc DB: unique owner/target/idempotency key theo actor; revision không giảm; `READY` đòi revision bằng nhau, hash đã áp dụng, Keycloak locator và các dependency READY; sửa graph hoặc nguồn liên quan phải fence trước. Mảng UUID tham chiếu partition tồn tại, không lặp; partition không hard-delete.
- Operation giữ bất biến idempotency payload; `SUCCEEDED` chỉ khi toàn bộ partition bị ảnh hưởng đã READY tại revision tương ứng. Tất cả trạng thái PENDING/APPLYING/SUCCEEDED/RETRYABLE_FAILURE/FAILED được lưu và có thể lấy ra qua JPA.

## Kết quả xác minh

- Môi trường: Docker Compose `giaokhoa-test`, PostgreSQL 18.6, realm TEST của Keycloak 26.8.1. Chỉ reset schema **TEST** để chạy lại migration từ đầu; không thay đổi DEV.
- Lệnh: `./backend/mvnw -B -ntp -f backend/pom.xml -Dtest=AuthorizationControlSchemaIT,DirectorySchemaIT,IntegrationEnvironmentIT test` (với biến môi trường TEST từ job integration).
- Kết quả: **45 passed, 0 failed, 0 errors**; trong đó `AuthorizationControlSchemaIT` 19 ca. Flyway V001/V002 được áp dụng lại thành công và Hibernate xác nhận mapping.
- CI integration được cập nhật để chạy thêm `AuthorizationControlSchemaIT`.

## Giới hạn và phần việc tiếp theo

- **Chưa có worker/PAP/PEP và không chứng nhận Keycloak graph đã đồng bộ.** `READY` ở DB là hàng rào dữ liệu; worker T017 phải kiểm tra graph/keycloak hash/revision thực sự trước khi chuyển READY.
- Idempotency key được bảo vệ và payload bất biến; trả lại kết quả khi request trùng key, hoặc HTTP 409 khi cùng key khác payload, thuộc `IdempotencyService` T009.
- Native PDP, revocation và concurrency gate chạy Keycloak thật thuộc T013–T018, không tự đánh dấu gate pass ở T007.
