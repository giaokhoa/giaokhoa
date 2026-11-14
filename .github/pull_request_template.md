## Liên kết issue

## Tóm tắt thay đổi

## Việc con

- [ ] <việc con 1>
- [ ] <việc con 2>

## Bản đồ thay đổi theo phạm vi

| File / module | Thay đổi | Lý do |
| ------------- | -------- | ----- |
|               |          |       |

## Đối chiếu tiêu chí nghiệm thu của issue

- [ ] <tiêu chí 1 của issue> — Đáp ứng: <cách đáp ứng>. Bằng chứng: <bằng chứng>.

## Cổng trước khi code: Ponytail và tài liệu chính thức

- [ ] Agent thực hiện đã đọc `.agents/skills/ponytail/SKILL.md` và áp dụng mức **full** trước khi sửa code (nếu PR chỉ sửa tài liệu, ghi rõ không phát sinh code).
- [ ] Đã đọc AGENTS/README, code/test và docs/ADR liên quan; đối chiếu pattern repo và docs chính thức đúng phiên bản của thư viện/framework bị tác động.
- Tài liệu/pattern đã kiểm tra và cách áp dụng: `<đường dẫn/nguồn, phiên bản, hành vi liên quan; ngoại lệ hoặc phần chưa xác minh>`
- [ ] Reviewer độc lập tự áp dụng Ponytail **full** và xác minh bằng chứng bám docs/pattern trước khi kết luận.

## Kiểm chứng đã chạy

Ghi từng lệnh, kết quả thực tế và trạng thái CI của head hiện tại; nêu rõ phần chưa chạy và nguyên nhân.

## Bàn giao Agent review

- Head SHA đã push: `<SHA>`
- Đầu mối tích hợp/branch owner và reviewer được giao: `<vai trò>`
- Phạm vi cần tập trung, rủi ro và giới hạn kiểm chứng: `<nội dung>`
- Trạng thái: chờ người điều phối giao Agent review độc lập; không tự khởi chạy reviewer.
- Sau mỗi lần push bổ sung, Agent triển khai trả lời finding trên PR và yêu cầu review lại head mới; Agent review đăng kết luận mới (**CHANGES_REQUESTED** / **APPROVED**, kèm SHA và bằng chứng) tại PR, không chỉ ghi trong chat.

## Kỷ luật đã giữ

- [ ] Không viết comment trong code/cấu hình; code (định danh, chuỗi kỹ thuật) bằng tiếng Anh, tài liệu và văn bản PR bằng tiếng Việt.
- [ ] Không còn comment mô tả trong mã nguồn hoặc cấu hình đã sửa; hành vi được thể hiện bằng code và test, không bằng chú thích.
- [ ] Tài liệu còn giữ trong repo (README/AGENTS.md của package liên quan) đã được cập nhật nếu thay đổi này ảnh hưởng tới chúng.
- [ ] Test bám spec và mục Nghiệm thu của issue; không yếu hoá assertion để cho qua.
- [ ] Agent review độc lập đã đăng kết luận **APPROVED** cho head SHA cuối tại PR, và Agent triển khai đã xác nhận xử lý hết finding chặn.
- [ ] `verify`, `verify-stack` và mọi check bắt buộc đã thành công trên head cuối; PR mergeable và không draft.
- [ ] Chỉ merge khi đạt đồng thuận và được giao quyền merge.

## Ngoài phạm vi / việc chưa làm

## Hậu merge

- [ ] Xác minh PR đã merge và issue được đóng.
- [ ] Kiểm kê cả file bị Git ignore; sao lưu/đối chiếu `.env` và dữ liệu local có giá trị trước khi dọn worktree; xóa branch local sau khi kiểm chứng squash merge.
- [ ] Xóa remote branch nếu GitHub chưa tự xóa; xác nhận `git worktree list` và `git branch -vv`.
- [ ] Ghi comment lên PR về kết quả cleanup hoặc lý do phải giữ lại.
