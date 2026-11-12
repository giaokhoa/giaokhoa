# Issue #12 — Bảo đảm vòng đời dữ liệu trung tâm độc lập

[Mở issue #12](https://github.com/giaokhoa/giaokhoa/issues/12).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Một dump database chưa chứng minh đủ khả năng khôi phục nội dung cùng file. Trung tâm cần xuất, sao lưu, khôi phục và xoá mà không ảnh hưởng miền khác.

## Mục tiêu

Người vận hành xuất/backup một trung tâm, phục hồi đầy đủ dữ liệu và file trong môi trường cô lập, rồi xoá trung tâm đúng phạm vi mà B/khu công cộng/ngân hàng vẫn hoạt động.

## Phạm vi

### Làm

- Mở rộng pipeline fleet và CLI hiện có với manifest database/file, toàn vẹn, mã hoá hiện có và tập dữ liệu nhất quán.
- Khôi phục tài khoản, dữ liệu học tập, lịch sử chấm và file đã có trong kho; hỗ trợ dữ liệu snapshot được thêm bởi các ticket tài nguyên sau.
- Hoàn thiện trạng thái, thu hồi quyền và xử lý job/cleanup khi xoá một trung tâm.

### Không làm

- Không cam kết RPO/RTO hay lưu trữ snapshot theo một lịch chưa được lựa chọn.
- Không di trú dữ liệu cũ hoặc dừng toàn hệ thống để xuất/khôi phục một trung tâm.

## Chi tiết việc cần làm

Người vận hành xuất/backup một trung tâm, phục hồi đầy đủ dữ liệu và file trong môi trường cô lập, rồi xoá trung tâm đúng phạm vi mà B/khu công cộng/ngân hàng vẫn hoạt động.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Hoàn thiện export/backup và manifest/toàn vẹn cho database cùng file.
- [ ] Kiểm phục hồi trong môi trường cô lập và nối đầy đủ trạng thái/quyền/CLI.
- [ ] Hoàn thiện xoá miền sở hữu và kiểm các job còn chờ/retry sau thu hồi.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Database, quan hệ/tài khoản cần khôi phục, bản chụp thi và file do hệ thống quản lý là cùng một đơn vị sở hữu.
- Backup phải xác định tập dữ liệu/file nhất quán và kiểm toàn vẹn, không mặc định dump DB đơn lẻ là đủ.
- Restore không tự liên kết tài khoản sang trung tâm khác.
- Xoá trung tâm không xoá bản công bố hoặc nội dung thuộc ngân hàng/trung tâm khác; các luồng tài nguyên mới được kiểm tích hợp lại ở #20.

## Nghiệm thu

- [ ] Xuất/backup A có manifest và toàn vẹn, đủ dữ liệu/quan hệ cần thiết cùng file; không chứa dữ liệu riêng của B/công cộng.
- [ ] Phục hồi A trong môi trường cô lập cho phép đăng nhập, xem nội dung, bài làm, điểm/lịch sử và tải đúng file của các luồng đã sẵn sàng.
- [ ] File hoặc manifest thiếu/hỏng bị phát hiện; không báo restore thành công giả hoặc nối dữ liệu sang kho khác.
- [ ] Xuất/backup/restore A không thay đổi database, quyền hoặc file B/công cộng.
- [ ] Xoá A thu hồi truy cập và chỉ xoá tài nguyên A được quản lý; B/công cộng và bản ngân hàng độc lập không bị mất nội dung.
- [ ] Job của A sau khi bị thu hồi không ghi sang B/kho khác; CLI và kiểm thử fleet được dùng thay vì tạo API vận hành chỉ để test.
- [ ] Định dạng backup chứa đầy đủ dữ liệu của kho, không phụ thuộc danh sách bảng legacy cố định khiến snapshot/quan hệ mới bị bỏ sót.

Truy vết với đặc tả cha: AC19, AC20, AC21. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #10 — Cách ly vòng đời file theo miền sở hữu: Backup/restore và xoá cần tập file có miền sở hữu cùng cleanup độc lập.
- #11 — Cách ly tác vụ nền và dữ liệu trả về theo trung tâm: Đình chỉ/xoá hoặc khôi phục trung tâm phải kiểm soát cả job đang chờ/retry, không để tác vụ ghi sang kho khác.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
