# Bộ dữ kiện nghiệm thu theo story

Thư mục này dành cho các fixture Keycloak **test/review**, không chạy trong production
và không nhập đè realm hoặc dữ liệu DEV. Bootstrap Keycloak và API seed
được triển khai riêng; thư mục này chỉ chứa fixture nghiệm thu.

`native-gate.json` là fixture native authorization cố định; `install-native-gate.sh` tạo actor, realm group,
resource/scope và policy thật chỉ trên realm tạm do `verify-native.sh` khởi động.
Hai test client dùng **Authorization Code + PKCE S256** trong Chromium thật,
tắt Direct Access Grants và không thay đổi `giaokhoa-web`. Token của actor được
lưu ở file tạm quyền 0600, sau khi chạy sẽ được dọn cùng stack.
Để chạy `verify-native.sh`, cài trước `npm --prefix frontend ci` và
`cd frontend && npx playwright install chromium`.

Mỗi scenario set phải tạo dữ kiện của mình độc lập (ID/người dùng/workspace mới),
không dựa vào thứ tự chạy hoặc trạng thái còn lại từ story trước:

| Set | Nguồn dữ kiện cần có |
| --- | --- |
| `us1-identity` | Account tự đăng ký đã/chưa xác minh, account center-issued không email, personal workspace |
| `us2-centers` | Operator, center A/B, owner/manager/teacher, gói center và personal độc lập |
| `us3-teaching` | Lớp L1/L2, khóa ba môn, giáo viên chéo môn và học sinh ghi danh từng môn |
| `us4-guardians` | Phụ huynh approved/pending/revoked, con ở A/B, result draft/published |
| `us5-resources` | Resource/version hệ thống, personal và center, correction, revocable/long-term grant |
| `us6-subscriptions` | Gói valid/expired, bài giao trước hết hạn, trường hợp thu hồi quyền |
| `us7-sharing` | Grant, fork/dependency, recipient và source bị thu hồi |

Cùng một directory mẫu phải dùng UUID nghiệp vụ và Keycloak ID opaque riêng.
Mọi mutation về quyền phải qua PAP/PEP và native Keycloak PDP; fixture không cấp
quyền bằng cờ mock, không ghi password/token, và không tự đánh dấu gate đạt.
