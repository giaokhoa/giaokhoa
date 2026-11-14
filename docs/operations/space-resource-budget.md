# Ngân sách kết nối và bằng chứng tài nguyên khi nghiệm thu #20

## Phạm vi quan sát

Đo trong Dev Container ngày 14/11/2026 lúc **05:43:25 UTC**, trên nhánh `feat/20-integrated-acceptance` trước thay đổi; PostgreSQL 18.6 và Redis tại `localhost`. Đây là mẫu quan sát khi suite e2e API đang chạy với database `giaokhoa_test_api`, **không** phải tải của một cụm production với A/B/công cộng đang phục vụ đồng thời. Không suy ra ngưỡng số trung tâm, thông lượng, độ trễ hoặc SLA từ mẫu này.

Lấy số liệu bằng driver `pg` với truy vấn `pg_stat_activity` và `current_setting`, bằng `ioredis INFO` và bằng đối chiếu trực tiếp `compose.yaml`, `SpaceDatabaseService`, các provider kết nối và decorator `@Processor`.

| Chỉ số                                                    |             Giá trị quan sát | Diễn giải                                              |
| --------------------------------------------------------- | ---------------------------: | ------------------------------------------------------ |
| PostgreSQL `max_connections`                              |                          100 | Cấu hình thực tế của server dev                        |
| `superuser_reserved_connections` / `reserved_connections` |                        3 / 0 | 97 slot không thuộc phần dành riêng cho superuser      |
| Session tại `giaokhoa_test_api`                           |         9 (1 active, 8 idle) | Thời điểm suite e2e còn chạy; không phải đỉnh tải      |
| Session đo tại `postgres`                                 |                     1 active | Chính kết nối đọc thống kê                             |
| Redis `connected_clients` / `blocked_clients`             |                       11 / 0 | Các kết nối của môi trường dev, có thể gồm test        |
| Redis `used_memory` / `used_memory_peak`                  | 11.014.600 / 16.206.088 byte | Bộ nhớ được Redis báo, không phải RSS cả cụm           |
| Redis `maxmemory`                                         |                            0 | Dev không đặt trần; production bắt buộc cấu hình riêng |
| Worker chạy nền đo tải thật                               |                      Chưa có | Chỉ kiểm kê cấu hình concurrency, chưa đo throughput   |

## Ngân sách pool trên cấu hình Compose mặc định

Cấu hình đang khai **một replica API và một replica worker**. Các số dưới đây là trần pool khả dĩ, **không phải** số kết nối đang mở; `pg.Pool` tạo kết nối khi cần. Ngân sách tính riêng mọi pool có thể cùng tồn tại.

| Nguồn pool                                                         |               API (max) |            Worker (max) |
| ------------------------------------------------------------------ | ----------------------: | ----------------------: |
| `DATABASE_URL` (pool cơ sở hiện hành)                              |                      10 |                      10 |
| Control plane / registry                                           |                       4 | 10 (mặc định `pg.Pool`) |
| System bank                                                        | 10 (mặc định `pg.Pool`) |                       0 |
| Pool từng kho riêng: `SPACE_DB_MAX_POOLS=6`, `SPACE_DB_POOL_MAX=3` |                      18 |                      18 |
| **Tổng theo tiến trình**                                           |                  **42** |                  **38** |

**Tổng trần một cụm API + worker = 80 kết nối**, chưa kể `migrate`, seed/cấp phát, CLI khôi phục, công cụ giám sát và ứng dụng khác. Với server dev `max_connections=100` và 3 kết nối dành riêng cho superuser, phần dư lý thuyết là **17** slot không dành riêng, không phải phần dư được phép sử dụng hết. Nếu tăng thêm một replica API mà giữ nguyên cấu hình, tổng trần thành **122**, vượt sức chứa 97 slot thông thường. Phải tính lại cả số replica, kết nối vận hành và headroom trước khi triển khai.

Worker có concurrency được khai tường minh: `notification-dispatch=10`, `calendar-import=5`; các processor còn lại không đặt concurrency riêng tại decorator. Đây là _mức song song xử lý job cấu hình_, không phải số tiến trình, số kết nối PostgreSQL hoặc tải CPU đã đo. BullMQ/Redis sử dụng kết nối độc lập với pool PostgreSQL.

## Cách đo lại trước khi chốt AC26

1. Khởi động A, B, công cộng và ngân hàng hệ thống bằng cấu hình thật; ghi số replica API/worker và mọi biến pool từ deployment (không ghi URL/mật khẩu).
2. Ghi mốc thời gian, thời gian duy trì tải, lượng job enqueue/completed/failed/retried, `pg_stat_activity` theo database/role/state và `pg_stat_database` trước/sau. Đo `INFO clients`, `INFO memory`, queue depth và stalled jobs của Redis trong cùng cửa sổ.
3. Thử các ngưỡng đồng thời phù hợp và kiểm thất bại/thu hồi pool, so sánh trần dự kiến với đỉnh thực tế; ghi RAM/RSS của **từng** tiến trình và resource limit của host.
4. Để lại headroom cho migration, backup/restore và giám sát. Không lấy lần đo dev này làm chuẩn để cam kết tải hay cấu hình production.

Các lệnh kiểm chứng ứng dụng và kết quả AC01–AC27 phải được ghi riêng trên **đúng head** của PR; số liệu ở trên chỉ đáp ứng phần đo điểm thời gian của AC26, **chưa** chứng minh AC26 toàn bộ hoặc AC27.
