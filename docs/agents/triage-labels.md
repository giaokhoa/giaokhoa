# Nhãn triage

Dùng nguyên tên nhãn mặc định của skill `triage`. Tên nhãn là định danh kỹ thuật tiếng Anh; mô tả và trao đổi dùng tiếng Việt.

## Nhãn loại

| Vai trò       | Nhãn trên GitHub | Ý nghĩa                          |
| ------------- | ---------------- | -------------------------------- |
| `bug`         | `bug`            | Có hành vi không hoạt động đúng. |
| `enhancement` | `enhancement`    | Tính năng mới hoặc cải tiến.     |

## Nhãn trạng thái

| Vai trò           | Nhãn trên GitHub  | Ý nghĩa                               |
| ----------------- | ----------------- | ------------------------------------- |
| `needs-triage`    | `needs-triage`    | Cần người duy trì đánh giá.           |
| `needs-info`      | `needs-info`      | Đang chờ người báo bổ sung thông tin. |
| `ready-for-agent` | `ready-for-agent` | Đặc tả đủ rõ để giao agent thực hiện. |
| `ready-for-human` | `ready-for-human` | Cần người trực tiếp thực hiện.        |
| `wontfix`         | `wontfix`         | Không triển khai yêu cầu này.         |

## Cách áp dụng

- Issue mới nhận một nhãn loại và trạng thái `needs-triage`.
- Mỗi issue đã phân loại có đúng một nhãn loại và một nhãn trạng thái trong các bảng trên. Khi đổi trạng thái, gỡ nhãn trạng thái cũ.
- Từ `needs-triage`, chuyển sang `needs-info`, `ready-for-agent`, `ready-for-human` hoặc `wontfix` sau khi người duy trì xác nhận. Khi người báo trả lời, đưa `needs-info` về `needs-triage` để đánh giá lại.
- `wontfix` phải kèm lý do và được đóng theo mục “Đóng issue” trong `AGENTS.md`.
- Nhãn triage biểu thị kết quả phân loại và khả năng giao việc. Theo dõi tiến độ thi công, review và merge trong issue hoặc PR.
