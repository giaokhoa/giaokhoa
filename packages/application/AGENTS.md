# Quy ước cho `@giaokhoa/application`

## Trách nhiệm và ranh giới

- Gói này sở hữu các trường hợp sử dụng nghiệp vụ (use case), lỗi nghiệp vụ và hợp đồng kho dữ liệu (repository port). Mỗi hợp đồng kho dữ liệu nằm cùng nhóm nghiệp vụ sử dụng nó.
- Chỉ phụ thuộc vào `@giaokhoa/shared` trong các gói của dự án. Không phụ thuộc vào NestJS, Drizzle, PostgreSQL hoặc mã của `apps/api`.
- Dịch vụ ứng dụng (application service) chứa hành vi dùng chung cho mọi cách giao tiếp: kiểm tra quyền sở hữu, xác thực lại dữ liệu sau khi kết hợp thay đổi, quản lý vòng đời và áp dụng quy tắc nghiệp vụ. Tầng giao tiếp không được tự triển khai lại các quy tắc này.
- Các mã lỗi riêng của PostgreSQL hoặc tầng lưu trữ phải được bộ chuyển đổi của `@giaokhoa/database` chuyển thành `ClientError`.

## Trách nhiệm các nhóm nghiệp vụ

- **Phân quyền:** `src/authorization` sở hữu cơ chế xét capability, vai trò và ngữ cảnh; không sử dụng role của Better Auth làm nguồn cấp quyền.
- **Lớp học:** `src/classes` sở hữu quản lý lớp, thành viên và mã tham gia.
- **Câu hỏi và ngữ liệu:** `src/questions` sở hữu biên soạn, phiên bản nội dung và liên kết ngữ liệu.
- **Đề thi:** `src/exams` sở hữu đề thi và các phiên bản đề.
- **Giao bài:** `src/assignments` sở hữu bài giao, nhóm người nhận và lịch công bố.
- **Bài làm:** `src/attempts` sở hữu lượt làm, bài nộp, chấm điểm và kết quả.
- **Tệp:** `src/files` sở hữu việc điều phối sử dụng, phục vụ và thu gom tệp.
- **Chương trình học:** `src/curriculum` sở hữu cấu trúc chương trình và nội dung học.

Điều kiện, ngoại lệ, thứ tự xử lý và quy tắc truy cập của từng nhóm được mô tả tại `src/<nhóm>/service.ts`, hợp đồng `src/<nhóm>/repository.ts`, bộ chuyển đổi lưu trữ liên quan và kiểm thử của nhóm đó; không sao chép luồng vào tệp này.

## Lỗi do yêu cầu không hợp lệ

- Dùng thống nhất `ClientError` từ `@giaokhoa/application/common/client-error`.
- `kind` gồm `invalid`, `not_found`, `conflict` và `forbidden`. `code` là mã ổn định để chương trình xử lý; `message` giải thích lỗi; `details` mang ngữ cảnh có cấu trúc nếu cần.
- Không tạo lớp lỗi con cho từng tài nguyên hoặc tệp `errors.ts` chỉ để đổi một trường hợp sang lỗi HTTP. Tầng giao tiếp tự ánh xạ `ClientError.kind` sang ngữ nghĩa giao thức.
