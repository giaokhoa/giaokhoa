# Quy ước cho `@giaokhoa/application`

- Package này sở hữu use case nghiệp vụ, lỗi domain/application và repository port.
- Chỉ phụ thuộc vào `@giaokhoa/shared`; không phụ thuộc vào NestJS, Drizzle hay PostgreSQL.
- Application service chứa hành vi chung cho mọi transport: kiểm tra quyền sở hữu, gộp và xác thực lại dữ liệu, vòng đời câu hỏi, xác thực cây chương trình học và lỗi domain/application.
- Repository interface phải nằm cùng hành vi application sử dụng nó.
- Lỗi đặc thù persistence, như mã lỗi PostgreSQL, phải được database adapter chuyển thành application error.

## Lỗi do client gây ra

- Dùng thống nhất `ClientError` từ `@giaokhoa/application/client-error`.
- `kind` chỉ được là `invalid`, `not_found` hoặc `conflict`.
- `code` là mã ổn định, có ý nghĩa trong domain và máy có thể xử lý; `message` là phần giải thích cho người dùng; `details` là ngữ cảnh có cấu trúc tùy chọn, ví dụ lỗi xác thực.
- Không tạo subclass lỗi cho từng resource hoặc `errors.ts` chỉ để ánh xạ một trường hợp sang HTTP.
- Transport adapter tự ánh xạ `ClientError.kind` sang ngữ nghĩa giao thức của nó.
