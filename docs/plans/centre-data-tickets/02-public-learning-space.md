# Issue #8 — Tách dữ liệu khu học tập công cộng

[Mở issue #8](https://github.com/giaokhoa/giaokhoa/issues/8).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Site chính hiện vừa phục vụ giáo viên/học viên tự do vừa có dữ liệu và vai trò nền tảng. Cần giữ chức năng học tập mà tách dữ liệu khu công cộng khỏi ngân hàng hệ thống và nhân sự vận hành.

## Mục tiêu

Giáo viên và học viên tự do tiếp tục đăng ký, đăng nhập, tạo lớp/khoá và học trên khu công cộng; dữ liệu nằm trong một kho riêng như một trung tâm.

## Phạm vi

### Làm

- Cấp và định tuyến một kho riêng cho khu công cộng, dùng cùng hợp đồng tài khoản/phiên của trung tâm.
- Tách nhận diện đăng nhập học tập công cộng khỏi nhận diện nhân sự vận hành; giữ đường quản trị nền tảng cần thiết.
- Đồng bộ khởi tạo, đăng nhập và các trang vào học hiện có; kiểm tra lớp/khoá, lượt làm và kết quả đúng kho.

### Không làm

- Không xây SSO hoặc tự liên kết tài khoản công cộng với trung tâm.
- Không viết lại nghiệp vụ lớp/khoá/đề hoặc mở rộng ngân hàng tài nguyên trong ticket này.

## Chi tiết việc cần làm

Giáo viên và học viên tự do tiếp tục đăng ký, đăng nhập, tạo lớp/khoá và học trên khu công cộng; dữ liệu nằm trong một kho riêng như một trung tâm.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Cấp kho và hoàn thiện nhận diện/khởi tạo khu công cộng.
- [ ] Nối luồng đăng ký, đăng nhập và vào học với kho công cộng, bảo toàn đường quản trị vận hành.
- [ ] Kiểm chứng tài khoản, phiên và một luồng lớp/khoá/làm bài công cộng độc lập với A/B.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Khu công cộng là một miền học tập có dữ liệu riêng, áp dụng cùng ranh giới sở hữu như trung tâm.
- Ngân hàng hệ thống chỉ chứa tài nguyên chung và metadata phân phối; không chứa học viên, lớp, bài làm hoặc điểm công cộng.
- Tài khoản vận hành không phải tài khoản toàn cục của người học/giáo viên.
- Không giữ dữ liệu cũ; chuẩn hoá luồng cài mới và seed, giữ chức năng học tập hiện có.

## Nghiệm thu

- [ ] Cài mới tạo được kho công cộng riêng và người dùng tự do đăng ký/đăng nhập thành công.
- [ ] Cùng email ở khu công cộng và A là hai tài khoản; đổi mật khẩu/đình chỉ ở một nơi không ảnh hưởng nơi kia.
- [ ] Token/cookie công cộng không dùng được tại A/B và ngược lại.
- [ ] Tạo lớp/khoá và một lượt làm/chấm tại khu công cộng chỉ lưu dữ liệu tại kho này.
- [ ] Kho ngân hàng hệ thống không chứa hồ sơ, lớp, bài làm hoặc điểm công cộng.
- [ ] Nhân sự vận hành vẫn đăng nhập và thực hiện chức năng quản trị được phép mà không dùng lẫn tài khoản học tập.

Truy vết với đặc tả cha: AC02, AC03, AC05. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #7 — Cấp trung tâm với kho và tài khoản riêng: Cần cơ chế cấp kho, tài khoản và định tuyến trung tâm riêng trước khi áp dụng cùng hợp đồng cho khu công cộng.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
