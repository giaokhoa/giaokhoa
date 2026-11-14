# Vận hành BullMQ — lỗi cuối và phát lại an toàn

Mọi processor kế thừa `ObservedWorkerHost` và ghi event lỗi cuối
vào Redis stream `giaokhoa:bullmq:terminal-failures`, tối đa khoảng
10.000 dòng gần nhất, mỗi dòng chỉ chứa tên queue, jobId, số lần thử,
loại lỗi và thời điểm. **Không sao chép payload, OTP, token, nội dung
thư/tin nhắn hoặc stack có dữ liệu người dùng vào stream**.

## Chẩn đoán

Trên máy có quyền kết nối Redis hàng đợi (không phải `redis-cache`):

```bash
redis-cli XREVRANGE giaokhoa:bullmq:terminal-failures + - COUNT 50
```

Tìm job gốc bằng `Queue.getJob(jobId)` và `Queue.getFailed()`.
Dữ liệu job gốc vẫn do BullMQ quản lý; stream chỉ giữ bản ghi giám sát,
**không** thay thế failed queue hay tạo bản sao payload nhạy cảm.

Không chạy `retry()` hàng loạt. Trước mỗi lượt replay, kiểm tra:
sự cố gốc đã được xử lý; job có tính idempotent; business key và
`spaceSlug/spaceId` chưa đổi; job có thể gửi mail, thông báo hoặc
thao tác có tác dụng ngoài. Cần lưu lịch sử và có phê duyệt vận hành
với các job không thể khử trùng một cách chắc chắn.

Payload sai schema tại biên worker (ID, kiểu dữ liệu hoặc phong bì
outbox) ném `UnrecoverableError`: BullMQ đưa job vào failed **ngay
lần đầu**, không tốn retry vì dữ liệu JSON không thể tự lành. Listener
`failed` ghi một event metadata cho trường hợp này, ngay cả khi
`attempts` lớn hơn 1. Lỗi hạ tầng/network dùng `Error` bình thường,
giữ backoff và chỉ ghi terminal stream khi hết `attempts`.

Khi Redis không nhận `XADD`, processor log cảnh báo nhưng BullMQ
vẫn tự giữ trạng thái failed và retry theo chính sách hàng đợi với
lỗi có thể phục hồi (không retry `UnrecoverableError`).
Stream có giới hạn bộ nhớ nên để giám sát dài hạn phải xuất sang
hệ thống log/metrics riêng. Tách Redis cache LRU khỏi queue/session
không được đổi chính sách `noeviction` của Redis BullMQ.
