# Giao diện lớp học

- `index.tsx` dành cho `/classes`: tạo lớp cho giáo viên hoặc quản trị viên, gia nhập bằng mã và truy cập bằng ID lớp hợp lệ. Không gọi điểm cuối liệt kê lớp hoặc dựng danh sách giả.
- Gia nhập trả `active` chuyển đến lớp; trả `pending` giữ ở trang nhập mã và hiển thị ID cùng thông báo chờ duyệt. Người chờ duyệt chưa có quyền xem lớp.
- `detail.tsx` dành cho `/classes/:id`: đọc thông tin qua hợp đồng `classesContract`, sửa thông tin, tạo mã mời, xem và quản lý thành viên, rời lớp.
- Mọi hàm tải dữ liệu và xử lý biểu mẫu đều dùng `requireSession`. Đọc vai trò tài khoản từ đối tượng phiên bằng kiểm tra cấu trúc; vai trò không nhận diện được không được mặc định thành giáo viên. Quyền quản lý đòi người tạo lớp trùng người đăng nhập, vai trò `teacher` hoặc `admin`, đồng thời yêu cầu đọc thành viên thành công. Quản trị viên không mặc định quản lý lớp của người khác. API kiểm tra quyền cuối cùng ở mỗi thao tác.
- Chỉ duyệt thành viên `pending` khi lớp `active`; chỉ đình chỉ `pending` hoặc `active`, không áp dụng cho chính mình hoặc chủ lớp. Danh sách chỉ hiển thị ID và thông tin thật có trong hợp đồng.
- Lớp `archived` vẫn sửa được thông tin và đình chỉ thành viên; không tạo mã mời hoặc duyệt. Học sinh mất quyền xem lớp. Khi nhận lỗi `403`, giao diện vẫn cho gửi yêu cầu rời lớp hoặc hủy yêu cầu gia nhập của chính mình, không đòi quyền xem lớp trước. API từ chối người không tham gia hoặc đang bị đình chỉ. Chủ lớp không có thao tác rời trong trang thông tin.
- Mã mời cho chọn thời hạn từ 1 đến 720 giờ và số lượt dùng nguyên dương tùy chọn. Hiển thị mã cùng thời điểm hết hạn theo giờ Việt Nam; mã chỉ giữ trong kết quả biểu mẫu và mất khi tải lại trang.
- Chuẩn hóa đúng trường ngày JSON trước khi kiểm tra hợp đồng: lớp có `createdAt`/`updatedAt`, thành viên có `joinedAt`/`updatedAt`, mã mời có `expiresAt`. Chỉ nhận chuỗi ngày chuẩn do `Date.toJSON()` tạo ra hoặc đối tượng `Date` hợp lệ; không ép `null`, số hoặc trường khác thành ngày.
- Biểu mẫu dùng `Form` khi chuyển trang và `fetcher.Form` cho thao tác tại chỗ; có kiểm tra dữ liệu phía máy chủ, lỗi tiếng Việt, trạng thái chờ và tự tải lại dữ liệu sau thay đổi. Khi dữ liệu thành công trả về sai hợp đồng, thông báo yêu cầu kiểm tra trước khi thử lại để hạn chế gửi lặp.

Kiểm thử riêng: chạy `node --test test/classes*.test.mjs` trong `apps/web`. Bao gồm kiểm tra dữ liệu/quyền và gọi trực tiếp các hàm tải dữ liệu, xử lý biểu mẫu với phản hồi API giả lập, không cần kết nối máy chủ.
