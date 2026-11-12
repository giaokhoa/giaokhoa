# @giaokhoa/eslint-config

Preset ESLint Flat Config dành cho các package TypeScript 6 (`api`,
`worker`, `db`, `enrol`, `payments`). Mỗi package tự quản lý
`eslint.config.mjs`, lệnh `lint` và các suppression thực sự cần thiết.

Các preset `javascript`, `typescript(import.meta.dirname)`,
`vitestTests`, `integrationTests` duy trì bộ quy tắc đang được dùng.
`typescript-eslint` sử dụng alias `@typescript/typescript6`, không
phụ thuộc compiler TypeScript 7 trong các workspace khác.
Typecheck tách thành task riêng của từng package.
