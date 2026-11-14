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

## Kiểm chứng đã chạy

Ghi từng lệnh, kết quả thực tế và trạng thái CI của head hiện tại; nêu rõ phần chưa chạy và nguyên nhân.

## Bàn giao Agent review

- Head SHA đã push: `<SHA>`
- Phạm vi cần tập trung, rủi ro và giới hạn kiểm chứng: `<nội dung>`
- Trạng thái: chờ Agent review độc lập đăng comment trực tiếp trên PR.
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
- [ ] Dọn worktree sạch; xóa branch local sau khi kiểm chứng squash merge không còn dữ liệu cần giữ.
- [ ] Xóa remote branch nếu GitHub chưa tự xóa; xác nhận `git worktree list` và `git branch -vv`.
- [ ] Ghi comment lên PR về kết quả cleanup hoặc lý do phải giữ lại.
