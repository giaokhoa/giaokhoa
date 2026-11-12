# Các issue con của đặc tả #6

Bản chia 14 ticket đã được xác nhận và xuất bản thành sub-issue native của [issue #6](https://github.com/giaokhoa/giaokhoa/issues/6). Có 19 quan hệ blocker native. Mã T01–T14 chỉ còn là mã thứ tự của bản chia việc; số issue thật được ghi trong các liên kết dưới đây. Mỗi ticket giao trọn một hành vi cùng schema, hợp đồng, API/CLI, giao diện cần thiết và kiểm chứng của nó.

## Các issue và blocker

1. **[#7 — Cấp trung tâm với kho và tài khoản riêng](https://github.com/giaokhoa/giaokhoa/issues/7)**

   **Bị chặn bởi:** không có; có thể bắt đầu ngay.

   **Bàn giao:** Người vận hành tạo trung tâm A/B; quản trị trung tâm tạo tài khoản, đăng nhập và quản lý hồ sơ chỉ trong kho của mình. Cùng email ở hai nơi là hai tài khoản độc lập và phiên A không dùng được ở B.

   [Nội dung tự chứa](centre-data-tickets/01-dedicated-centre.md).

2. **[#8 — Tách dữ liệu khu học tập công cộng](https://github.com/giaokhoa/giaokhoa/issues/8)**

   **Bị chặn bởi:** [#7](https://github.com/giaokhoa/giaokhoa/issues/7).

   **Bàn giao:** Giáo viên và học viên tự do tiếp tục đăng ký, đăng nhập, tạo lớp/khoá và học trên khu công cộng; dữ liệu nằm trong một kho riêng như một trung tâm.

   [Nội dung tự chứa](centre-data-tickets/02-public-learning-space.md).

3. **[#9 — Giới hạn control plane ở dữ liệu vận hành](https://github.com/giaokhoa/giaokhoa/issues/9)**

   **Bị chặn bởi:** [#8](https://github.com/giaokhoa/giaokhoa/issues/8).

   **Bàn giao:** Người vận hành quản lý registry, trạng thái, gói dịch vụ và phiên bản schema; không có danh bạ học viên xuyên trung tâm và không được tự xem hồ sơ/bài làm/điểm của trung tâm.

   [Nội dung tự chứa](centre-data-tickets/03-operational-control-plane.md).

4. **[#10 — Cách ly vòng đời file theo miền sở hữu](https://github.com/giaokhoa/giaokhoa/issues/10)**

   **Bị chặn bởi:** [#8](https://github.com/giaokhoa/giaokhoa/issues/8).

   **Bàn giao:** A, B, khu công cộng và ngân hàng lưu file trong miền riêng; người dùng tải được file có quyền và xoá ở A không làm hỏng file cùng nội dung tại B.

   [Nội dung tự chứa](centre-data-tickets/04-owned-file-lifecycle.md).

5. **[#11 — Cách ly tác vụ nền và dữ liệu trả về theo trung tâm](https://github.com/giaokhoa/giaokhoa/issues/11)**

   **Bị chặn bởi:** [#9](https://github.com/giaokhoa/giaokhoa/issues/9).

   **Bàn giao:** Một hành động tại A đi qua queue, cập nhật kết quả và phản hồi tìm kiếm/realtime của A; B và khu công cộng không nhận dữ liệu hoặc tác động của A.

   [Nội dung tự chứa](centre-data-tickets/05-scoped-background-and-reads.md).

6. **[#12 — Bảo đảm vòng đời dữ liệu trung tâm độc lập](https://github.com/giaokhoa/giaokhoa/issues/12)**

   **Bị chặn bởi:** [#10](https://github.com/giaokhoa/giaokhoa/issues/10), [#11](https://github.com/giaokhoa/giaokhoa/issues/11).

   **Bàn giao:** Người vận hành xuất/backup một trung tâm, phục hồi đầy đủ dữ liệu và file trong môi trường cô lập, rồi xoá trung tâm đúng phạm vi mà B/khu công cộng/ngân hàng vẫn hoạt động.

   [Nội dung tự chứa](centre-data-tickets/06-independent-data-lifecycle.md).

7. **[#13 — Công bố câu hỏi chung qua luồng gửi và duyệt](https://github.com/giaokhoa/giaokhoa/issues/13)**

   **Bị chặn bởi:** [#9](https://github.com/giaokhoa/giaokhoa/issues/9), [#10](https://github.com/giaokhoa/giaokhoa/issues/10).

   **Bàn giao:** Giáo viên soạn câu riêng, quản trị trung tâm gửi, biên tập viên duyệt và giáo viên trung tâm khác khám phá câu đã công bố; nội dung cùng file nguồn được giữ độc lập trong ngân hàng.

   [Nội dung tự chứa](centre-data-tickets/07-publish-shared-questions.md).

8. **[#14 — Tạo và giao đề riêng từ câu hỏi chung](https://github.com/giaokhoa/giaokhoa/issues/14)**

   **Bị chặn bởi:** [#13](https://github.com/giaokhoa/giaokhoa/issues/13).

   **Bàn giao:** Giáo viên A ghép câu chung với câu riêng thành đề riêng, giao cho lớp, học sinh làm và được chấm tự động/chấm tay; không có bước Copy bắt buộc hoặc câu có thể biên tập được nhân bản ngầm vào bank A.

   [Nội dung tự chứa](centre-data-tickets/08-private-exams-from-shared-questions.md).

9. **[#15 — Giao đề chung cho học sinh từng trung tâm](https://github.com/giaokhoa/giaokhoa/issues/15)**

   **Bị chặn bởi:** [#14](https://github.com/giaokhoa/giaokhoa/issues/14).

   **Bàn giao:** Quản trị gửi đề, hệ thống duyệt thành đề chung; A và B chọn cùng phiên bản đề để giao cho lớp với lịch/cấu hình riêng và nhận kết quả riêng.

   [Nội dung tự chứa](centre-data-tickets/09-shared-exam-assignments.md).

10. **[#16 — Dùng học liệu chung trong khoá học trung tâm](https://github.com/giaokhoa/giaokhoa/issues/16)**

**Bị chặn bởi:** [#13](https://github.com/giaokhoa/giaokhoa/issues/13).

**Bàn giao:** Trung tâm soạn học liệu riêng, quản trị gửi và hệ thống duyệt; giáo viên trung tâm khác chọn phiên bản học liệu để sử dụng trong khoá của mình với quyền học viên của khoá.

[Nội dung tự chứa](centre-data-tickets/10-shared-learning-resources.md).

11. **[#17 — Cài chương trình chung theo phiên bản](https://github.com/giaokhoa/giaokhoa/issues/17)**

**Bị chặn bởi:** [#13](https://github.com/giaokhoa/giaokhoa/issues/13).

**Bàn giao:** Quản trị gửi chương trình phù hợp, hệ thống duyệt/phát hành gói; A chủ động chọn và cài một phiên bản để dùng các môn/nội dung/YCCĐ tại kho mình, không đổi chương trình B.

[Nội dung tự chứa](centre-data-tickets/11-shared-curriculum-packages.md).

12. **[#18 — Quản lý bản riêng và phiên bản tài nguyên đã dùng](https://github.com/giaokhoa/giaokhoa/issues/18)**

**Bị chặn bởi:** [#15](https://github.com/giaokhoa/giaokhoa/issues/15), [#16](https://github.com/giaokhoa/giaokhoa/issues/16), [#17](https://github.com/giaokhoa/giaokhoa/issues/17).

**Bàn giao:** Giáo viên tạo bản riêng của câu/đề để sửa, xem nguồn/phiên bản đã dùng, nhận thông báo thay đổi/rút và chủ động chọn thay thế; nội dung đã giao và kết quả không đổi.

[Nội dung tự chứa](centre-data-tickets/12-adopted-resource-lifecycle.md).

13. **[#19 — Cấp quyền hỗ trợ có thời hạn cho trung tâm](https://github.com/giaokhoa/giaokhoa/issues/19)**

**Bị chặn bởi:** [#9](https://github.com/giaokhoa/giaokhoa/issues/9).

**Bàn giao:** Quản trị A cấp quyền hỗ trợ hữu hạn; người hỗ trợ chỉ thực hiện được thao tác được cấp tại A, bị chặn ở B hoặc khi hết hạn/thu hồi; A xem được audit.

[Nội dung tự chứa](centre-data-tickets/13-time-limited-support-grants.md).

14. **[#20 — Hoàn tất cài mới và nghiệm thu mô hình trung tâm riêng](https://github.com/giaokhoa/giaokhoa/issues/20)**

**Bị chặn bởi:** [#12](https://github.com/giaokhoa/giaokhoa/issues/12), [#18](https://github.com/giaokhoa/giaokhoa/issues/18), [#19](https://github.com/giaokhoa/giaokhoa/issues/19).

**Bàn giao:** Cài mới, seed và vận hành thử A/B/khu công cộng theo đúng mô hình đích; chứng minh toàn bộ nghiệm thu #6, dọn đường legacy còn lại và có số liệu tài nguyên thực tế.

[Nội dung tự chứa](centre-data-tickets/14-clean-install-and-final-verification.md).

## Lý do blocker

### #8

- #7: Cần cơ chế cấp kho, tài khoản và định tuyến trung tâm riêng trước khi áp dụng cùng hợp đồng cho khu công cộng.

### #9

- #8: Cần trung tâm và khu công cộng đều có tài khoản/kho riêng để bỏ liên kết định danh toàn cục mà không làm mất luồng đăng nhập học tập.

### #10

- #8: Cần định danh kho và ngữ cảnh ổn định cho cả trung tâm lẫn khu công cộng để mọi file đều có miền sở hữu rõ ràng.

### #11

- #9: Cần tài khoản/ngữ cảnh không còn phụ thuộc directory toàn cục và quyền vận hành đã tách khỏi dữ liệu nghiệp vụ.

### #12

- #10: Backup/restore và xoá cần tập file có miền sở hữu cùng cleanup độc lập.
- #11: Đình chỉ/xoá hoặc khôi phục trung tâm phải kiểm soát cả job đang chờ/retry, không để tác vụ ghi sang kho khác.

### #13

- #9: Cần phân biệt quyền vận hành, quyền trung tâm và quyền biên tập ngân hàng.
- #10: Câu công bố cùng media phải có file thuộc ngân hàng, độc lập với file riêng của trung tâm gửi.

### #14

- #13: Cần câu chung đã duyệt với phiên bản, quyền sử dụng và phụ thuộc/media bất biến để ghim vào đề riêng.

### #15

- #14: Cần cơ chế tham chiếu câu, snapshot và làm/chấm cục bộ đã hoạt động để giao nguyên đề chung mà không nhân bản một đề có thể biên tập.

### #16

- #13: Cần luồng gửi/duyệt, phiên bản công bố và quyền sở hữu media của ngân hàng; học liệu bổ sung một loại tài nguyên trên nền đó.

### #17

- #13: Cần quyền gửi/duyệt, phiên bản công bố và truy vết ngân hàng đã thống nhất trước khi hoàn thiện gói chương trình.

### #18

- #15: Cần đề/câu chung đã có tham chiếu và đợt giao để kiểm fork, lịch sử và nguồn bị rút.
- #16: Cần học liệu công bố và dấu vết sử dụng trong khoá để hoàn thiện thông báo/rút nguồn cho loại này.
- #17: Cần gói chương trình có dấu vết phiên bản cục bộ để kiểm cập nhật chủ động và cảnh báo toàn bộ ngân hàng.

### #19

- #9: Cần đóng quyền truy cập nghiệp vụ ngầm của nền tảng và có định danh vận hành/tài khoản trung tâm tách biệt trước khi cấp quyền hỗ trợ tường minh.

### #20

- #12: Cần xuất/backup/restore/xoá độc lập đã hoạt động để nghiệm thu vòng đời trên dữ liệu của các luồng mới.
- #18: Cần toàn bộ loại tài nguyên và vòng đời phiên bản/giao bài đã hoàn thiện trước khi bỏ các đường ngân hàng cũ và kiểm cài mới.
- #19: Cần quyền hỗ trợ tường minh hoạt động trước khi kết luận mô hình quyền không còn đường truy cập legacy.

## Truy vết nghiệm thu cha

| Tiêu chí | Issue giao phần triển khai chính |
| -------- | -------------------------------- |
| AC01     | #7                               |
| AC02     | #7, #8                           |
| AC03     | #7, #8, #11                      |
| AC04     | #9                               |
| AC05     | #8                               |
| AC06     | #10                              |
| AC07     | #10, #11                         |
| AC08     | #13                              |
| AC09     | #13, #15, #16, #17               |
| AC10     | #13, #16, #17                    |
| AC11     | #14                              |
| AC12     | #15                              |
| AC13     | #14, #15                         |
| AC14     | #18                              |
| AC15     | #18                              |
| AC16     | #18                              |
| AC17     | #14, #15                         |
| AC18     | #14, #15                         |
| AC19     | #12                              |
| AC20     | #12                              |
| AC21     | #12                              |
| AC22     | #9, #19                          |
| AC23     | #19                              |
| AC24     | #14, #15                         |
| AC25     | #20                              |
| AC26     | #20                              |
| AC27     | #20                              |

Issue #20 đối chiếu toàn bộ AC01–AC27 trên mô hình tích hợp, đặc biệt vòng đời backup/restore với snapshot từ nguồn chung. Đây là kiểm chứng liên miền sau các hành vi đã được giao, không phải nơi gom API/giao diện/test còn thiếu của các issue khác.

## Quy tắc thực hiện

- Tất cả child issue có nhãn enhancement và ready-for-agent; bắt đầu ở frontier có toàn bộ blocker đã đóng.
- Mỗi child issue có worktree/branch và đúng một PR; không tách schema/API/test của cùng hành vi thành nhiều PR.
- Giữ nguyên thân, nhãn và trạng thái issue cha #6; quan hệ sub-issue không thay cho blocker và #6 không là blocker của child.
- Chỉ đóng issue cha qua PR cuối khi mọi child issue hoàn tất; không đóng tay trước merge.
