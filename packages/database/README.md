# Quyết định tổ chức database schema

Schema được tách theo quyền sở hữu:

- `auth.generated.ts` — schema do Better Auth CLI sinh.
- `images.ts` — metadata media image; bytes nằm trong S3-compatible object storage.
- `curriculum.ts` — môn học, chương trình theo môn/lớp, cây nội dung, yêu cầu cần đạt và liên kết câu hỏi.
- `questions.ts` — schema domain Questions và Stimuli.
- `index.ts` — entry point chung cho Drizzle và Nest.

Cấu trúc này giữ generated auth schema và handwritten domain schema độc lập với nhau.

## Better Auth và UUIDv7

Drizzle adapter của Better Auth dùng `usePlural: true`, nên các bảng auth có tên:

- `users`
- `sessions`
- `accounts`
- `verifications`

Runtime Better Auth dùng `advanced.database.generateId: false`, nên PostgreSQL chịu trách nhiệm sinh
ID. Riêng `auth.config.ts` dùng `"uuid"` khi chạy CLI để generated schema có sẵn PostgreSQL `uuid` cho
primary key và foreign key.

Lệnh `auth:generate` chạy theo pipeline:

```text
auth generate
-> auth.generated.ts
-> patch-auth-schema.mjs
```

Better Auth CLI sinh UUID với default `pg_catalog.gen_random_uuid()`. `patch-auth-schema.mjs` chỉ đổi
default đó sang PostgreSQL 18 `uuidv7()`.

Lệnh chuẩn để regenerate auth schema:

```sh
pnpm --filter @giaokhoa/api auth:generate
```

## Migration trong giai đoạn init

Trong giai đoạn phát triển initial schema, mọi thay đổi schema được phản ánh bằng cách tạo lại migration
`0000` từ đầu. Migration history bắt đầu ổn định khi database/version mục tiêu được chốt để triển khai.

## Ranh giới package

`@giaokhoa/database` là nguồn chuẩn của tầng lưu trữ trong workspace:

- `src/schema/*` chứa bảng, quan hệ, ràng buộc và chỉ mục Drizzle.
- `src/types.ts` xuất `$inferSelect` / `$inferInsert` dưới dạng type-only.
- `drizzle/` và `drizzle.config.ts` quản lý migration.

Repository của API import bảng runtime từ `@giaokhoa/database/schema/*`. Các package chỉ cần
kiểu dữ liệu sử dụng `import type` từ `@giaokhoa/database/types` để kiểm tra projection;
web/editor không phụ thuộc vào database.

## Quy ước đặt tên

Tên package thống nhất là `@giaokhoa/database`, không viết tắt thành `@giaokhoa/db`.

- Biến bảng runtime dùng danh từ số nhiều dạng lower-camel: `subjects`, `questions`, `imageVariants`.
- Kiểu persistence suy ra công khai dùng `{Entity}Row` cho `$inferSelect` và `{Entity}Insert`
  cho `$inferInsert`.
- Import schema runtime từ `@giaokhoa/database/schema` hoặc `@giaokhoa/database/schema/<group>`.
- Package chỉ dùng kiểu dữ liệu import từ `@giaokhoa/database/types`.
- Thành phần cần đường dẫn migration dùng `@giaokhoa/database/migrations`.

Không tạo alias tương thích `@giaokhoa/db`; một tên chuẩn giúp đồ thị phụ thuộc và thay đổi
do agent thực hiện nhất quán.
