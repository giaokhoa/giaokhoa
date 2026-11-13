# AGENTS.md — Yêu cầu dành cho AI khi làm việc trong `apps/api`

## Nguồn sự thật (đọc trước khi sửa)

1. `README.md` của package này — quyết định nghiệp vụ còn hiệu lực của `apps/api`.
2. Issue đặc tả của việc đang làm trên GitHub — nguồn sự thật cho việc đó: bối cảnh, phạm vi, các quyết định liên quan (viết trọn vẹn ngay trong issue) và tiêu chí nghiệm thu đều nằm trong chính issue. Không viện dẫn sổ quyết định, hồ sơ hay tệp ngoài repo làm căn cứ. Tài liệu trong repo mâu thuẫn với issue thì DỪNG, báo main chat.
3. `AGENTS.md` ở thư mục gốc của repo — quy định chung cho AI toàn repo, gồm chuẩn văn bản tự chứa cho issue và PR.

## Chuẩn ngôn ngữ

Code (định danh, tên hàm/biến/lớp, chuỗi kỹ thuật) viết bằng tiếng Anh. Cấm viết comment, gồm TSDoc/JSDoc, comment nội tuyến và comment mô tả luồng, trong mã nguồn hoặc cấu hình. Mã nguồn và cấu hình thực thi là nguồn sự thật duy nhất cho hành vi hiện hành; không dùng comment để lưu quyết định. Tài liệu trong repo và văn bản GitHub viết bằng tiếng Việt. Tuân thủ quy định tại `AGENTS.md` gốc.

## Ranh giới phạm vi

- Chỉ sửa module thuộc phạm vi việc được giao. Việc phát sinh thuộc cùng feat thì ghi vào đúng issue của feat đó (mở lại nếu đã đóng), không xé issue/PR mới. **1 issue = 1 feat = 1 PR**; các chặng là commit đẩy vào chính PR đó.
- Nghiệp vụ phải gác ở server. Không "gác" bằng cách giấu ở client.

## Quy ước tầng dữ liệu (Kysely)

- Tầng dữ liệu của hệ dùng **Kysely** duy nhất, qua package `@giaokhoa/db`. **Một module thuộc hẳn về Kysely**: toàn bộ đường dữ liệu đi qua handle Kysely (khung định tuyến `SpaceDatabaseService` cho kho trung tâm, `@InjectKysely(...)` từ `src/db/kysely.module.ts` khi cần inject theo kho, repository nằm ở `@giaokhoa/db/repositories/*`).
- **Một giao dịch một handle**: một thao tác nghiệp vụ chỉ mở giao dịch trên đúng một handle Kysely.
- Handle Kysely của kho trung tâm phải dựng trên `TenantAwarePool` để GUC/RLS theo ngữ cảnh tenant hoạt động đúng; hai kho còn lại dùng pool thường qua các điểm vào riêng của `@giaokhoa/db`.

## Điều cấm package-specific

- Cấm capability có tiền tố (`moodle/`, `mod/`, `giaokhoa/`, `report/`) — dạng duy nhất `<area>:<name>`. Thêm capability phải đăng ký vào registry và cập nhật mọi spec đếm.
- Cấm schema route dùng `z.date()`/`z.coerce.date()` — chỉ `z.iso.datetime(...)` (Swagger `createDocument` lúc boot production sẽ crash; e2e không bắt được lớp này, đã có test hồi quy `openapi-document` — không được xoá/yếu hoá test đó).
- Cấm nới cổng công bố điểm: học sinh/phụ huynh chỉ thấy điểm ĐÃ CÔNG BỐ. Mọi đường đọc điểm mới phải qua cùng một cổng công bố.
- Cấm để API phía học viên trả trường nguồn sách (`book` attribution) của câu hỏi.
- Cấm literal múi giờ `Asia/Saigon` trong SQL — chỉ dùng IANA canonical `Asia/Ho_Chi_Minh` (CI không có alias, local có — lỗi "local xanh CI đỏ" kinh điển).
- Cấm tuỳ tiện regen baseline: baseline chứa SQL RLS viết tay mà bộ sinh migration không sinh lại được. Gộp baseline phải giữ RLS và kiểm chứng cây MERGE chứa đúng MỘT thư mục `*_baseline`.
- Cấm custom jobId BullMQ chứa dấu `:` — nối khoá dedupe bằng `-`.
- Cấm viết script probe chứa pattern `token=<biến>` hoặc khoá `"password":` viết thẳng trong thân script (bị biến tướng khi truyền qua công cụ ghi file).

## Kiểm chứng bắt buộc

- **Typecheck package trước khi push**: sửa file nào thì typecheck tối thiểu trọn package (`pnpm --filter @giaokhoa/api typecheck`) — tuyệt đối không đẩy code chưa qua typecheck để CI đổ ở bước rẻ nhất. Đụng package dùng chung thì build lại dist của package đó trước khi kết luận lỗi type (dist cũ = lỗi type giả kinh điển).
- CI trên PR là cổng kiểm chứng chính; kết luận về CI chỉ từ **LOG THẬT** (log của job `verify` trên GitHub Actions của chính PR), không suy từ thời lượng bước hay thông báo của helper.
- Local chỉ chạy test targeted của đúng phần mình đụng. Chạy suite e2e/vitest nặng ở local phải giữ khoá `flock /tmp/giaokhoa-heavy-suite.lock` suốt lượt chạy; tối đa một vòng nặng tại một thời điểm trên máy này.
- Suite api và worker không chạy đồng thời trên cùng một DB; giữ cách ly DB như CI (`giaokhoa_test_api` / `giaokhoa_test_worker`).

## Kỷ luật test theo nghiệp vụ

- Test phải thể hiện **luồng nghiệp vụ thật** (GV/HS làm gì, hệ thống phải giữ quy tắc gì), không viết test chỉ để mô tả chi tiết triển khai (tên hàm nội bộ, cấu trúc trung gian). Đổi nghiệp vụ đã chốt thì test tương ứng **phải fail** — nếu đổi quyết định mà test vẫn xanh, test đó viết sai và phải sửa cùng lượt.
- Không yếu hoá assertion, không nới khẳng định để "cho qua" khi sửa spec đếm/cố định (registry capability, số bảng/uuidv7 trong baseline): đếm lại trên cây merge cuối và ghi con số thật.

## Không viết comment trong code

Không thêm, giữ lại hoặc tái tạo comment trong code, kể cả TSDoc/JSDoc, comment JSX, comment giải thích flow và comment cấu hình. Thể hiện hành vi bằng code rõ ràng và test kiểm chứng. Code là nguồn sự thật duy nhất; comment có nguy cơ lệch code và tốn token. Quy tắc chung nằm trong `AGENTS.md` gốc.

## Bản đồ flow của package

- **Điểm vào:** `src/main.ts` bootstrap ứng dụng NestJS (prefix `/api/v1`); `src/app.module.ts` lắp toàn bộ module; `src/modules/seed/review-seed.ts` là seed tài khoản demo phục vụ nghiệm thu.
- **Lớp cắt ngang:** `src/common/` — guard (`jwt-auth.guard`, `better-auth-session.guard`, `capability.guard`), decorator (`current-user`, `require-capability`, `public`), `problem-details.filter` (mọi lỗi ra theo khuôn ProblemDetails), middleware security headers, `client-ip`. `src/db/` — kết nối DB, khung định tuyến theo không gian, `tenant-pool` và `tenant-als` (ngữ cảnh tenant/RLS theo request), provider kết nối control plane độc lập; `modules/tenants/tenant-als` chỉ re-export tương thích. Thêm `src/config/`, `src/infra/`, `src/i18n/`.
- **Luồng một request:** HTTP vào → guard xác thực (JWT/Better Auth) → thiết lập ngữ cảnh tenant → guard capability theo cây context → controller kiểm chứng body bằng schema route của `@giaokhoa/contracts` → service thực thi luật nghiệp vụ (giao dịch khi cần) → ghi/đọc DB qua Kysely với `tenant_id` + RLS fail-closed → trả response đúng contract. Side-effect nền đi qua **outbox/sự kiện** cho `apps/worker` và realtime, không chạy việc nền dài trong request; hành động nhạy cảm ghi `event-log`/audit.
- **Module nghiệp vụ** nằm ở `src/modules/<tên>`, một module một miền:
  - Định danh & nền tảng: `auth`, `users`, `access`, `tenants`, `site-config`, `health`, `seed`.
  - Học tập cốt lõi: `classes`, `courses`, `enrol`, `groups`, `content`, `completion`, `availability`, `calendar`, `dashboard`.
  - Đánh giá & ngân hàng nội dung: `questions`, `exams`, `quiz`, `assessment-routes` (lắp controller HTTP liên miền), `assignments`, `grades`, `paper-grading`, `content-bank`, `curriculum`, `books`.
  - Tương tác & vận hành: `messaging`, `mail`, `social`, `badges`, `competencies`, `custom-fields`, `files`, `backup`, `privacy`, `guardians`, `reports`, `analytics`, `search`, `event-log`, `integrations`, `payments`, `mcp`.
