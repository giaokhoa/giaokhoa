# Giáo khoa

Monorepo gồm API NestJS, web React Router và package UI dùng chung.

## Bắt đầu

Yêu cầu Node.js 24+ và pnpm 12.9.1.

```sh
pnpm install
pnpm dev
```

API chạy mặc định ở cổng `3000`, web dev ở `5173`. Web dùng `VITE_API_URL` để gọi API và mặc định là `http://localhost:3000`.

## Lệnh

```sh
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:cov
pnpm format
pnpm format:check
```

Chạy riêng một app bằng Turborepo, ví dụ:

```sh
pnpm dev --filter=@giaokhoa/api
pnpm dev --filter=@giaokhoa/web
```

Ở production, API dùng cổng `3000` và web dùng `3001` mặc định. Dùng `PORT` để đổi cổng.

## Local reset và S3Mock

Devcontainer dùng bucket `giaokhoa-assets` trên Adobe S3Mock. Để reset toàn bộ database local, chạy migration lại và xóa sạch bucket S3Mock:

```sh
pnpm --filter @giaokhoa/api reset
```

`reset` chỉ cho phép database host và S3 endpoint local/devcontainer trước khi thực hiện thao tác xóa dữ liệu.

File upload chưa được gắn vào câu hỏi hoặc ngữ liệu được giữ ở vùng nháp. Cần cấu hình scheduler/cron (ví dụ chạy hằng ngày) gọi `pnpm --filter @giaokhoa/api files:gc` để thu gom file nháp quá hạn `FILE_ORPHAN_TTL_HOURS` (mặc định 24 giờ). Các file đã được tham chiếu bởi phiên bản câu hỏi hoặc ngữ liệu không bị dọn. Storage key được xếp vào outbox cùng transaction xóa metadata và GC thử lại nếu xóa S3 lỗi. Lệnh GC không tự chạy nếu chưa cấu hình scheduler.

## UI

Thêm shadcn component từ root:

```sh
pnpm dlx shadcn@latest add card -c apps/web
```

Shared UI nằm trong `packages/ui`.
