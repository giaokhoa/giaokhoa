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

## Xác thực và phân quyền

Better Auth phụ trách tài khoản và phiên đăng nhập. Hệ thống phân quyền riêng trong
`packages/application/src/authorization` quản lý vai trò, capability và ngữ cảnh
theo định hướng Moodle. `apps/api` cung cấp các giao diện HTTP tương ứng; lược đồ
lưu trữ ở `packages/database/src/schema/authorization.ts`.

Các lệnh quản trị dữ liệu, công cụ khởi tạo và hướng dẫn sử dụng cụ thể nằm cùng
thành phần thực hiện chúng; không mô tả luồng nghiệp vụ trong README dự án.

## Giao diện web

Không gian làm việc gồm ngân hàng câu hỏi, đề thi, lớp học, bài giao, bài làm và chấm điểm. Khu vực quản trị cung cấp môn học, chương trình và phân quyền. Thanh điều hướng và các thao tác sử dụng quyền hiệu lực do API trả về; Better Auth chỉ cung cấp danh tính và phiên đăng nhập.

Các trang dùng bộ nạp dữ liệu và hành động của React Router, hợp đồng tại `@giaokhoa/shared/http/*` và thành phần trong `packages/ui`. Kiểm thử giao diện thuần đặt tại `apps/web/test`; kiểm thử dữ liệu và phân quyền của không gian làm việc đặt tại `apps/api/test/integration/workspace`.
