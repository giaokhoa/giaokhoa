# Quy ước cho `apps/api`

- Đây là HTTP/Nest adapter. Controller dùng `@giaokhoa/shared/http/*` cho route contract và inject application service.
- Controller không được truy vấn trực tiếp bảng Drizzle hoặc tự thực hiện persistence logic.
- Composition root của API có thể import database schema để khởi tạo Drizzle; controller và application service không được import bảng runtime.
- Ánh xạ `ClientError.kind` từ application sang HTTP status và nội dung phản hồi phù hợp.
