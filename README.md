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
