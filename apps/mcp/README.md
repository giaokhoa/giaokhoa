# MCP

MCP dùng stdio để đọc Curriculum. Ba công cụ ghi `create_curriculum`, `create_curriculum_node`, `create_learning_outcome` bị từ chối nếu không có `GIAOKHOA_MCP_TRUSTED_ADMIN_USER_ID` hợp lệ và quyền `platform:moderate` tại System context; quyền được kiểm tra cho từng lần ghi và kết quả ghi ra stderr.

Chỉ cấu hình trusted admin actor trong CLI do người vận hành kiểm soát; không lấy principal từ input MCP. Nếu cho client không tin cậy truy cập, cần cơ chế xác thực theo request thay vì trusted actor.

Script chạy local: `pnpm --filter @giaokhoa/mcp start:local` (sau khi build).
