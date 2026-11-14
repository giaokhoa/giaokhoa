# Cấp trung tâm với database và tài khoản độc lập (issue #7)

## Quy tắc bắt buộc

Trung tâm giáo dục mới (`kind: center`) **không được tạo trong database chung**. Chỉ người vận hành có quyền cấp role/database PostgreSQL chạy pipeline 7 bước. Bootstrap control plane chỉ đăng ký `trang-chinh` với `storageMode=dedicated`, không tự cấp một trường mặc định trong database platform. API cấp trung tâm vẫn yêu cầu lệnh vận hành riêng; không dùng form tạo trường học trong kho chung. Đường legacy tạo trường học qua API/UI chưa được loại bỏ hoàn toàn và là blocker trước khi chốt issue #20.

Mỗi trung tâm có một database, một role runtime, một tenant, hồ sơ người dùng và membership độc lập. Định danh lấy từ slug đã đăng ký ở control plane; hostname không khớp hoặc thiếu bí mật kết nối không được phép quay về kho chung. Tài khoản cùng email ở hai trung tâm vẫn là hai người dùng khác nhau.

## Quy trình người vận hành

1. Xây dựng API và package phụ thuộc: `pnpm --filter '@giaokhoa/api^...' build && pnpm --filter @giaokhoa/api build`. Cấu hình `DATABASE_URL` và `CONTROL_PLANE_DATABASE_URL` cho **môi trường vận hành**; role cấp phát phải có quyền tạo database và role. Tài khoản runtime của API không cần và không nên có các quyền này.
2. Chạy lệnh ngoài tiến trình NestJS (chỉ là ví dụ, không chứa mật khẩu):

   ```bash
   node apps/api/dist/modules/tenants/space-provision.js provision \
     --slug trung-tam-a --name "Trung tâm A" \
     --admin-email admin-a@example.com \
     --actor-id <uuid-nguoi-van-hanh>
   ```

   Nếu sử dụng mật khẩu database được cấp trước, đặt `SPACE_PROVISION_DB_PASSWORD` trong môi trường lệnh. Nếu không, pipeline sinh mật khẩu và chỉ in một lần ở `PROVISION_RESULT`. Lưu token lời mời và mật khẩu mới vào hệ quản lý bí mật; **không ghi chúng vào mã nguồn, log ứng dụng, tài liệu hay Git**.

3. Cấu hình biến môi trường đúng tên do pipeline trả về (`secretEnvVar`), chẳng hạn `SPACE_TRUNG_TAM_A_DATABASE_URL`, với URL dùng **role runtime của trung tâm** và database được trả về. Phân phối bí mật tới mọi instance API/worker cần dùng và tải lại cấu hình triển khai. Trạng thái `active` trong sổ đăng ký không thay thế bước cài đặt bí mật này: nếu chưa cài, request tới hostname trung tâm phải lỗi fail-closed.
4. Gửi token lời mời riêng cho quản trị trung tâm. Quản trị kích hoạt bằng `POST /api/v1/centres/activate-invite` với `{ slug, token, password }`, sau đó đăng nhập ở **hostname của chính trung tâm** qua `POST /api/v1/auth/token`. Kiểm tra `GET /api/v1/users/me`, `GET /api/v1/tenants/current` và thao tác tạo người dùng tại `POST /api/v1/tenants/:tenantId/users`. Không tái sử dụng tài khoản/email hay token của trung tâm khác.
5. Nếu dừng giữa chừng ở trạng thái `provisioning`, chạy lại cùng lệnh để tiếp tục idempotent. Trung tâm đã `active` trả `already-active`. Nếu mất token mời, dùng `space-provision.js invite --slug trung-tam-a --email admin-a@example.com` để cấp lại; không tạo thêm tài khoản chung.

## Kiểm tra ranh giới

- Dùng role kết nối của A thử `CONNECT` vào database B và ngược lại: PostgreSQL phải từ chối trước mọi `SELECT/INSERT`; cả hai role không được có `SUPERUSER` hoặc `BYPASSRLS`.
- Tạo cùng email ở A và B; mỗi kho chỉ có tài khoản và phiên của mình. Đổi mật khẩu hoặc đình chỉ ở A không làm đổi đăng nhập B.
- Token/cookie của A tại Host B, tenantId của B gửi vào Host A, hoặc Host mang slug không đăng ký đều phải bị từ chối. Slug có trong ngữ cảnh mà handle chưa chuẩn bị hoặc đã thu hồi không được đọc/ghi ở kho chung.
- Socket.IO: JWT của A tại hostname gốc, hostname shared hay hostname B phải bị ngắt, kể cả khi shared còn bản sao tài khoản legacy. Ngoại lệ JWT mang `centre_id` của **Trang chính** chỉ có hiệu lực trên hostname gốc **khớp chính xác hostname trong `BETTER_AUTH_URL` do deployment cấu hình** và khi cả `tid` lẫn `centre_id` khớp sổ đăng ký platform. Host bất kỳ không có slug (ví dụ `unrelated.example`) không phải hostname gốc hợp lệ. Production thiếu `BETTER_AUTH_URL` thì ngoại lệ này **fail-closed**; dev/test chỉ cho loopback cục bộ. Reverse proxy phải chuyển tiếp `Host` đúng và loại Host không được phép.
- Suite thực tế: `pnpm --filter @giaokhoa/api exec vitest run --project unit src/modules/tenants/space-resolution.spec.ts src/modules/tenants/space-context.guard.spec.ts`, `--project int test/integration/db/routed-kysely.int-spec.ts`, và `--project e2e test/e2e/platform/space-provisioning-flow.e2e-spec.ts test/e2e/platform/space-membership-flow.e2e-spec.ts test/e2e/platform/space-routing-flow.e2e-spec.ts`. Dùng khoá `flock /tmp/giaokhoa-heavy-suite.lock` cho suite nặng, và migrate database test riêng trước khi chạy E2E.

Phạm vi tách khu học tập công cộng và thư mục tài khoản toàn cục thuộc các issue sau, không tự hợp nhất dữ liệu hoặc user qua email ở bước này.
