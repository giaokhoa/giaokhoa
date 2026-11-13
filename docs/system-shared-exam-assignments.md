# Giao đề chung phiên bản bất biến cho nhiều trung tâm (#15)

## Luồng chức năng

Quản trị trung tâm tạo đề trong ngân hàng của mình, đưa đề sang trạng thái `ready` rồi gửi phiên bản bằng `POST /api/v1/system-bank/exams` với `{ "examId": "uuid" }`. Quyền bắt buộc là `tenant:manage` và quyền xem đề nguồn. Chỉ đề `kind=snapshot` thuộc tenant hiện tại được chấp nhận. Đề nguồn được đóng gói một lần gồm phiên bản đề, vị trí/thứ tự, điểm từng slot, bản câu hỏi đầy đủ (nội dung, ngữ liệu, lựa chọn, đáp án, hướng dẫn/nhận xét, chuẩn đầu ra), checksum SHA-256 chuẩn hoá và manifest media. File ảnh được sao lưu vào miền lưu trữ ngân hàng hệ thống, không tham chiếu file riêng của trung tâm nguồn.

Bản gửi được lưu trong `system_exam_versions` với trạng thái `pending`, bất biến theo bộ `(centre_slug, source_exam_id, source_version_id)`. Gửi lại cùng phiên bản không cập nhật nội dung. Phiên bản đã bị từ chối không được gửi lại; cần tạo phiên bản nguồn mới. Hệ thống tách danh sách chờ duyệt và nguồn đã duyệt. Quyền `systembank:review` cho phép xem toàn bộ gói và xem media đã sao lưu; duyệt chỉ thành công nếu checksum tất cả câu, thứ tự slot và media còn nguyên. Các API:

- `GET /api/v1/system-bank/exams/mine` — trạng thái các bản gửi của trung tâm, yêu cầu `tenant:manage`.
- `GET /api/v1/system-bank/exams/pending`, `GET /api/v1/system-bank/exams/:id`, `GET /api/v1/system-bank/exams/:id/media/:hash` — hàng chờ, gói đầy đủ, ảnh xem trước; yêu cầu `systembank:review`.
- `POST /api/v1/system-bank/exams/:id/approve` và `POST /api/v1/system-bank/exams/:id/reject` — duyệt/từ chối, từ chối yêu cầu `reason`.
- `GET /api/v1/system-bank/exams?courseId=uuid` — chỉ trả metadata của đề `approved` cho người có quyền giao bài và quản lý điểm tại khoá học; tuyệt đối không trả đáp án hay gói câu hỏi.

Trên giao diện **Đề của tôi**, quản trị trung tâm chọn “Gửi đề lên hệ thống” tại đề `ready`. Trên trang **Đề thi hệ thống**, người có quyền duyệt thấy hàng chờ và nội dung cần thẩm định. Giáo viên chọn khoá học, phiên bản đề đã duyệt, mục, nhóm, số mã đề, lịch mở/đóng, tên đợt giao rồi chọn “Giao đề chung”.

## Cách giao và lưu dữ liệu

`POST /api/v1/courses/:courseId/exam-pins` với `sharedExamVersionId`, `sectionId`, `requestId` và các tham số pin bình thường. Không được truyền đồng thời `examId`, `newExam` hoặc `examVersionId`; bắt buộc `versionMode=pinned`. Server kiểm tra quyền `course:manageactivities`, `grade:manage`, chỉ đọc phiên bản trung ương `approved`, kiểm tra lại checksum, rồi tạo **bản thực thi nội bộ** trong DB của trung tâm (`exams.kind=system_execution`) với `exam_versions` và `exam_slots.source_snapshot`. Đây **không phải bản đề được biên tập**: API xem/sửa đề và danh sách ngân hàng loại hẳn kind nội bộ. Thông tin `shared_exam_version_id`/nguồn/vị trí giao được gắn vào bản thực thi. `QuizView.sharedSource` chỉ trả cho người có quyền quản lý/chấm, không trả cho học sinh. Trong đợt giao đề chung, học sinh nhận `QuizView.slots[].questionId=null`, `QuizAttemptView.questions[].questionId` và `stimulus.id` là ID slot cục bộ của trung tâm; ID đáp án được sinh mới khi tạo bản thực thi, không ghép từ ID phiên bản nguồn. Tóm tắt lượt làm của học sinh không chứa `appliedSettings.questionOrder` của câu gốc, bao gồm phản hồi chi tiết, màn chi tiết đợt giao và `GET /api/v1/exam-pins/:pinId/attempts`; người có quyền quản lý/chấm vẫn được xem thông tin theo quyền.

Luồng `QuizPinsService.createPinRecord` và snapshot của #14 sẽ sao chép media vào miền file của khoá học và chụp `exam_pins.question_snapshots` trước khi pin chuyển `ready`. Snapshot ưu tiên nội dung `exam_slots.source_snapshot` đã kiểm checksum, không truy xuất phiên bản câu hỏi hiện tại trên bank chung. Khi học sinh làm bài, hướng dẫn chấm (`answerKey.guidance`), lời giải và đáp án bị ẩn; sau nộp chỉ hiện theo `reviewRightAnswer`, cửa sổ review và trạng thái công bố điểm của grade item; thiếu grade item sẽ giữ phần đáp án bảo mật ở trạng thái ẩn. Người có quyền quản lý/chấm vẫn có thể xem hướng dẫn khi cần chấm. **Quy tắc che rubric này chỉ áp dụng cho đề chung**; quiz thường tiếp tục cho học sinh xem `guidance` khi đang làm hoặc sau nộp, không phụ thuộc `reviewRightAnswer`, theo yêu cầu ĐX-3/#181. Sau khi `ready`, thi, phúc khảo, chấm tự động/tự luận, `exam_attempts`, `question_attempts` và điểm số đều dùng DB trung tâm. Không có bài làm, danh sách học sinh, số lần làm hoặc điểm trong DB ngân hàng chung.

Mỗi trung tâm và mỗi khoá học có đợt giao, lịch, điều kiện truy cập, nhóm và kết quả riêng. Cùng `sharedExamVersionId` luôn tạo dữ liệu thực thi độc lập theo từng trung tâm; không có tự động theo phiên bản mới. Đề chung được cập nhật bằng một bản gửi/duyệt khác; pin cũ giữ nguyên nội dung và điểm.

## Retry và các lỗi

`requestId` là bắt buộc, khoá đồng thời theo `courseId + actorId + requestId`; HMAC-SHA-256 của toàn bộ nội dung giao đã chuẩn hoá (kể cả lịch, nhóm, số mã đề, quyền xem đáp án, mật khẩu và thời gian) được lưu ngay trong bản thực thi, đối chiếu trước mọi lần resume; khóa HMAC dẫn xuất theo miền riêng từ `JWT_SECRET`, vì vậy không thể thử đoán mật khẩu ngoại tuyến chỉ từ bản sao DB. Các API node phải dùng cùng secret đủ mạnh, không dùng giá trị ví dụ trong `.env.example`; khi đổi secret, những yêu cầu cũ có `requestId` không thể retry mà không có phương án chuyển khóa; nếu tạo pin thất bại sau khi đã tạo bản thực thi, lần gọi lại cùng mã nguồn đề/section sẽ sử dụng đúng một `exams` và `exam_versions` nội bộ. Nếu pin đã được tạo nhưng còn ở trạng thái `preparing`, quy trình #14 tiếp tục snapshot, course module và grade item thay vì nhân bản. Khác nguồn/section/lịch/nhóm/tùy chọn giao với cùng khoá sẽ trả `409 exam.pin_request_conflict`.

Bản chưa duyệt/không tồn tại trả `404 system_exam.not_published`; thiếu quyền trả `403`. Gói checksum sai trả lỗi trước khi giao. Nếu media không có ở lần chuẩn bị, pin không đạt `ready` và không thể làm bài; phục hồi media rồi retry cùng `requestId` sẽ tiếp tục. Khi snapshot đã `ready`, mất kết nối DB hoặc file ở bank chung không ảnh hưởng bài thi, đáp án hay file bản sao của trung tâm. Không trả nội dung câu hỏi qua API liệt kê đề chung; chỉ giao diện duyệt có quyền lấy gói đầy đủ.

## Kiểm thử

Kiểm thử e2e `apps/api/test/e2e/exams/system-shared-exams.e2e-spec.ts` tạo tenant A/B và hai database trung tâm vật lý riêng bên cạnh database ngân hàng hệ thống, chạy luồng gửi/duyệt/giao cùng phiên bản, kiểm tra quyền truy cập chéo, ID câu nguồn/ID đáp án/rubric bị ẩn theo quyền, snapshot và làm/chấm khi bank offline; có kiểm thử thiếu media/checksum, retry sau lỗi DB và requestId sai nguồn/section. Kiểm thử này dùng DB test sinh riêng và xóa cuối test. Chạy:

```bash
flock /tmp/giaokhoa-heavy-suite.lock pnpm --filter @giaokhoa/api exec vitest run --project e2e test/e2e/exams/system-shared-exams.e2e-spec.ts
```

Migrations: `packages/db/migrations/system-bank/20261113210000_shared_exam_versions` và `packages/db/migrations/centre/20261113210000_shared_exam_execution`. DB Kysely types được tái sinh bằng `pnpm --filter @giaokhoa/db db:types` với môi trường PostgreSQL phù hợp.
