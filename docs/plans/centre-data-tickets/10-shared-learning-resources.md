# Issue #16 — Dùng học liệu chung trong khoá học trung tâm

[Mở issue #16](https://github.com/giaokhoa/giaokhoa/issues/16).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Kho học liệu tổng quát còn ở database trung tâm, chưa là tài nguyên toàn hệ thống có thể dùng theo phiên bản mà không làm lộ hoặc phụ thuộc file riêng của nơi gửi.

## Mục tiêu

Trung tâm soạn học liệu riêng, quản trị gửi và hệ thống duyệt; giáo viên trung tâm khác chọn phiên bản học liệu để sử dụng trong khoá của mình với quyền học viên của khoá.

## Phạm vi

### Làm

- Đưa học liệu vào luồng công bố ngân hàng, giữ tác giả/nguồn/giấy phép và media theo hợp đồng hiện có.
- Nối khám phá, chọn phiên bản và dùng trong khoá, với tham chiếu/ghi nhận tiếp nhận phù hợp.
- Giữ quyền xem, vùng file và vòng đời riêng của nội dung công bố và nội dung học tập ở trung tâm.

### Không làm

- Không thêm loại trình phát, định dạng học liệu hoặc hệ thống bản quyền mới.
- Không đổi nội dung nguồn tại chỗ hoặc công bố nội dung học viên/bài làm.

## Chi tiết việc cần làm

Trung tâm soạn học liệu riêng, quản trị gửi và hệ thống duyệt; giáo viên trung tâm khác chọn phiên bản học liệu để sử dụng trong khoá của mình với quyền học viên của khoá.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Hoàn thiện công bố/duyệt/phiên bản và phụ thuộc học liệu.
- [ ] Nối khám phá và sử dụng phiên bản trong khoá cùng hợp đồng/giao diện.
- [ ] Kiểm quyền riêng/chung, quyền học viên và vòng đời file nguồn.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Học liệu trung tâm tạo mặc định riêng; chỉ quản trị gửi và hệ thống duyệt trước khi dùng chung.
- Nội dung công bố có phiên bản bất biến và phụ thuộc do ngân hàng quản lý, không trỏ vào file riêng có thể bị thu hồi.
- Trung tâm chủ động chọn phiên bản; quyền truy cập khoá học vẫn quyết định học viên nào thấy học liệu.
- Việc cập nhật/rút nguồn đồng bộ hành vi đầy đủ ở #18, dựa trên bản tiếp nhận và truy vết phiên bản của ticket này.

## Nghiệm thu

- [ ] Học liệu riêng A không xuất hiện ở B/ngân hàng trước khi quản trị gửi và hệ thống duyệt.
- [ ] Học liệu được duyệt có nguồn/giấy phép/phiên bản và media hợp lệ; xoá file riêng nơi gửi không làm hỏng bản công bố.
- [ ] Giáo viên B chọn được phiên bản học liệu dùng trong khoá B; không bắt tạo một bản học liệu có thể biên tập để dùng nguyên trạng.
- [ ] Chỉ người có quyền tại khoá/nhóm B được xem nội dung; học sinh A hoặc ngoài audience không truy cập được qua id/URL trực tiếp.
- [ ] Dùng học liệu không ghi hồ sơ người học hoặc dữ liệu khoá vào ngân hàng hệ thống.
- [ ] Luồng soạn/gửi/duyệt/chọn/dùng hoạt động qua API và giao diện hiện có.

Truy vết với đặc tả cha: AC09, AC10. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #13 — Công bố câu hỏi chung qua luồng gửi và duyệt: Cần luồng gửi/duyệt, phiên bản công bố và quyền sở hữu media của ngân hàng; học liệu bổ sung một loại tài nguyên trên nền đó.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
