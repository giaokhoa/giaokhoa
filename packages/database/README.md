# Database

`@giaokhoa/database` sở hữu Drizzle schema (`src/schema/`), PostgreSQL repository adapter và migration (`drizzle/`). Schema runtime được export từ `src/schema/index.ts`.

`auth.generated.ts` được Better Auth CLI sinh; khi cần tạo lại, dùng `pnpm --filter @giaokhoa/api auth:generate`. PostgreSQL 18 sinh UUIDv7 cho ID.

Trong giai đoạn dev chưa giữ dữ liệu, `drizzle/0000_baseline.sql` là migration duy nhất cho database trống, gồm cả seed quyền RBAC. Database đã chạy lịch sử migration cũ phải được reset trước khi áp dụng baseline mới.

Package exports và lệnh Drizzle xem `package.json`.
