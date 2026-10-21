# Giao bài

Ba thành phần trang nằm trong `app/routes/assignments/`: `new.tsx` cho
`/assignments/new`, `detail.tsx` cho `/assignments/:id` và `delivery.tsx` cho
`/assignments/:id/delivery`. Phần khai báo đường dẫn và thanh điều hướng do công
việc tích hợp quản lý. API không có danh sách bài giao, vì vậy không tạo trang
danh sách hoặc suy ra danh sách từ dữ liệu khác.

- Tạo bản nháp cần mã lớp và mã phiên bản đề dạng UUID phiên bản 7. Có thể điền
  trước bằng tham số truy vấn `classId` và `examRevisionId`. Giao cả lớp hoặc nhập
  các mã học sinh phân cách bằng dấu phẩy, dấu chấm phẩy hoặc khoảng trắng; không
  tự loại mã lặp. Kiểm tra theo `assignmentsContract.create.body`, gồm thứ tự mở,
  đóng, giới hạn 1–100 lượt và tối đa 5.000 học sinh. Ba lịch công bố được để
  `null` khi bỏ trống. Tạo thành công chuyển đến trang chi tiết.
- Trường `datetime-local` dùng múi giờ trình duyệt tại ngày được chọn, rồi chuyển
  thành ISO UTC trước khi gửi biểu mẫu. Chỉ bật biểu mẫu sau khi trình duyệt xác
  định múi giờ. Không diễn giải giờ địa phương bằng múi giờ máy chủ. Ngày hiển thị
  trong thông tin bài giao dùng UTC và ghi rõ UTC; khi sửa, đổi trở lại giờ địa
  phương, giữ giây và mili giây. Giờ không tồn tại khi chuyển giờ mùa hè bị từ chối.
- Trang chi tiết tải cấu hình và người nhận qua hai điểm truy cập riêng. Chỉ sửa
  khi còn bản nháp; đọc lại cấu hình trước khi sửa, giữ cố định lớp và phiên bản đề,
  kiểm tra toàn bộ cấu hình bằng hợp đồng tạo, rồi kiểm tra phần cập nhật bằng hợp
  đồng sửa. API tiếp tục quyết định quyền và xử lý xung đột nếu đã công bố.
- Công bố dùng cấu hình đã lưu và chốt học sinh đang tham gia lớp tại thời điểm
  công bố. Người ghi danh sau đó không được tự động thêm. Danh sách người nhận
  hiển thị mã học sinh, nguồn giao, trạng thái và thời gian giao/thu hồi. Thu hồi
  gọi API cho từng học sinh, giữ lịch sử đã giao. Thành công tự tải lại dữ liệu.
  Lỗi tải người nhận vẫn giữ phần cấu hình để người dùng xem.
- Trang nhận bài chỉ gọi `assignmentsContract.delivery`, kiểm tra cấu trúc nội
  dung theo từng dạng câu hỏi và dùng thành phần xem trước của `@giaokhoa/editor`.
  Tự luận nhiều ý hiển thị lần lượt từng phần. Không gọi API biên soạn câu hỏi,
  hướng dẫn hoặc lời giải; không đưa dữ liệu ngoài hợp đồng nội dung vào giao diện.
  Các ô trả lời ở bản xem đề bị vô hiệu hóa để tránh nhầm với lượt làm thật.
- Bắt đầu lượt làm gọi `attemptsContract.start`, kiểm tra phản hồi sau khi khôi
  phục ngày ở lượt làm và từng câu trả lời, rồi chuyển đến `/attempts/:id` khi nhận
  đúng trạng thái 201 và dữ liệu hợp lệ. API kiểm tra quyền nhận bài, thời gian,
  giới hạn lượt làm; giao diện hiển thị thông báo lỗi từ API và khóa nút khi chờ.
- Tất cả phần tải và xử lý biểu mẫu gọi `requireSession`, dùng `createApiClient`
  cùng thông báo lỗi chung. Trường ngày từ JSON chỉ được khôi phục ở tên trường
  đã khai báo trước khi kiểm tra hợp đồng; không đổi `null` thành mốc thời gian
  hoặc duyệt đệ quy vào nội dung đề. Có trạng thái chờ, rỗng, lỗi và nút tải lại.

Kiểm tra quy tắc dữ liệu: `pnpm --filter @giaokhoa/web test`.
Kiểm tra kiểu dữ liệu sau khi tích hợp đường dẫn:
`pnpm --filter @giaokhoa/web typecheck`.
