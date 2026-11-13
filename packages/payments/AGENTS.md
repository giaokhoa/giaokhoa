# AGENTS.md — Yêu cầu dành cho AI khi làm việc trong `packages/payments`

## Nguồn sự thật (đọc trước khi sửa)

1. `README.md` của package này — phạm vi bề mặt dùng chung và quyết định về các cổng xuyên module còn hiệu lực.
2. Issue đặc tả của việc đang làm trên GitHub — nguồn sự thật cho việc đó: bối cảnh, phạm vi, các quyết định liên quan (viết trọn vẹn ngay trong issue) và tiêu chí nghiệm thu đều nằm trong chính issue. Không viện dẫn sổ quyết định, hồ sơ hay tệp ngoài repo làm căn cứ. Tài liệu trong repo mâu thuẫn với issue thì DỪNG, báo main chat.
3. `AGENTS.md` ở thư mục gốc của repo — quy định chung cho AI toàn repo, gồm chuẩn văn bản tự chứa cho issue và PR.

## Chuẩn ngôn ngữ

Code (định danh, tên hàm/biến/lớp, chuỗi kỹ thuật) viết bằng tiếng Anh. Cấm viết comment, gồm TSDoc/JSDoc, comment nội tuyến và comment mô tả luồng, trong mã nguồn hoặc cấu hình. Mã nguồn và cấu hình thực thi là nguồn sự thật duy nhất cho hành vi hiện hành; không dùng comment để lưu quyết định. Tài liệu trong repo và văn bản GitHub viết bằng tiếng Việt. Tuân thủ quy định tại `AGENTS.md` gốc.

## Ranh giới phạm vi

- 1 issue = 1 feat = 1 PR.
- Package này là bề mặt DÙNG CHUNG cho nhiều tiến trình: cấm import bất cứ thứ gì từ `apps/*`. Phụ thuộc cho phép: kho trung tâm và handle Kysely qua `@giaokhoa/db`, khung NestJS (`@nestjs/common`). Cấm import trực tiếp `kysely` — mọi kiểu handle và `sql` đều lấy qua `@giaokhoa/db`.
- Ba hiệu ứng xuyên module của luồng matching (kích hoạt ghi danh, kích hoạt ghi danh cấp lớp, đối chiếu đích và xác nhận chi) chỉ được gọi qua các cổng ở `src/sepay-matching-ports.ts` — cấm import trực tiếp service của module nghiệp vụ khác vào package, và cấm chép logic của các hiệu ứng đó vào package.

## Điều cấm package-specific

- Cấm tạo bản sao thứ hai của logic matching hoặc của logic ba hiệu ứng xuyên module ở bất kỳ đâu (package này, apps/api, apps/worker): luật nghiệp vụ chỉ tồn tại đúng một bản.
- Cấm đổi ngữ nghĩa matching đã chốt (luật khớp 3 điều kiện, phép đối chiếu đích phía server, thứ tự kích hoạt TRƯỚC nhịp lật `succeeded`, nhánh `needs_review` không kích hoạt gì) trong một việc trích xuất/di chuyển — đổi ngữ nghĩa phải là việc riêng có đặc tả riêng.
- Cấm đưa phía tiếp nhận IPN (controller, xác thực, ghi sự kiện) hoặc facade thanh toán vào package này khi chưa có quyết định riêng: chúng ở nguyên phía apps/api.

## Kiểm chứng bắt buộc

- **Typecheck + test của package trước khi push**: `pnpm --filter @giaokhoa/payments typecheck` và `pnpm --filter @giaokhoa/payments test`.
- Build lại `dist` của package trước khi typecheck apps/api trong cùng feat (dist cũ = lỗi type giả kinh điển).
- CI là cổng chính; kết luận CI chỉ từ LOG THẬT.

## Kỷ luật test theo nghiệp vụ

- `src/sepay-matching.service.spec.ts` là test đặc trưng hoá ghim hành vi matching: đổi hành vi matching đã chốt thì ca tương ứng phải fail — nếu đổi mà test vẫn xanh, test viết sai và phải sửa cùng lượt. Không yếu hoá khẳng định để cho qua.
- Hành vi đầu-cuối trên DB thật do các suite e2e payments của apps/api ghim; số ca của các suite đó không được giảm khi sửa package này.

## Không viết comment trong code

Không thêm, giữ lại hoặc tái tạo comment trong code, kể cả TSDoc/JSDoc, comment JSX, comment giải thích flow và comment cấu hình. Thể hiện hành vi bằng code rõ ràng và test kiểm chứng. Code là nguồn sự thật duy nhất; comment có nguy cơ lệch code và tốn token. Quy tắc chung nằm trong `AGENTS.md` gốc.
