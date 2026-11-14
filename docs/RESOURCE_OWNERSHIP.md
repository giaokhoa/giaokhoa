# Resource ownership, versioning và trao đổi học liệu

**Mô hình chủ:** GitLab-like namespace/project ownership. **Mở rộng riêng của Giáo khoa:** quy tắc content version, dependency và resource exchange cho giáo dục.

## 1. Ownership khác author và permissions

| Thuộc tính logic          | Diễn giải                                 |
| ------------------------- | ----------------------------------------- |
| `owner_namespace`         | Phạm vi **sở hữu** tài nguyên             |
| `project`                 | Nơi vận hành/chứa tài nguyên và cấp quyền |
| `created_by`              | Principal tạo nội dung                    |
| `original_author`         | Tác giả nguồn khi được sao chép           |
| `source_resource/version` | Nguồn gốc phiên bản để kiểm toán          |
| `resource_version`        | Nội dung bất biến đã công bố              |
| `storage_target`          | Nơi lưu vật lý, độc lập ownership logic   |

Bản nháp trong project Trung tâm A vẫn **thuộc A**. Tên “Bản nháp của tôi” chỉ có nghĩa người đó đang biên tập, không phải người đó sở hữu tài nguyên.

## 2. Chính sách theo loại tài nguyên

| Loại                         | Share access                                | Copy/Import                         | Export ra ngoài |
| ---------------------------- | ------------------------------------------- | ----------------------------------- | --------------- |
| Question                     | Có điều kiện                                | Có                                  | Có điều kiện    |
| Exam                         | Có, có kiểm soát đáp án                     | Có, kèm dependency                  | Hạn chế nghiêm  |
| Matrix                       | Có                                          | Có                                  | Có điều kiện    |
| Document / rubric / template | Có                                          | Có                                  | Có điều kiện    |
| Bank                         | Phân quyền thành viên                       | Không copy tùy tiện toàn bộ         | Không mặc định  |
| Class / roster               | Chỉ người có quyền nghiệp vụ                | Không copy hồ sơ học sinh hàng loạt | Không mặc định  |
| Publication                  | Chia sẻ quyền tham gia                      | Không chuyển attempt theo           | Không mặc định  |
| Attempt / submission / grade | Chỉ chủ thể hoặc người có quyền chuyên biệt | Không                               | Không           |

## 3. Các thao tác phân biệt rõ

**Share access:** cấp quyền đọc/sử dụng phiên bản nguồn trong phạm vi có hiệu lực; không chuyển ownership, không tự cấp quyền sao chép.

**Copy:** tạo resource ID mới dưới owner namespace đích, với nội dung phiên bản được phép sao chép và provenance. Các thay đổi tương lai của nguồn không làm thay đổi bản sao.

**Contribution:** đề nghị gửi một resource version tới project đích; bên nhận xét duyệt, kiểm tra nội dung và nhập bản sao khi chấp nhận. Người gửi phải có quyền đề xuất/export; bên nhận phải có quyền approve/import. Pending không tạo quyền dùng chính thức.

**Transfer ownership:** thao tác khác copy, có hợp đồng riêng về quyền tác giả, học liệu đang dùng, tham chiếu và revocation; không tự phát sinh từ việc chuyển project hoặc xóa membership.

## 4. Bất biến phiên bản và dependency

- Exam đã giao phải dùng version được pin; sửa đề gốc không được lén thay lượt thi đang diễn ra.
- Copy Exam phải xét Question Versions, đáp án, media, trật tự, thang điểm và cấu hình; không chỉ copy bản ghi đề.
- Copy Matrix phải xét cấu trúc ô, phân bố kiến thức, loại câu, thang điểm và tham chiếu taxonomy.
- Copy Question phải xét nội dung rich text, media, đáp án, thang điểm và metadata được cho phép.
- Mỗi gói copy/transfer có resource type, source namespace, source resource/version, author, target, content hash, manifest dependency và licensing/restrictions.
- Không tự copy student submissions, answers, grades hoặc roster theo đề.
- Khi dùng câu hỏi nguồn ở nhiều đề, **quyền dùng** và **quyền xem đáp án** vẫn có thể khác nhau.

## 5. Trao đổi liên namespace/database

```text
Nguồn: kiểm quyền export/share
    → chốt resource version
    → tạo package bất biến, checksum, metadata nguồn
    → bên nhận kiểm quyền accept/import và chính sách
    → import dependency hợp lệ, sinh ID mới
    → audit, gửi kết quả
```

- Không dùng transaction xuyên nhiều database như giả định mặc định.
- Luồng copy/import cần idempotency, timeout/retry, kiểm chống lặp và audit.
- Quyền trên nguồn không tự truyền sang bản sao; bản sao chịu policy đích.
- Thu hồi share có thể chấm dứt quyền truy cập **tương lai**, nhưng không tự xóa bản sao đã chuyển giao hợp lệ. Điều kiện license phải xác định trước lúc chia sẻ.
- Bên nhận không được đọc trực tiếp database nguồn chỉ vì có link/ID tài nguyên.
- Export đề thi trước khi công bố có thể gây lộ đáp án; phải được bảo vệ bằng policy riêng.

## 6. Quy tắc khi người dùng rời tổ chức

- Tài nguyên thuộc tổ chức vẫn tồn tại và có thể được giao lại cho người biên tập khác.
- Người rời tổ chức mất khả năng truy cập phát sinh từ membership/role của tổ chức đó.
- Kho cá nhân độc lập không bị tổ chức tiếp quản tự động.
- Mọi dữ liệu học tập đã phát sinh vẫn thuộc scope nghiệp vụ được định nghĩa, không đổi owner chỉ vì người chấm/người soạn rời đi.

## 7. Chưa chốt

- License mặc định đối với bản sao được xuất từ organization namespace.
- Khi share không copy: dùng proxy kiểm quyền tức thời, cached snapshot có thời hạn hay cơ chế khác.
- Hỗ trợ sửa đổi bản sao và việc đề xuất cập nhật trở lại nguồn.
- Quy tắc chuyển ownership thật sự (khác copy) cho tài nguyên đã có lịch sử sử dụng.

Không được suy các trường hợp trên là “đã hỗ trợ” từ tài liệu nền.

## 8. Tình huống nghiệm thu thiết kế

Đây là các hợp đồng đầu vào/kết quả mong đợi để review tài liệu; model FGA mẫu chưa biểu diễn share/copy/import hoặc kiểm chứng trao đổi dữ liệu thật. Các quyền nguồn và đích bên dưới là quyền theo resource type và domain policy, không được thay bằng `can_share_external` trên project.

| Mã   | Đầu vào / thao tác                                                                 | Kết quả mong đợi                                                                                                                                                                |
| ---- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | A cấp quyền share một phiên bản học liệu cho B                                     | Owner và resource ID vẫn thuộc A; B chỉ có quyền được cấp, không tự có copy/export. Chỉ thực thi khi policy và cơ chế share đã được duyệt                                       |
| R-02 | Copy phiên bản v1 từ A vào B, đủ quyền xuất nguồn và nhập đích, license cho phép   | Tạo ID mới thuộc B, giữ source ID/version, tác giả và dependency được phép; A sửa thành v2 không đổi bản sao v1                                                                 |
| R-03 | Copy có quyền nguồn nhưng thiếu quyền nhập B, hoặc ngược lại                       | Từ chối chuyển giao; không có bản sao dùng được tại đích chỉ vì một phía cho phép                                                                                               |
| R-04 | Contribution còn pending; sau đó người có quyền approve/import tại B chấp nhận     | Pending không tạo quyền dùng chính thức; chấp nhận phải kiểm quyền nguồn/đích và policy còn hiệu lực rồi nhập bản sao. Người không có quyền duyệt không làm thay đổi trạng thái |
| R-05 | Copy đề có câu hỏi, media, bài làm, câu trả lời học sinh, điểm và roster liên quan | Chỉ mang nội dung/đáp án chuẩn và dependency học liệu được phép; không mang bài làm, câu trả lời học sinh, điểm hay roster                                                      |
| R-06 | A thu hồi share sau khi B đã có bản sao được chuyển giao hợp lệ                    | Dừng quyền truy cập nguồn phát sinh từ share; không tự xóa bản sao hợp lệ. License phải được xác định trước khi chuyển giao                                                     |
| R-07 | Tác giả rời A hoặc bị hạ quyền sau khi tạo bản nháp                                | Resource vẫn thuộc A, không chuyển về cá nhân; authorship được giữ nhưng không tự cấp quyền sửa                                                                                 |
| R-08 | Đề v1 đang được dùng trong lượt thi; sửa nội dung đề gốc                           | Lượt thi vẫn dùng v1; chỉnh sửa tạo phiên bản khác theo domain policy, không đổi nội dung đã pin                                                                                |

Chưa xác định license hoặc cơ chế share không được diễn giải thành cho phép mặc định. Phạm vi bị chặn bởi các quyết định còn mở được ghi tại [DECISIONS.md](DECISIONS.md).
