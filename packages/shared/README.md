# Hợp đồng và schema dùng chung

`@giaokhoa/shared` chứa schema, kiểu dữ liệu, hằng số và mô tả HTTP được dùng chung giữa web,
editor, API, application service, database adapter và MCP. Package này không phụ thuộc framework
hoặc hạ tầng.

Các đường dẫn public của domain được chia theo bounded context:

- `@giaokhoa/shared/questions`
- `@giaokhoa/shared/curriculum`
- `@giaokhoa/shared/images`

Hợp đồng HTTP sử dụng các đường dẫn riêng theo transport:

- `@giaokhoa/shared/http/questions`
- `@giaokhoa/shared/http/stimuli`
- `@giaokhoa/shared/http/subjects`
- `@giaokhoa/shared/http/curricula`
- `@giaokhoa/shared/http/curriculum-nodes`
- `@giaokhoa/shared/http/learning-outcomes`
- `@giaokhoa/shared/http/images`
- `@giaokhoa/shared/http/auth`

Schema của domain đặt tên theo ý nghĩa, chẳng hạn `questionCreateSchema`,
`questionPatchSchema` và `questionSchema`. Khi dữ liệu HTTP có cùng cấu trúc,
descriptor dùng lại schema gốc, không tạo alias chỉ để đổi tên.

Không import NestJS, React, Drizzle, PostgreSQL, `@giaokhoa/application` hoặc
`@giaokhoa/database` vào package này.
