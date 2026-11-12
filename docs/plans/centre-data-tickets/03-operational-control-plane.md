# Issue #9 — Giới hạn control plane ở dữ liệu vận hành

[Mở issue #9](https://github.com/giaokhoa/giaokhoa/issues/9).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Control plane còn thư mục liên kết người dùng với trung tâm và có đường quản trị nền tảng đọc dữ liệu nghiệp vụ. Mô hình đích chỉ cho phép metadata vận hành dùng chung.

## Mục tiêu

Người vận hành quản lý registry, trạng thái, gói dịch vụ và phiên bản schema; không có danh bạ học viên xuyên trung tâm và không được tự xem hồ sơ/bài làm/điểm của trung tâm.

## Phạm vi

### Làm

- Loại bỏ thư mục liên kết người dùng và các luồng đăng ký/tra cứu/chuyển trung tâm dựa vào thư mục này.
- Giữ metadata cần cho registry, cấp phát, gói dịch vụ, schema và vận hành; rà hợp đồng và giao diện quản trị/điều hướng liên quan.
- Đóng quyền đọc nghiệp vụ ngầm của quản trị nền tảng; quyền quản trị cục bộ của trung tâm vẫn hoạt động.

### Không làm

- Quyền hỗ trợ được trung tâm cấp sẽ được thêm ở #19; ticket này chỉ đóng truy cập thường trực không được phép.
- Không thay quyền biên tập tài nguyên đã công bố thành quyền đọc hồ sơ trung tâm.

## Chi tiết việc cần làm

Người vận hành quản lý registry, trạng thái, gói dịch vụ và phiên bản schema; không có danh bạ học viên xuyên trung tâm và không được tự xem hồ sơ/bài làm/điểm của trung tâm.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Rà và bỏ cấu trúc/liên kết người dùng toàn cục cùng các consumer tương ứng.
- [ ] Giữ luồng quản trị registry/vòng đời hoạt động và cập nhật hợp đồng, giao diện, seed.
- [ ] Đóng đường đọc nghiệp vụ ngầm và kiểm chứng quyền quản trị trung tâm không bị mất.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Không có SSO hoặc danh bạ liên kết người học/giáo viên xuyên trung tâm; cùng email không là căn cứ nhận diện chung.
- Control plane giữ registry, tham chiếu cấu hình kết nối, trạng thái, gói dịch vụ, phiên bản schema và metadata vận hành cần thiết.
- Tài khoản nhân sự vận hành là định danh vận hành; vai trò này không tự có quyền nghiệp vụ ở mọi trung tâm.
- Không cần giữ nhánh tương thích với thư mục hoặc dữ liệu user toàn cục cũ.

## Nghiệm thu

- [ ] Control plane cài mới không có directory liên kết tài khoản người học/giáo viên giữa các trung tâm.
- [ ] Tạo user trong A/B/công cộng không tạo hồ sơ hoặc liên kết người dùng ở control plane.
- [ ] Quản trị vận hành vẫn xem và cập nhật registry, trạng thái, gói dịch vụ và phiên bản schema theo quyền.
- [ ] Nhân sự nền tảng không có quyền hỗ trợ bị từ chối đọc hồ sơ, bài làm, điểm và nội dung riêng của A/B.
- [ ] Quản trị A vẫn xem/quản lý dữ liệu nghiệp vụ của A nhưng không của B.
- [ ] Luồng đăng nhập/điều hướng trung tâm không còn dựa vào user toàn cục; hợp đồng và giao diện không hiển thị danh bạ xuyên trung tâm.

Truy vết với đặc tả cha: AC04, AC22. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #8 — Tách dữ liệu khu học tập công cộng: Cần trung tâm và khu công cộng đều có tài khoản/kho riêng để bỏ liên kết định danh toàn cục mà không làm mất luồng đăng nhập học tập.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
