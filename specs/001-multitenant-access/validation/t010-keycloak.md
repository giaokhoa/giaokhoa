# T010 — Kiểm chứng baseline Keycloak

## Trạng thái và nguồn lỗi

- Branch `feat/issue-12-keycloak-baseline`; blocker #6 và #8 đã CLOSED.
- Trên Keycloak TEST 26.8.1 (không phải DEV), đã **tái hiện** HTTP 404 ở `PUT /admin/realms/giaokhoa/clients/{client-id}/authz/resource-server/settings`.
- Keycloak 26.8 dùng `GET .../resource-server/settings` để đọc, nhưng **PUT .../resource-server** để cập nhật cấu hình. Đã sửa script theo endpoint chính thức.
- Bootstrap cũ tạo realm `enabled=false` rồi lỗi, chạy lại không bật realm vì biến `NEW_REALM=false`. Đã thêm realm attribute `gk.bootstrap.pending=true`; chỉ lần chạy thành công có marker mới bật realm và xóa marker. Realm bị admin tắt mà không có marker vẫn được giữ nguyên.
- Tìm group theo tên + `max=1000` không chứng minh group vắng mặt và có thể bỏ sót việc thu hồi. Java và bootstrap hiện tra cứu theo `group-by-path`. Java từ chối công nhận revoke thành công nếu group nguồn không tồn tại hoặc API lỗi.
- Token provisioner được quản lý bởi Spring Security OAuth2 `AuthorizedClientServiceOAuth2AuthorizedClientManager` với `client_credentials`, tự tái sử dụng/đổi token trước khi hết hạn; không dùng user session hoặc token của web client.

## Bằng chứng kiểm thử code

- `bash -n infra/keycloak/bootstrap.sh`: đạt.
- `mvn -q -f backend/pom.xml verify`: đạt; 6 test provisioning đạt, gồm Organization idempotent, exact group path, group conflict, revoke không có group, revoke lỗi HTTP, path không hợp lệ.
- `git diff --check`: đạt.
- Không reset hoặc truy cập database/realm DEV.

## Native TEST Keycloak 26.8.1 — chạy thật ngày 2026-11-05

- Với sự phê duyệt Run qua Desktop Commander, dùng **container Keycloak 26.8.1 tạm riêng** tại `127.0.0.1:18091`, admin/secret chỉ là giá trị thử nghiệm tự tạo. Không truy cập admin credential của realm `giaokhoa-it` hoặc DEV.
- `BOOTSTRAP_1`: `Keycloak realm 'giaokhoa' baseline reconciled`; exit 0.
- `BOOTSTRAP_2`: `Keycloak realm 'giaokhoa' baseline reconciled`; exit 0.
- Ảnh chụp ID native sau mỗi lần chạy so sánh bằng `test "$before" = "$after"`: **đạt**, gồm ba client `giaokhoa-web`, `giaokhoa-api`, `giaokhoa-provisioner` và sáu group cố định `/gk`, `/gk/identity`, `/gk/identity/eligible`, `/gk/platform`, `/gk/platform/operators`, `/gk/workspaces`.
- Gọi Admin API để xác nhận `enabled=true`, `organizationsEnabled=true`, `verifyEmail=true` và không còn marker `gk.bootstrap.pending`: **đạt**.
- Log kết thúc `NATIVE_TEST_COMPLETE`, exit code 0 (15.71s); container được tự động dừng/xóa và kiểm tra không còn tồn tại.
- Script có cơ chế xóa Default Permission/Resource/Policy và chặn URI wildcard `/*`, nhưng **chưa có phép đo độc lập lưu bằng chứng** danh sách policy sau bootstrap. Tương tự, chưa có phép kiểm native độc lập cho email `required`, default required actions, quyền grant provisioner và thử nghiệm phục hồi sau khi cố ý ngắt script. Không coi các mục đó là đã nghiệm thu chỉ vì bootstrap không báo lỗi.
- PDP end-to-end với actor/resources/scopes thật thuộc các task tiếp theo (T013/T016); không suy ra pass từ unit test hoặc baseline.
