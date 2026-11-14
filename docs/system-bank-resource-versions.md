# Tiếp nhận và cập nhật câu hỏi dùng chung (issue #18)

Câu hỏi từ kho hệ thống được tiếp nhận dưới dạng bản riêng tại trung tâm. Mỗi lần tiếp nhận tạo một câu hỏi với quyền biên tập thuộc ngân hàng đích, lưu dấu nguồn, ID phiên bản nguồn, checksum và số phiên bản đã tiếp nhận trong `system_question_imports`. Khi giáo viên sửa bản riêng, phiên bản mới của câu hỏi cục bộ được tạo và bản ghi nguồn chuyển sang `derived`; dữ liệu phiên bản nguồn và những đợt giao đã có không bị sửa.

`GET /api/v1/system-bank/imports` liệt kê các bản có quyền xem cùng trạng thái nguồn, số phiên bản mới nhất và cờ `hasNewVersion`. `GET /api/v1/system-bank/imports/:id` trả thông tin truy vết của một bản riêng nếu người gọi có quyền đọc câu hỏi. Giáo viên chủ động chọn phiên bản mới bằng `POST /api/v1/system-bank/import` với `sourceQuestionId` và `sourceVersionNumber`; hệ thống không tự cập nhật bản cũ.

Việc nhập câu, stimulus, liên kết YCCĐ và bản ghi phiên bản tại trung tâm hoàn tất trong cùng giao dịch cơ sở dữ liệu; thất bại giữa chừng không tạo bản nhập hoặc câu hỏi rời. Sau khi giao dịch trung tâm commit thành công, hệ thống ghi nhận trung tâm đã tiếp nhận tại kho ngân hàng dùng chung (`system_question_importers`). Hai kho sử dụng các kết nối khác nhau, không dùng giao dịch phân tán. Nếu xác nhận ở kho hệ thống lỗi sau commit trung tâm, request nhập vẫn thành công vì bản nhập đã bền vững; lỗi được ghi log để quan sát. Dấu `system_question_imports` thuộc ngân hàng của **đúng tenant** là bằng chứng có quyền nhận thông báo và đọc nguồn đã rút ngay cả khi chưa có bản xác nhận ở kho hệ thống. Dấu đã được xác nhận thành công ở `system_question_importers` vẫn bảo toàn lịch sử thông báo khi bản riêng cục bộ đã bị xóa; quyền đọc **nội dung phiên bản** của nguồn đã rút vẫn đòi hỏi vết cài đặt đúng phiên bản tại kho trung tâm để không mở rộng quyền sang bản chưa từng nhận. Khi đọc thông báo hoặc phiên bản đã rút, API đối chiếu dấu trung tâm, bổ sung các xác nhận thiếu vào `system_question_importers` theo thao tác idempotent. Retry cùng người dùng, phiên bản và danh mục khi dấu xác nhận còn thiếu trả bản đã nhập thay vì tạo bản sao thứ hai. Nhờ đó không có khoảng trống thông báo hoặc quyền trong khi kho hệ thống đang gặp lỗi xác nhận.

Khi phát hành phiên bản mới, kho hệ thống ghi `question_version_published` trong cùng giao dịch với phiên bản. Khi rút câu, kho ghi sự kiện `question_withdrawn`. Chỉ trung tâm có bản tiếp nhận của nguồn đó thấy sự kiện trong `GET /api/v1/system-bank/events/pending` và được ghi nhận qua `POST /api/v1/system-bank/events/:id/acknowledge`; gửi ID sự kiện không thuộc nguồn đã tiếp nhận trả 404.

Lệnh phát hành phiên bản câu hỏi mới khoá bản ghi nguồn và kiểm tra trạng thái ngay trong giao dịch. Lệnh rút nguồn cập nhật cùng bản ghi nguồn, nên không thể có phiên bản mới được commit sau khi lệnh rút hoàn tất.

Nguồn rút không còn xuất hiện trong khám phá. Trung tâm chưa từng nhận nguồn không được nhập hay đọc gói nguồn đã rút bằng cách đoán ID. Trung tâm từng nhận chỉ được tiếp nhận lại **đúng phiên bản đã có** tại kho mình, không được nhận phiên bản chưa từng tiếp nhận trước khi rút. Bản đã giao và các phiên bản nguồn là dữ liệu độc lập, không có đồng bộ sống.

Kiểm thử HTTP: `apps/api/test/e2e/system-bank/system-bank-flow.e2e-spec.ts` bao phủ bản riêng, cập nhật phiên bản, thông báo, ghi nhận và quyền sử dụng sau rút. Các luồng đề, học liệu và chương trình có kiểm thử HTTP riêng trong `apps/api/test/e2e/exams/system-shared-exams.e2e-spec.ts`, `apps/api/test/e2e/system-bank/system-materials.e2e-spec.ts`, và `apps/api/test/e2e/system-bank/programme-package-flow.e2e-spec.ts`.

## Đề chung

Mỗi bản đề được phê duyệt là một phiên bản bất biến trong `system_exam_versions`; phát hành tạo `exam_version_published`. Giáo viên có thể **giao** đề theo snapshot, hoặc chọn `POST /api/v1/system-bank/exams/:id/fork` để tạo đề nháp riêng (`kind = snapshot`) và câu hỏi riêng trong ngân hàng cá nhân. Đề riêng lưu `system_exam_fork_version_id`; câu riêng có thể chỉnh sửa mà không làm thay đổi đề hệ thống hay đề đã giao.

Duyệt phiên bản đang chờ, gửi phiên bản mới và rút đề được tuần tự hoá theo định danh nguồn trong giao dịch kho hệ thống. Khi bất kỳ phiên bản nào của nguồn đã bị rút, không thể duyệt hoặc gửi thêm phiên bản cho cùng nguồn. Tạo bản riêng của đề ghi toàn bộ câu hỏi, stimulus, sự kiện outbox, đề và slot cùng một giao dịch trung tâm; lỗi tại một slot làm rollback toàn bộ bản riêng mới. Việc materialize ảnh cần ghi file vật lý và metadata trước giao dịch câu/đề. API theo dõi các ID file vừa tạo trong riêng thao tác đó và bù trừ cả metadata lẫn object không còn tham chiếu nếu fork hoặc nhập thất bại. Dọn file theo refcount của `content_hash` và `storage_domain`, không xóa object đang dùng bởi bản riêng khác hay ảnh đã công bố của nguồn.

`POST /api/v1/system-bank/exams/:id/withdraw` (kèm `reason`) dành cho quyền duyệt; trạng thái nguồn chuyển `withdrawn`, thông báo `exam_withdrawn`. Phiên bản đã giao hoặc đã fork ở trung tâm vẫn dùng được; trung tâm không được giao/fork phiên bản chưa từng nhận sau khi rút. Danh sách khám phá không bao gồm nguồn bị rút.

## Học liệu chung

`GET /api/v1/system-bank/materials/used` đọc danh sách tài nguyên đã ghim ở trung tâm, gồm phiên bản, checksum, trạng thái nguồn và phiên bản gần nhất. Người dùng chủ động chọn phiên bản khác rồi sử dụng; không có đồng bộ ngầm. Khi duyệt học liệu mới phát `material_version_published`; `POST /api/v1/system-bank/materials/:id/withdraw` (kèm lý do) chuyển nguồn về `withdrawn` và phát `material_withdrawn`.

Danh sách khám phá loại trừ nguồn rút. Dù nguồn rút, bản đã ghim tại khoá học và player vẫn hoạt động theo quyền nội bộ; chỉ phiên bản đã ghim được xem/tiếp nhận lại. Các bản chưa từng ghim bị từ chối.

## Gói chương trình

Phê duyệt gói chương trình phát `programme_version_published`; `POST /api/v1/system-bank/outcome-packages/:version/withdraw` chuyển trạng thái và phát `programme_withdrawn`. Gói đã cài tại trung tâm vẫn được đọc và xác nhận cài lại đúng phiên bản, không làm thay đổi dữ liệu YCCĐ đã dùng; trung tâm chưa cài không thể cài mới gói rút. Lịch sử cài và checksum vẫn nằm tại trung tâm.

## Thông báo chung và triển khai schema

Tất cả bốn loại nguồn dùng `GET /api/v1/system-bank/events/pending` và `POST /api/v1/system-bank/events/:id/acknowledge`; sự kiện chỉ hiện nếu kho trung tâm có bằng chứng đã dùng nguồn (nhập câu, fork/giao đề, gắn học liệu, cài gói), và chỉ được ghi nhận một lần. Các sự kiện tài nguyên dùng cặp `resource_kind`/`resource_key` để phân biệt, không trộn với `source_question_id`. Phiên bản nguồn và dữ liệu đã dùng không được sửa đồng bộ.

Migration:
- `packages/db/migrations/system-bank/20261114030000_resource_lifecycle`
- `packages/db/migrations/centre/20261114031000_shared_exam_forks`

Phải áp migration ở cả hai kho trước khi deploy API. `packages/db/src/types/*.d.ts` được sinh lại theo schema mới.
