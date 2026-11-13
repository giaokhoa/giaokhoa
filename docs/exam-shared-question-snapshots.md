# Đề trộn câu hệ thống và câu riêng (issue #14)

## Mô hình dữ liệu

Đề tại trung tâm có thể chứa đồng thời câu trong kho trung tâm (`source_domain = centre`) và câu đã công bố ở kho hệ thống (`source_domain = bank-system`). Mỗi slot giữ `question_id`, `pinned_version_id`, `pinned_version_number` và thông tin nguồn; slot câu hệ thống còn có `source_snapshot` để phát hiện nguồn thay đổi trước khi giao. **Không tạo bản sao câu có thể chỉnh sửa** trong ngân hàng của giáo viên, cũng không tạo khóa ngoại xuyên database.

Khi giáo viên giao đề, dịch vụ `ExamQuestionSnapshotsService` kiểm tra quyền đọc nguồn, trạng thái công bố, phiên bản đã chọn, checksum và cấu trúc gói câu. Dữ liệu gồm đề bài, các lựa chọn, đáp án, quy tắc chấm, ngữ liệu và tài nguyên ảnh cần dùng được chụp vào `exam_pins.question_snapshots` tại trung tâm đích. Tài nguyên ảnh được sao vào miền lưu trữ của trung tâm, không phụ thuộc URL/byte tại kho hệ thống sau khi giao.

Mỗi lượt làm lưu bản chụp dùng cho chấm trong `question_attempts.content_snapshot`. Bộ máy làm bài, chấm tự động, chấm tay và xem lại đọc snapshot của trung tâm khi có câu chung; dữ liệu học sinh không ghi ngược vào kho câu hệ thống.

## Giao đề và cập nhật

Giao diện soạn đề cho phép chọn câu chung theo đúng phiên bản, xem trước nội dung và lưu cùng các câu local. API tạo/cập nhật đề nhận `sourceDomain: "bank-system"` và `sourceVersionNumber` cho câu chung. Câu local dùng hợp đồng cũ để tương thích.

Khi giao đề có câu hệ thống **hoặc tạo đề mới bằng `newExam`** qua `POST /api/v1/courses/:courseId/exam-pins`, client bắt buộc gửi `requestId` UUID ổn định cho những lần retry cùng thao tác. Course builder giữ lại khóa này khi yêu cầu bị lỗi và chỉ tạo khóa mới sau khi thành công. Chỉ khi toàn bộ snapshot và bước tạo course module/grade item thành công thì pin chuyển sang `preparation_state = ready`. Trạng thái đang chuẩn bị không được liệt kê như pin sẵn sàng. Quyền bị từ chối, phiên bản sai, sai checksum, media thiếu hoặc lỗi ghi snapshot đều không được tạo pin ready thiếu dữ liệu. Khóa advisory theo `(courseId, actorId, requestId)` bao trùm cả bước tạo đề mới và ghim pin; định danh yêu cầu được lưu tại `exams.pin_request_id` và `exam_pins.request_id`. Retry sau lỗi chèn pin dùng lại đề/version 1 ban đầu, không tạo thêm đề; khóa tự giải phóng nếu kết nối bị mất.

**Phục hồi và media staging:** Pin `preparing` là intent bền, được insert trước sao ảnh. Các tệp snapshot staging mang `item_id = pin.id`; khi snapshot chưa ghi mà bị crash, lần retry xoá các tệp staging này rồi sao lại. Nếu tiến trình đã tạo course module hoặc grade item nhưng chưa chuyển pin sang `ready`, retry tìm lại theo `instance_id`/`item_instance` và chỉ tạo phần còn thiếu. Khi cập nhật phiên bản pin đã ready, `exam_pins.pending_snapshot_id` ghi dấu staging trước upload; commit version/snapshot và xoá pending id nguyên tử. Lần sửa tiếp theo dọn staging còn lại của quá trình cập nhật bị ngắt. Dọn file chỉ khi biết snapshot chưa được dùng; thao tác xoá metadata dùng cơ chế refcount/cleanup queue hiện hành để không xoá byte trùng hash vẫn được tham chiếu. Không xoá pin đang `preparing` nếu bù trừ lỗi để lần retry còn dấu vết phục hồi.

Đề có câu chung chỉ được giao ở chế độ `versionMode = pinned`; không dùng `float_latest_ready`. Việc đổi phiên bản pin phải chuẩn bị lại snapshot và tuân thủ khóa khi đã có lượt làm thực. Chính sách công bố điểm, quyền xem lại đáp án và hàng đợi chấm tay tiếp tục do tầng quiz/grades hiện hành kiểm soát.

## Kiểm chứng

- HTTP E2E: `apps/api/test/e2e/quiz/quiz-shared-questions.e2e-spec.ts` kiểm tra bốn loại câu, offline kho hệ thống, quyền nhóm, cô lập hai kho A/B, lỗi chuẩn bị, retry `newExam` không nhân bản đề/version, phục hồi `preparing` qua các bước pin → CM → grade item và dọn staging media.
- UI unit: `apps/web/src/features/course-builder/routes/course-builder.spec.tsx` kiểm tra requestId của thao tác tạo đề, và `apps/web/src/features/exams/routes/exam-paper-editor.spec.tsx` kiểm tra chọn phiên bản, xem trước, lưu slot và không gọi API nhập/copy câu.
- Chạy qua khóa thử nghiệm chung: `flock /tmp/giaokhoa-heavy-suite.lock pnpm --filter @giaokhoa/api exec vitest run --project e2e test/e2e/quiz/quiz-shared-questions.e2e-spec.ts`.
- Migration trung tâm: `packages/db/migrations/centre/20261113160000_exam_question_snapshots/migration.sql`; kiểu Kysely sinh bằng `pnpm --filter @giaokhoa/db db:types`.

- Migration verifier: `packages/db/src/migrate/migrate.int-spec.ts` khẳng định 204 bảng, 23 RLS policy, **424 index** và **4 migration journal rows** tại trung tâm sau khi có index khóa retry đề.
