# Khu học tập công cộng — kho và tài khoản riêng (issue #8)

## Ranh giới dữ liệu

Khu công cộng dùng slug cố định `cong-cong` trong sổ control plane,
`kind=platform`, `storage_mode=dedicated`, database/role riêng và cùng
bộ migration, RLS, quyền và hợp đồng session như một trung tâm đã cấp
kho. **Địa chỉ gốc** (`BETTER_AUTH_URL`) trỏ tới kho này khi
`PUBLIC_LEARNING_ENABLED=true`; mỗi `<slug>.<domain>` tiếp tục trỏ
vào đúng trung tâm. Quyết định định tuyến dùng `Host` thật và tên
miền được khai trong cấu hình, không tin một `X-Forwarded-Host` tự do.

Tài khoản học viên/giáo viên, lớp, khoá, lời giải và điểm của khu
công cộng chỉ thuộc database `cong-cong`. Tài khoản cùng email ở
`cong-cong` và ở trung tâm A/B **không liên kết**: username, mật khẩu,
phiên, đình chỉ, gán vai và dữ liệu được lưu riêng. Cookie Better Auth
là cookie host-only; mang cookie hoặc JWT sang kho khác không tra
được phiên ở đó. Token vận hành `aud=platform` chỉ dùng được với
`@PlatformRoute` và do `POST /api/v1/auth/platform/login` phát trên
hostname gốc; tài khoản vận hành nằm trong database dùng chung và
không được đăng nhập vào khu công cộng bằng đường đăng nhập học tập.

Kho ngân hàng hệ thống là một database **khác nữa** (theo
`SYSTEM_BANK_DATABASE_URL`); không được ghi hồ sơ, lớp,
`attempt` hay điểm công cộng vào kho ngân hàng. Worker đọc sổ
đăng ký, xử lý outbox của *mọi* kho dedicated, bao gồm `cong-cong`,
với URL/role chính kho đó.

## Khởi tạo bản cài mới

1. Cấp phát database chung, control plane, runtime roles và chạy
   migration ban đầu theo quy trình trong [Tài liệu vận hành](centre-provisioning.md).
   Giữ `PUBLIC_LEARNING_ENABLED=false` trong giai đoạn này.
2. Từ môi trường vận hành có `DATABASE_ADMIN_URL` (hoặc quyền quản
   trị tương đương), `DATABASE_URL`, `CONTROL_PLANE_DATABASE_URL`
   và bộ migration đã build, chạy:

   ```sh
   pnpm --filter @giaokhoa/api build
   cd apps/api
   node dist/modules/tenants/space-provision.js provision-public --actor-id '<operator-uuid>' --admin-email 'admin-public@example.org'
   ```

   CLI trả về `PROVISION_RESULT` gồm `secretEnvVar`
   `SPACE_CONG_CONG_DATABASE_URL`, tên database, role và lời mời
   quản trị. Lệnh tạo database và role riêng, migrate schema, cài
   gói chương trình/vai, tạo danh mục khóa học gốc, thêm tenant/
   identity và người quản trị ban đầu; **không** tạo tài khoản vận hành ở kho công cộng.
   Dùng `--database-password` (hoặc `SPACE_PROVISION_DB_PASSWORD`)
   để kiểm soát secret; không ghi secret vào repo/PR/log. Cất
   `inviteToken` an toàn và kích hoạt qua đường lời mời trung tâm
   (`POST /api/v1/centres/activate-invite` với slug `cong-cong`).
3. Cài `SPACE_CONG_CONG_DATABASE_URL` bằng chuỗi kết nối chỉ tới
   database/role của kho vừa cấp, ở cả API lẫn worker (Compose đã
   chuẩn bị chỗ truyền biến này cho hai service).
4. Đặt `PUBLIC_LEARNING_ENABLED=true` cùng `BETTER_AUTH_ENABLED=true`,
   `BETTER_AUTH_URL`, `CONTROL_PLANE_DATABASE_URL`,
   `BETTER_AUTH_SECRET` trước khi mở traffic. API từ chối boot
   nếu thiếu URL hoặc secret; dù đã bật mà sổ/role không sẵn sàng
   thì request công cộng lỗi thay vì rơi về kho chung.
5. Kiểm tra trên hostname gốc: mở `/register`, tạo một người học
   và một giáo viên, đăng nhập, tạo lớp/khoá rồi nộp/chấm bài.
   Đồng thời thử cùng email ở một hostname trung tâm; các phiên
   không được dùng chéo. Kiểm tra tài khoản vận hành vẫn đăng
   nhập qua `/api/v1/auth/platform/login` và vào được control plane.

## Hợp đồng đăng ký và đăng nhập

- `POST /api/v1/auth/public/register`: chỉ hostname gốc khi đã
  bật kho công cộng, body gồm `username`, `email`, `password`,
  `firstName`, `lastName` và `role: student | teacher`.
  Người dùng và credential Better Auth được tạo trong một
  transaction cùng kho, vai `student` hoặc `coursecreator`
  tại tenant `cong-cong`. Giáo viên không tự nhận role manager
  hoặc role của trung tâm khác. Email tự khai chưa được đánh
  dấu đã xác minh.
- Sau đăng ký, trang `/register` đăng nhập bằng
  `/api/v1/auth/sign-in/username` và điều hướng `/profile`.
  Truy vấn học tập/đăng nhập sau đó tự đi cùng cookie + hostname
  đến database của khu công cộng, không truyền slug/tenant tuỳ
  ý do trình duyệt tạo.
- Đường học tập tự đăng ký dùng phiên cookie Better Auth. Nếu có
  JWT nghiệp vụ được cấp cho một tài khoản ở kho công cộng, token
  phải mang `centre_id` bằng ID sổ của `cong-cong`; JWT thiếu
  claim này bị từ chối ở API nghiệp vụ của khu công cộng. API
  mật khẩu JWT cũ `/auth/token` không phải đường đăng nhập cho
  tài khoản mới tạo qua Better Auth (không nhân đôi mật khẩu giữa
  hai kho credential). `/auth/platform/login` và bước MFA của nó luôn
  tra danh tính vận hành ở kho chung.
- Đường Better Auth `/sign-up/*` vẫn **đóng** trên mọi hostname:
  không cho đăng ký lách qua controller gắn kho và vai ở trên.

## Nâng cấp, vận hành và khôi phục

Không tự động chuyển dữ liệu học tập cũ ở kho chung; issue này chỉ
chuẩn hoá luồng **cài mới**. Cần dừng traffic, sao lưu rồi hoạch
định migration riêng nếu có dữ liệu cũ. Bật cờ trước khi cấp phát
sẽ từ chối phục vụ công cộng (fail-closed), không tự tạo dữ liệu
trong kho chung. Các công cụ fleet migration/backup/restore liệt
kê cả kho `kind=platform` dedicated và xử lý theo thứ tự platform
trước trung tâm. Các endpoint của control plane không đổi hợp đồng.

## Kiểm chứng

Chạy `pnpm --filter @giaokhoa/api typecheck`,
`pnpm --filter @giaokhoa/web typecheck`, các spec
`space-resolution`, `public-learning` và e2e luồng khu
công cộng qua HTTP. Các suite đụng Postgres dùng
`flock /tmp/giaokhoa-heavy-suite.lock`.
