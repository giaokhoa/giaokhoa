# Issue #20 — Hoàn tất cài mới và nghiệm thu mô hình trung tâm riêng

[Mở issue #20](https://github.com/giaokhoa/giaokhoa/issues/20).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Các phần thi công phải hội tụ thành một mô hình cài mới sạch, không còn đường kho chung hoặc ngân hàng cũ và không chỉ đạt riêng từng test đơn lẻ.

## Mục tiêu

Cài mới, seed và vận hành thử A/B/khu công cộng theo đúng mô hình đích; chứng minh toàn bộ nghiệm thu #6, dọn đường legacy còn lại và có số liệu tài nguyên thực tế.

## Phạm vi

### Làm

- Hoàn tất schema/seed/tài liệu và loại bỏ cấu hình, nhánh hoặc consumer legacy không còn dùng sau các ticket trước.
- Nghiệm thu kết hợp câu/đề chung, snapshot và khôi phục khi nguồn đổi/rút/không truy cập được, cùng cách ly file/quyền.
- Đo pool/kết nối/worker, ghi điều kiện đo và ngân sách toàn cụm; chạy kiểm chứng trên cây tích hợp/head cuối.

### Không làm

- Không mở rộng thành dọn toàn repo hoặc thay framework/hạ tầng.
- Không cam kết thông lượng, số trung tâm hoặc SLA không có căn cứ định lượng.

## Chi tiết việc cần làm

Cài mới, seed và vận hành thử A/B/khu công cộng theo đúng mô hình đích; chứng minh toàn bộ nghiệm thu #6, dọn đường legacy còn lại và có số liệu tài nguyên thực tế.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Hoàn tất dọn legacy và cập nhật cài mới/seed/tài liệu theo mô hình đích.
- [ ] Chạy và đối chiếu toàn bộ AC01–AC27 của issue #6, bao gồm các ca kết hợp nhiều ticket.
- [ ] Đo tài nguyên/ghi cấu hình và tổng hợp bằng chứng kiểm chứng, CI và điều kiện đóng issue cha.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Mô hình đích sạch, không giữ dữ liệu cũ hoặc pipeline di trú/tương thích legacy.
- Mỗi trung tâm/khu công cộng có kho, tài khoản và vùng file riêng; tài nguyên chung dùng phiên bản cố định với snapshot thực thi cục bộ.
- Các ticket trước phải tự giao hành vi hoàn chỉnh; ticket cuối không để dành schema/API/UI/test còn thiếu của một hành vi cho tới đây.
- CI phải success trên đúng head/cây tích hợp; nếu đây là PR cuối của các child issue thì ghi từ khoá đóng cả child này và issue cha #6.

## Nghiệm thu

- [ ] Cài mới và seed tạo đúng kho trung tâm/công cộng/ngân hàng/control plane và cho phép thực hiện các luồng mục tiêu.
- [ ] Không còn consumer cần chế độ shared cho trung tâm, directory user toàn cục hoặc ngân hàng chung cũ để chạy chức năng được giữ.
- [ ] Toàn bộ AC01–AC27 của #6 có bằng chứng; đặc biệt backup/restore dữ liệu thi từ nguồn chung hoạt động khi nguồn đổi/rút hoặc không truy cập được.
- [ ] Có số liệu pool/kết nối/worker, điều kiện đo, số tiến trình và ngân sách toàn cụm, nêu rõ giới hạn của phép đo.
- [ ] Tài liệu API/DB/worker/web và test theo tầng cùng phản ánh mô hình đích; không sửa yếu assertion để giữ hành vi cũ.
- [ ] Lint, typecheck, build và test phù hợp trên cây tích hợp đạt; CI head cuối đạt theo phạm vi repo, chỉ kết luận từ log thật.
- [ ] Chỉ đóng issue cha sau khi mọi child issue hoàn tất; PR cuối có Closes cho child và #6, không đóng tay trước merge.

Truy vết với đặc tả cha: AC25, AC26, AC27. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #12 — Bảo đảm vòng đời dữ liệu trung tâm độc lập: Cần xuất/backup/restore/xoá độc lập đã hoạt động để nghiệm thu vòng đời trên dữ liệu của các luồng mới.
- #18 — Quản lý bản riêng và phiên bản tài nguyên đã dùng: Cần toàn bộ loại tài nguyên và vòng đời phiên bản/giao bài đã hoàn thiện trước khi bỏ các đường ngân hàng cũ và kiểm cài mới.
- #19 — Cấp quyền hỗ trợ có thời hạn cho trung tâm: Cần quyền hỗ trợ tường minh hoạt động trước khi kết luận mô hình quyền không còn đường truy cập legacy.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
