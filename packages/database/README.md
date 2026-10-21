# Tầng cơ sở dữ liệu

`@giaokhoa/database` sở hữu bảng Drizzle tại `src/schema/`, bộ chuyển đổi kho dữ liệu PostgreSQL và các bản di trú tại `drizzle/`. Các bảng dùng khi chạy được công khai qua `@giaokhoa/database/schema`; các kiểu dữ liệu lưu trữ qua `@giaokhoa/database/types`. Quy định chi tiết về ranh giới nghiệp vụ và kiểm thử nằm trong `AGENTS.md`.

## Lược đồ xác thực

`src/schema/auth.generated.ts` được sinh từ cấu hình Better Auth của `apps/api` bằng
lệnh `pnpm --filter @giaokhoa/api auth:generate`. Không sửa trực tiếp tệp được sinh;
các bước sinh và hiệu chỉnh định danh thuộc cấu hình và công cụ của ứng dụng API.

## Bản di trú gốc

Trong giai đoạn phát triển **chưa giữ dữ liệu**, `drizzle/0000_baseline.sql` là bản di trú duy nhất cho cơ sở dữ liệu trống, bao gồm dữ liệu khởi tạo phân quyền theo vai trò (RBAC). Nhật ký `drizzle/meta/_journal.json` và ảnh chụp `drizzle/meta/0000_snapshot.json` phải khớp bản di trú cùng lược đồ hiện tại.

**Không áp dụng bản di trú gốc này lên cơ sở dữ liệu đã chạy các bản di trú cũ.** Môi trường thử nghiệm hoặc phát triển cũ cần được chuẩn bị lại trước khi dùng bản gốc mới; nếu phải giữ dữ liệu, cần có phương án chuyển đổi được phê duyệt riêng.

Các câu lệnh sinh và thực thi bản di trú được khai báo trong `packages/database/package.json`. Không đưa truy vấn bảng Drizzle vào gói nghiệp vụ hoặc bộ điều khiển HTTP.

## Dữ liệu phân quyền

`src/schema/authorization.ts` định nghĩa dữ liệu vai trò, quyền và ngữ cảnh độc lập
với bảng xác thực do Better Auth sinh ra. Các bộ chuyển đổi trong `src/repositories/`
phụ trách truy cập, tính nhất quán và giao dịch theo hợp đồng của gói ứng dụng.

Công cụ thao tác dữ liệu nằm tại `scripts/`; các điều kiện và biện pháp an toàn
của từng thao tác được ghi cùng tập lệnh hoặc hàm xử lý tương ứng.
