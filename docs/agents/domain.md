# Tài liệu miền nghiệp vụ

Repo dùng một ngữ cảnh chung (single-context): `CONTEXT.md` và `docs/adr/`
ở gốc repo.

Các skill Matt Pocock được ghim ở `v1.2.3` để khớp bộ skill đã dùng
khi thiết lập quy ước `CONTEXT.md` này.

## Trước khi khảo sát mã nguồn

Đọc `README.md` và `AGENTS.md` của repo cùng các package liên quan.
Đọc thêm các tài liệu sau nếu đã tồn tại:

- `CONTEXT.md`: thuật ngữ nghiệp vụ chung.
- Các ADR trong `docs/adr/` có liên quan tới phạm vi đang xử lý.

Nếu tài liệu chưa tồn tại, tiếp tục công việc mà không báo thiếu hay tạo
file rỗng. Skill `domain-modeling` tạo `CONTEXT.md` khi thuật ngữ đầu tiên
được xác định và tạo ADR khi có quyết định kiến trúc cần lưu.

## Sử dụng thuật ngữ và quyết định

Dùng thuật ngữ trong `CONTEXT.md` khi viết issue, giả thuyết, tên test
và đề xuất thay đổi. `CONTEXT.md` chỉ chứa bảng thuật ngữ nghiệp vụ;
đặc tả triển khai nằm trong issue hoặc tài liệu phù hợp.

Nếu thiếu thuật ngữ cần thiết, kiểm tra cách gọi trong mã nguồn và ghi
nhận để xử lý bằng `domain-modeling`. Nếu đề xuất mâu thuẫn với ADR,
nêu rõ ADR và lý do cần xem xét lại trước khi thay đổi quyết định đó.
