# Quy ước cho `@giaokhoa/database`

- Gói này là nguồn chuẩn của tầng lưu trữ dữ liệu (persistence): sở hữu lược đồ Drizzle, bản di trú (migration), kiểu dữ liệu lưu trữ và bộ chuyển đổi kho dữ liệu PostgreSQL.
- Triển khai hợp đồng kho dữ liệu (repository port) từ `@giaokhoa/application`; có thể phụ thuộc trực tiếp vào `@giaokhoa/shared` để kiểm tra bản ghi bằng lược đồ chuẩn.
- Bảng Drizzle khi chạy nằm trong `src/schema/*.ts`; bản di trú và công cụ Drizzle thuộc gói này.
- Đặt tên bộ chuyển đổi PostgreSQL theo dạng `Postgres{Context}Repository`.
- Mã chạy ngoài gói này không được truy vấn Drizzle trực tiếp.
- Bộ chuyển đổi phải chuyển lỗi riêng của PostgreSQL và tầng lưu trữ thành lỗi ứng dụng (application error).
- Thêm cột dữ liệu nội bộ không được tự động công khai cột đó qua lược đồ chuẩn của `@giaokhoa/shared`.

## Phân tầng kiểm thử và giữ đúng nghiệp vụ

- Kiểm thử trong `packages/database/test` chỉ kiểm tra lược đồ, bản di trú, giao dịch, truy vấn, ràng buộc dữ liệu và bộ chuyển đổi kho dữ liệu. Không nhập hoặc khởi tạo dịch vụ ứng dụng (application service) tại đây.
- Kiểm thử kết hợp dịch vụ nghiệp vụ với PostgreSQL thực nằm trong `apps/api/test/integration`; kiểm thử HTTP đầu cuối nằm trong `apps/api/test/e2e`.
- Giữ đúng các ràng buộc về quyền sở hữu, khóa ngoại, tính duy nhất, phiên bản nội dung và quyền truy cập tệp khi thay đổi bảng hoặc truy vấn.
- Bản di trú gốc `drizzle/0000_baseline.sql` chỉ dành cho cơ sở dữ liệu trống; không được áp dụng trực tiếp lên cơ sở dữ liệu đã chạy chuỗi bản di trú trước đó. Đồng bộ tệp SQL, ảnh chụp lược đồ và nhật ký bản di trú.
- Khi sửa truy vấn hoặc lược đồ, cập nhật ngay chú thích, tài liệu liên quan và mô tả kiểm thử theo quy tắc tiếng Việt tại `AGENTS.md` gốc.
