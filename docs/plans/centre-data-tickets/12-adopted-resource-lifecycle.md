# Issue #18 — Quản lý bản riêng và phiên bản tài nguyên đã dùng

[Mở issue #18](https://github.com/giaokhoa/giaokhoa/issues/18).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Sử dụng nguồn chung cần được tách khỏi sửa nguồn: người dùng phải tạo được bản riêng, nhận thông báo phiên bản mới và giữ quyền dùng/lịch sử sau khi nguồn bị rút.

## Mục tiêu

Giáo viên tạo bản riêng của câu/đề để sửa, xem nguồn/phiên bản đã dùng, nhận thông báo thay đổi/rút và chủ động chọn thay thế; nội dung đã giao và kết quả không đổi.

## Phạm vi

### Làm

- Hoàn thiện tạo bản riêng của câu/đề, giữ nguồn và quyền biên tập tại trung tâm.
- Thông báo phiên bản mới/rút cho trung tâm đã tiếp nhận câu, đề, học liệu và chương trình.
- Kiểm quyền tiếp nhận mới so với quyền dùng phiên bản đã tiếp nhận, giữ phiên bản bất biến và lịch sử/snapshot.

### Không làm

- Không đồng bộ sống hoặc cưỡng bức sửa/xoá nội dung đã giao.
- Không bổ sung chính sách giấy phép/thu phí mới.

## Chi tiết việc cần làm

Giáo viên tạo bản riêng của câu/đề để sửa, xem nguồn/phiên bản đã dùng, nhận thông báo thay đổi/rút và chủ động chọn thay thế; nội dung đã giao và kết quả không đổi.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Hoàn thiện tạo bản riêng và truy vết nguồn cho câu/đề.
- [ ] Hoàn thiện danh sách phiên bản đang dùng, sự kiện/thông báo mới/rút và nhận phiên bản mới chủ động.
- [ ] Khoá các ca hai trung tâm, rút nguồn, API trực tiếp và snapshot/lịch sử không đổi.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Dùng nguyên trạng là tham chiếu phiên bản cố định; muốn sửa thì tạo bản riêng, không sửa nguồn chung.
- Nguồn rút ngừng khám phá/tiếp nhận mới và cảnh báo; trung tâm đã tiếp nhận tiếp tục dùng phiên bản đã ghim, bản riêng, snapshot và lịch sử.
- Trung tâm chưa tiếp nhận không được vượt trạng thái rút bằng cách đoán id hoặc gọi API trực tiếp.
- Phiên bản nguồn được tham chiếu phải còn nguyên; xoá trung tâm gửi không làm mất các bản công bố/bản dùng độc lập.

## Nghiệm thu

- [ ] Tạo và sửa bản riêng ở A không đổi nguồn chung, tài nguyên B hoặc nội dung/đáp án của đợt giao đã sẵn sàng.
- [ ] Bản riêng có thông tin nguồn/phiên bản và quyền biên tập tại A, không cấp thêm quyền biên tập ngân hàng chung.
- [ ] Nguồn mới tạo thông báo, trung tâm chủ động chọn cho lần dùng tiếp theo; đợt giao/lượt làm/điểm cũ không đổi.
- [ ] Rút câu/đề/học liệu/chương trình làm mất khả năng khám phá/tiếp nhận mới và cảnh báo đúng các trung tâm đã sử dụng.
- [ ] A đã tiếp nhận trước khi rút vẫn dùng lại phiên bản đã ghim cùng bản riêng/snapshot/lịch sử; B chưa tiếp nhận bị từ chối khi gọi API trực tiếp với id nguồn rút.
- [ ] Rút hoặc xoá nội dung riêng ở trung tâm gửi không xoá phiên bản chung đã tham chiếu hay lịch sử trung tâm khác.
- [ ] Hợp đồng và giao diện phân biệt rõ tham chiếu, tạo bản riêng, phiên bản mới và nguồn bị rút.

Truy vết với đặc tả cha: AC14, AC15, AC16. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #15 — Giao đề chung cho học sinh từng trung tâm: Cần đề/câu chung đã có tham chiếu và đợt giao để kiểm fork, lịch sử và nguồn bị rút.
- #16 — Dùng học liệu chung trong khoá học trung tâm: Cần học liệu công bố và dấu vết sử dụng trong khoá để hoàn thiện thông báo/rút nguồn cho loại này.
- #17 — Cài chương trình chung theo phiên bản: Cần gói chương trình có dấu vết phiên bản cục bộ để kiểm cập nhật chủ động và cảnh báo toàn bộ ngân hàng.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
