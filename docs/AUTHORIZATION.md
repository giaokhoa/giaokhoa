# Authorization — hợp đồng quyền theo phạm vi

**Chuẩn tham chiếu:** OpenFGA (object, relation, tuple, userset, Check) kết hợp hierarchy namespace/project từ GitLab. **Mô hình mẫu:** [authz/model.fga](authz/model.fga). Lệnh và kết quả kiểm chứng nằm trong [REFERENCE_BASELINE.md](REFERENCE_BASELINE.md); đây là đề xuất hợp đồng mục tiêu, chưa phải cấu hình production.

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

| Scope                    | Loại quyền                                  | Kế thừa                                               |
| ------------------------ | ------------------------------------------- | ----------------------------------------------------- |
| Namespace                | Membership, quản trị phạm vi                | Có thể cấp điều kiện cần cho project                  |
| Team/Subgroup            | Membership nhóm, phân công                  | Theo policy xác định, không mặc định quyền đáp án     |
| Project                  | viewer/contributor/reviewer/manager         | Là nơi cấp quyền tạo resource                         |
| Resource                 | Quyền đặc thù, người tạo, owner, trạng thái | Chỉ kế thừa quan hệ được khai báo trong model         |
| Publication / Submission | Quyền thi, làm bài, chấm, công bố điểm      | Theo domain policy, không tự động từ project thư viện |

Một người chỉ được tạo exam trong project A nếu có `can_create_exam` tại **project A**. Sở hữu account hoặc membership ở B không đủ.

Trong model mẫu, `can_edit_own` tại project yêu cầu contributor hoặc manager còn đủ điều kiện membership/ownership; `can_edit` tại question/exam/matrix yêu cầu đồng thời `author` và `can_edit_own` từ project. Hạ contributor xuống viewer hoặc reviewer giữ lại authorship nhưng mất quyền sửa. Reviewer được duyệt, không được sửa chỉ vì từng là tác giả. Manager cũng không có quyền sửa bài của người khác từ model này; `edit_all` cần đặc tả riêng. Quyền sửa nội dung vẫn chịu điều kiện bản nháp/phiên bản bất biến ở domain policy.

## 3. Phân biệt action theo loại resource

| Resource        | Các action riêng                                                           |
| --------------- | -------------------------------------------------------------------------- |
| question        | view, create_draft, edit_own, edit_all, approve, use, copy, share_external |
| exam            | view, create_draft, edit, approve, deploy, copy, export, share_external    |
| matrix          | view, create_draft, edit, approve, generate_exam, copy                     |
| document/rubric | view, annotate, edit, copy, export                                         |
| class           | view, manage_roster, assign_work, view_results                             |
| publication     | open, close, enroll, manage, view_reports                                  |
| attempt         | start, save_answer, submit, view_own_result                                |
| submission      | view, annotate, grade, return, reopen                                      |
| grade           | view, edit, release, regrade                                               |
| membership      | invite, change_role, suspend, remove                                       |

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
- Các ca quan hệ ở mục 6 bắt buộc chạy bằng CLI. Thay bank ID, chuyển phiên context, owner khác người tạo, dữ liệu nhạy cảm và quyền lỗi thời được phân trách nhiệm ở mục 7; không nhận các ca này đã được CLI chứng minh.
- Model thử nghiệm chỉ chứng minh các assertions được chạy, không thay thế E2E kiểm soát dữ liệu thật.

## 6. Các tình huống quan hệ bắt buộc chạy được

| Kịch bản                                                                                                        | Kỳ vọng                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| User thường có membership và contributor A; có grant B nhưng không có membership B                              | Tạo question/exam/matrix ở A; từ chối ở B, không tự được duyệt/chia sẻ ngoài                          |
| Tác giả có quyền biên tập A; người ngoài A truy cập cùng tài nguyên                                             | Tác giả được xem/sửa cả ba loại; người ngoài không xem/sửa/duyệt                                      |
| Cùng principal Linh thuộc A và B, contributor A, viewer B, owner personal namespace nhưng chưa có grant cá nhân | Được tạo/sửa ở A; chỉ xem ở B; không tạo cá nhân                                                      |
| Linh có membership A và B nhưng không có grant project                                                          | Không xem/tạo/sửa chỉ từ membership hoặc authorship                                                   |
| Thu hồi membership A của Linh, giữ grant contributor A và membership/viewer B                                   | Trước thu hồi tạo/sửa được ở A; sau thu hồi mọi quyền đó bị từ chối, vẫn xem được B                   |
| Linh từ contributor A xuống viewer, vẫn là tác giả                                                              | Vẫn xem; không tạo hay sửa question/exam/matrix                                                       |
| Cấp contributor personal project cho Linh, chỉ có membership A                                                  | Được tạo cá nhân; không phát sinh quyền project A                                                     |
| Tác giả Linh là reviewer A; Mai là manager A nhưng không phải tác giả                                           | Linh được duyệt, không sửa/tạo/chia sẻ ngoài; Mai được tạo/duyệt/chia sẻ ngoài, không tự sửa bài Linh |

Fixture trước/sau thu hồi và hạ quyền dùng cùng principal/project/resource, chỉ thay membership hoặc role. Tuple riêng từng test được cộng vào tuple chung theo [Store File Format](https://openfga.dev/docs/modeling/store-file-format), nên membership/role thay đổi của Linh chỉ được khai ở từng test. Hai fixture trạng thái không kiểm chứng cơ chế đồng bộ hay thời gian thu hồi ngoài runtime.

## 7. Bất biến và nơi chịu trách nhiệm kiểm tra

| Bất biến                                                                                                                     | Nơi chịu trách nhiệm                                                                                      | Tình huống nghiệm thu thiết kế                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Quyền cần grant project và membership/ownership đúng scope; tác giả cần quyền biên tập hiện hành                             | DSL và tuple hợp lệ                                                                                       | Các test mục 6 cho phép/từ chối đúng, gồm trước/sau thu hồi và hạ vai trò                                                             |
| Một project thuộc đúng một namespace; một resource có đúng project và owner namespace tương ứng                              | Domain khi tạo/chuyển tài nguyên và ghi quan hệ; DSL không kiểm cardinality                               | Từ chối gắn project vào namespace thứ hai hoặc gắn resource với owner khác namespace project                                          |
| Personal namespace có đúng một principal owner; organization namespace có đúng một organization và không nhận personal owner | Domain quản lý namespace trước khi ghi tuple; DSL mẫu không phân loại hai kiểu namespace                  | Từ chối namespace vừa có personal owner vừa gắn organization, hoặc thêm owner thứ hai                                                 |
| Chỉ chủ thể được ủy quyền mới cấp/đổi/thu hồi grant                                                                          | Domain quản trị membership/quyền; không suy quyền ghi tuple từ Check của người nhận                       | Viewer tự cấp contributor hoặc admin A cấp grant B bị từ chối; quản trị đúng scope mới được ghi                                       |
| Principal/session, namespace/project và membership còn hiệu lực                                                              | Xác thực và domain kiểm trạng thái từ nguồn đáng tin; tuple member chỉ biểu diễn membership đủ điều kiện  | Account bị khóa, membership suspended hoặc scope ngừng hoạt động phải bị từ chối dù tuple cũ còn tồn tại                              |
| Thu hồi có hiệu lực với yêu cầu tiếp theo sau khi thay đổi được xác nhận                                                     | Domain enforcement và cơ chế đồng bộ quyền được thiết kế riêng; CLI chỉ chứng minh trạng thái sau thu hồi | Grant/cache cũ không cho phép tiếp tục sửa ở A; thay đổi A không vô hiệu hóa membership B; chưa có dữ liệu quyền đáng tin thì từ chối |
| Scope đích và storage boundary được xác minh phía server                                                                     | Domain phân giải resource, session context và truy cập dữ liệu                                            | Đổi project/bank ID hoặc gửi context A để đọc resource B không tạo quyền; liên kết học liệu không cấp quyền đọc bài làm/điểm          |
| Trạng thái resource và quyền theo loại là điều kiện độc lập                                                                  | Domain policy; model chỉ minh họa question/exam/matrix với cùng grant contributor                         | Bản đã công bố không bị sửa tại chỗ; được tạo exam không tự được export đáp án, chấm điểm hay chuyển dữ liệu học sinh                 |

Các dòng ngoài DSL là hợp đồng đầu vào/kết quả mong đợi để review trong phạm vi tài liệu. Chưa triển khai hoặc chạy test API/database cho các dòng này. Domain phải bảo đảm tính hợp lệ của tuple trước khi đưa vào OpenFGA; DSL validate thành công không chứng minh dữ liệu ghi quan hệ thỏa các bất biến.

Nguồn: https://openfga.dev/docs/modeling/organization-context-authorization ; https://openfga.dev/docs/modeling/parent-child ; https://openfga.dev/docs/modeling/testing .
