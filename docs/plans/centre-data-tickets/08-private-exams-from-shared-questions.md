# Issue #14 — Tạo và giao đề riêng từ câu hỏi chung

[Mở issue #14](https://github.com/giaokhoa/giaokhoa/issues/14).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Đề hiện chỉ nhận câu trong database trung tâm và câu chung phải nhập thành câu cục bộ trước. Cần chọn câu chung trực tiếp nhưng giữ dữ liệu thi/chấm tại trung tâm.

## Mục tiêu

Giáo viên A ghép câu chung với câu riêng thành đề riêng, giao cho lớp, học sinh làm và được chấm tự động/chấm tay; không có bước Copy bắt buộc hoặc câu có thể biên tập được nhân bản ngầm vào bank A.

## Phạm vi

### Làm

- Hỗ trợ tham chiếu nguồn/phiên bản trong đề riêng, kiểm quyền nguồn và quyền tạo/giao ở đích.
- Tự tạo bản chụp nội dung/đáp án/quy tắc chấm cùng phụ thuộc trước khi đợt giao sẵn sàng.
- Nối toàn bộ làm bài, chấm, nhận xét, xem lại và công bố điểm với snapshot của trung tâm; cập nhật picker/giao diện tương ứng.

### Không làm

- Giao nguyên đề chung thuộc #15; tạo bản riêng để sửa nguồn và quản lý thay đổi/rút nguồn thuộc #18.
- Không thay luật chấm/công bố điểm ngoài điều cần để dùng nguồn chung.

## Chi tiết việc cần làm

Giáo viên A ghép câu chung với câu riêng thành đề riêng, giao cho lớp, học sinh làm và được chấm tự động/chấm tay; không có bước Copy bắt buộc hoặc câu có thể biên tập được nhân bản ngầm vào bank A.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Mở rộng tham chiếu đề/câu và luồng chọn câu chung kết hợp câu riêng.
- [ ] Hoàn thiện snapshot và luồng giao/làm/chấm cho các dạng câu hiện có.
- [ ] Khoá quyền, công bố điểm, bank-off, lỗi chuẩn bị và retry bằng test đầu-cuối.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Tham chiếu gồm miền nguồn, loại, tài nguyên và phiên bản bất biến; không có FK/SQL join xuyên database.
- Bản chụp thi khác tài nguyên riêng có thể biên tập và không yêu cầu một bản đề có thể biên tập cho mỗi học sinh.
- Lượt làm, câu trả lời, chấm, nhận xét và điểm thuộc trung tâm; đáp án chưa được phép xem phải bị che.
- Đợt giao đã sẵn sàng vận hành bằng snapshot khi ngân hàng không truy cập được; lỗi chuẩn bị không để lại đợt giao sẵn sàng thiếu nội dung.

## Nghiệm thu

- [ ] A tạo đề trộn câu chung và riêng mà không gọi bước Copy/Import thủ công hoặc bắt tạo câu chung có thể biên tập trong ngân hàng A.
- [ ] Học sinh đúng lớp/nhóm làm được; người ở B hoặc ngoài nhóm không truy cập được bài làm.
- [ ] Chấm tự động và chấm tay cho các dạng câu hiện có dùng đúng nội dung/đáp án/quy tắc đã chụp.
- [ ] Bài làm, điểm, nhận xét và lịch sử chỉ lưu trong kho A; ngân hàng và B không nhận bản dữ liệu học sinh.
- [ ] Ngân hàng ngừng truy cập sau khi đợt giao sẵn sàng không làm hỏng việc làm/chấm/xem lịch sử.
- [ ] Thiếu quyền, phiên bản/media không hợp lệ hoặc ghi snapshot lỗi không tạo đợt giao sẵn sàng thiếu dữ liệu; retry không nhân bản đợt giao.
- [ ] Học sinh/phụ huynh chỉ thấy điểm đã công bố và phản hồi theo quyền xem lại; giao diện hoàn thành luồng chọn câu chung/giao bài trực tiếp.

Truy vết với đặc tả cha: AC11, AC13, AC17, AC18, AC24. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #13 — Công bố câu hỏi chung qua luồng gửi và duyệt: Cần câu chung đã duyệt với phiên bản, quyền sử dụng và phụ thuộc/media bất biến để ghim vào đề riêng.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
