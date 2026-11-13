# AGENTS.md — Yêu cầu dành cho AI khi làm việc trong `packages/config`

## Nguồn sự thật (đọc trước khi sửa)

1. `README.md` của package này — phạm vi và quyết định còn hiệu lực của config.
2. Issue đặc tả của việc đang làm trên GitHub — nguồn sự thật cho việc đó: bối cảnh, phạm vi, các quyết định liên quan (viết trọn vẹn ngay trong issue) và tiêu chí nghiệm thu đều nằm trong chính issue. Không viện dẫn sổ quyết định, hồ sơ hay tệp ngoài repo làm căn cứ. Tài liệu trong repo mâu thuẫn với issue thì DỪNG, báo main chat.
3. `AGENTS.md` ở thư mục gốc của repo — quy định chung cho AI toàn repo, gồm chuẩn văn bản tự chứa cho issue và PR.

## Chuẩn ngôn ngữ

Code (định danh, tên hàm/biến/lớp, chuỗi kỹ thuật) viết bằng tiếng Anh. Cấm viết comment, gồm TSDoc/JSDoc, comment nội tuyến và comment mô tả luồng, trong mã nguồn hoặc cấu hình. Mã nguồn và cấu hình thực thi là nguồn sự thật duy nhất cho hành vi hiện hành; không dùng comment để lưu quyết định. Tài liệu trong repo và văn bản GitHub viết bằng tiếng Việt. Tuân thủ quy định tại `AGENTS.md` gốc.

## Ranh giới phạm vi

- 1 issue = 1 feat = 1 PR. Package chỉ chứa tsconfig dùng chung.

## Điều cấm package-specific

- Cấm thêm code runtime, hằng số, hay bất kỳ logic/nghiệp vụ nào vào package này.
- Cấm nới lỏng kỷ luật kiểu dùng chung (vd tắt `strict`, nới `noUncheckedIndexedAccess` nếu đang bật) để "cho qua" lỗi type ở một app — sửa lỗi ở app đó; đổi kỷ luật chung phải là quyết định riêng, áp có kiểm chứng trên toàn monorepo.
- Cấm gộp hai dòng TypeScript (Nest/React) thành một khi chưa có quyết định thay thế quyết định tách hai dòng hiện hành.

## Kiểm chứng bắt buộc

- Đổi tsconfig ở đây = đổi điều kiện biên dịch của MỌI package: trước khi push phải chạy typecheck của ít nhất một app mỗi dòng (`@giaokhoa/api` cho dòng Nest, `@giaokhoa/web` cho dòng React) và ghi kết quả vào bàn giao.
- CI là cổng chính; kết luận CI chỉ từ LOG THẬT.

## Kỷ luật test theo nghiệp vụ

- Package không có test nghiệp vụ (và không được bịa test cho có): kiểm chứng của package này là typecheck của các app tiêu thụ, ghi ở mục trên.

## Không viết comment trong code

Không thêm, giữ lại hoặc tái tạo comment trong code, kể cả TSDoc/JSDoc, comment JSX, comment giải thích flow và comment cấu hình. Thể hiện hành vi bằng code rõ ràng và test kiểm chứng. Code là nguồn sự thật duy nhất; comment có nguy cơ lệch code và tốn token. Quy tắc chung nằm trong `AGENTS.md` gốc.

## Bản đồ của package

- `tsconfig/base.json` — nền dùng chung cho mọi package (target ES2023, `strict: true` và các kỷ luật kiểu nền).
- `tsconfig/nest.json` — kế thừa `base.json`, dòng backend (module CommonJS, moduleResolution Node10): `apps/api`, `apps/worker`, `packages/db` dùng qua `extends: "@giaokhoa/config/tsconfig/nest.json"`.
- `tsconfig/react.json` — kế thừa `base.json`, dòng frontend (module ESNext, moduleResolution bundler): `apps/web`, `packages/editor`, `packages/ui` dùng qua `extends: "@giaokhoa/config/tsconfig/react.json"`.
- `packages/contracts` dùng thẳng `base.json`. Hai dòng Nest/React tách nhau theo quyết định tách hai dòng (xem điều cấm ở trên: không gộp hai dòng khi chưa có quyết định thay thế).
- Luồng tác động: đổi một dòng ở đây → điều kiện biên dịch của **mọi** package tiêu thụ thay đổi → bắt buộc kiểm chứng typecheck ở cả hai dòng như mục "Kiểm chứng bắt buộc" đã ghi.
