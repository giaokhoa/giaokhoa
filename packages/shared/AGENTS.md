# Quy ước cho `@giaokhoa/shared`

- Chứa canonical schema, type và HTTP descriptor; không import NestJS, React, Drizzle hoặc các package `application`/`database`.
- Khai báo public entry tường minh trong `package.json`, không tạo export gốc. Domain và transport HTTP là hai nhóm subpath riêng.
- Dùng `schema.ts` (không song song `schemas.ts`); tránh barrel và alias chỉ để tái xuất hoặc đổi tên schema.
- HTTP descriptor dạng `<resource>Contract` chỉ dùng `method`, `path`, `pathParams`, `query`, `headers`, `body`, `file`, `responses`. `responses` key theo HTTP status, với `204: null` và `'binary'` khi phù hợp. Path là public API đầy đủ.
- Kiểm tra các quy ước HTTP qua `test/http-contracts.spec.ts`.
