# AGENTS.md — Yêu cầu dành cho AI khi làm việc trong `packages/editor`

## Nguồn sự thật (đọc trước khi sửa)

1. `README.md` của package này — quyết định nghiệp vụ còn hiệu lực của editor.
2. Issue đặc tả của việc đang làm trên GitHub — nguồn sự thật cho việc đó: bối cảnh, phạm vi, các quyết định liên quan (viết trọn vẹn ngay trong issue) và tiêu chí nghiệm thu đều nằm trong chính issue. Không viện dẫn sổ quyết định, hồ sơ hay tệp ngoài repo làm căn cứ. Tài liệu trong repo mâu thuẫn với issue thì DỪNG, báo main chat.
3. `AGENTS.md` ở thư mục gốc của repo — quy định chung cho AI toàn repo, gồm chuẩn văn bản tự chứa cho issue và PR.

## Chuẩn ngôn ngữ

Code (định danh, tên hàm/biến/lớp, chuỗi kỹ thuật) viết bằng tiếng Anh. Cấm viết comment, gồm TSDoc/JSDoc, comment nội tuyến và comment mô tả luồng, trong mã nguồn hoặc cấu hình. Mã nguồn và cấu hình thực thi là nguồn sự thật duy nhất cho hành vi hiện hành; không dùng comment để lưu quyết định. Tài liệu trong repo và văn bản GitHub viết bằng tiếng Việt. Tuân thủ quy định tại `AGENTS.md` gốc.

## Ranh giới phạm vi

- 1 issue = 1 feat = 1 PR. Chỉ soạn/xem rich-text; nghiệp vụ bao quanh thuộc apps/api + apps/web.
- Đổi tập extension/định dạng tài liệu là đổi hợp đồng nội dung — phải đi cùng thay đổi ở `packages/contracts` trong cùng feat khi hình dạng thay đổi.

## Điều cấm package-specific

- Cấm lưu/nhận nội dung dạng HTML tự do ngoài hợp đồng rich-text của contracts.
- Cấm thêm extension mà phía xem tĩnh (`RichTextView`) không render được — mọi nút/định dạng phía soạn phải có đường hiển thị tương ứng phía xem.
- Cấm nhúng logic nghiệp vụ (gác quyền, trạng thái nộp/chấm) vào editor.
- Cấm apps/web tự chế editor khác thay package này — phát hiện bề mặt tự chế thì ghi nhận vào issue của feat, không âm thầm duy trì hai editor.

## Kiểm chứng bắt buộc

- **Typecheck + test của package trước khi push**: `pnpm --filter @giaokhoa/editor typecheck` và `pnpm --filter @giaokhoa/editor test`; build lại `dist` trước khi typecheck apps/web trong cùng feat.
- CI là cổng chính; kết luận CI chỉ từ LOG THẬT. Suite nặng local giữ khoá `flock /tmp/giaokhoa-heavy-suite.lock`.

## Kỷ luật test theo nghiệp vụ

- Test phải thể hiện luồng soạn–lưu–xem thật: soạn nội dung theo định dạng đã chốt → xem tĩnh hiển thị đúng cùng nội dung; nội dung ngoài hợp đồng bị từ chối. Không test chi tiết nội bộ của TipTap (thứ tự plugin, cấu trúc transaction).
- Thêm một khả năng soạn mới mà test phía xem không có ca tương ứng = chưa xong.

## Không viết comment trong code

Không thêm, giữ lại hoặc tái tạo comment trong code, kể cả TSDoc/JSDoc, comment JSX, comment giải thích flow và comment cấu hình. Thể hiện hành vi bằng code rõ ràng và test kiểm chứng. Code là nguồn sự thật duy nhất; comment có nguy cơ lệch code và tốn token. Quy tắc chung nằm trong `AGENTS.md` gốc.

## Bản đồ flow của package

- **Thành phần chính:** `src/rich-text-editor.tsx` — trình soạn (TipTap 3); `src/rich-text-view.tsx` — trình xem tĩnh cùng định dạng; `src/extensions.ts` — tập extension đã chốt của hợp đồng nội dung (gồm `UndoRedo`); `src/math.ts`
  - `src/math-editor-panel.tsx` — soạn công thức bằng panel phủ (overlay); `src/document-continuation.ts` — chuẩn hoá đuôi tài liệu (`ensureTerminalContinuation` khi nạp, dạng đem-lưu `contentForSave` khi phát); `src/editor.css` — vỏ vùng soạn + toolbar; xuất qua `src/index.ts`; test ở `src/editor.spec.tsx`.
- **Luồng dữ liệu:** `apps/web` gắn editor với tài liệu đầu vào đúng hợp đồng rich-text của `@giaokhoa/contracts` → tài liệu được bảo đảm đoạn viết tiếp ở cuối → người dùng soạn qua **một toolbar duy nhất cho editor đang active** (portal vào `#editor-toolbar-slot` ở header trang khi trang có slot, không có thì neo trên editor; mất focus thì ẩn) → mỗi thay đổi phát qua `onChange` ở dạng đem-lưu → web gửi API lưu. Phía học sinh/người xem không qua editor: cùng tài liệu được `RichTextView` render tĩnh.
- Mọi nút/định dạng phía soạn phải có đường hiển thị tương ứng ở phía xem — đó là bất biến của hợp đồng nội dung (xem điều cấm ở trên).
