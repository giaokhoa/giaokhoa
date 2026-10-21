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
