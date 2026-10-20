# Quy ước cho `@giaokhoa/shared`

- Đây là nguồn schema, type, constant và HTTP protocol descriptor chuẩn, không phụ thuộc vào framework hoặc hạ tầng.
- Public domain subpath phải theo bounded context:

```text
@giaokhoa/shared/questions
@giaokhoa/shared/curriculum
@giaokhoa/shared/images
```

- HTTP descriptor là phần riêng của transport, xuất qua:

```text
@giaokhoa/shared/http/questions
@giaokhoa/shared/http/stimuli
@giaokhoa/shared/http/subjects
@giaokhoa/shared/http/curricula
@giaokhoa/shared/http/curriculum-nodes
@giaokhoa/shared/http/learning-outcomes
@giaokhoa/shared/http/images
@giaokhoa/shared/http/auth
```

- Không tạo export gốc cho `@giaokhoa/shared`; khai báo public entry tường minh trong package exports.
- Schema chuẩn dùng tên có ý nghĩa như `questionSchema`, `questionCreateSchema`, `questionPatchSchema`, `subjectSchema`, `subjectCreateSchema`, `subjectPatchSchema`.
- Khi HTTP body/response trùng cấu trúc schema chuẩn, dùng schema đó trực tiếp; không tạo alias `CreateQuestionBody` hoặc `questionResponseSchema` chỉ để đổi tên.
- Dùng `schema.ts` (số ít), không dùng song song `schemas.ts`. Đặt tên file theo trách nhiệm như `service.ts`, `repository.ts`, hoặc public entry `questions.ts`; không tạo barrel `index.ts` chỉ để tái export file cùng cấp.

## HTTP descriptor

- Registry của resource có dạng `<resource>Contract`, ví dụ `questionsContract`.
- Chỉ dùng các trường `method`, `path`, `pathParams`, `query`, `headers`, `body`, `file` và `responses`.
- `responses` được key bằng HTTP status; dùng `204: null` khi thành công không có body và `'binary'` cho phản hồi nhị phân.
- Path phải là đường dẫn public API đầy đủ.
- `test/http-contracts.spec.ts` kiểm tra quy ước HTTP descriptor.
