# Quy ước cho `@giaokhoa/database`

- Package này là nguồn chuẩn của persistence: sở hữu Drizzle schema, migration, persistence type và PostgreSQL repository adapter.
- Triển khai repository port từ `@giaokhoa/application`; có thể phụ thuộc trực tiếp vào `@giaokhoa/shared` để xác thực row bằng schema chuẩn.
- Bảng Drizzle ở runtime nằm trong `src/schema/*.ts`; migration và công cụ Drizzle thuộc package này.
- Đặt tên PostgreSQL adapter theo dạng `Postgres{Context}Repository`.
- Runtime code ngoài package này không được truy vấn Drizzle trực tiếp.
- Adapter phải chuyển lỗi riêng của PostgreSQL/persistence thành application error.
- Thêm cột database nội bộ không được tự động làm lộ cột đó qua shared canonical schema.
