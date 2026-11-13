# Đề trộn câu hệ thống và câu riêng (issue #14)

## Mô hình dữ liệu

Đề tại trung tâm có thể chứa đồng thời câu trong kho trung tâm (`source_domain = centre`) và câu đã công bố ở kho hệ thống (`source_domain = bank-system`). Mỗi slot giữ `question_id`, `pinned_version_id`, `pinned_version_number` và thông tin nguồn; slot câu hệ thống còn có `source_snapshot` để phát hiện nguồn thay đổi trước khi giao. **Không tạo bản sao câu có thể chỉnh sửa** trong ngân hàng của giáo viên, cũng không tạo khóa ngoại xuyên database.

Khi giáo viên giao đề, dịch vụ `ExamQuestionSnapshotsService` kiểm tra quyền đọc nguồn, trạng thái công bố, phiên bản đã chọn, checksum và cấu trúc gói câu. Dữ liệu gồm đề bài, các lựa chọn, đáp án, quy tắc chấm, ngữ liệu và tài nguyên ảnh cần dùng được chụp vào `exam_pins.question_snapshots` tại trung tâm đích. Tài nguyên ảnh được sao vào miền lưu trữ của trung tâm, không phụ thuộc URL/byte tại kho hệ thống sau khi giao.

Mỗi lượt làm lưu bản chụp dùng cho chấm trong `question_attempts.content_snapshot`. Bộ máy làm bài, chấm tự động, chấm tay và xem lại đọc snapshot của trung tâm khi có câu chung; dữ liệu học sinh không ghi ngược vào kho câu hệ thống.

## Giao đề và cập nhật

Giao diện soạn đề cho phép chọn câu chung theo đúng phiên bản, xem trước nội dung và lưu cùng các câu local. API tạo/cập nhật đề nhận `sourceDomain: "bank-system"` và `sourceVersionNumber` cho câu chung. Câu local dùng hợp đồng cũ để tương thích.

Khi giao đề có câu hệ thống qua `POST /api/v1/courses/:courseId/exam-pins`, client gửi `requestId` UUID ổn định cho những lần retry cùng thao tác. Chỉ khi toàn bộ snapshot và bước tạo course module/grade item thành công thì pin chuyển sang `preparation_state = ready`. Trạng thái đang chuẩn bị không được liệt kê như pin sẵn sàng. Quyền bị từ chối, phiên bản sai, sai checksum, media thiếu hoặc lỗi ghi snapshot đều không được tạo pin ready thiếu dữ liệu. Cùng `requestId` được tra cứu trong trung tâm để tránh nhân đôi pin.

Đề có câu chung chỉ được giao ở chế độ `versionMode = pinned`; không dùng `float_latest_ready`. Việc đổi phiên bản pin phải chuẩn bị lại snapshot và tuân thủ khóa khi đã có lượt làm thực. Chính sách công bố điểm, quyền xem lại đáp án và hàng đợi chấm tay tiếp tục do tầng quiz/grades hiện hành kiểm soát.

## Kiểm chứng

- HTTP E2E: `apps/api/test/e2e/quiz/quiz-shared-questions.e2e-spec.ts` kiểm tra bốn loại câu, offline kho hệ thống, quyền nhóm, cô lập hai kho A/B, lỗi chuẩn bị và retry idempotent.
- UI unit: `apps/web/src/features/exams/routes/exam-paper-editor.spec.tsx` kiểm tra chọn phiên bản, xem trước, lưu slot và không gọi API nhập/copy câu.
- Chạy qua khóa thử nghiệm chung: `flock /tmp/giaokhoa-heavy-suite.lock pnpm --filter @giaokhoa/api exec vitest run --project e2e test/e2e/quiz/quiz-shared-questions.e2e-spec.ts`.
- Migration trung tâm: `packages/db/migrations/centre/20261113160000_exam_question_snapshots/migration.sql`; kiểu Kysely sinh bằng `pnpm --filter @giaokhoa/db db:types`.
