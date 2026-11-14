# Quyết định kiến trúc đề xuất — baseline 0.1.0

**Ngày cập nhật bản đề xuất:** 2026-11-14. **Phạm vi:** domain model mục tiêu, không nêu hiện trạng code, migration hay tiến độ thực hiện.

**Trạng thái D-001 đến D-013: ĐỀ XUẤT**, chờ review độc lập và phê duyệt qua PR. Kết quả CLI chỉ xác nhận test model, không phê duyệt kiến trúc. Quyết định chỉ chuyển sang **ĐƯỢC DUYỆT** khi reviewer độc lập đã APPROVED đúng head và PR được người có quyền merge theo quy trình repo; lưu bằng chứng PR/commit tương ứng. Các vấn đề ở mục 3 giữ trạng thái **CÒN MỞ** kể cả khi baseline được duyệt, và chặn đúng phạm vi ghi trong bảng.

| Mã    | Quyết định                                                                                                                        | Căn cứ                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D-001 | Cấu trúc sở hữu theo GitLab Personal/Group Namespace → Project → Resource                                                         | [GitLab Namespaces](https://docs.gitlab.com/user/namespace/)                                                             |
| D-002 | Một principal có thể có membership ở nhiều organization/project, quyền ở mỗi scope độc lập                                        | [GitLab Members](https://docs.gitlab.com/api/group_members/)                                                             |
| D-003 | Không đồng nhất tài khoản, quyền giáo viên, quyền tạo học liệu cá nhân                                                            | [GitLab Account limits](https://docs.gitlab.com/administration/settings/account_and_limit_settings/) + yêu cầu Giáo khoa |
| D-004 | Authorization biểu diễn bằng OpenFGA-style object/relation/tuple; kiểm theo scope đích                                            | [OpenFGA Concepts](https://openfga.dev/docs/concepts)                                                                    |
| D-005 | Có model bất biến, version được khóa và kịch bản test deny/allow                                                                  | [OpenFGA Immutable Models](https://openfga.dev/docs/getting-started/immutable-models)                                    |
| D-006 | Managed account có thể không có email, username có phạm vi tổ chức                                                                | [RFC 7643](https://www.rfc-editor.org/rfc/rfc7643) + yêu cầu Giáo khoa                                                   |
| D-007 | Bank là container chuyên cho học liệu; project có nhiều loại; các domain giữ chính sách riêng                                     | Mở rộng Giáo khoa                                                                                                        |
| D-008 | Tác giả khác chủ sở hữu; tạo ở organization project thì tổ chức sở hữu cả bản nháp                                                | Mở rộng Giáo khoa                                                                                                        |
| D-009 | Copy/share/contribution/transfer là hành động khác nhau; không tự chuyển quyền sở hữu                                             | Mở rộng Giáo khoa                                                                                                        |
| D-010 | Dữ liệu học sinh không tự trao đổi và không kế thừa quyền theo học liệu                                                           | Mở rộng Giáo khoa                                                                                                        |
| D-011 | Data Space vật lý độc lập với Namespace logic; không dùng DB boundary để suy membership                                           | Mở rộng Giáo khoa                                                                                                        |
| D-012 | Chỉ có một baseline kiến trúc chính thức; thay đổi model cần sửa docs và test trước khi coi là chốt                               | Quản trị thiết kế Giáo khoa                                                                                              |
| D-013 | Authorship không giữ quyền sửa sau khi hạ vai trò; sửa tài nguyên của mình cần quyền biên tập hiện hành và domain policy cho phép | Mở rộng Giáo khoa; model và test hạ vai trò                                                                              |

## 1. Quy tắc giải thích

- **Chuẩn tham khảo:** một thuộc tính được tài liệu GitLab, OpenFGA hoặc RFC xác nhận trong phạm vi sản phẩm/tiêu chuẩn đó.
- **Phần mở rộng Giáo khoa:** quyết định nội bộ nhằm đáp ứng bài toán giáo dục. Không gán các quy tắc này cho bên thứ ba.
- **Không chuẩn hóa bằng ví dụ:** bảng role, tên project hay các tuple mẫu không có nghĩa chính sách đã được triển khai.
- **Không tự thêm quyền:** loại resource mới mặc định deny cho đến khi domain policy, ownership và test được xác định.
- **Không hợp nhất ownership theo người dùng:** giáo viên hoạt động tại nhiều tổ chức không dẫn tới việc hợp nhất kho.

## 2. Điều kiện thay đổi baseline

Một thay đổi thuộc D-001 đến D-013 cần ghi: lý do, tài liệu nguồn, rủi ro cô lập dữ liệu, hành vi mới và cũ, tác động đối với user/membership/resource, test trước/sau và trạng thái chấp thuận. Nếu thay đổi authorization DSL thì phải thay đổi kịch bản `.fga.yaml`. Trước khi baseline đầu tiên được duyệt, các chỉnh sửa thuộc cùng bản đề xuất 0.1.0 và được phân biệt bằng revision Git.

Các quyết định về schema database vật lý, routing storage, tên module và migration **không thuộc baseline này**; lập ADR riêng sau khi đội triển khai nghiên cứu code.

## 3. Những vấn đề chưa chốt có chủ đích

| Mã   | Quyết định còn mở                                                                      | Phạm vi triển khai bị chặn                                                                                               |
| ---- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| O-01 | Bảng role mặc định, quyền theo từng resource type và custom role                       | Role production, `edit_all` và quyền ngoài model mẫu; không suy bảng role hoàn chỉnh từ contributor/reviewer/manager mẫu |
| O-02 | Số cấp subgroup/team và giới hạn project per namespace                                 | Phân cấp và kế thừa quyền team trong runtime                                                                             |
| O-03 | Share chỉ đọc theo thời gian thực hay chỉ copy bất biến; cơ chế thu hồi truy cập nguồn | Tính năng share liên tổ chức; chưa chọn thì không bật share                                                              |
| O-04 | License mặc định cho cá nhân → tổ chức và tổ chức → tổ chức                            | Luồng chuyển giao chưa có license rõ ràng; không mặc định cho phép copy/export                                           |
| O-05 | Transfer ownership với tài nguyên đã có lịch sử sử dụng                                | Chuyển owner thực sự; copy không thay thế quyết định này                                                                 |
| O-06 | Phạm vi endpoint, schema extension và bảo mật SCIM cụ thể                              | Tích hợp SCIM runtime, gồm User/Group; viện dẫn RFC không xác nhận tương thích                                           |
| O-07 | Đồng bộ membership/thu hồi quyền giữa vùng dữ liệu, xử lý cache và lỗi                 | Enforcement phân tán trong production; phải đáp ứng bất biến thu hồi tại AUTHORIZATION trước khi bật                     |
| O-08 | Account linking, hợp nhất định danh và phạm vi credential do tổ chức quản lý           | Linking runtime; phải chứng minh quyền kiểm soát hai phía và không cho admin A chiếm registered account/B                |
| O-09 | Project type ban đầu, quyền tạo project và xét duyệt project nhạy cảm                  | Cấp phát project production và policy theo loại project                                                                  |
| O-10 | Sửa bản sao và đề xuất cập nhật về nguồn                                               | Đồng bộ cập nhật hai chiều; copy hiện chỉ có hợp đồng snapshot độc lập                                                   |

Không được ngầm giải quyết các mục này chỉ bằng suy luận từ GitLab hoặc OpenFGA.

## 4. Phương pháp duy trì

- Bản thiết kế nội bộ nằm trong Git, thay đổi cùng revision với các test tương ứng; trạng thái duyệt gắn với PR/commit, không suy từ ngày ghi trên tài liệu.
- Nguồn web GitLab/OpenFGA ghi URL và ngày đối chiếu, chưa được snapshot. CLI kiểm thử được khóa phiên bản và commit đã xác minh tại [REFERENCE_BASELINE.md](REFERENCE_BASELINE.md). Việc triển khai phụ thuộc phiên bản phần mềm sau này phải tự khóa nguồn đúng phiên bản, không coi URL đang đổi là nguồn bất biến.
- Không công bố API riêng của Giáo khoa chỉ bằng cách sao chép tài liệu API GitLab/OpenFGA.
- Không sao chép toàn bộ DB schema hay framework của GitLab.
