# Kiểm tra cấu hình production khi triển khai Compose

Ngân sách pool trên cấu hình mặc định và số đo tại môi trường dev được đối chiếu trong [báo cáo tài nguyên khi nghiệm thu #20](space-resource-budget.md); cần đo lại với tải thực trước khi quyết định số replica hoặc ngưỡng vận hành.

Tài liệu vận hành cho PR audit #48. Đây là các cổng phải kiểm tra trên
máy thực, **không** được coi là đạt chỉ vì CI tạo stack tạm thời thành công.

## Trước khi triển khai

Các biến bắt buộc trong Compose phải lấy từ bộ secret được quản lý
ngoài repo. Không dùng mật khẩu mẫu của `.env.example` trên production,
không in thông tin xác thực vào log hoặc lưu file trong Git.

| Nhóm | Biến cấu hình tuỳ chọn | Cách vận hành |
| --- | --- | --- |
| Kho riêng | `SPACE_DB_POOL_MAX=3`, `SPACE_DB_MAX_POOLS=6` | Ngân sách mỗi tiến trình = số pool × số kết nối mỗi pool. Khi đạt trần, manager thu hồi pool hết TTL và không còn kết nối đang mượn trước khi mở kho khác; pool còn bận hoặc chưa hết TTL bị giữ nguyên, yêu cầu kho mới có thể bị từ chối tạm thời. Cộng mọi API/worker replica, pool chung, control-plane, system-bank và headroom trước khi tăng giới hạn |
| PostgreSQL TLS | `DATABASE_SSL=true`, `DATABASE_TLS_CA_FILE=/run/certs/database-ca.pem` | Mount CA nội bộ bằng volume read-only vào đúng các service cần kết nối (API, worker, migrate); phải xác minh hostname và chuỗi chứng chỉ, không đặt `rejectUnauthorized=false` |
| Redis TLS | `REDIS_TLS_CA_FILE=/run/certs/redis-ca.pem` và `rediss://` | Mount CA và đặt ACL/mật khẩu Redis tương ứng. Chỉ dùng Redis không xác thực bên trong mạng riêng đã cô lập và kiểm chứng firewall |
| Redis cache | `REDIS_CACHE_MAXMEMORY=256mb`, `CACHE_REDIS_URL=redis://redis-cache:6379` | Cache là instance eviction riêng; không dùng eviction trên Redis session/BullMQ. Khi ra ngoài Compose, cache cần URL riêng |
| Redis queue | `REDIS_MAXMEMORY` (**bắt buộc khai**) | Khai mức dương có đơn vị (`mb`/`gb`) dựa trên số job, bộ nhớ Redis thật và RAM khả dụng của host; Compose không chọn hộ. Giữ `noeviction`, AOF và RDB snapshots. Theo dõi `used_memory`, `used_memory_peak`, `maxmemory`, `evicted_keys`, số lần Redis báo OOM và dung lượng đĩa; có backup off-host cùng thử restore. Khi chạm trần, enqueue có thể lỗi thay vì mất job qua eviction; tăng ngân sách hoặc xử lý backlog có kiểm soát |
| Thư điện tử | `RESEND_API_KEY`, `MAIL_FROM`, `RESEND_RATE_LIMIT_PER_SECOND=1` | Chỉ bật gửi thật khi có đủ API key và địa chỉ gửi; không khai biến rỗng. Token bucket Redis giới hạn cả cụm, đối chiếu hạn mức Resend thật |
| Caddy ingress | `GIAOKHOA_TRUSTED_PROXY_CIDRS` | Mặc định chỉ tin `127.0.0.1/32`. Đo địa chỉ peer thật của Cloudflare Tunnel/ingress, khai CIDR chính xác (ưu tiên /32) và firewall cấm kết nối trực tiếp từ Internet tới 8080 |
| API nhiều replica | `GIAOKHOA_API_UPSTREAM=api:3100 api-two:3100` | Mỗi upstream phải chỉ tới một replica riêng để cookie affinity giữ Engine.IO polling SID; cả hai API dùng cùng Redis adapter |

Compose sẽ dừng ở bước phân giải biến nếu `REDIS_MAXMEMORY` chưa
được khai. CI khai riêng `512mb` cho stack thử nghiệm và kiểm tra Redis
đang chạy trả về `maxmemory > 0`; **đó không phải đề xuất ngân sách
production**. Không dùng `0` (không giới hạn) trên production vì Redis
có thể chiếm toàn RAM host trước khi hệ giám sát cảnh báo. Worker
healthcheck gọi cùng `redisConnectionFromUrl` với runtime; nếu dùng
Redis TLS CA riêng phải mount chứng chỉ read-only trong worker/API và
kiểm tra `rediss://` đúng hostname từ môi trường thực tế.

Khi thay đổi identity của một kho, manager chỉ chờ `Pool.end()` của
chính kho đó, không khóa các kho khác. Pool đang đóng vẫn chiếm slot
trong `SPACE_DB_MAX_POOLS` cho tới khi đóng thành công; kho khác
vẫn dùng được pool sẵn có và có thể mở pool mới nếu còn ngân sách.
Nếu `Pool.end()` trả lỗi, manager ghi lỗi, giữ lại slot như pool
**không an toàn**, thu hồi cache handle đã chuẩn bị và từ chối dùng
lại pool đó. Người vận hành phải kiểm tra kết nối, log và khởi động
lại tiến trình hoặc xử lý tài nguyên hỏng có kiểm soát; không tăng
trần bừa để bỏ qua pool chưa được xác nhận đã giải phóng.

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
