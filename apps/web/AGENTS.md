# AGENTS.md — Yêu cầu dành cho AI khi làm việc trong `apps/web`

## Nguồn sự thật (đọc trước khi sửa)

1. `README.md` của package này — quyết định nghiệp vụ còn hiệu lực của `apps/web`.
2. Issue đặc tả của việc đang làm trên GitHub — nguồn sự thật cho việc đó: bối cảnh, phạm vi, các quyết định liên quan (viết trọn vẹn ngay trong issue) và tiêu chí nghiệm thu đều nằm trong chính issue. Không viện dẫn sổ quyết định, hồ sơ hay tệp ngoài repo làm căn cứ. Tài liệu trong repo mâu thuẫn với issue thì DỪNG, báo main chat.
3. `AGENTS.md` ở thư mục gốc của repo — quy định chung cho AI toàn repo, gồm chuẩn văn bản tự chứa cho issue và PR.

## Chuẩn ngôn ngữ

Code (định danh, tên hàm/biến/lớp, chuỗi kỹ thuật) viết bằng tiếng Anh. Cấm viết comment, gồm TSDoc/JSDoc, comment nội tuyến và comment mô tả luồng, trong mã nguồn hoặc cấu hình. Mã nguồn và cấu hình thực thi là nguồn sự thật duy nhất cho hành vi hiện hành; không dùng comment để lưu quyết định. Tài liệu trong repo và văn bản GitHub viết bằng tiếng Việt. Tuân thủ quy định tại `AGENTS.md` gốc.

## Ranh giới phạm vi

- 1 issue = 1 feat = 1 PR; việc phát sinh của cùng feat comment vào đúng issue đó.
- Chỉ trình bày + dẫn luồng. Thấy thiếu gác quyền ở API thì ghi nhận/báo, không tự "vá" bằng cách giấu phần tử giao diện (bài học #134: giấu UI không phải là gác).

## Điều cấm package-specific

- Cấm sao chép component shadcn từ `packages/ui` vào `src/components/` để sửa riêng; cần đổi hành vi thì bọc component ở `apps/web/src/components/` hoặc sửa ở package ui theo quy trình của package đó.
- Cấm tự chế kiểu collapse/section/accordion riêng cho từng trang — dùng component dùng chung đã thống nhất; giữ nguyên hành vi đã nghiệm thu (trạng thái mở/đóng, neo URL + scroll) khi thay vỏ.
- Cấm hiển thị nguồn sách trên bề mặt học sinh làm bài, cấm hiển thị điểm chưa công bố cho HS/PH — kể cả khi API lỡ trả thừa trường (lọc ở tầng hiển thị + báo API sửa).
- Không tự dựng lại bề mặt blog/hỏi-đáp đã bị loại khỏi ứng dụng hoặc mở rộng sidebar ngoài phạm vi issue.
- Cấm đổi cấu trúc sidebar ngân hàng khác 3 mục top-level + tab Cá nhân/Hệ thống trong từng màn danh sách đã chốt (sổ mục B, chốt lại 26/10/2026 11:40).

## Kiểm chứng bắt buộc

- **Typecheck trước khi push**: `pnpm --filter @giaokhoa/web typecheck` (build của web có kèm typecheck). Dist cũ của `@giaokhoa/ui`/`@giaokhoa/editor`/`@giaokhoa/contracts` là nguồn lỗi type giả — build lại package phụ thuộc trước khi kết luận.
- Feat lớn xong phải có lượt nghiệm thu trên **trình duyệt thật** bằng tài khoản seed đổi đủ vai liên quan (tài khoản demo ghi công khai trong README gốc của repo — tự đọc mà dùng, tự gõ vào form đăng nhập, không xin lại thông tin đăng nhập, không chờ thẻ Secure Vault).
- Kiểm chứng gồm cả **tính nhất quán hình thức** (vỏ component, trạng thái hover, chevron, khoảng cách) — không chỉ kiểm cấu trúc/chức năng.
- CI là cổng chính; kết luận CI chỉ từ LOG THẬT. Local chỉ test targeted (`pnpm --filter @giaokhoa/web test -- <spec liên quan>`); suite nặng phải giữ khoá `flock /tmp/giaokhoa-heavy-suite.lock`.

## Kỷ luật test theo nghiệp vụ

- Test web phải thể hiện luồng người dùng thật theo vai (GV tạo khoá trong lớp, HS chỉ thấy điểm đã công bố, HS không thấy nhóm ngân hàng…), không test chi tiết triển khai (tên class, cấu trúc DOM trung gian). Đổi quyết định nghiệp vụ thì test tương ứng phải fail — xanh giả là test sai, sửa cùng lượt.
- Neo URL/trạng thái điều hướng đã nghiệm thu là hành vi nghiệp vụ: test phải giữ được chúng khi refactor vỏ.

## Cấu trúc tầng test

- `apps/web` chỉ có **một tầng test: unit**. Mọi spec là test đơn vị/component render trong jsdom với dữ liệu/API được mock; spec `.spec.ts`/`.spec.tsx` đặt cạnh file nguồn trong `src/`, riêng spec `.spec.mjs` của các module server Node của app đặt trong `server/`.
- Cấu trúc `test/e2e/`, `test/integration/` cùng hậu tố `.e2e-spec`/`.int-spec` là của backend (`apps/api`, `apps/worker`) — không áp dụng cho web và không tạo tầng rỗng cho web.
- `vitest.config.ts` khai một project Vitest tên `unit` giữ danh sách `include` neo đúng các vị trí trên; script `test` chạy toàn bộ test của app, script `test:unit` chạy riêng project `unit` (hiện cùng một tập test vì web chỉ có một tầng).

## Không viết comment trong code

Không thêm, giữ lại hoặc tái tạo comment trong code, kể cả TSDoc/JSDoc, comment JSX, comment giải thích flow và comment cấu hình. Thể hiện hành vi bằng code rõ ràng và test kiểm chứng. Code là nguồn sự thật duy nhất; comment có nguy cơ lệch code và tốn token. Quy tắc chung nằm trong `AGENTS.md` gốc.

## Cấu trúc `features/` và kỷ luật import

Từ đợt tổ chức lại theo mô hình features/, `apps/web` tổ chức theo feature: mỗi miền nghiệp vụ là một thư mục `src/features/<feature>/` tự chứa các tầng của chính nó — `routes/` (route module, export trực tiếp component/loader/clientLoader/meta/ErrorBoundary; config route riêng ở `features/<feature>/routes.ts` dùng `relative()`/`prefix()` của React Router), `components/`, `api/` (hàm gọi API thuần, không phụ thuộc React), `queries/` (hook React Query + query keys riêng của feature ở `queries/keys.ts` + prefetch/clientLoader), `types/`, `utils/`, `hooks/`. Mô hình `src/lib/*-data.ts` phẳng đã bỏ: tầng dữ liệu của mỗi miền nằm trong feature của nó, tách rõ tầng `api/` khỏi tầng `queries/`.

- **Kỷ luật phụ thuộc một chiều:** thư mục dùng chung ← features ← app. Feature chỉ import từ tầng dùng chung (`src/lib/`, `src/components/`, `src/hooks/`, `src/config/`, `src/utils/`) và từ chính feature của nó; **không import ngang giữa các feature**. Phần hai feature cùng cần phải đưa xuống thư mục dùng chung hoặc hợp nhất ở tầng app. Tầng app (`src/app/`) import từ mọi feature (file `src/app/routes.ts` chỉ gộp các khối route của feature vào layout chung).
- Phần thật sự đa-feature mới ở lại tầng dùng chung: `src/lib/` giữ client API (`api.ts`), auth (`auth.tsx`, `auth-client.ts`), phân quyền hiển thị (`permissions.tsx`, `access.ts`), `query-keys.ts` (chỉ các khoá dùng chung/đa-feature), `curriculum.ts` (query môn học dùng cả questions/matrices), `course-content.ts` (query nội dung khoá dùng cả builder/content-bank/exams/questions), `course-cards.ts`, `ssr-data.ts`… — không thêm module dữ liệu theo miền mới vào `src/lib/`.
- Alias đường dẫn: `#features/*` trỏ `src/features/*`, `#lib/*`, `#components/*`, `#hooks/*`, `#config/*`, `#utils/*`, `#test/*` trỏ các thư mục dùng chung tương ứng (khai ở `package.json` mục `imports` và `tsconfig.json` mục `paths`).

### Import ngang còn tồn tại trong code

Import ngang giữa các feature còn tồn tại trong code hiện tại là nợ kỹ thuật, không phải quy tắc cho phép phát sinh thêm. Không dựa vào danh sách từ issue thuộc repo khác làm nguồn sự thật. Khi sửa vùng liên quan, giữ ranh giới phụ thuộc, không tăng cạnh import ngang và ưu tiên tháo gỡ các cạnh hiện có theo phạm vi issue.

Hai chiều import runtime `questions → matrices` và `content-bank → course-builder` đã được loại khỏi baseline hiện hành; không được đưa trở lại bằng cách dựa vào ngoại lệ lịch sử. Khi rà soát ranh giới bằng script tạm, phải xét cả alias `#features/*`, đường relative và import từ tầng dùng chung ngược về feature; script audit tạm không được lưu trong source hoặc thêm thành lệnh CI. Hai thành phần bố cục `src/components/site-header.tsx` và `src/components/app-sidebar.tsx` hiện vẫn import trực tiếp từ feature `notifications`: đó là coupling runtime hiện hữu cần phân xử riêng, không xem đây là quy tắc cho phép shared import feature.

## Bản đồ flow của package

- **Điểm vào:** React Router dùng `appDirectory: "src"` để sinh `+types` cho các route module trong `src/features/`. Các convention file `src/root.tsx`, `src/routes.ts`, `src/entry.client.tsx`, `src/entry.server.tsx` chỉ tái xuất/chuyển tiếp sang implementation ở `src/app/` để không đảo chiều phụ thuộc. `src/app/root.tsx` giữ vỏ gốc, SSR loader phiên và provider; `src/app/routes.ts` gộp các nhóm route feature qua layout `app/shell.tsx`; `src/config/i18n.ts` nạp bản dịch. Script typecheck chạy `react-router typegen` trước TypeScript theo docs.
- **Luồng hiển thị:** điều hướng vào route → root/vỏ đọc phiên (cookie `giaokhoa_session`) và capabilities từ API → route module trong `src/features/<feature>/routes/` nạp dữ liệu qua tầng `queries/` của chính feature đó (hook React Query, prefetch/clientLoader) trên nền các hàm gọi API thuần ở tầng `api/` và client dùng chung `src/lib/api.ts` → render bằng component nền của `@giaokhoa/ui` và editor của `@giaokhoa/editor` (không tự chế editor/component nền riêng) → hành động của người dùng gọi API `/api/v1` hoặc kênh realtime (`src/features/messaging/api/messaging-socket.ts`, `src/features/notifications/hooks/notification-unread-stream.ts`) rồi cập nhật cache/dữ liệu hiển thị.
- **Thư mục chính:** `src/features/` — 27 feature theo miền nghiệp vụ (khoá học, lớp, câu hỏi/đề/ma trận, làm bài, điểm, tin nhắn, quản trị…), mỗi feature tự chứa route module, component và tầng dữ liệu của nó; `src/app/` — khung framework (điểm vào, root, shell, file gộp route); `src/components/` — vỏ dùng chung của app (bọc component `@giaokhoa/ui` theo luồng GV/HS); `src/lib/` — client API, auth, phân quyền hiển thị và helper thật sự đa-feature; `src/config/`, `src/hooks/`, `src/utils/` — cấu hình, hook và hàm thuần dùng chung; `src/test/` — hạ tầng test của app.
