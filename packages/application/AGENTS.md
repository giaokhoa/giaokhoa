# Quy ước cho `@giaokhoa/application`

- Sở hữu use case, `ClientError` và repository port; trong workspace chỉ phụ thuộc `@giaokhoa/shared`, không phụ thuộc NestJS, Drizzle hay PostgreSQL.
- Nghiệp vụ và kiểm tra quyền thuộc application service; lỗi persistence phải được adapter chuyển thành application error.
- Dùng `ClientError` từ `@giaokhoa/application/common/client-error` với `kind`: `invalid`, `not_found`, `conflict`, `forbidden`. `code` ổn định; transport tự ánh xạ lỗi. Không tạo subclass lỗi cho từng resource.
