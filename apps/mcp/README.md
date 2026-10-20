# Giaokhoa MCP — trust boundary

MCP chạy qua stdio và đọc dữ liệu Curriculum. Ba công cụ ghi (`create_curriculum`, `create_curriculum_node`, `create_learning_outcome`) **mặc định bị từ chối**, kể cả khi tiến trình kết nối được PostgreSQL.

Chỉ bật đường ghi cho môi trường CLI do người vận hành tin cậy quản lý:

1. Cấu hình `GIAOKHOA_MCP_TRUSTED_ADMIN_USER_ID` thành UUID của một tài khoản admin thực.
2. Tài khoản phải còn hiệu lực và có quyền `platform:moderate` tại System context. Quyền được kiểm tra lại từ database ở **mỗi lệnh ghi**.
3. Quyết định quyền được ghi vào stderr để không làm hỏng giao thức stdio.

Không truyền principal này từ input MCP hoặc tin rằng stdio/tunnel tự xác thực người dùng. Nếu mở MCP cho client không tin cậy, cần xác thực principal theo từng request, policy ở application và audit riêng (quyết định D11); **không cấu hình trusted admin actor** cho trường hợp đó.

Ví dụ chạy trong CLI tin cậy (không lưu biến này trong repository):

```bash
GIAOKHOA_MCP_TRUSTED_ADMIN_USER_ID=<uuid-cua-admin> pnpm --filter @giaokhoa/mcp start:local
```
