# Files Subsystem — kiến trúc v1

## Quyết định và phạm vi

Giaokhoa áp dụng **ý tưởng Files Subsystem của Moodle**: tách bytes bất biến khỏi các vị trí sử dụng theo `context / component / fileArea / itemId`. Phần triển khai là **TypeScript/NestJS + PostgreSQL/Drizzle + S3-compatible storage** ngay trong Giaokhoa, không dùng Moodle plugin hay phụ thuộc runtime Moodle.

V1 phục vụ ảnh PNG/JPEG/WebP và SVG sinh từ TikZ trong câu hỏi, Stimulus và trình soạn thảo. Đây là triển khai **greenfield**: không chuyển dữ liệu từ domain `images`, không giữ endpoint, kiểu dữ liệu hoặc adapter tương thích legacy. Metadata, quyền và binary đều đi qua domain `files`.

## Mô hình dữ liệu

| Bảng                    | Trách nhiệm                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file_blobs`            | Một object vật lý cho mỗi SHA-256 (`content_hash` PK); giữ `storage_key`, `byte_size`.                                                            |
| `files`                 | Asset logic UUIDv7, chủ sở hữu, MIME, kích thước, tên gốc, `content_hash`, `orphaned_at`; crop là hàng riêng có `parent_file_id` trỏ về original. |
| `file_uses`             | Các placement (`file_id, context_id, component, file_area, item_id`), duy nhất theo bộ năm; một file có thể có nhiều placement.                   |
| `file_sources`          | Nguồn `{kind: 'tikz', source}`, khóa theo `file_id`; không trộn với binary hoặc nội dung đề.                                                      |
| `file_object_deletions` | Outbox bền vững giữ `storage_key` phải xóa; xử lý thất bại được thử lại.                                                                          |

`context_id` tham chiếu `authz_contexts` đã có. Content/editor lưu `FileRef = { fileId: UUIDv7, variantFileId: UUIDv7 | null }`, **không** lưu URL S3. `fileId` nhận diện original; `variantFileId` là asset crop đang hiển thị. Client sinh `src` từ hai ID và API cấp binary sau khi kiểm quyền.

| Nội dung sử dụng                     | Context                       | Component / fileArea                             | itemId                      |
| ------------------------------------ | ----------------------------- | ------------------------------------------------ | --------------------------- |
| Upload chưa lưu                      | `user`, người upload          | `user / draft`                                   | `fileId`                    |
| Câu hỏi theo từng phiên bản bất biến | `bank`, `questionBankEntryId` | `questions / content, guidance, solution`        | `question.id` của phiên bản |
| Stimulus                             | `user`, chủ Stimulus          | `stimuli / content`                              | `stimuli.id`                |
| Original có crop                     | Giống placement hiển thị      | `questions / original` hoặc `stimuli / original` | Cùng itemId với variant     |

Nếu có crop, placement `content` (hoặc `guidance/solution`) chỉ gắn **ID variant**; ID original được giữ trong area `original` để tác giả chỉnh sửa. Không suy quyền xem original từ quyền xem variant. Khi lưu câu hỏi/Stimulus, repository xác thực ownership, khóa các asset trong transaction, gắn file uses rồi bỏ placement `draft`; phiên bản câu hỏi cũ giữ tham chiếu riêng cho đề đã chốt.

## Luồng và phân quyền

1. **Upload:** kiểm tra bytes thực tế, định dạng, kích thước (tối đa 8 MiB; chiều tối đa 12.000 px; diện tích tối đa 40 MP), làm sạch SVG; ghi object S3 bằng khóa ngẫu nhiên, lưu SHA-256 và metadata trong DB. Nếu hash đã có, dùng blob hiện hữu và đưa object upload dư qua outbox dọn.
2. **Crop:** chỉ tác giả original được tạo variant raster; variant là file độc lập với `parent_file_id`. Editor giữ `FileRef` trỏ tới original và variant; không hỗ trợ crop SVG.
3. **Phục vụ file:** luôn xác thực session, không trả public S3 URL. Owner đọc original/variant của mình. Học sinh chỉ đọc đúng file được dùng trong `content` của câu hỏi/Stimulus thuộc bài đã xuất bản và mở, đúng người nhận và lớp đang hoạt động, sau khi kiểm `assignment:view_assigned`; đối chiếu cả câu hỏi trong exam snapshot. `guidance`, `original` của crop và bản nháp không cấp quyền xem cho học sinh. File trong `solution` chỉ được xem sau `releaseSolutionsAt` qua lượt làm đã nộp/chấm, kể cả khi học sinh đã rời lớp; không mở quyền solution từ quyền xem đề.
4. **TikZ:** biên dịch LaTeX trong browser Web Worker/WASM, không thực thi LaTeX trên API server. Chỉ SVG đã làm sạch được upload; phía server kiểm lại bằng DOMPurify/JSDOM, loại các tham chiếu ngoài kể cả URL trong CSS (`style` và `@import`), chỉ cho phép `url(#id)` nội bộ và không nhận SVG thường không có metadata nguồn TikZ. Nguồn `file_sources` chỉ người tạo file đọc qua endpoint riêng; không đưa source vào question snapshot hay API binary. SVG response đặt CSP sandbox, `nosniff`; file response dùng cache `private, no-store`.
5. **Thu gom:** file có `orphaned_at` được giữ mặc định **24 giờ** (`FILE_ORPHAN_TTL_HOURS`) khi còn ở trạng thái draft hoặc bị tháo tham chiếu. `discard` dọn nháp có chủ đích; GC chỉ xóa metadata không còn `file_uses`, kiểm tra các crop con, chỉ xóa blob khi không asset nào cùng hash tham chiếu. Xóa DB và ghi outbox cùng transaction, sau đó xóa object; thất bại lưu để retry, tránh mất đồng bộ khi S3 lỗi. Trước mỗi PUT, lưu upload intent bền vững vào outbox với thời hạn dọn 48 giờ; transaction tạo file gỡ intent nếu object đã được dùng. Nếu API chết hoặc ghi DB/cleanup đồng thời lỗi, GC vẫn tìm được object để dọn.

GC chạy một lần qua `pnpm --filter @giaokhoa/api files:gc` (script `apps/api/scripts/files-gc.mjs`). **Triển khai production cần lịch chạy định kỳ bên ngoài** (cron/Job); ứng dụng API hiện không tự đặt timer chạy GC.

## Giao diện HTTP

Các endpoint yêu cầu phiên đăng nhập; `src` là URL API nội bộ.

| Phương thức | Endpoint                         | Chức năng                                                                                                |
| ----------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST`      | `/files`                         | Multipart `file` và metadata TikZ tùy chọn; trả `{fileId, variantFileId, src, width, height, mimeType}`. |
| `POST`      | `/files/:id/variants`            | Upload ảnh crop raster, trả cùng định dạng phản hồi.                                                     |
| `GET`       | `/files/:id`                     | Binary original theo ACL.                                                                                |
| `GET`       | `/files/:id/variants/:variantId` | Binary variant theo ACL độc lập.                                                                         |
| `GET`       | `/files/:id/source`              | Nguồn TikZ chỉ cho chủ file.                                                                             |
| `POST`      | `/files/discard`                 | Body `{files: FileRef[]}`; dọn nháp còn mồ côi, trả 204.                                                 |

## Kiểm chứng và triển khai

Chạy tại root worktree sau khi cài dependencies và build các package liên quan:

```sh
pnpm --filter @giaokhoa/application typecheck
pnpm --filter @giaokhoa/application exec vitest run test/files.service.spec.ts test/files.security.spec.ts
pnpm --filter @giaokhoa/database typecheck
pnpm --filter @giaokhoa/api typecheck
pnpm --filter @giaokhoa/api test:e2e
```

Đã xác nhận tại thời điểm viết: **15/15** FilesService tests, **8/8** security tests và application typecheck đạt. Security tests bao gồm SVG độc hại, che nguồn TikZ, phân quyền trước khi đọc storage, crop original và GC retry. **DB/API E2E tích hợp PostgreSQL và S3 chưa được xác minh** trong worktree do thiếu cấu hình `.env`/dịch vụ; phải kiểm tra khi có môi trường được cấp quyền, đặc biệt race attach–discard–GC, assignment/Stimulus ACL và object outbox.

Triển khai chỉ tạo schema `files` mới và cập nhật callers sang `FileRef`; **không chạy backfill, không migration từ `images` và không bật đường dẫn legacy**. Trước rollout, chạy migration schema mới, cấu hình S3 + cron GC, kiểm thử E2E và xác nhận không còn dữ liệu sản xuất cần chuyển đổi.
