# Domain model — Namespace-based ownership

**Trạng thái:** Đặc tả logic dựa trên GitLab namespace hierarchy; tên miền, dữ liệu và project type là phần mở rộng của Giáo khoa.

## 1. Cây chuẩn

```text
Platform
├── Personal Namespace (thuộc một principal)
│   └── Project: thư viện / công việc cá nhân
│       └── Domain Resources
└── Organization Namespace (thuộc một organization)
    ├── Subgroup / Team
    │   └── Project
    └── Project
        ├── Bank, Folder hoặc Class tùy loại project
        └── Domain Resources
```

- **Namespace** là gốc phạm vi sở hữu. Cấp root chỉ có hai loại: `personal`, `organization`.
- **Organization** là pháp nhân/đơn vị nghiệp vụ; **Organization Namespace** là không gian nơi tài nguyên của tổ chức được đặt và quản trị.
- **Subgroup/Team** là nhóm nằm dưới organization; không được nhầm team với tenant/database.
- **Project** là vùng cộng tác và phân quyền nhỏ hơn namespace, tương đương vai trò project trong GitLab. Một project được gán `project_type`; không phải project nào cũng là ngân hàng.
- **Resource** là thực thể nghiệp vụ thuộc một project/namespace hoặc liên kết hợp lệ đến project đó.
- **Bank** là container chuyên biệt cho tài nguyên học liệu. **Class**, **Publication**, **Attempt**, **Grade** không bắt buộc nằm trong bank.

## 2. Ánh xạ thuật ngữ GitLab → Giáo khoa (chỉ ở cấp logic)

| GitLab               | Giáo khoa                               | Giới hạn                                                    |
| -------------------- | --------------------------------------- | ----------------------------------------------------------- |
| Instance             | Platform                                | Không quyết định cách chia database                         |
| User                 | Principal / Identity                    | Danh tính khác Credential                                   |
| User Namespace       | Personal Namespace / Không gian cá nhân | Có namespace không đồng nghĩa có quyền tạo nội dung cá nhân |
| Group Namespace      | Organization Namespace                  | Tổ chức là owner, không phải người tạo                      |
| Subgroup             | Team / Tổ bộ môn                        | Kế thừa quyền phải có policy rõ                             |
| Project              | Project / Khu vực cộng tác              | Có `project_type` theo domain                               |
| Group/Project Member | Membership                              | Status và role gắn với scope, không phải tài khoản toàn cục |
| Project Role         | Scoped Role                             | Không sao chép nguyên role GitLab                           |
| Project artifacts    | Domain Resources                        | Question, Exam, Matrix, Class, Publication...               |

Không ánh xạ các thuật ngữ này sang tên bảng, service hay API cụ thể.

## 3. Tập thực thể và quan hệ

- `Principal` 1–N `Credential`; principal có thể có nhiều membership.
- `Organization` 1–1 `Organization Namespace` ở bản tiêu chuẩn.
- `Personal Namespace` có đúng một principal sở hữu.
- `Namespace` 1–N `Project`; project thuộc một namespace, có thể nằm dưới một subgroup.
- `Membership` là quan hệ principal–scope có role và trạng thái hiệu lực.
- `Resource` có một owner namespace và phạm vi project xác định, nhưng có thể liên kết nhiều resource khác qua quan hệ nghiệp vụ.
- `DataSpace` là quyết định lưu trữ vật lý độc lập, không phải parent trong ownership tree.

Các quan hệ nghiệp vụ (đề chứa câu hỏi, publication sử dụng phiên bản đề, attempt thuộc publication, grade tham chiếu submission) không làm chuyển ownership.

## 4. Resource taxonomy

| Nhóm             | Loại điển hình                                  | Mặc định được chuyển giao   |
| ---------------- | ----------------------------------------------- | --------------------------- |
| Học liệu         | question, exam, matrix, document, rubric, media | Có, theo policy             |
| Container        | bank, folder, team, class                       | Không copy toàn bộ tự động  |
| Phân phối        | publication, assignment run, exam pin           | Không                       |
| Dữ liệu học sinh | attempt, submission, answer, grade              | Không                       |
| Quản trị         | membership, role, policy, setting               | Không                       |
| Hạ tầng          | data space, storage, job                        | Không thuộc domain học liệu |

Các domain giữ schema và vòng đời riêng. Không xây một bảng JSON tổng quát thay mọi loại tài nguyên.

## 5. Bất biến

1. `created_by` chỉ định tác giả thao tác, **không** mặc định là owner.
2. Tài nguyên được tạo trong project của tổ chức thuộc organization namespace ngay khi tạo, gồm cả bản nháp.
3. Một cá nhân tham gia nhiều tổ chức không tự động hợp nhất hoặc kế thừa quyền giữa chúng.
4. Personal namespace có thể tồn tại mà không được cấp `create` cho bất kỳ học liệu nào.
5. Việc đổi namespace của resource là chuyển giao nghiệp vụ có kiểm soát, không phải cập nhật trường owner tùy ý.
6. Project/Bank dùng làm parent phân quyền, còn các liên kết tham chiếu nghiệp vụ không tự động truyền quyền.
7. Dữ liệu nhạy cảm của học sinh không trở thành tài nguyên trao đổi chỉ vì cùng là `Resource`.

## 6. Phạm vi chưa chốt

- Cây subgroup có nhiều cấp hay giới hạn một cấp.
- Loại project nào là bắt buộc ở phiên bản sản phẩm đầu.
- Chính sách cho tổ chức tự tạo project, và quy trình xét duyệt project nhạy cảm.

Những lựa chọn này không được tự suy diễn thành tính năng từ model tham chiếu.
