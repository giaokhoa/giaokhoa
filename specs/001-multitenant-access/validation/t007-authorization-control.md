# T007 — Schema revision, projection và durable authorization operation

## Phạm vi đã hoàn thành

- Flyway `V002__authorization_control.sql`: `authz_partition`, `authz_projection` và `authorization_operation`. Một operation vừa lưu trạng thái vừa là mục hàng đợi có chỉ mục retry; không dùng outbox/broker thứ hai.
- Tự tạo `ACCOUNT` và `WORKSPACE` partition ở trạng thái `PENDING` khi insert directory, backfill phạm vi có sẵn; `GRANT` partition sẽ do luồng cấp quyền tương ứng tạo khi bảng grant xuất hiện.
- UUID nghiệp vụ tách khỏi Keycloak locator opaque. Projection chỉ lưu key/metadata/hash/policies/dependencies, không lưu body, bài làm, token hoặc password.
- Ràng buộc DB: unique owner/target/idempotency key theo actor; revision không giảm; `READY` đòi revision bằng nhau, hash đã áp dụng, Keycloak locator và các dependency READY; sửa graph hoặc nguồn liên quan phải fence trước. Mảng UUID tham chiếu partition tồn tại, không lặp; partition không hard-delete.
- Operation giữ bất biến idempotency payload và snapshot `affected_revisions` theo từng partition (sắp theo thứ tự `affected_partitions`); `desired_revision` vẫn là revision của partition đầu tiên. `SUCCEEDED` chỉ khi tất cả partition READY ở revision tương ứng, không yêu cầu các partition có cùng số revision. `SUCCEEDED`/`FAILED` không thể chuyển về trạng thái chờ. Các trạng thái PENDING/APPLYING/SUCCEEDED/RETRYABLE_FAILURE/FAILED được lưu và có thể lấy ra qua JPA.

## Kết quả xác minh

- Môi trường: Docker Compose `giaokhoa-test`, PostgreSQL 18.6, realm TEST của Keycloak 26.8.1. Chỉ reset schema **TEST** để chạy lại migration từ đầu; không thay đổi DEV.
- Lệnh: `./backend/mvnw -B -ntp -f backend/pom.xml -Dtest=AuthorizationControlSchemaIT,DirectorySchemaIT,IntegrationEnvironmentIT test` (với biến môi trường TEST từ job integration).
- Kết quả: **56 passed, 0 failed, 0 errors**; trong đó `AuthorizationControlSchemaIT` 30 ca. Flyway V001/V002 được áp dụng lại thành công và Hibernate xác nhận mapping.
- CI integration được cập nhật để chạy thêm `AuthorizationControlSchemaIT`.

## Review bổ sung (Issue #9)

- Viết regression tests trước khi sửa: **3 test thất bại** đúng ba lỗi từ review: thay `keycloak_resource_id` khi READY được chấp nhận; multi-partition revisions `1/2` bị từ chối khi SUCCEEDED; `SUCCEEDED → PENDING` được chấp nhận.
- Đã sửa: fence cả Keycloak locator; bổ sung mảng `affected_revisions` tương ứng một-một với `affected_partitions` và xác minh từng revision; bảo vệ trạng thái kết thúc `SUCCEEDED`/`FAILED`.
- Regression tests kiểm tra cả đường hợp lệ khi đã fence, operation nhiều partition khác revision, dependency stale bị từ chối, snapshot revision không được ghi đè và lỗi cấu trúc mảng.
- Review bổ sung commit `9d4ea6e`: `CHECK` trước đây có thể nhận `NULL` với mảng PostgreSQL bắt đầu từ chỉ số 0, làm `desired_revision` không khớp revision đầu. Thêm kiểm tra cả hai mảng là một chiều, chỉ số từ 1 và `CHECK ... IS TRUE`; đổi `array_position()` thành `unnest()` để từ chối cả mảng nhiều chiều mà không làm hỏng kết nối.
- Ba regression test mới: revision array chỉ số 0, partition array chỉ số 0, revision array nhiều chiều. Flyway V001/V002 áp dụng thành công từ database PostgreSQL TEST trống; không thay đổi DEV.
- V002 vẫn chỉ ở nhánh T007, chưa merge/deploy; kiểm tra lại từ schema PostgreSQL TEST sạch để xác nhận migration Flyway và Hibernate.

## Giới hạn và phần việc tiếp theo

- **Chưa có worker/PAP/PEP và không chứng nhận Keycloak graph đã đồng bộ.** `READY` ở DB là hàng rào dữ liệu; worker T017 phải kiểm tra graph/keycloak hash/revision thực sự trước khi chuyển READY.
- Idempotency key được bảo vệ và payload bất biến; trả lại kết quả khi request trùng key, hoặc HTTP 409 khi cùng key khác payload, thuộc `IdempotencyService` T009.
- Native PDP, revocation và concurrency gate chạy Keycloak thật thuộc T013–T018, không tự đánh dấu gate pass ở T007.
