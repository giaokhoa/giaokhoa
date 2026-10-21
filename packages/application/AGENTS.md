# Quy ước cho `@giaokhoa/application`

## Trách nhiệm và ranh giới

- Gói này sở hữu các trường hợp sử dụng nghiệp vụ (use case), lỗi nghiệp vụ và hợp đồng kho dữ liệu (repository port). Mỗi hợp đồng kho dữ liệu nằm cùng nhóm nghiệp vụ sử dụng nó.
- Chỉ phụ thuộc vào `@giaokhoa/shared` trong các gói của dự án. Không phụ thuộc vào NestJS, Drizzle, PostgreSQL hoặc mã của `apps/api`.
- Dịch vụ ứng dụng (application service) chứa hành vi dùng chung cho mọi cách giao tiếp: kiểm tra quyền sở hữu, xác thực lại dữ liệu sau khi kết hợp thay đổi, quản lý vòng đời và áp dụng quy tắc nghiệp vụ. Tầng giao tiếp không được tự triển khai lại các quy tắc này.
- Các mã lỗi riêng của PostgreSQL hoặc tầng lưu trữ phải được bộ chuyển đổi của `@giaokhoa/database` chuyển thành `ClientError`.

## Các luồng nghiệp vụ phải bảo vệ

- **Phân quyền:** `AuthorizationService` kiểm tra vai trò tài khoản, phạm vi hệ thống hoặc lớp học và quyền trên tài nguyên. Quyền được xét theo trạng thái hiện tại; không chỉ kiểm tra một lần lúc tạo tài nguyên. Quyết định từ chối phải ngăn thao tác ghi hoặc lộ dữ liệu.
- **Lớp học:** Tạo lớp gắn với việc tạo phạm vi phân quyền và quyền chủ lớp. Mã tham gia phải được kiểm tra trạng thái, thời hạn và chế độ ghi danh. Chế độ tự động cho phép vào lớp ngay; chế độ chờ duyệt chỉ cấp quyền sau khi được phê duyệt. Đình chỉ, rời lớp hoặc thu hồi quyền phải có hiệu lực với các thao tác tiếp theo.
- **Câu hỏi và ngữ liệu:** Kiểm tra quyền biên soạn và chủ sở hữu khi tạo, đọc, sửa, xóa. Sửa nội dung câu hỏi tạo phiên bản nội dung mới, giữ phiên bản trước; chỉ thay đổi trạng thái không tự tạo phiên bản mới. Không được sửa ngữ liệu đang bị câu hỏi sử dụng trái quy tắc.
- **Đề thi:** Người tạo quản lý đề riêng của mình. Mỗi phiên bản đề chốt danh sách, thứ tự và nội dung câu hỏi tại thời điểm tạo; chỉnh sửa câu hỏi sau đó không được âm thầm thay đổi phiên bản đã chốt.
- **Giao bài:** Kiểm tra quyền quản lý lớp và phiên bản đề. Khi công bố, chốt danh sách người nhận đủ điều kiện; người tham gia muộn không tự trở thành người nhận. Tôn trọng khoảng thời gian mở, đóng và thu hồi quyền truy cập.
- **Bài làm:** Chỉ người nhận đủ điều kiện được bắt đầu và lưu câu trả lời; kiểm soát số lần làm, thời hạn và quyền sở hữu. Bài đã nộp không được tiếp tục sửa. Chấm bài chỉ dành cho người có quyền; điểm, nhận xét và lời giải được công bố theo các quyền độc lập.
- **Tệp:** Xác thực chủ sở hữu trước khi truy cập tệp gốc, biến thể hoặc nguồn tạo tệp; người nhận bài chỉ được đọc tệp thực sự thuộc nội dung được giao. Không xóa dữ liệu còn được tham chiếu; việc thu gom và xóa đối tượng lưu trữ phải tôn trọng các bản ghi chờ xóa.
- **Chương trình học:** Cây nội dung phải ở đúng chương trình, không được tạo chu trình khi đổi nút cha. Việc sửa hoặc xóa môn học, chương trình, nút và yêu cầu cần đạt phải tôn trọng các quan hệ dữ liệu.

Các quy tắc chi tiết phải được đối chiếu với mã trong `src/*/service.ts`, hợp đồng tại `src/*/repository.ts` và kiểm thử. Khi hành vi thay đổi, sửa mục tương ứng tại đây cùng lúc; không xóa phần mô tả luồng chỉ vì đã có mã nguồn.

## Lỗi do yêu cầu không hợp lệ

- Dùng thống nhất `ClientError` từ `@giaokhoa/application/common/client-error`.
- `kind` gồm `invalid`, `not_found`, `conflict` và `forbidden`. `code` là mã ổn định để chương trình xử lý; `message` giải thích lỗi; `details` mang ngữ cảnh có cấu trúc nếu cần.
- Không tạo lớp lỗi con cho từng tài nguyên hoặc tệp `errors.ts` chỉ để đổi một trường hợp sang lỗi HTTP. Tầng giao tiếp tự ánh xạ `ClientError.kind` sang ngữ nghĩa giao thức.
