# AGENTS.md — Yêu cầu dành cho AI khi làm việc trong `packages/contracts`

## Nguồn sự thật (đọc trước khi sửa)

1. `README.md` của package này — quyết định nghiệp vụ còn hiệu lực của contracts.
2. Issue đặc tả của việc đang làm trên GitHub — nguồn sự thật cho việc đó: bối cảnh, phạm vi, các quyết định liên quan (viết trọn vẹn ngay trong issue) và tiêu chí nghiệm thu đều nằm trong chính issue. Không viện dẫn sổ quyết định, hồ sơ hay tệp ngoài repo làm căn cứ. Tài liệu trong repo mâu thuẫn với issue thì DỪNG, báo main chat.
3. `AGENTS.md` ở thư mục gốc của repo — quy định chung cho AI toàn repo, gồm chuẩn văn bản tự chứa cho issue và PR.

## Chuẩn ngôn ngữ

Code (định danh, tên hàm/biến/lớp, chuỗi kỹ thuật) viết bằng tiếng Anh. Cấm viết comment, gồm TSDoc/JSDoc, comment nội tuyến và comment mô tả luồng, trong mã nguồn hoặc cấu hình. Mã nguồn và cấu hình thực thi là nguồn sự thật duy nhất cho hành vi hiện hành; không dùng comment để lưu quyết định. Tài liệu trong repo và văn bản GitHub viết bằng tiếng Việt. Tuân thủ quy định tại `AGENTS.md` gốc.

## Ranh giới phạm vi

- 1 issue = 1 feat = 1 PR. Đổi schema ở đây gần như luôn kéo theo thay đổi ở api/web — các thay đổi đó thuộc cùng feat/PR, không tách PR riêng cho contracts.
- Chỉ mô tả hình dạng dữ liệu. Cần logic/ràng buộc chạy → đặt ở `apps/api`.

## Điều cấm package-specific

- Cấm đổi mã lỗi/khuôn ProblemDetails đã chốt (vd vượt trần tin nhắn = 400) theo cảm tính — mã lỗi là hợp đồng nghiệp vụ, đổi phải có quyết định trong sổ.
- Cấm thêm scope MCP mới (đặc biệt scope ghi bank chung) khi chưa có quyết định chốt.
- Cấm thêm khoá site-config không có quyết định nghiệp vụ đi kèm.
- Cấm dùng kiểu ngày giờ không biểu diễn được trong JSON Schema ở schema route (`z.date()` làm crash boot production qua Swagger) — dùng `z.iso.datetime(...)`.
- Cấm định nghĩa trùng một schema đã có: một miền một file, xuất qua `index.ts`.

## Kiểm chứng bắt buộc

- **Typecheck + build trước khi push**: `pnpm --filter @giaokhoa/contracts typecheck` rồi build để `dist` mới — sau đó mới typecheck các app tiêu thụ trong cùng feat.
- CI là cổng chính; kết luận CI chỉ từ LOG THẬT. Local chỉ test targeted (`contracts.spec`); suite nặng giữ khoá `flock /tmp/giaokhoa-heavy-suite.lock`.

## Kỷ luật test theo nghiệp vụ

- Test contracts phải kiểm các ràng buộc NGHIỆP VỤ của hình dạng (giới hạn độ dài, enum trạng thái đúng tập đã chốt, scope đúng tập đã chốt), không chỉ kiểm "schema parse được JSON mẫu". Nới một ràng buộc nghiệp vụ thì test phải fail.
- Đổi schema mà mọi test vẫn xanh nguyên = dấu hiệu test chưa bám nghiệp vụ — bổ sung test bám quyết định trong cùng lượt.

## Không viết comment trong code

Không thêm, giữ lại hoặc tái tạo comment trong code, kể cả TSDoc/JSDoc, comment JSX, comment giải thích flow và comment cấu hình. Thể hiện hành vi bằng code rõ ràng và test kiểm chứng. Code là nguồn sự thật duy nhất; comment có nguy cơ lệch code và tốn token. Quy tắc chung nằm trong `AGENTS.md` gốc.

## Bản đồ flow của package

- **Cấu trúc:** mỗi miền một file trong `src/`, xuất tập trung qua `src/index.ts`. Các miền hiện có: `identity.ts` (định danh/người dùng), `course.ts`, `classes.ts`, `assessment.ts`, `engagement.ts`, `platform.ts`, `site-config.ts`, `tenants.ts`, `centres.ts`, `control-plane.ts`, `system-bank.ts`, `curriculum.ts`, `books.ts`, `dashboard.ts`, `guardian.ts`, `health.ts`, `mcp.ts`, `rich-text.ts` (hợp đồng editor), `problem-details.ts` (hợp đồng lỗi), `ids.ts` (UUIDv7) và `auth-mail.ts` (payload/định dạng mail xác thực dùng chung). Test đặt cạnh source: `src/contracts.spec.ts` và `src/auth-mail.spec.ts`. Package không import DB, app hoặc UI; mọi consumers dùng entrypoint `@giaokhoa/contracts`.
- **Luồng dữ liệu:** schema Zod định nghĩa MỘT lần ở đây → build ra `dist` → `apps/api` dùng để kiểm chứng request/response ở biên, `apps/web` dùng làm kiểu + kiểm chứng dữ liệu hiển thị, `apps/worker` dùng các kiểu dùng chung khi xử lý nền. Đổi một hình dạng ở đây = đổi đồng thời ở cả ba app sau khi build lại `dist` (dist cũ là nguồn lỗi type giả kinh điển — xem mục kiểm chứng ở trên).
- Package **không** chứa logic chạy: ràng buộc trong schema là khai báo hình dạng; việc thực thi luật (gác quyền, cổng công bố…) nằm ở `apps/api` như mục ranh giới đã ghi.
