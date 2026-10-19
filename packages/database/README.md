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

## Package boundary

`@giaokhoa/database` là persistence source of truth của workspace:

- `src/schema/*` chứa Drizzle tables, relations, constraints và indexes.
- `src/types.ts` expose `$inferSelect` / `$inferInsert` dưới dạng type-only public surface.
- `drizzle/` và `drizzle.config.ts` sở hữu migration tooling.

API repositories import runtime table objects từ `@giaokhoa/database/schema/*`. Contracts chỉ được import
`@giaokhoa/database/types` bằng `import type` để compile-check projection; web/editor không phụ thuộc DB.

## Naming convention

The package name is deliberately `@giaokhoa/database`, not an abbreviated `@giaokhoa/db`.

- Runtime table variables are plural lower-camel nouns: `subjects`, `questions`, `imageVariants`.
- Public inferred persistence types use `{Entity}Row` for `$inferSelect` and `{Entity}Insert` for
  `$inferInsert`.
- Runtime schema imports use `@giaokhoa/database/schema` or
  `@giaokhoa/database/schema/<group>`.
- Type-only consumers use `@giaokhoa/database/types`.
- Migration path consumers use `@giaokhoa/database/migrations`.

Do not add compatibility aliases for `@giaokhoa/db`; keeping one canonical name makes dependency graphs
and agent-generated changes predictable.
