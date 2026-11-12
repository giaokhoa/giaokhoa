# Issue #13 — Công bố câu hỏi chung qua luồng gửi và duyệt

[Mở issue #13](https://github.com/giaokhoa/giaokhoa/issues/13).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Ngân hàng hệ thống đã có câu phiên bản nhưng chưa đầy đủ luồng quản trị trung tâm gửi và hệ thống duyệt với tài nguyên mặc định riêng.

## Mục tiêu

Giáo viên soạn câu riêng, quản trị trung tâm gửi, biên tập viên duyệt và giáo viên trung tâm khác khám phá câu đã công bố; nội dung cùng file nguồn được giữ độc lập trong ngân hàng.

## Phạm vi

### Làm

- Hoàn thiện luồng gửi/duyệt/từ chối và công bố câu thuộc các dạng hiện có, với phiên bản bất biến và truy vết nguồn.
- Nối quyền, hợp đồng, giao diện soạn/gửi/duyệt/khám phá hiện có; bảo toàn thông tin nguồn/giấy phép và quyền xem đáp án.
- Đóng gói phụ thuộc/media vào miền ngân hàng và bảo vệ nội dung đã công bố khỏi vòng đời trung tâm nguồn.

### Không làm

- Tạo đề riêng trực tiếp từ câu chung thuộc #14; đề chung/học liệu/chương trình có các ticket riêng.
- Không tạo chính sách thu phí hoặc giấy phép mới.

## Chi tiết việc cần làm

Giáo viên soạn câu riêng, quản trị trung tâm gửi, biên tập viên duyệt và giáo viên trung tâm khác khám phá câu đã công bố; nội dung cùng file nguồn được giữ độc lập trong ngân hàng.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Hoàn thiện trạng thái gửi/duyệt/từ chối và quyền theo actor.
- [ ] Tạo phiên bản công bố tự đủ cùng media/truy vết và cập nhật hợp đồng/giao diện.
- [ ] Kiểm đường riêng/chung, các dạng câu và việc xoá/sửa nội dung gốc sau công bố.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Tài nguyên trung tâm tạo mặc định riêng; chỉ quản trị trung tâm được gửi, hệ thống duyệt trước khi công bố.
- Ngân hàng không chứa học sinh, bài làm, điểm hoặc danh bạ tài khoản xuyên trung tâm.
- Phiên bản công bố và checksum bất biến; cập nhật tạo phiên bản mới, giữ nguồn/tác giả phù hợp.
- Nội dung công bố và media thuộc ngân hàng, không trỏ tới file riêng có thể bị trung tâm nguồn xoá.

## Nghiệm thu

- [ ] Câu A mới soạn không xuất hiện ở B/ngân hàng chung.
- [ ] Giáo viên không gửi hoặc duyệt thay quản trị; quản trị gửi được, hệ thống duyệt hoặc từ chối kèm lý do.
- [ ] Câu chưa duyệt/bị từ chối không được khám phá hoặc lấy qua API trực tiếp như câu đã công bố.
- [ ] Câu đã duyệt có phiên bản, checksum, nguồn và đủ nội dung/đáp án/media cho các dạng hiện có.
- [ ] Sửa hoặc xoá câu/file riêng ở nơi gửi không làm đổi/hỏng phiên bản công bố.
- [ ] Học sinh không lấy được gói đáp án hoặc thông tin nguồn sách vượt quyền qua route ngân hàng.
- [ ] Luồng soạn/gửi/duyệt/khám phá hoạt động qua API/giao diện; retry không công bố trùng phiên bản.

Truy vết với đặc tả cha: AC08, AC09, AC10. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #9 — Giới hạn control plane ở dữ liệu vận hành: Cần phân biệt quyền vận hành, quyền trung tâm và quyền biên tập ngân hàng.
- #10 — Cách ly vòng đời file theo miền sở hữu: Câu công bố cùng media phải có file thuộc ngân hàng, độc lập với file riêng của trung tâm gửi.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
