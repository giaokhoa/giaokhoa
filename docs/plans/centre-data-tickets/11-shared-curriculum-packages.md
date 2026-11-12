# Issue #17 — Cài chương trình chung theo phiên bản

[Mở issue #17](https://github.com/giaokhoa/giaokhoa/issues/17).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Đã có gói chương trình/YCCĐ dùng chung và cài vào kho trung tâm, nhưng cần đồng bộ với mô hình riêng, duyệt công bố và phiên bản đích, bỏ hành vi cài chung giữa nhiều trung tâm cùng DB.

## Mục tiêu

Quản trị gửi chương trình phù hợp, hệ thống duyệt/phát hành gói; A chủ động chọn và cài một phiên bản để dùng các môn/nội dung/YCCĐ tại kho mình, không đổi chương trình B.

## Phạm vi

### Làm

- Hoàn thiện công bố/duyệt/khám phá phiên bản gói chương trình và nội dung/YCCĐ.
- Kiểm toàn vẹn và cài nguyên tử/idempotent trong kho trung tâm; báo xung đột rõ thay vì tự gộp định danh khác nhau.
- Đồng bộ chọn/cài gói, trạng thái phiên bản và quan hệ với câu/đề đang có.

### Không làm

- Không nhập thêm dataset ngoài phạm vi hoặc đổi luật chuẩn GDPT.
- Không đổi FK của dữ liệu chuẩn sang cascade hoặc cập nhật ngầm mọi trung tâm.

## Chi tiết việc cần làm

Quản trị gửi chương trình phù hợp, hệ thống duyệt/phát hành gói; A chủ động chọn và cài một phiên bản để dùng các môn/nội dung/YCCĐ tại kho mình, không đổi chương trình B.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Đồng bộ luồng gửi/duyệt/phát hành gói chương trình.
- [ ] Hoàn thiện chọn/cài/ghi phiên bản cùng validation/xử lý xung đột.
- [ ] Kiểm hai trung tâm chọn phiên bản khác nhau và retry/lỗi không làm hỏng quan hệ.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Chương trình chung có phiên bản; trung tâm chủ động cài, nguồn mới không tự làm thay đổi dữ liệu/đợt giao đang sử dụng.
- Cây chương trình và dấu vết cài thuộc kho trung tâm, không dùng chung giữa các trung tâm qua database nghiệp vụ.
- Giữ id/quan hệ chuẩn hợp lệ và quy tắc restrict; gói hỏng hoặc xung đột định danh bị từ chối trước khi ghi một phần.
- Giữ nguồn/phiên bản và lịch sử sử dụng cần thiết để cập nhật chủ động và xử lý rút nguồn ở #18.

## Nghiệm thu

- [ ] Gói chương trình chưa duyệt không được dùng như gói chung; gói phát hành có phiên bản và toàn vẹn.
- [ ] A cài một phiên bản thành công với cây chương trình/YCCĐ và dấu vết phiên bản ở kho A.
- [ ] B không bị thay đổi khi A cài/cập nhật; hai trung tâm có thể giữ các phiên bản khác nhau.
- [ ] Gói hỏng, quan hệ thiếu hoặc xung đột id bị từ chối mà không để lại chương trình cài dở.
- [ ] Retry cùng phiên bản không tạo trùng cây/quan hệ; quy tắc restrict của dữ liệu chuẩn được giữ.
- [ ] Giao diện chọn/cài và API phản ánh đúng trạng thái phiên bản; câu/đề đã dùng không bị sửa ngược khi nguồn có phiên bản mới.

Truy vết với đặc tả cha: AC09, AC10. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #13 — Công bố câu hỏi chung qua luồng gửi và duyệt: Cần quyền gửi/duyệt, phiên bản công bố và truy vết ngân hàng đã thống nhất trước khi hoàn thiện gói chương trình.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
