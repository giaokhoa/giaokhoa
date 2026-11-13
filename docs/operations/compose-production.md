# Kiểm tra cấu hình production khi triển khai Compose

Tài liệu vận hành cho PR audit #48. Đây là các cổng phải kiểm tra trên
máy thực, **không** được coi là đạt chỉ vì CI tạo stack tạm thời thành công.

## Trước khi triển khai

Các biến bắt buộc trong Compose phải lấy từ bộ secret được quản lý
ngoài repo. Không dùng mật khẩu mẫu của `.env.example` trên production,
không in thông tin xác thực vào log hoặc lưu file trong Git.

| Nhóm | Biến cấu hình tuỳ chọn | Cách vận hành |
| --- | --- | --- |
| Kho riêng | `SPACE_DB_POOL_MAX=3`, `SPACE_DB_MAX_POOLS=6` | Ngân sách tối đa mỗi tiến trình là số pool × số kết nối mỗi pool. Cộng tất cả API/worker replica, pool kho chung, control-plane, system-bank và headroom trước khi tăng giới hạn |
| PostgreSQL TLS | `DATABASE_SSL=true`, `DATABASE_TLS_CA_FILE=/run/certs/database-ca.pem` | Mount CA nội bộ bằng volume read-only vào đúng các service cần kết nối (API, worker, migrate); phải xác minh hostname và chuỗi chứng chỉ, không đặt `rejectUnauthorized=false` |
| Redis TLS | `REDIS_TLS_CA_FILE=/run/certs/redis-ca.pem` và `rediss://` | Mount CA và đặt ACL/mật khẩu Redis tương ứng. Chỉ dùng Redis không xác thực bên trong mạng riêng đã cô lập và kiểm chứng firewall |
| Redis cache | `REDIS_CACHE_MAXMEMORY=256mb`, `CACHE_REDIS_URL=redis://redis-cache:6379` | Cache là instance eviction riêng; không dùng eviction trên Redis session/BullMQ. Khi ra ngoài Compose, cache cần URL riêng |
| Redis queue | `REDIS_MAXMEMORY` | `noeviction`, AOF `appendfsync everysec`, snapshot RDB `save 900 1 300 10 60 10000`; hoạch định RAM/ổ đĩa, giữ sao lưu off-host có thử restore |
| Thư điện tử | `RESEND_API_KEY`, `MAIL_FROM`, `RESEND_RATE_LIMIT_PER_SECOND=1` | Chỉ bật gửi thật khi có đủ API key và địa chỉ gửi; không khai biến rỗng. Token bucket Redis giới hạn cả cụm, đối chiếu hạn mức Resend thật |
| Caddy ingress | `GIAOKHOA_TRUSTED_PROXY_CIDRS` | Mặc định chỉ tin `127.0.0.1/32`. Đo địa chỉ peer thật của Cloudflare Tunnel/ingress, khai CIDR chính xác (ưu tiên /32) và firewall cấm kết nối trực tiếp từ Internet tới 8080 |
| API nhiều replica | `GIAOKHOA_API_UPSTREAM=api:3100 api-two:3100` | Mỗi upstream phải chỉ tới một replica riêng để cookie affinity giữ Engine.IO polling SID; cả hai API dùng cùng Redis adapter |

**Không dùng subnet Docker bridge `172.16/12` làm CIDR proxy tin cậy.**
Docker NAT có thể làm client ngoài xuất hiện với IP gateway; nếu Caddy
tin toàn subnet, client có thể tự khai `CF-Connecting-IP` và
`X-Forwarded-For`. Sau khi thay đổi ingress cần kiểm tra lại HTTPS
redirect, cookie bảo mật, Google OAuth và MCP trên URL công khai.

Đọc file CA, dữ liệu volume và IP peer thực tế **trước khi** chuyển
người dùng qua gateway mới. Không tự xoá DNS, Cloudflare Tunnel,
secret hay volume PostgreSQL/Keycloak từng tồn tại: phải kiểm kê host,
kiểm tra bản sao lưu và có phê duyệt vận hành từng tài nguyên.
Các service Keycloak/kc-db đã bị loại khỏi Compose và không được
triển khai lại như federation hoặc giai đoạn 1.

## Bằng chứng từ CI

Workflow `.github/workflows/deploy-check.yml` dựng stack tạm,
kiểm tra non-root API/worker đọc-ghi chung volume, Redis persistence,
hai API replica qua Caddy cookie affinity, và HTTP 503 khi Redis/
PostgreSQL ngừng. Bài kiểm tra này **không thay thế** kiểm chứng
backup, chứng chỉ CA riêng, IP ingress, dung lượng đĩa hay kế hoạch
triển khai/rollback trên hạ tầng thật.
