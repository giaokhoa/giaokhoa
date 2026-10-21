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

UI dùng các thành phần shadcn/ui trong `packages/ui`, tổ chức theo mẫu điều hướng có thanh bên và các thẻ chức năng.

## Các luồng trên web

- `/classes`: tạo lớp, tham gia bằng mã mời hoặc mở lớp theo mã định danh; trang lớp quản lý thông tin, thành viên và mã mời.
- `/exams`: tạo và sửa đề, chốt phiên bản từ các câu hỏi đã sẵn sàng, xem nội dung từng phiên bản.
- `/assignments/new`: giao một phiên bản đề cho lớp, đặt lịch làm bài, công bố bài và quản lý người nhận; trang chi tiết hiển thị trạng thái bài giao.
- `/assignments/:id/delivery`: học sinh xem bài được giao và bắt đầu lượt làm; `/attempts/:id` lưu bài, nộp và xem kết quả khi được công bố; giáo viên xem lượt làm, chấm điểm qua các trang tương ứng.

API hiện chưa có điểm cuối liệt kê lớp hoặc bài giao. Web chỉ hỗ trợ nhập mã tham gia, mã định danh lớp và đi theo liên kết đến bài giao, không tạo danh sách từ dữ liệu giả. Các hành động đều dùng phiên đăng nhập và phân quyền của API; kết quả và đáp án chỉ xuất hiện khi API cho phép.
