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

## Cần kiểm chứng native trước khi đóng issue

- Lần chạy bootstrap TEST sau sửa endpoint đang yêu cầu phê duyệt truy cập admin credentials của TEST trong Desktop Commander. Chưa ghi nhận kết quả kiểm tra đủ hai lần liên tiếp, nên **chưa được tuyên bố native bootstrap đạt**.
- Sau khi quyền chạy TEST được phê duyệt, xác minh: hai lần bootstrap giữ client/group IDs; không còn default permission/resource wildcard; realm profile email optional, default required actions đúng; clients/secrets/redirect/Authorization Services đúng; provisioner có quyền Organization/group và không có realm-admin; kiểm tra lỗi/khôi phục khi bootstrap bị ngắt.
- Kiểm tra PDP end-to-end với actor/resources/scopes thật thuộc các task tiếp theo (T013/T016), không được suy ra pass từ unit test hay file cấu hình.
