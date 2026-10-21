# Quy ước cho `@giaokhoa/shared`

Đây là nguồn chuẩn của lược đồ dữ liệu (schema), kiểu dữ liệu, hằng số và mô tả hợp đồng HTTP; không phụ thuộc vào khung phần mềm hay tầng hạ tầng. Không nhập NestJS, React, Drizzle, `@giaokhoa/application` hoặc `@giaokhoa/database` vào gói này.

## Ranh giới và các đường dẫn công khai

- Chia đường dẫn công khai theo nhóm nghiệp vụ (bounded context); những nhóm hiện có gồm `@giaokhoa/shared/questions`, `@giaokhoa/shared/curriculum`, `@giaokhoa/shared/files`, `@giaokhoa/shared/classes`, `@giaokhoa/shared/exams`, `@giaokhoa/shared/assignments` và `@giaokhoa/shared/attempts`.
- Hợp đồng truyền tải HTTP tách khỏi dữ liệu nghiệp vụ, xuất qua `@giaokhoa/shared/http/*`. Những đường dẫn hiện có gồm `questions`, `stimuli`, `subjects`, `curricula`, `curriculum-nodes`, `learning-outcomes`, `files`, `auth`, `classes`, `exams`, `assignments` và `attempts` dưới tiền tố này.
- Không tạo đường dẫn xuất gốc cho `@giaokhoa/shared`; khai báo công khai trong `package.json`. Không tạo tệp `index.ts` chỉ để xuất lại thành phần cùng cấp.
- Đặt lược đồ theo ý nghĩa như `questionSchema`, `questionCreateSchema`, `questionPatchSchema`, `subjectSchema`, `subjectCreateSchema`, `subjectPatchSchema`. Khi dữ liệu yêu cầu hoặc phản hồi HTTP trùng lược đồ nghiệp vụ, dùng trực tiếp lược đồ đó, không tạo tên thay thế chỉ để đổi tên.
- Dùng `schema.ts` (số ít), không đồng thời tạo `schemas.ts`. Đặt tên tệp theo trách nhiệm như `service.ts`, `repository.ts` hoặc tệp công khai `questions.ts`.

## Luồng khai báo hợp đồng HTTP

- Mỗi nhóm tài nguyên có một bộ hợp đồng dạng `<resource>Contract`, chẳng hạn `questionsContract`, làm căn cứ thống nhất cho cách gửi và nhận dữ liệu.
- Mỗi mô tả chỉ dùng các trường `method`, `path`, `pathParams`, `query`, `headers`, `body`, `file` và `responses`. Đường dẫn `path` phải là đường dẫn API công khai đầy đủ.
- `responses` được đánh khóa theo mã trạng thái HTTP. Dùng `204: null` cho phản hồi thành công không có nội dung và `'binary'` cho nội dung nhị phân.
- Giữ lược đồ gửi/nhận nhất quán với lược đồ nghiệp vụ, tránh sao chép quy tắc xác thực sang từng tầng. `test/http-contracts.spec.ts` kiểm tra cấu trúc và các quy ước hợp đồng.

Khi thay đổi hợp đồng, phải cập nhật lược đồ tương ứng, phần sử dụng hợp đồng, chú thích và mô tả kiểm thử liên quan trong cùng thay đổi. Không được rút gọn tài liệu bằng cách xóa các quy tắc hợp đồng khiến người sửa mã phải đoán lại từ cách triển khai.
