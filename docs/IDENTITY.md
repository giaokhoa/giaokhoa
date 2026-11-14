# Identity, managed account và membership

**Trạng thái:** Hợp đồng domain mục tiêu. Nguồn tham chiếu là SCIM RFC 7643/7644 về provisioning và GitLab membership về phạm vi quyền; không sao chép cơ chế login của GitLab.

## 1. Bốn khái niệm không được trộn

| Khái niệm | Định nghĩa | Không thay thế cho |
| --- | --- | --- |
| Principal | Định danh ổn định của chủ thể | Email, username, role |
| Credential | Phương thức xác thực được gắn với principal | Membership |
| Membership | Quan hệ principal với organization/team/project | Principal |
| Session context | Phạm vi tổ chức/workspace đang thực hiện yêu cầu | Bằng chứng có quyền trên mọi resource |

Một principal có thể có nhiều credential và nhiều membership. Identity phục vụ chứng minh **ai** đang thực hiện hành động; authorization quyết định **được làm gì** trong scope được kiểm tra.

## 2. Hai loại tài khoản

### Registered account

- Được người dùng đăng ký/kiểm soát qua phương thức xác thực đã xác minh.
- Có principal chung, có thể gia nhập nhiều tổ chức qua lời mời.
- Có personal namespace ở mức logic, nhưng **quyền tạo học liệu cá nhân là entitlement độc lập**, không tự cấp theo việc đăng ký.
- Membership tổ chức không thay đổi quyền với namespace cá nhân.

### Organization-managed account

- Do tổ chức tạo và quản lý, không bắt buộc cung cấp email.
- Tên đăng nhập hiển thị là `organization + username` hoặc đăng nhập tại domain chuyên biệt của tổ chức.
- Username phải duy nhất **trong tổ chức**; hai tổ chức có thể cùng username `gv001`.
- Khi cung cấp SCIM ra ngoài, `userName` phải duy nhất trong phạm vi service provider theo RFC 7643; dùng định danh canonical có scope hoặc phân vùng service provider. Không công bố bare username trùng nhau là SCIM global username.
- Không có email thì không sử dụng luồng reset bằng email; admin cấp lại bằng cơ chế xác minh và token dùng một lần, ghi audit, buộc đổi credential khi đăng nhập.
- Mặc định **không** có quyền tạo học liệu cá nhân, export hoặc truy cập workspace tổ chức khác.

Một account do tổ chức quản lý có thể là danh tính độc lập cho tới khi có quy trình liên kết an toàn với registered account. Không tạo email giả để đáp ứng validation.

## 3. Giáo viên ở nhiều tổ chức

Ví dụ principal `an` là thành viên của A và B:

| Scope | Role | Ý nghĩa |
| --- | --- | --- |
| A | teacher, contributor trong Project Toán | Được soạn đề trong project được cấp |
| B | member, viewer trong Project Văn | Chỉ xem tài nguyên được cấp |
| Cá nhân | chưa có authoring entitlement | Không được tạo học liệu cá nhân |

- Role giáo viên **không** phải thuộc tính toàn cục của Principal.
- Một tổ chức ngừng cấp quyền không xóa danh tính/đăng nhập tại các tổ chức khác.
- Chuyển tổ chức phải kiểm tra session context và membership theo đích; không mang quyền của A sang B.
- Ghi audit cả principal chung, actor/credential dùng để đăng nhập, organization/namespace đang hoạt động và target resource.

## 4. Invitation và account linking

1. Tổ chức có thể **mời principal đã tồn tại** hoặc **tạo managed account**. Hai hành động khác nhau.
2. Lời mời định rõ organization, role, thời hạn, người mời, trạng thái và cơ chế chấp nhận.
3. Linking yêu cầu chứng minh quyền kiểm soát **hai phía**, không tự ghép theo họ tên, email chưa xác minh hoặc username.
4. Linking không được tự chuyển ownership resource; membership và lịch sử audit giữ được provenance.
5. Có thể thu hồi liên kết/phiên, nhưng không được tự động xóa dữ liệu học sinh hoặc thay chủ sở hữu học liệu.
6. Mọi thay đổi role/credential quan trọng phải tạo security event; cấp lại mật khẩu do admin phải bị giới hạn và kiểm toán.

## 5. Trạng thái và bất biến

- Account: `pending_activation`, `active`, `suspended`, `closed`.
- Membership: `invited`, `active`, `suspended`, `ended`.
- Chỉ membership `active` trong namespace hoạt động mới được xét là điều kiện cấp quyền.
- Xóa membership phải thu hồi các quyền phát sinh, không chỉ ẩn project khỏi giao diện.
- Không xác định quyền từ `email`, `username`, số điện thoại hoặc chức danh hiển thị.
- Không chia sẻ bí mật credential, password reset token hoặc session token giữa các tổ chức.

## 6. Ranh giới SCIM

RFC 7643 yêu cầu `userName` và không yêu cầu `emails`. RFC 7644 quy định REST provisioning nhưng **không** định nghĩa đăng nhập, xác thực phiên hoặc quyền tài nguyên học tập. Các nội dung sau là mở rộng riêng Giáo khoa: organization-managed account, quyền tạo đề, personal authoring entitlement và account linking an toàn.

Nguồn: https://www.rfc-editor.org/rfc/rfc7643 ; https://www.rfc-editor.org/rfc/rfc7644 .
