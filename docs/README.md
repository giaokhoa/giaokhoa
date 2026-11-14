# Chuẩn kiến trúc danh tính, không gian và tài nguyên của Giáo khoa

**Trạng thái:** Đặc tả mục tiêu, phiên bản tài liệu 0.1.0 (2026-11-14). Không mô tả các chức năng đã được triển khai.

Bộ tài liệu này cố định **một kiến trúc tham chiếu về tổ chức/ownership** và **một chuẩn máy đọc được về authorization**. Mọi thành phần là quyết định mục tiêu cho Giáo khoa; không tuyên bố tương thích API hoặc data model của bên thứ ba.

## Thứ tự đọc

1. [REFERENCE_BASELINE.md](REFERENCE_BASELINE.md) — nguồn chính thức, phạm vi áp dụng, quy tắc cố định phiên bản.
2. [DOMAIN_MODEL.md](DOMAIN_MODEL.md) — cấu trúc Namespace / Group / Project / Resource và thuật ngữ Giáo khoa.
3. [IDENTITY.md](IDENTITY.md) — danh tính chung, tài khoản tổ chức không email, thành viên đa tổ chức.
4. [AUTHORIZATION.md](AUTHORIZATION.md) — quyền theo namespace/project/resource; phạm vi của OpenFGA.
5. [RESOURCE_OWNERSHIP.md](RESOURCE_OWNERSHIP.md) — quyền sở hữu, version, chia sẻ và sao chép.
6. [DECISIONS.md](DECISIONS.md) — các quyết định cố định, ngoại lệ, câu hỏi chưa chốt.
7. [authz/model.fga](authz/model.fga) và [authz/model.fga.yaml](authz/model.fga.yaml) — mô hình quyền mẫu và kịch bản test để chốt hợp đồng (**OpenFGA CLI v0.9.0: 27/27 Check đạt**).

## Ranh giới của bộ tài liệu

- **Được quy định:** mô hình logic, nguyên tắc phân quyền, tình huống mong đợi, hợp đồng chuyển giao học liệu và liên kết tài khoản.
- **Không quy định:** tên bảng trong database hiện tại, tên module/code cũ, lộ trình migration, endpoint API nội bộ, tên thư viện bắt buộc phải cài, cấu hình triển khai, tiến độ.
- **GitLab** là mô hình tham chiếu về hierarchy và membership, **không** phải dependency sản phẩm.
- **OpenFGA** là ngôn ngữ/hợp đồng tham chiếu cho authorization, không có nghĩa hệ thống hiện đã chạy OpenFGA.
- **SCIM 2.0** chỉ là chuẩn giao tiếp provisioning danh tính; không phải giao thức đăng nhập và không phải hệ thống quyền học liệu.

## Thuật ngữ điều hành

- **BẮT BUỘC:** bất biến của domain đã chốt.
- **MẶC ĐỊNH:** hành vi tiêu chuẩn, chỉ được thay bởi policy được ghi nhận.
- **ĐỀ XUẤT:** bản thiết kế cần xác thực triển khai, chưa phải hành vi sản phẩm.
- **CHƯA CHỐT:** thiếu dữ kiện/đòi hỏi quyết định tiếp theo.

Mọi thay đổi kiến trúc phải nêu nguồn chính thức, thay đổi hợp đồng và bổ sung ca kiểm thử cho hành vi bị tác động; không dùng ví dụ tham khảo làm lý do tự bổ sung quyền truy cập.
