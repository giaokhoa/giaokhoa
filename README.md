# Giáo khoa

Monorepo gồm API NestJS, web React Router, MCP và các package `application`, `database`, `shared`, `editor`, `ui`.

## Phát triển

Yêu cầu Node.js 24+ và pnpm 12.9.1. Cấu hình môi trường theo `apps/api/.env.example` và `apps/web/.env.example`.

```sh
pnpm install
pnpm dev
```

API mặc định ở cổng `3000`, web dev ở `5173`. Web gọi API qua `VITE_API_URL` (mặc định `http://localhost:3000`). Các lệnh build, test, lint và typecheck nằm trong `package.json`.

## Dữ liệu local

`pnpm --filter @giaokhoa/api reset` **xóa schema `public`/`drizzle`** trong PostgreSQL local và toàn bộ object của bucket S3Mock rồi chạy migration từ đầu. Script từ chối host database/S3 không thuộc danh sách local.

`pnpm --filter @giaokhoa/api files:gc` dọn file nháp hết hạn và thử lại các lần xóa storage lỗi. Lệnh không tự chạy; cần scheduler nếu muốn thu gom định kỳ. TTL mặc định là 24 giờ (`FILE_ORPHAN_TTL_HOURS`).

UI dùng các component trong `packages/ui`.

## Xác thực và phân quyền theo ngữ cảnh

Better Auth quản lý đăng ký, đăng nhập, xác minh email, phiên và trạng thái khóa tài khoản.
**Không đăng ký `better-auth/plugins/admin`**, không sử dụng `users.role` hay API `/api/auth/admin/*` để quyết định quyền.

`AuthorizationService` của ứng dụng xét quyền theo mô hình giống Moodle: người dùng nhận vai trò
trong `system` hoặc `class` (qua `authz_role_assignments`); quyền nằm ở `authz_role_permissions`
và được xét từ ngữ cảnh cụ thể lên ngữ cảnh cha. Vai trò mặc định `system:user` áp dụng cho tài khoản
đã đăng nhập còn hoạt động, không cần ghi một bản gán riêng. Một tài khoản có thể giữ đồng thời
nhiều vai trò ở nhiều ngữ cảnh. `PROHIBIT` cấm tuyệt đối; `ALLOW` thắng `PREVENT` của vai trò khác
cùng ngữ cảnh; ngữ cảnh con ưu tiên ngữ cảnh cha. Thu hồi vai trò có hiệu lực cho lần kiểm tra kế tiếp.

Sau khi tạo tài khoản đầu tiên đã xác minh email, người vận hành có quyền kết nối PostgreSQL có thể
khởi tạo **duy nhất** quản trị viên đầu tiên:

```sh
pnpm --filter @giaokhoa/database build
pnpm --filter @giaokhoa/database authz:bootstrap admin@example.com
```

Lệnh từ chối nếu đã có quản trị viên; không nhận email chưa xác minh, không đăng ký tài khoản mới.
Quản trị viên dùng `POST` hoặc `DELETE /authorization/system-roles/:userId`, với thân yêu cầu
`{"role":"teacher"}` hoặc `{"role":"admin"}` để cấp hoặc thu hồi vai trò.
API đòi capability `role:assign_system` tại ngữ cảnh `system`, không phụ thuộc vai trò Better Auth.
Các quyền theo lớp vẫn do luồng ghi danh và cấp vai trò trong ngữ cảnh lớp quản lý.

Bản di trú `0000_baseline.sql` là bản dành cho **cơ sở dữ liệu trống**, không được chạy trực tiếp
trên cơ sở dữ liệu đang giữ dữ liệu: việc chuyển các vai trò cũ sang bảng gán theo ngữ cảnh
phải có bản di trú bảo toàn dữ liệu riêng được rà soát trước khi áp dụng.

### Cấu hình vai trò và ghi đè theo ngữ cảnh

Hệ phân quyền ứng dụng lưu **định nghĩa vai trò** độc lập với **lần gán vai trò**.
Bảng `authz_role_context_levels` quản lý những loại ngữ cảnh được gán; hai ma trận
`authz_role_allow_assignments` và `authz_role_allow_overrides` xác định vai trò nào
được phép gán hoặc ghi đè vai trò khác. Có capability quản trị mà không được ma trận
cho phép vẫn không đủ quyền.

- Quản trị định nghĩa role: `POST /authorization/roles`, `PUT /authorization/roles/:roleKey/permissions`,
  `PUT /authorization/roles/:roleKey/contexts` và `PUT /authorization/roles/:roleKey/matrix`;
  chỉ tài khoản có capability `role:manage` tại `system` được phép.
- Gán/thu hồi vai trò theo ngữ cảnh: `POST` hoặc `DELETE /authorization/contexts/:contextId/roles/:userId`,
  body `{"roleKey":"class:teacher"}`. Cần capability `role:assign` và ma trận gán role cho phép.
- Ghi đè role tại một ngữ cảnh: `PUT /authorization/contexts/:contextId/overrides`, body
  `{"roleKey":"class:student","capability":"assignment:attempt","effect":"PREVENT"}`.
  `INHERIT` xóa override, quay về quyền đã định nghĩa hoặc override tại cha.

Áp dụng ngữ nghĩa cốt lõi của Moodle về role, capability và context nhưng **không khẳng định
đã sao chép mọi loại context và API của Moodle LMS**. Giáo khoa ánh xạ khóa học thành lớp
(`class`) và hoạt động thành bài giao (`assignment`); quyền truy cập câu hỏi, đề, tệp vẫn
chịu các quy tắc nghiệp vụ riêng và bảo vệ dữ liệu người dùng.
Tài liệu tham chiếu: https://moodledev.io/docs/5.0/apis/subsystems/roles
