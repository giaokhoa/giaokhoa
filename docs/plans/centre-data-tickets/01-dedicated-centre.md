# Issue #7 — Cấp trung tâm với kho và tài khoản riêng

[Mở issue #7](https://github.com/giaokhoa/giaokhoa/issues/7).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Hệ thống đã có đường cấp database riêng nhưng còn giữ chế độ kho chung và đường đổi đích khi ngữ cảnh chưa được chuẩn bị. Cần một luồng tạo trung tâm và đăng nhập được kiểm chứng với ranh giới kho rõ ràng.

## Mục tiêu

Người vận hành tạo trung tâm A/B; quản trị trung tâm tạo tài khoản, đăng nhập và quản lý hồ sơ chỉ trong kho của mình. Cùng email ở hai nơi là hai tài khoản độc lập và phiên A không dùng được ở B.

## Phạm vi

### Làm

- Cấp phát và đăng ký database/role riêng cho mọi trung tâm mới, giữ RLS fail-closed và quyền tối thiểu.
- Hoàn thiện nhận diện hostname, kiểm phiên/ngữ cảnh và chuẩn bị handle trước khi truy vấn; ngữ cảnh thiếu/sai/thu hồi báo lỗi thay vì đổi sang kho khác.
- Đồng bộ luồng tạo trung tâm, tạo user, đăng nhập và trang hồ sơ hiện có; kiểm bằng HTTP và kết nối database thật.

### Không làm

- Tách khu học tập công cộng và loại bỏ thư mục người dùng toàn cục là các ticket tiếp theo.
- Không đổi cơ chế file, ngân hàng tài nguyên hoặc chấm bài trong ticket này.

## Chi tiết việc cần làm

Người vận hành tạo trung tâm A/B; quản trị trung tâm tạo tài khoản, đăng nhập và quản lý hồ sơ chỉ trong kho của mình. Cùng email ở hai nơi là hai tài khoản độc lập và phiên A không dùng được ở B.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Hoàn thiện cấp phát, đăng ký và trạng thái sẵn sàng của trung tâm.
- [ ] Nối luồng tạo tài khoản, đăng nhập và hồ sơ đúng kho, cùng hợp đồng/giao diện liên quan.
- [ ] Khoá các ca ngữ cảnh sai, thiếu, thu hồi và phiên xuyên trung tâm bằng test hành vi.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Dùng chung API/worker/PostgreSQL/Redis; ranh giới dữ liệu của trung tâm là database và role riêng.
- Tài khoản, mật khẩu, đình chỉ và phiên thuộc trung tâm; không tự liên kết bằng email/số điện thoại.
- Dùng định danh kho ổn định và repository/handle định tuyến hiện có; không tự mở pool trong repository.
- Không có yêu cầu giữ dữ liệu cũ hoặc xây di trú; không xoá dữ liệu môi trường trong lúc viết đặc tả.

## Nghiệm thu

- [ ] Cấp A và B tạo database, role và định danh kho riêng; role runtime A bị từ chối kết nối/đọc/ghi kho B.
- [ ] Tạo cùng email ở A/B cho hai tài khoản độc lập, chỉ có hồ sơ ở đúng kho.
- [ ] Đổi mật khẩu hoặc đình chỉ tài khoản A không làm mất quyền đăng nhập, phiên hoặc hồ sơ ở B.
- [ ] Token/cookie A bị từ chối ở hostname B; định danh giả mạo trong request không đổi kho hiệu lực.
- [ ] Request trung tâm có ngữ cảnh thiếu/sai hoặc handle bị thu hồi trả lỗi và không để lại ghi thành công ở kho khác.
- [ ] Luồng tạo trung tâm, user và đăng nhập hiện có hoạt động từ API/giao diện; test e2e dùng ứng dụng thật, test role dùng database thật.

Truy vết với đặc tả cha: AC01, AC02, AC03. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

Không có blocker; có thể bắt đầu ngay sau khi bản chia việc được duyệt.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
