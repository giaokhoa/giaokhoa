# Quyết định kiến trúc chuẩn — baseline 0.1.0

**Ngày chốt bản thiết kế:** 2026-11-14. **Phạm vi:** domain model mục tiêu, không nêu hiện trạng code, migration hay tiến độ thực hiện.

| Mã | Quyết định | Căn cứ |
| --- | --- | --- |
| D-001 | Cấu trúc sở hữu theo GitLab Personal/Group Namespace → Project → Resource | [GitLab Namespaces](https://docs.gitlab.com/user/namespace/) |
| D-002 | Một principal có thể có membership ở nhiều organization/project, quyền ở mỗi scope độc lập | [GitLab Members](https://docs.gitlab.com/api/group_members/) |
| D-003 | Không đồng nhất tài khoản, quyền giáo viên, quyền tạo học liệu cá nhân | [GitLab Account limits](https://docs.gitlab.com/administration/settings/account_and_limit_settings/) + yêu cầu Giáo khoa |
| D-004 | Authorization biểu diễn bằng OpenFGA-style object/relation/tuple; kiểm theo scope đích | [OpenFGA Concepts](https://openfga.dev/docs/concepts) |
| D-005 | Có model bất biến, version được khóa và kịch bản test deny/allow | [OpenFGA Immutable Models](https://openfga.dev/docs/getting-started/immutable-models) |
| D-006 | Managed account có thể không có email, username có phạm vi tổ chức | [RFC 7643](https://www.rfc-editor.org/rfc/rfc7643) + yêu cầu Giáo khoa |
| D-007 | Bank là container chuyên cho học liệu; project có nhiều loại; các domain giữ chính sách riêng | Mở rộng Giáo khoa |
| D-008 | Tác giả khác chủ sở hữu; tạo ở organization project thì tổ chức sở hữu cả bản nháp | Mở rộng Giáo khoa |
| D-009 | Copy/share/contribution/transfer là hành động khác nhau; không tự chuyển quyền sở hữu | Mở rộng Giáo khoa |
| D-010 | Dữ liệu học sinh không tự trao đổi và không kế thừa quyền theo học liệu | Mở rộng Giáo khoa |
| D-011 | Data Space vật lý độc lập với Namespace logic; không dùng DB boundary để suy membership | Mở rộng Giáo khoa |
| D-012 | Chỉ có một baseline kiến trúc chính thức; thay đổi model cần sửa docs và test trước khi coi là chốt | Quản trị thiết kế Giáo khoa |

## 1. Quy tắc giải thích

- **Chuẩn tham khảo:** một thuộc tính được tài liệu GitLab, OpenFGA hoặc RFC xác nhận trong phạm vi sản phẩm/tiêu chuẩn đó.
- **Phần mở rộng Giáo khoa:** quyết định nội bộ nhằm đáp ứng bài toán giáo dục. Không gán các quy tắc này cho bên thứ ba.
- **Không chuẩn hóa bằng ví dụ:** bảng role, tên project hay các tuple mẫu không có nghĩa chính sách đã được triển khai.
- **Không tự thêm quyền:** loại resource mới mặc định deny cho đến khi domain policy, ownership và test được xác định.
- **Không hợp nhất ownership theo người dùng:** giáo viên hoạt động tại nhiều tổ chức không dẫn tới việc hợp nhất kho.

## 2. Điều kiện thay đổi baseline

Một thay đổi thuộc D-001 đến D-012 cần ghi: lý do, tài liệu nguồn, rủi ro cô lập dữ liệu, hành vi mới và cũ, tác động đối với user/membership/resource, test trước/sau và trạng thái chấp thuận. Nếu thay đổi authorization DSL thì phải thay đổi kịch bản `.fga.yaml`.

Các quyết định về schema database vật lý, routing storage, tên module và migration **không thuộc baseline này**; lập ADR riêng sau khi đội triển khai nghiên cứu code.

## 3. Những vấn đề chưa chốt có chủ đích

1. Bảng role mặc định chính xác và khả năng tự tạo custom role.
2. Số cấp subgroup/team; giới hạn project per namespace.
3. Có hỗ trợ cross-organization share chỉ-đọc theo thời gian thực hay chỉ copy bất biến ở phiên bản đầu.
4. Default license cho học liệu cá nhân → tổ chức và tổ chức → tổ chức.
5. Cơ chế chuyển ownership thực sự sau khi tài nguyên đã được sử dụng trong bài thi.
6. Phạm vi hỗ trợ SCIM ngoài provisioning User/Group.
7. Cơ chế đồng bộ membership và account linking khi nhiều vùng dữ liệu vật lý.

Không được ngầm giải quyết các mục này chỉ bằng suy luận từ GitLab hoặc OpenFGA.

## 4. Phương pháp duy trì

- Bản baseline nằm trong Git, thay đổi cùng revision với các test tương ứng.
- Khi cần nguồn GitLab/OpenFGA cố định ở mức byte, khóa **release tag + SHA đã được xác minh**, ghi bổ sung tại [REFERENCE_BASELINE.md](REFERENCE_BASELINE.md); không viện dẫn nhánh đang đổi theo thời gian làm snapshot.
- Không công bố API riêng của Giáo khoa chỉ bằng cách sao chép tài liệu API GitLab/OpenFGA.
- Không sao chép toàn bộ DB schema hay framework của GitLab.
