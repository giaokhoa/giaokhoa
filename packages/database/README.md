# Tầng cơ sở dữ liệu

`@giaokhoa/database` sở hữu bảng Drizzle tại `src/schema/`, bộ chuyển đổi kho dữ liệu PostgreSQL và các bản di trú tại `drizzle/`. Các bảng dùng khi chạy được công khai qua `@giaokhoa/database/schema`; các kiểu dữ liệu lưu trữ qua `@giaokhoa/database/types`. Quy định chi tiết về ranh giới nghiệp vụ và kiểm thử nằm trong `AGENTS.md`.

## Quy trình tạo lược đồ xác thực

`src/schema/auth.generated.ts` do công cụ dòng lệnh Better Auth sinh ra; không sửa trực tiếp tệp được tạo. Lệnh chuẩn:

```sh
pnpm --filter @giaokhoa/api auth:generate
```

Lệnh thực hiện lần lượt các bước:

1. Better Auth đọc `apps/api/src/auth/auth.config.ts` và tạo `auth.generated.ts` theo các bảng dạng số nhiều `users`, `sessions`, `accounts`, `verifications` vì cấu hình `usePlural: true`.
2. `apps/api/scripts/patch-auth-schema.mjs` đổi giá trị sinh UUID mặc định `pg_catalog.gen_random_uuid()` thành `uuidv7()`, do PostgreSQL 18 chịu trách nhiệm cấp định danh.
3. Mã chạy của Better Auth dùng `generateId: false`; cấu hình phục vụ công cụ tạo lược đồ dùng kiểu `uuid` để khóa chính và khóa ngoại có kiểu PostgreSQL thống nhất.

Sau khi tái tạo lược đồ, đối chiếu bảng, ràng buộc và bản di trú trước khi áp dụng. Không tự ý sửa tệp sinh để che giấu sai lệch cấu hình.

## Bản di trú gốc

Trong giai đoạn phát triển **chưa giữ dữ liệu**, `drizzle/0000_baseline.sql` là bản di trú duy nhất cho cơ sở dữ liệu trống, bao gồm dữ liệu khởi tạo phân quyền theo vai trò (RBAC). Nhật ký `drizzle/meta/_journal.json` và ảnh chụp `drizzle/meta/0000_snapshot.json` phải khớp bản di trú cùng lược đồ hiện tại.

**Không áp dụng bản di trú gốc này lên cơ sở dữ liệu đã chạy các bản di trú cũ.** Môi trường thử nghiệm hoặc phát triển cũ cần được chuẩn bị lại trước khi dùng bản gốc mới; nếu phải giữ dữ liệu, cần có phương án chuyển đổi được phê duyệt riêng.

Các câu lệnh sinh và thực thi bản di trú được khai báo trong `packages/database/package.json`. Không đưa truy vấn bảng Drizzle vào gói nghiệp vụ hoặc bộ điều khiển HTTP.

## Phân quyền tách khỏi Better Auth

Better Auth chỉ sinh các bảng xác thực và những trường khóa tài khoản (`banned`, `banReason`, `banExpires`).
Trường `users.role` và `sessions.impersonatedBy` của plugin admin không còn trong lược đồ được sinh.
Các vai trò theo ngữ cảnh, cả `system` và `class`, được ghi trong `authz_role_assignments`;
`system:user` là quyền mặc định cho tài khoản đang hoạt động và không lưu thành lần cấp vai trò riêng.
Không tự thêm lại các trường quản trị cũ vào `auth.generated.ts`.

Người vận hành tạo quản trị viên ban đầu theo lệnh `authz:bootstrap` trong README gốc;
không đặt tài khoản quản trị mặc định trong dữ liệu khởi tạo. Chỉ khởi tạo trên cơ sở dữ liệu
đã có người dùng được xác minh và chưa có quản trị viên nào. Vai trò sau đó được cấp hoặc
thu hồi qua API có kiểm tra capability `role:assign_system`.

### Vai trò và quyền ghi đè theo Moodle

Lược đồ độc lập với Better Auth gồm `authz_roles` (định nghĩa), `authz_role_context_levels`
(các ngữ cảnh được phép gán), `authz_role_assignments` (gán theo người dùng/ngữ cảnh),
`authz_role_permissions` (capability mặc định) và `authz_role_overrides` (ghi đè role tại ngữ cảnh).
`authz_role_allow_assignments` và `authz_role_allow_overrides` là các ma trận quyền uỷ nhiệm.
Mỗi role được tính quyền riêng với ghi đè gần nhất trong cây hợp lệ; `PROHIBIT` không thể
bị cho phép ghi đè. Sau khi tính từng role, chỉ cần một `ALLOW` và không có `PROHIBIT`
để cho phép, còn `PREVENT` không tự phủ quyết `ALLOW` của role khác.

Lúc tạo bài giao phải tạo đồng thời ngữ cảnh `assignment` dưới ngữ cảnh `class`; thao tác
làm bài/chấm bài/công bố đọc quyền tại hoạt động đó, vẫn áp dụng điều kiện người nhận,
trạng thái ghi danh, thời hạn và lịch công bố. Các lệnh quản trị vai trò được kiểm capability
lần nữa ngay trong giao dịch PostgreSQL để tránh dùng quyền vừa bị thu hồi.

### Tính quyền học sinh theo ngữ cảnh và đồng bộ ghi danh

Vai trò `class:student` được gán ở `class` hoặc `assignment` đều phải đối chiếu trạng thái
lớp cha và bản ghi tham gia lớp của chính người dùng; đình chỉ hoặc rời lớp khiến vai trò
ở cả hai cấp không còn quyền, nhưng không cấp quyền ngược từ hoạt động lên lớp hay hoạt
động khác. Khi tự cấp vai trò cho chủ lớp hoặc cho học sinh sau khi ghi danh, kho dữ liệu
phải kiểm `authz_role_context_levels` tại ngữ cảnh `class`. Nếu cấu hình không cho phép,
giao dịch trả lỗi xung đột và không ghi danh/cấp vai trò trái cấu hình; việc thu hồi vai trò
không bị cản bởi thay đổi cấu hình cấp mới. Đây là ràng buộc nhất quán của Giáo khoa
cho các luồng cấp quyền tự động, không phải tuyên bố Moodle cấm mọi cách tự cấp vai trò.

### Đối chiếu truy cập và dữ liệu ngữ cảnh đã tồn tại

Khi học sinh xem tệp trong bài giao, kho dữ liệu trả **mã bài giao chứa tệp**, không trả
mã lớp; tầng nghiệp vụ đối chiếu capability tại đúng ngữ cảnh `assignment` và đúng
vùng nội dung `content` hoặc `solution`. Quy tắc xem lịch sử sau khi rời lớp không
được vượt qua một `PROHIBIT` hiện có hiệu lực ở ngữ cảnh bài giao.

Các ngữ cảnh `user` và `bank` mới được nối đến gốc `system:giaokhoa` ngay khi tạo.
Các thao tác tạo tệp và gắn tệp vào câu hỏi/ngữ liệu cũng sửa ngữ cảnh cũ thiếu cha
nếu đi qua bản ghi đó. Với các ngữ cảnh cũ **không được truy cập lại**, cần chạy
riêng `scripts/repair-context-parents.sql` sau khi sao lưu và rà soát trên bản sao
cơ sở dữ liệu, bằng quyền quản trị PostgreSQL. Tệp này là lệnh cập nhật dữ liệu
có thể chạy lặp lại; **không** phải bản di trú tự động, không áp dụng vào dữ liệu thật
trong PR này. Không được chạy lại `0000_baseline.sql` trên cơ sở dữ liệu hiện hữu.

Các thao tác thay đổi quyền và lưu/nộp/bắt đầu bài dùng khóa giao dịch advisory chung
để loại bỏ khoảng thời gian giữa việc kiểm tra quyền và ghi dữ liệu. Đây là giới hạn
thông lượng có chủ đích trong giai đoạn hiện tại; nếu cần tải lớn, thay bằng khóa
theo ngữ cảnh nhưng vẫn phải chứng minh thứ tự giao dịch không gây leo thang quyền.
