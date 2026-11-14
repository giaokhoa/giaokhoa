# Reference baseline — nguồn tham chiếu kiến trúc

**Baseline nội bộ đề xuất:** 0.1.0. **Ngày đối chiếu:** 2026-11-14. Các URL dưới đây là nguồn công khai chính thức; nội dung trang trực tuyến có thể tiếp tục thay đổi. Baseline chưa được phê duyệt cho tới khi hoàn tất quy trình tại [DECISIONS.md](DECISIONS.md).

## 1. Một mô hình gốc cho cấu trúc sở hữu: GitLab Namespace Model

| Cấp độ                          | Nguồn                                                                       | Nội dung xác nhận                                                           |
| ------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Namespace                       | https://docs.gitlab.com/user/namespace/                                     | Hai loại namespace: user (cá nhân), group (tổ chức/nhóm); nhóm có subgroup  |
| Membership / role               | https://docs.gitlab.com/user/permissions/                                   | Quyền theo vai trò và phạm vi group/project                                 |
| Group membership API            | https://docs.gitlab.com/api/group_members/                                  | Thành viên trực tiếp, kế thừa và qua group được chia sẻ                     |
| Project membership API          | https://docs.gitlab.com/api/project_members/                                | Quyền thành viên ở project                                                  |
| Namespace API                   | https://docs.gitlab.com/api/namespaces/                                     | Dữ liệu namespace                                                           |
| OpenAPI 3                       | https://docs.gitlab.com/api/openapi/                                        | GitLab sinh đặc tả từ code; file nguồn là `doc/api/openapi/openapi_v3.yaml` |
| Giới hạn tạo tài nguyên cá nhân | https://docs.gitlab.com/administration/settings/account_and_limit_settings/ | Có thể đặt giới hạn tạo project cá nhân bằng 0, vẫn cho tạo trong group     |

**Phạm vi áp dụng:** hierarchy của owner, membership và project. **Không sao chép:** cấu trúc DB của GitLab, cách GitLab vận hành issue/repository, nguyên role hierarchy, pricing hay các API URL thành API của Giáo khoa.

**Phạm vi cố định:** nội dung thiết kế nội bộ được lưu theo revision Git; nguồn GitLab/OpenFGA dạng trang web chỉ được ghi URL và ngày đối chiếu, không tuyên bố đã khóa snapshot. Việc này không yêu cầu tích hợp API GitLab. Khi một việc sau phụ thuộc hành vi của phiên bản phần mềm cụ thể, việc đó phải xác minh release/tag và commit nguồn của đúng phần mềm trước khi triển khai; đây không phải điều kiện để coi URL hiện tại là bất biến. Không ghi SHA chưa xác minh.

## 2. Chuẩn authorization model: OpenFGA

| Thành phần       | Nguồn                                                                | Vai trò                                                           |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Model cơ sở      | https://openfga.dev/docs/concepts                                    | Object type, relation, tuple, Check                               |
| Ngữ cảnh tổ chức | https://openfga.dev/docs/modeling/organization-context-authorization | Quyền phụ thuộc organization đang làm việc                        |
| Quan hệ cha-con  | https://openfga.dev/docs/modeling/parent-child                       | Quyền qua relation từ container                                   |
| Model bất biến   | https://openfga.dev/docs/getting-started/immutable-models            | Mỗi lần ghi model tạo ID mới; nên chỉ rõ `authorization_model_id` |
| Test chính thức  | https://openfga.dev/docs/modeling/testing                            | File `.fga.yaml`, Check/ListObjects                               |
| Format test      | https://openfga.dev/docs/modeling/store-file-format                  | Định dạng Store File                                              |
| API công khai    | https://github.com/openfga/api                                       | Protobuf/API của OpenFGA                                          |
| CLI              | https://github.com/openfga/cli                                       | Kiểm tra model và chạy test                                       |

**Định dạng lựa chọn cho baseline:** OpenFGA DSL `schema 1.1` với source tại [authz/model.fga](authz/model.fga). Mỗi lần publish lên một OpenFGA store phải lưu `store_id` và `authorization_model_id` trong cấu hình môi trường. Không trỏ mặc định tới model mới nhất trong production.

**Công cụ tái lập:** OpenFGA CLI [v0.9.0](https://github.com/openfga/cli/releases/tag/v0.9.0), release commit `4b10e119c40a02dac0a665c9f8516b2ea3a36291`, ngày 2026-11-12. Tải binary phù hợp từ release chính thức, đối chiếu SHA-256 với `checksums.txt` của release rồi chạy ngoài repo; không thêm dependency dự án. Chạy từ gốc checkout, với binary đó có tên `fga` trong PATH:

```bash
fga version
fga model validate --file docs/authz/model.fga
fga model test --tests docs/authz/model.fga.yaml
```

**Kiểm chứng thiết kế:** validate trả `is_valid: true`; test đạt **8/8 nhóm và 163/163 Check**, exit code 0. Sáu Check về quyền sửa của tác giả có vai trò viewer/reviewer thất bại với biểu thức cũ `author and can_view from project`, rồi đạt sau khi yêu cầu quyền biên tập hiện hành. Không cần server OpenFGA, database ứng dụng hay credentials production cho các lệnh này.

Các file `.fga` vẫn là hợp đồng **mục tiêu**. CLI chỉ kiểm tra các quan hệ được khai báo; các bất biến ngoài model và tình huống identity/trao đổi học liệu phải được review theo [AUTHORIZATION.md](AUTHORIZATION.md), [IDENTITY.md](IDENTITY.md), [RESOURCE_OWNERSHIP.md](RESOURCE_OWNERSHIP.md). Chưa có kiểm chứng runtime cho các phần đó.

## 3. Identity provisioning: IETF SCIM 2.0

- **RFC 7643 (Core Schema):** https://www.rfc-editor.org/rfc/rfc7643 — `userName` bắt buộc và duy nhất trong phạm vi service provider; thuộc tính `emails` là tùy chọn.
- **RFC 7644 (Protocol):** https://www.rfc-editor.org/rfc/rfc7644 — REST provisioning User/Group, lọc, cập nhật, đồng bộ.
- Hai RFC là tham chiếu **bất biến theo số RFC**; nếu RFC được cập nhật thì phải ghi rõ quyết định chấp nhận bản cập nhật.
- SCIM không quy định hình thức login, bảo mật phiên, quyền truy cập đề thi hoặc cách chuyển quyền sở hữu.

## 4. Quy tắc duy trì nguồn cố định

1. Mọi assertion về bên thứ ba phải đi kèm URL chính thức và phân biệt **sự kiện tài liệu hóa** với **quyết định riêng của Giáo khoa**.
2. Không sửa bản thiết kế vì một URL trực tuyến đổi nội dung; thay đổi phải có quyết định phiên bản mới trong [DECISIONS.md](DECISIONS.md).
3. Khi triển khai công nghệ thật: khóa commit/tag thư viện/API source, lưu version của tool kiểm thử, và kiểm chứng artifact tại commit của chính repo.
4. Không gọi một mô hình giả lập trong docs là API runtime đã được phát hành.
