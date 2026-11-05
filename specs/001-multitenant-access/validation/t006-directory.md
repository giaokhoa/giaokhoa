# T006 — Directory migration và entities

**Ngày xác minh:** 2026-11-05

**Nhánh:** `feat/issue-8-foundation-directory`

**Môi trường:** PostgreSQL 18.6 TEST riêng qua `infra/compose.test.yaml`, Keycloak TEST thật.

## Đã kiểm tra

- Flyway áp dụng `V001__identity_workspace_directory.sql` thành công từ database TEST sạch.
- Hibernate `ddl-auto=validate` chấp nhận cả sáu JPA entities và khóa composite `MembershipRole.Key`.
- `./backend/mvnw -B -ntp -f backend/pom.xml -Dtest=DirectorySchemaIT test`: **15 passed, 0 failed, 0 errors**.
- `./backend/mvnw -B -ntp -f backend/pom.xml verify`: **BUILD SUCCESS**; test mặc định 1 passed.
- Các test dùng transaction rollback và `SET CONSTRAINTS ALL IMMEDIATE` để thực sự kiểm tra trigger trì hoãn; bao gồm:
  - Tạo center, membership owner và nhiều role trong cùng transaction.
  - Cấm owner khác, xóa role OWNER, thu hồi owner cuối cùng, chuyển owner.
  - Mỗi account đúng một personal workspace; cấm thiếu/xóa/nhân bản.
  - Unique membership hiện hành; cấm role ngoài danh mục; cấm membership ở personal.
  - FK cặp workspace–center, subscription ngoài SYSTEM, khoảng thời gian kết thúc lớn hơn bắt đầu, biên `[valid_from, expires_at)`.

## Phạm vi và giới hạn

T006 chỉ tạo schema, JPA entities và thư mục mô tả scenario fixture; không tạo REST CRUD, dữ liệu Keycloak thật hay logic phân quyền. Việc xác nhận actor là platform operator và báo ACTIVE sau projection cần xử lý ở các task PAP/PEP, không suy ra từ một hàng dữ liệu. Fixture thực thi theo story chờ các task test/Keycloak tiếp theo; không tính là gate T022 đã đạt.

TEST database được tái tạo **chỉ trong stack TEST cô lập** để áp dụng lại bản V001 chưa merge sau thay đổi thiết kế; không chạm DEV. Không chạy frontend E2E vì không đổi UI.
