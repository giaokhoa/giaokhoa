# Issue #19 — Cấp quyền hỗ trợ có thời hạn cho trung tâm

[Mở issue #19](https://github.com/giaokhoa/giaokhoa/issues/19).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Lý do/audit của login-as chưa thay thế việc trung tâm cho phép hỗ trợ. Cần quyền hỗ trợ có người nhận, phạm vi, hết hạn/thu hồi và kiểm lại ở mỗi truy cập.

## Mục tiêu

Quản trị A cấp quyền hỗ trợ hữu hạn; người hỗ trợ chỉ thực hiện được thao tác được cấp tại A, bị chặn ở B hoặc khi hết hạn/thu hồi; A xem được audit.

## Phạm vi

### Làm

- Hoàn thiện cấp, sử dụng, hết hạn và thu hồi quyền hỗ trợ trên các đường nghiệp vụ có liên quan.
- Nối hợp đồng/giao diện cấp quyền, trạng thái hỗ trợ và audit trung tâm.
- Giữ quyền vận hành và biên tập ngân hàng tách khỏi quyền dữ liệu riêng.

### Không làm

- Không tạo tài khoản học viên toàn cục hoặc quyền hỗ trợ vô hạn.
- Không coi cơ chế ứng dụng là cách ly vật lý khỏi người quản trị hạ tầng dùng chung.

## Chi tiết việc cần làm

Quản trị A cấp quyền hỗ trợ hữu hạn; người hỗ trợ chỉ thực hiện được thao tác được cấp tại A, bị chặn ở B hoặc khi hết hạn/thu hồi; A xem được audit.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Hoàn thiện mô hình và luồng cấp/thu hồi quyền hỗ trợ.
- [ ] Kiểm quyền trên các đường nghiệp vụ, hết hạn/thu hồi và tách phiên khỏi hiệu lực grant.
- [ ] Hoàn thiện giao diện trạng thái/audit và test truy cập đúng/sai phạm vi.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Trung tâm cấp quyền cho người hỗ trợ cụ thể, tại một trung tâm, với thao tác/phạm vi và thời điểm hết hạn hữu hạn.
- Phiên còn hiệu lực không giữ quyền đã hết hạn/thu hồi; request tiếp theo phải kiểm trạng thái hiện thời.
- Ghi cấp, dùng, thu hồi và kết quả truy cập vào audit mà trung tâm xem được; không ghi bí mật/toàn bộ hồ sơ nhạy cảm vào log vận hành chung.
- Không có grant thì quản trị nền tảng chỉ có thông tin vận hành, không đọc hồ sơ/bài làm/điểm/nội dung riêng.

## Nghiệm thu

- [ ] Không có grant thì nhân sự nền tảng không đọc được dữ liệu nghiệp vụ A/B qua các đường quản trị hoặc login-as.
- [ ] Quản trị A cấp được grant hữu hạn với người nhận và phạm vi rõ; người không có quyền cấp không tạo grant được.
- [ ] Grant A chỉ mở đúng thao tác và trung tâm được cấp; ngoài phạm vi hoặc ở B bị từ chối.
- [ ] Hết hạn/thu hồi chặn request kế tiếp dù phiên đăng nhập của người hỗ trợ vẫn còn.
- [ ] A xem được audit cấp, dùng, thu hồi và kết quả; B không đọc audit nghiệp vụ A.
- [ ] Log vận hành không chứa bí mật hoặc toàn bộ dữ liệu nghiệp vụ; giao diện thể hiện rõ trạng thái quyền hỗ trợ.

Truy vết với đặc tả cha: AC22, AC23. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #9 — Giới hạn control plane ở dữ liệu vận hành: Cần đóng quyền truy cập nghiệp vụ ngầm của nền tảng và có định danh vận hành/tài khoản trung tâm tách biệt trước khi cấp quyền hỗ trợ tường minh.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
