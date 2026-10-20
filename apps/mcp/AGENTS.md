# Quy ước cho `apps/mcp`

- Đây là runtime riêng, phải compose cùng application service và database adapter như các transport khác.
- Không tự triển khai logic persistence riêng hoặc truy vấn trực tiếp bảng Drizzle từ handler.
