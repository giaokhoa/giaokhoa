# Authorization — hợp đồng quyền theo phạm vi

**Chuẩn tham chiếu:** OpenFGA (object, relation, tuple, userset, Check) kết hợp hierarchy namespace/project từ GitLab. **Mô hình mẫu:** [authz/model.fga](authz/model.fga). Đã validate và kiểm tra **27/27 Check** bằng OpenFGA CLI v0.9.0; đây vẫn là hợp đồng mục tiêu, chưa phải cấu hình production.

## 1. Luật đánh giá bắt buộc

Một yêu cầu chỉ được ALLOW khi **đồng thời** thỏa:

1. Principal và session đã xác thực, chưa bị vô hiệu.
2. Namespace, project và target resource xác thực được và đang hoạt động.
3. Membership của actor hợp lệ trong namespace đích, hoặc actor sở hữu personal namespace đích.
4. Có relation/permission cần thiết trên đúng project/resource theo authorization model.
5. Domain policy cho phép hành động trên trạng thái, thời gian và đối tượng cụ thể.
6. Đúng storage boundary và không có chính sách cấm riêng đang hiệu lực.

Quyền không rõ hoặc lookup lỗi thì **DENY**. Chỉ kiểm tra role trong organization là không đủ. Không tin `owner_namespace`, `created_by`, `project_id` do client gửi nếu backend có thể tự giải quyết từ target resource.

## 2. Cấp quyền ở scope nào?

| Scope | Loại quyền | Kế thừa |
| --- | --- | --- |
| Namespace | Membership, quản trị phạm vi | Có thể cấp điều kiện cần cho project |
| Team/Subgroup | Membership nhóm, phân công | Theo policy xác định, không mặc định quyền đáp án |
| Project | viewer/contributor/reviewer/manager | Là nơi cấp quyền tạo resource |
| Resource | Quyền đặc thù, người tạo, owner, trạng thái | Chỉ kế thừa quan hệ được khai báo trong model |
| Publication / Submission | Quyền thi, làm bài, chấm, công bố điểm | Theo domain policy, không tự động từ project thư viện |

Một người chỉ được tạo exam trong project A nếu có `can_create_exam` tại **project A**. Sở hữu account hoặc membership ở B không đủ.

## 3. Phân biệt action theo loại resource

| Resource | Các action riêng |
| --- | --- |
| question | view, create_draft, edit_own, edit_all, approve, use, copy, share_external |
| exam | view, create_draft, edit, approve, deploy, copy, export, share_external |
| matrix | view, create_draft, edit, approve, generate_exam, copy |
| document/rubric | view, annotate, edit, copy, export |
| class | view, manage_roster, assign_work, view_results |
| publication | open, close, enroll, manage, view_reports |
| attempt | start, save_answer, submit, view_own_result |
| submission | view, annotate, grade, return, reopen |
| grade | view, edit, release, regrade |
| membership | invite, change_role, suspend, remove |

Không dùng một quyền `resource:share` chung cho mọi loại. `view` không kéo theo `copy`; `use` không kéo theo `export`; `teacher` không kéo theo `see_answers` hay `grade`.

## 4. Mô hình thử nghiệm và giới hạn

- [authz/model.fga](authz/model.fga) cố định **lõi**: organization → namespace → project, membership, viewer/contributor/reviewer/manager, capability tạo và duyệt học liệu.
- [authz/model.fga.yaml](authz/model.fga.yaml) kiểm tra trường hợp user thường được A cấp quyền tạo trong A nhưng không thể tạo trong cá nhân/B.
- Resource-specific policies (đáp án trước giờ thi, grade, submission, invitation, data export) phải có thiết kế và test riêng trước khi thêm vào model; không suy diễn quyền từ các relation mẫu.
- Đặc tả OpenFGA biểu diễn **quan hệ**; trạng thái account, membership, resource và chính sách động phải được domain enforcement xác thực với dữ liệu đáng tin. Model mẫu không tự giải quyết những trạng thái đó.
- Khi dùng organization context trong OpenFGA, không tin giá trị organization từ client như bằng chứng quyền; server phải kiểm tra scope được chọn là hợp lệ trước khi dùng trong request.

## 5. Quy tắc version và test

- File `.fga` là nguồn chuẩn của quyền được mô hình hóa; thay đổi relation hay permission phải thay đổi test `.fga.yaml`.
- Trong production OpenFGA, sử dụng `authorization_model_id` **được khóa** cùng store ID; không dùng ngầm phiên bản mới nhất.
- Không được cấp quyền mặc định cho từng domain mới chỉ vì một role có tên tương tự.
- Bổ sung ca kiểm thử deny xuyên namespace, thu hồi membership, thay bank ID, chuyển phiên context, owner khác người tạo, tài nguyên nhạy cảm, stale permissions.
- Model thử nghiệm chỉ chứng minh các assertions được chạy, không thay thế E2E kiểm soát dữ liệu thật.

## 6. Các tình huống chuẩn

| Kịch bản | Kỳ vọng |
| --- | --- |
| An là user thường, A cấp contributor trên project Toán A | Cho tạo bản nháp trong project Toán A |
| An chưa được cấp authoring ở personal project | Không tạo được học liệu cá nhân |
| An chỉ có membership B, không có contributor B | Không tạo ở B |
| An mất membership A nhưng grant project chưa xóa | Không tạo ở A |
| An tạo bản nháp trong A | Owner thuộc A, dù An là tác giả |
| Admin B cố đọc bài làm học sinh A | Từ chối |
| An được xem câu hỏi A nhưng không có quyền export | Không được export |
| A chia sẻ tài nguyên sang B | Kiểm hai phía và policy chuyển giao, không suy quyền từ membership |

Nguồn: https://openfga.dev/docs/modeling/organization-context-authorization ; https://openfga.dev/docs/modeling/parent-child ; https://openfga.dev/docs/modeling/testing .
