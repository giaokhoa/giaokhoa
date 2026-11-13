# Gói chương trình theo phiên bản (issue #17)

## Quy tắc nghiệp vụ

Mỗi **trung tâm có kho PostgreSQL riêng** được gửi ảnh chụp chương trình (môn, khối, cây node, yêu cầu cần đạt — YCCĐ) vào kho ngân hàng hệ thống. Bản gửi có trạng thái `pending`, kèm mã phiên bản duy nhất, slug của trung tâm nguồn, số YCCĐ và checksum SHA-256 từ nội dung chuẩn hoá. Ảnh chụp này **không tự làm thay đổi** bất kỳ trung tâm nào.

Biên tập viên có quyền `systembank:review` tại **context hệ thống của platform** đọc nội dung và chọn **phê duyệt** (`published`) hoặc **từ chối** (`rejected`, kèm lý do). Quyền duyệt và xem hàng chờ chỉ dùng tại **địa chỉ platform**, không tại hostname trung tâm (kể cả site admin của kho riêng). Quyết định được ghi một lần; không được chuyển bản đã từ chối thành phát hành hoặc sửa lại nội dung bản đã phát hành. Các bản chưa duyệt/từ chối không xuất hiện trong danh mục gói có thể cài. Mỗi lần phát hành thay đổi nội dung phải dùng **mã phiên bản mới**.

Quản trị trung tâm có quyền `tenant:manage` tại context của trung tâm, trong **hostname và kho riêng đã đăng ký**, được chọn và cài một bản đã phát hành. Trung tâm dùng kho chung không được gửi/cài bằng luồng này, để tránh hai trung tâm vô tình cùng sửa một chương trình.

## HTTP API

Các đường đều ở tiền tố `/api/v1/system-bank/outcome-packages`:

| Phương thức | Đường               | Chức năng và quyền                                        |
| ----------- | ------------------- | --------------------------------------------------------- |
| `POST`      | `/`                 | Trung tâm gửi `{version, scope, mappings}`, tạo `pending` |
| `GET`       | `/`                 | Khám phá **chỉ** các phiên bản `published`                |
| `GET`       | `/mine`             | Trung tâm xem bản đã gửi và lý do từ chối                 |
| `GET`       | `/installed`        | Trung tâm xem lịch sử đã cài, checksum và phiên bản trước |
| `GET`       | `/pending`          | Hàng chờ của biên tập viên hệ thống                       |
| `GET`       | `/review/:version`  | Biên tập viên xem cây/YCCĐ, checksum của bản chưa công bố |
| `POST`      | `/:version/approve` | Biên tập viên kiểm tra toàn vẹn rồi phát hành             |
| `POST`      | `/:version/reject`  | Biên tập viên từ chối với `{reason}` bắt buộc             |
| `GET`       | `/:version`         | Đọc **chỉ** bản đã phát hành                              |
| `POST`      | `/:version/install` | Cài bản phát hành nguyên tử vào kho trung tâm             |

Giao diện ở **Quản trị chương trình GDPT 2018**, mục **Gói chương trình dùng chung**. Quản trị trung tâm chọn phạm vi, gửi bản chụp, theo dõi trạng thái và chọn phiên bản để cài. Biên tập viên xem nội dung theo môn/khối/node/YCCĐ trước khi quyết định.

## Bảo toàn dữ liệu và giao dịch

Trước khi ghi, service so lại checksum, số YCCĐ, phạm vi môn, định danh duy nhất và các liên kết chương trình → node cha/con → YCCĐ; chặn cây có chu trình, node sai chương trình và gói thiếu liên kết. Cài trong **một transaction của đúng kho trung tâm** với khoá tư vấn giao dịch để xử lý hai yêu cầu đồng thời. Đối chiếu toàn bộ chương trình, node và YCCĐ theo ID **và nội dung** với kho đích trước khi chèn; cùng môn/khối khác ID hoặc cùng ID khác nội dung đều trả xung đột rõ ràng, không tự gộp.

Khi văn bản YCCĐ thay đổi giữa v1 và v2, nguồn phải phát hành YCCĐ với **ID mới** và gửi kèm ánh xạ `fromOutcomeId → toOutcomeId`. Ánh xạ chỉ để truy vết, không tự đổi quan hệ `question_learning_outcomes` hoặc đề đang dùng ID v1; người quản trị quyết định cập nhật thủ công khi phù hợp. Nếu gói mới sử dụng ID cũ nhưng nội dung khác, việc cài bị từ chối và rollback, không ghi đè.

Node cha được chèn trước con; YCCĐ được chèn sau cây. Các ID đã tồn tại và đồng nhất được giữ nguyên, không `UPDATE` văn bản nguồn tại chỗ. Vì vậy câu hỏi/đề đã tham chiếu đến ID cũ không bị viết ngược khi bản phát hành mới xuất hiện. Dòng `outcome_package_installs` ghi `package_version`, `package_checksum`, `previous_version` theo phạm vi, người cài và thời điểm trong **cùng transaction**. Gọi lại cùng phiên bản trả `unchanged` và không cập nhật lại vết cài hay nhân bản cây.

### Nâng cấp database

Migration kho hệ thống thêm trạng thái kiểm duyệt và tên/vị trí môn trong ảnh chụp; các gói đã có trước nâng cấp được đánh dấu `published` để giữ lịch sử. Migration kho trung tâm bổ sung `outcome_package_installs.package_checksum` (bản ghi cũ có giá trị rỗng vì trước đó không lưu checksum; lần gọi lại cùng phiên bản chỉ bổ sung checksum đã xác thực, không đổi nội dung và thời điểm cài). Script đảm bảo bảng vệ tinh cũng hỗ trợ nâng cấp bảng cũ không có cột này và tạo bảng mới với cột từ đầu. Không chuyển dữ liệu của trung tâm A sang trung tâm B, không sửa FK thành cascade và không tự cài khi nguồn đổi.

## Kiểm chứng

- Integration: `test/integration/system-bank/system-bank.int-spec.ts`, gồm review, checksum, retry, rollback, xung đột và **hai database A/B giữ phiên bản độc lập**.
- E2E HTTP: `test/e2e/system-bank/system-bank-flow.e2e-spec.ts`, ca **HTTP gói chương trình** kiểm tra ẩn bản chờ, quyền reviewer và phát hành qua endpoint thật.
- E2E HTTP đầy đủ: `test/e2e/system-bank/programme-package-flow.e2e-spec.ts` cấp phát **hai trung tâm với hai PostgreSQL riêng**, gửi bản gói qua HTTP ở A, ngăn A tự duyệt, duyệt tại platform, cài v1/v2 qua HTTP ở B, kiểm tra liên kết câu/YCCĐ v1 không bị sửa ngược, retry và từ chối gửi/cài tại kho chung.
- Unit API: `src/modules/system-bank/system-bank-centre-tables.spec.ts`, kiểm tra DDL đảm bảo bảng vệ tinh.
- Repository integration: `packages/db/src/repositories/system-bank{,-centre}.int-spec.ts`, kiểm tra contract mới, duyệt xuất bản và giữ nguyên vết cài khi retry. `pnpm --filter @giaokhoa/db typecheck` là bước kiểm chứng CI bắt buộc.
- Unit web: `src/features/admin-curriculum/components/programme-package-panel.spec.tsx`, kiểm tra gửi/cài theo vai trung tâm và duyệt theo vai biên tập viên.
- Các test chạy với database cô lập và khoá `flock /tmp/giaokhoa-heavy-suite.lock` theo quy định repo.

Phạm vi xử lý rút nguồn và thông báo khi nguồn mới/rút thuộc issue #18, không tự đổi bản đang dùng của trung tâm ở issue này.
