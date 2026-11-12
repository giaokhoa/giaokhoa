# Issue #15 — Giao đề chung cho học sinh từng trung tâm

[Mở issue #15](https://github.com/giaokhoa/giaokhoa/issues/15).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Ngân hàng hệ thống mới chưa có đề chung đầy đủ giữa các database riêng, dù luồng ghim đề/làm/chấm trong trung tâm đã có.

## Mục tiêu

Quản trị gửi đề, hệ thống duyệt thành đề chung; A và B chọn cùng phiên bản đề để giao cho lớp với lịch/cấu hình riêng và nhận kết quả riêng.

## Phạm vi

### Làm

- Công bố/duyệt phiên bản đề chung cùng danh sách câu, thứ tự, cấu hình và các phụ thuộc tự đủ.
- Tạo đợt giao riêng tham chiếu đề chung, lớp/nhóm, lịch và cấu hình làm bài/chấm của trung tâm.
- Nối chọn đề/giao bài, snapshot, lượt làm và báo cáo điểm tại trung tâm cho toàn bộ dạng câu đã hỗ trợ.

### Không làm

- Sửa nội dung đề nguồn bằng bản riêng và quản lý vòng đời nguồn thuộc #18.
- Không lưu lớp, học sinh, bài làm hoặc điểm trong ngân hàng chung.

## Chi tiết việc cần làm

Quản trị gửi đề, hệ thống duyệt thành đề chung; A và B chọn cùng phiên bản đề để giao cho lớp với lịch/cấu hình riêng và nhận kết quả riêng.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Hoàn thiện xuất bản/duyệt và khám phá đề chung cùng phụ thuộc.
- [ ] Nối chọn đề chung vào giao bài và tạo snapshot/cấu hình cục bộ.
- [ ] Kiểm hai trung tâm giao cùng đề, làm/chấm, bank-off, lỗi và retry.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Phiên bản đề và câu phụ thuộc bất biến; công bố không phụ thuộc file hoặc nội dung riêng có thể bị nơi gửi xoá.
- Giao nguyên trạng không bắt tạo bản đề/câu có thể biên tập trong bank trung tâm.
- Mỗi đợt giao có cấu hình và snapshot thực thi riêng của trung tâm; nguồn không điều khiển trực tiếp kết quả thi.
- Giữ luồng quản trị gửi/hệ thống duyệt và quyền che đáp án/điểm như các tài nguyên đã có.

## Nghiệm thu

- [ ] Quản trị trung tâm gửi và hệ thống duyệt được một đề chung; đề chưa duyệt không được dùng như nguồn công bố.
- [ ] A/B giao cùng phiên bản đề với lớp/lịch/cấu hình riêng mà không phải Copy đề về bank riêng.
- [ ] Học sinh A/B làm và được chấm tự động/chấm tay; bài làm, điểm, nhận xét, lịch sử và công bố điểm chỉ có tại kho tương ứng.
- [ ] Phiên bản nguồn được ghim rõ; đợt giao đã sẵn sàng không đổi khi bản nguồn có phiên bản mới.
- [ ] Ngân hàng không truy cập được sau chuẩn bị không làm hỏng làm/chấm/xem lịch sử của đợt giao.
- [ ] Lỗi quyền/phụ thuộc/snapshot và retry không tạo đợt giao thiếu nội dung, trùng dữ liệu hoặc gắn sang trung tâm khác.
- [ ] Giao diện khám phá/chọn/giao đề chung hoạt động trực tiếp và không lộ đáp án hay thông tin nguồn vượt quyền của học sinh.

Truy vết với đặc tả cha: AC09, AC12, AC13, AC17, AC18, AC24. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #14 — Tạo và giao đề riêng từ câu hỏi chung: Cần cơ chế tham chiếu câu, snapshot và làm/chấm cục bộ đã hoạt động để giao nguyên đề chung mà không nhân bản một đề có thể biên tập.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
