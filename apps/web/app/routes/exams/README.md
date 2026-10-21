# Đề thi

- `index.tsx` phục vụ `/exams`: liệt kê đề thuộc quyền quản lý và tạo đề với tiêu đề từ 1 đến 200 ký tự.
- `detail.tsx` phục vụ `/exams/:id`: đổi tiêu đề đề gốc, liệt kê phiên bản, chốt phiên bản mới và xem bản chụp câu hỏi. Tham số truy vấn `revision` chọn số phiên bản; mặc định mở phiên bản có số lớn nhất.
- Mọi hàm tải dữ liệu và xử lý biểu mẫu đều gọi `requireSession`. Quyền sở hữu và khả năng quản lý đề do API kiểm tra; giao diện hiển thị lỗi API.
- Chỉ gọi các điểm cuối trong `@giaokhoa/shared/http/exams`, không gọi điểm cuối liệt kê câu hỏi. Người dùng nhập mỗi dòng `questionId,version`; bỏ qua dòng trống, giữ thứ tự câu hỏi. Mã phải là UUID v7, phiên bản phải là số nguyên dương an toàn; từ 1 đến 100 câu và không lặp mã, kể cả khác chữ hoa/chữ thường hoặc khác phiên bản. API tiếp tục kiểm tra quyền sở hữu, trạng thái sẵn sàng và sự tồn tại của phiên bản câu hỏi.
- Phiên bản đề là bản chụp bất biến, có tiêu đề và nội dung câu hỏi riêng. Đổi tiêu đề đề gốc hoặc sửa câu hỏi về sau không sửa bản chụp cũ. Trang hiển thị bản xem trước bằng `@giaokhoa/editor` và cho mở toàn bộ dữ liệu câu hỏi, hướng dẫn, đáp án dưới dạng JSON. Dữ liệu ngữ liệu chỉ có mã `stimulusId` theo hợp đồng bản chụp; trang không tự tải nội dung ngữ liệu hiện tại thay cho bản chụp.
- Chuỗi ngày JSON ở `createdAt`, `updatedAt` được chuyển sang `Date` trước khi kiểm tra hợp đồng phản hồi; ngày sai hoặc thiếu bị từ chối. Không chuyển đổi đệ quy nội dung câu hỏi. Thời gian hiển thị theo `Asia/Ho_Chi_Minh` để nhất quán giữa máy chủ và trình duyệt.
- Có thông báo chờ, lỗi biểu mẫu, lỗi tải dữ liệu và hàng thông báo khi danh sách rỗng. Giữ dữ liệu nhập khi lỗi; sau khi tạo thành công chuyển tới đề hoặc bản chụp vừa tạo.
- Dùng các thành phần `Card`, `Table`, `FieldGroup`, `Field`, `Input`, `Textarea`, `Button`, `Alert`, `Empty`, `Spinner` sẵn có từ `@giaokhoa/ui/components/*`; không sửa thư viện giao diện.

Kiểm tra bộ phân tích đầu vào và ngày JSON: `pnpm --filter @giaokhoa/web test`.
