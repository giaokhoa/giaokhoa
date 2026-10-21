# Làm bài và chấm bài

Ba thành phần tuyến đường trong phạm vi này:

- `routes/attempts/detail.tsx`: `/attempts/:id`, chỉ dành cho chủ lượt làm bài.
- `routes/attempts/review.tsx`: `/attempts/:id/review`, đọc và chấm bằng quyền giáo viên do API kiểm tra.
- `routes/assignments/attempts.tsx`: `/assignments/:assignmentId/attempts`, danh sách lượt làm dành cho giáo viên.

Mỗi hàm tải dữ liệu và xử lý biểu mẫu gọi `requireSession`, kiểm tra tham số theo hợp đồng `@giaokhoa/shared/http/*`, rồi gọi API bằng `createApiClient`. Quyền lớp, quyền sở hữu, người nhận, thời hạn, trạng thái và quyền chấm cuối cùng do API quyết định. Không suy quyền giáo viên từ dữ liệu của học sinh hoặc dùng đường đọc giáo viên để bỏ qua lỗi trang cá nhân.

## Nội dung đề và câu trả lời

API chi tiết lượt làm không chứa đề. Trang cá nhân gọi API trả đề được giao từ `assignmentId`; chỉ dùng nội dung API này trả về, không gọi API câu hỏi dành cho tác giả. Khi không thể đọc đề, trang vẫn hiển thị lịch sử câu trả lời và kết quả được phép đọc, kèm liên kết tới trang đề. Điều này giữ lịch sử cho học sinh đã rời lớp. Trang chấm hiển thị câu trả lời theo vị trí và liên kết về bài giao để giáo viên đối chiếu đề.

Lưu từng câu bằng `PUT /attempts/:id/responses/:position`. `position` lấy nguyên từ đề, không dùng chỉ số mảng. Trắc nghiệm dùng `choiceId`; đúng/sai cần đủ bốn `statementId` và giá trị đúng/sai, không tự chọn mặc định; câu ngắn theo quy tắc hợp đồng. Tự luận đơn dùng `answer` là tài liệu, tự luận nhiều phần dùng `answers` gồm `partId` và `content` cho từng phần.

Ô nhập tự luận hiện hỗ trợ văn bản nhiều dòng và chuyển thành các đoạn trong tài liệu phong phú. Tài liệu có công thức, ảnh, bảng hoặc căn chỉnh đã lưu được giữ nguyên, hiển thị bằng thành phần xem tài liệu hiện có; muốn thay bằng văn bản phải chọn thao tác thay thế rõ ràng. Muốn soạn trực tiếp các nội dung phong phú này cần xuất thành phần nhập tài liệu dùng chung từ `@giaokhoa/editor`; thay đổi đó nằm ngoài phạm vi nhiệm vụ này.

Không mất nội dung đang nhập khi đổi thẻ hoặc lưu lỗi. Giữ thẻ bài làm trong cây thành phần khi ẩn; giữ đề đã tải thành công trong cùng lượt nếu tải lại đề bị lỗi, đồng thời hiện cảnh báo. Khi tải lại nhận câu trả lời mới, đồng bộ những câu không có sửa cục bộ; sau nộp hiển thị đúng bản trên máy chủ. Chặn nộp trong lúc đang lưu hoặc còn thay đổi chưa lưu, cảnh báo khi rời/tải lại trang. Nộp cần xác nhận; API cho phép nộp cả khi chưa trả lời đủ câu. Sau nộp chỉ đọc, không tự nộp khi hết hạn. API kiểm tra khoảng thời gian `[openAt, closeAt)` khi lưu và nộp; việc đọc được đề không có nghĩa còn được nộp.

## Kết quả, lời giải và chấm lại

Sau nộp, trang gọi độc lập hai API `result` và `solutions`. Chỉ đưa dữ liệu của phản hồi thành công, đúng hợp đồng vào giao diện. Không tính điểm, suy đáp án hoặc lấy lời giải từ đề. Điểm và nhận xét `null` giữ nguyên ý nghĩa chưa công bố, không đổi thành điểm 0. Lỗi hoặc mốc chưa công bố của một API không chặn API còn lại. Nút tải lại giúp kiểm tra khi đến mốc công bố.

Giáo viên đọc được lượt đang làm nhưng chỉ có biểu mẫu chấm với lượt đã nộp hoặc đã chấm. Cho phép chấm lại. Điểm 0–100, tối đa hai chữ số thập phân, nhận xét tối đa 5.000 ký tự; API tiếp tục kiểm tra quyền và trạng thái khi ghi.

Chuẩn hóa riêng các trường ngày từ JSON trước khi kiểm tra hợp đồng: `startedAt`, `submittedAt`, `gradedAt`, `responses[].updatedAt`; đề có `openAt`, `closeAt`. Giữ `null`, không chuyển chuỗi đệ quy trong nội dung, ngày sai bị hợp đồng từ chối. Giao diện hiển thị thời gian UTC để thống nhất khi dựng trang ở máy chủ và trình duyệt.

Kiểm tra: `pnpm --filter @giaokhoa/web test` và `pnpm --filter @giaokhoa/web typecheck`. Kiểm thử dữ liệu riêng tại `test/attempt-data.test.mjs`; kiểm thử các hàm tải/xử lý biểu mẫu với API giả lập tại `test/attempt-routes.test.mjs`, gồm mốc công bố độc lập, quyền giáo viên, năm dạng câu trả lời, lỗi thời hạn và ngày JSON sai.
