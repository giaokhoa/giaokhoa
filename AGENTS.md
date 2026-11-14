# AGENTS.md — Quy định chung cho AI làm việc trong repo này

Tài liệu này chứa các quy định chung áp dụng cho mọi app/package trong repo. Luật riêng của từng package nằm trong `AGENTS.md` của chính package đó (`apps/api`, `apps/web`, `apps/worker` và các thư mục trong `packages/`) và vẫn phải được đọc trước khi sửa package tương ứng.

## Nguồn sự thật

Code và cấu hình thực thi là nguồn sự thật duy nhất về hành vi, hợp đồng và thực trạng của hệ thống. Tài liệu và issue hỗ trợ xác định yêu cầu, quy trình và phạm vi, nhưng không thay thế hoặc diễn giải trái với code. Các nguồn ngữ cảnh được phép tham khảo:

1. `README.md` ở thư mục gốc — cấu trúc repo, cách chạy, quy ước chung và định nghĩa kiểm chứng.
2. `README.md` của package — quyết định nghiệp vụ còn hiệu lực của package đó.
3. `AGENTS.md` của package — luật làm việc riêng của package đó.
4. Tài liệu còn giữ trong thư mục `docs/` của repo — gồm các quyết định kiến trúc đã được ghi thành văn bản trong repo.
5. Issue đặc tả của việc đang làm — bối cảnh, phạm vi, quyết định liên quan (viết trọn vẹn trong issue) và tiêu chí nghiệm thu.

## Cổng bắt buộc trước khi đụng code

1. **Ponytail mức `full` cho mọi Agent:** trước khi viết, sửa, tái cấu trúc hoặc review code, **mỗi Agent** phải đọc `.agents/skills/ponytail/SKILL.md` và áp dụng đầy đủ mức **`full`** trong lượt làm việc của chính mình. Dùng cơ chế kích hoạt skill của môi trường nếu có; nếu không, đọc và thực thi trực tiếp nội dung skill, **không giả định có lệnh `/ponytail`**. Agent reviewer cũng phải tự áp dụng, không kế thừa lời xác nhận của Agent code. Không tự spawn Agent để thực hiện bước này. Nếu không truy cập được skill, dừng trước khi đụng code và bàn giao trở ngại, không tự nhận đã áp dụng.
2. **Docs và pattern là điều kiện tiên quyết:** trước khi code, Agent bắt buộc đọc `AGENTS.md`, `README.md` áp dụng cho phạm vi công việc; kiểm tra cách triển khai đang được sử dụng trong repo; và đối chiếu tài liệu chính thức đúng phiên bản của framework, thư viện liên quan. Phải tuân thủ pattern đã được xác minh, không tự nghĩ ra cách triển khai khác.
3. **Chưa xác minh thì chưa code:** nếu thiếu tài liệu cần thiết, pattern mâu thuẫn hoặc không xác định được phiên bản/hợp đồng thực tế, phải làm rõ hoặc bàn giao trở ngại **trước khi viết code liên quan**, không bịa nguồn và không bỏ qua cổng này vì tiến độ. Trong PR/bàn giao phải ghi tài liệu và pattern đã đối chiếu, phần áp dụng, ngoại lệ được chấp thuận và điều chưa kiểm chứng; reviewer phải kiểm tra bằng chứng này. Yêu cầu này không buộc mọi Agent có cùng CLI, công cụ truy cập hay quyền GitHub.

## Quy tắc làm việc chung

- **Không được bỏ qua docs và pattern:** cổng bắt buộc ở mục trên áp dụng cho mọi thay đổi có liên quan package/framework bên ngoài (ví dụ Vitest, NestJS, Kysely, ESLint), kể cả chỉnh cấu hình, test, nâng version hoặc tích hợp API. Phải ưu tiên cơ chế được hỗ trợ chính thức, tuân thủ convention của repo và nêu căn cứ trong PR. Không tự phỏng đoán hành vi thư viện hoặc áp đặt pattern quen thuộc từ hệ thống khác.
- **Không sinh script hạ tầng nếu framework đã hỗ trợ:** trước khi tạo file `.js`/`.mjs`/`.sh`/`.sql` phục vụ bootstrap, build, proxy, CI hoặc devcontainer, phải đối chiếu tài liệu chính thức của công cụ hiện tại (pnpm, Docker Compose/PostgreSQL, Dev Containers, Nest CLI, React Router, Kysely, Vitest). Ưu tiên cấu hình khai báo và CLI có sẵn. Chỉ viết code điều phối riêng khi có hành vi thật sự chưa được hỗ trợ và có kiểm chứng tương đương; ghi rõ trách nhiệm và thời điểm chạy của nó. Không coi việc chuyển đoạn shell sang script mới là dọn sạch code.
- **Thay đổi tối thiểu theo đúng task:** mọi thay đổi phải là tối thiểu cần thiết cho task: không mở rộng phạm vi, không refactor tiện tay, không đụng code không liên quan. Phát hiện ngoài phạm vi thì ghi lại và báo cáo, không đưa vào thay đổi.

## Chuẩn ngôn ngữ

- **Code viết bằng tiếng Anh:** định danh, tên hàm/biến/lớp và các chuỗi kỹ thuật (log key, mã lỗi, khoá cấu hình, thông điệp do máy đọc) viết bằng tiếng Anh.
- **Cấm comment trong code và cấu hình:** không viết TSDoc/JSDoc, comment đầu file, comment nội tuyến, JSX comment, comment SQL/shell/CSS/YAML hay comment giải thích flow. Code tự diễn đạt hành vi và test kiểm chứng hành vi; không lưu quyết định hoặc mô tả triển khai trong comment. Comment dễ sai lệch so với code, đồng thời gây tốn token đọc, viết và bảo trì.
- **Mô tả test viết bằng tiếng Việt:** chuỗi mô tả của `describe`, `it` và `test` trong các file test viết bằng tiếng Việt; mỗi mô tả phải nêu rõ hành vi đang được kiểm chứng — cấm mô tả mơ hồ, không nói lên hành vi (ví dụ chỉ ghi tên hàm hoặc "hoạt động đúng").
- **Phân tầng test:** test e2e đi theo quy ước chính thức của NestJS — file nằm trong thư mục `test/`, hậu tố `*.e2e-spec.ts`, khởi động ứng dụng đầy đủ và kích hoạt qua HTTP bằng supertest. Tầng integration là quy định riêng của dự án (NestJS không quy ước tầng này): test gọi trực tiếp service là integration test — phải đặt tên, vị trí và cách chạy đúng tầng integration, không mang danh e2e.
- **Cấu trúc thư mục test:** backend tách test theo tầng — `test/e2e/<module>/…` chỉ chứa test e2e (hậu tố `*.e2e-spec.ts`), `test/integration/<module>/…` chỉ chứa integration test (hậu tố `*.int-spec.ts`); việc chia thư mục con theo module trong mỗi tầng và toàn bộ tầng integration là quy định riêng của dự án. Test đơn vị (unit) đặt cạnh mã nguồn trong `src`, hậu tố `*.spec.ts`, theo quy ước chính thức của NestJS. Worker hiện đã phân tầng: unit `src/**/*.spec.ts`, integration `test/integration/**/*.int-spec.ts`; không còn ngoại lệ 19 file test tích hợp mang hậu tố unit. Riêng `packages/db` giữ integration spec tại `src/**/*.int-spec.ts` theo cấu hình Vitest của package; đây là ngoại lệ ở package dữ liệu, không áp đặt đường dẫn test của app lên package này.
- **Cấu hình chạy test (Vitest):** pattern khám phá mặc định của Vitest không nhận cả `.e2e-spec.ts` lẫn `.int-spec.ts`, nên mỗi tầng bắt buộc khai `include` tường minh neo đúng thư mục và hậu tố của tầng đó trong `projects` của `vitest.config.ts`; quên khai là test âm thầm không chạy. Cấm pattern lỏng (ví dụ `**/*spec.ts`) và include cả thư mục, vì chúng phá tính tách bạch giữa các tầng và có thể làm test chạy trùng. Chạy tách theo từng loại bằng `--project` hoặc script riêng (`test:unit`, `test:int`, `test:e2e`).
- **Tài liệu và văn bản GitHub viết bằng tiếng Việt:** mọi tài liệu trong repo (README, các file AGENTS, tài liệu của package) và mọi văn bản trên GitHub (issue, PR, comment) viết bằng tiếng Việt, văn phong kỹ thuật trung tính.
- **Ngoại lệ cho directive bắt buộc:** giữ nguyên chỉ thị có cú pháp giống comment nhưng được công cụ thực thi đọc để quyết định hành vi, ví dụ shebang `#!`, chỉ thị `# syntax=` của Dockerfile và dấu `--> statement-breakpoint` của bộ chạy migration SQL. Chúng là dữ liệu điều khiển của code, không phải chú thích mô tả. Không xóa hoặc thay đổi những chỉ thị này khi dọn comment.
- **Code là nguồn sự thật duy nhất:** khi có mâu thuẫn giữa code với diễn giải trong tài liệu, kiểm tra code và test thực tế, cập nhật tài liệu hoặc sửa code theo yêu cầu đã được duyệt; tuyệt đối không thêm comment để tạo thêm một bản mô tả song song.

## Quy trình tạo Issue và PR

Chương này là chuẩn GitHub đầy đủ và duy nhất của repo: flow nhánh, đặt tên branch, tạo issue, tạo PR, chuẩn tiêu đề và commit, đóng issue, review và merge, vòng đời label. Khi repo được tạo lại từ đầu, toàn bộ quy trình được dựng lại theo đúng chương này.

### Worktree bắt buộc khi xử lý Issue

1. **Mỗi Issue một worktree riêng dưới `.worktrees/`.** Tất cả worktree phục vụ Issue phải đặt trong `<repo-root>/.worktrees/` (ví dụ `.worktrees/fix-442-tenant-api-prefix`), và đường dẫn `/.worktrees/` phải được khai trong `.gitignore`. Mỗi Issue có worktree và nhánh riêng; không tái sử dụng worktree cho Issue khác. Cấm sửa file nguồn, tạo commit hoặc chạy lệnh làm thay đổi code trong worktree gốc đang checkout `main`; chỉ được dùng worktree gốc để quản lý Git worktree.
2. **Kiểm tra trước khi thi công.** Tại worktree gốc, chạy `git status --short` và `git worktree list` trước khi tạo worktree. Tạo từ `main` đã đồng bộ với `origin/main` bằng lệnh `git worktree add -b <type>/<số-issue>-<slug> .worktrees/<type>-<số-issue>-<slug> main`. Quy tắc tên nhánh vẫn theo mục "Đặt tên branch" ở dưới. **Ngay sau mỗi lần tạo worktree, bắt buộc sao chép cả hai file `.env` local từ worktree gốc sang worktree mới** trước khi chạy install, build, migrate, test hoặc dev. Chạy từ thư mục gốc repo (thay `<worktree>` bằng tên thư mục vừa tạo):

   ```bash
   cp -n apps/api/.env .worktrees/<worktree>/apps/api/.env
   cp -n apps/worker/.env .worktrees/<worktree>/apps/worker/.env
   ```

   Không ghi đè `.env` đã có ở worktree đích, không in giá trị bí mật ra log và không commit các file này. Nếu worktree gốc chưa có một file `.env` cần sao chép, tạo file đó từ `.env.example` tương ứng và cấu hình các giá trị local trước khi tiếp tục. Kiểm tra `DATABASE_URL` trong cả hai file đích trỏ đúng database của môi trường hiện tại.

3. **Chưa có số Issue.** Khi cần chuẩn bị trước khi có Issue, dùng worktree trong `.worktrees/` và nhánh tạm riêng, không tự đặt số Issue giả. Đổi về nhánh đúng quy ước khi có Issue và trước PR.
4. **Bảo toàn thay đổi.** Khi phát hiện sửa nhầm trong worktree gốc, phải sao lưu, chuyển và đối chiếu đầy đủ thay đổi trước khi dọn bản sai chỗ. Cấm dùng `git reset --hard` hoặc `git clean -fd` để xoá dữ liệu chưa được xác minh đã chuyển an toàn.
5. **Kiểm chứng và bàn giao.** Chạy lint, typecheck, test trong worktree của Issue. Báo rõ đường dẫn worktree, nhánh, trạng thái Git và giữ worktree gốc sạch (ngoại trừ thay đổi do người dùng chủ động giữ lại).

### Flow nhánh hiện hành

1. **Nhánh tích hợp và phát hành:** `main` đang là default branch và nhánh đích của PR. Không giả định `dev` đã tồn tại; chỉ chuyển sang flow hai nhánh khi GitHub và CI thực sự được cấu hình, đồng thời cập nhật tài liệu này.
2. **Việc theo issue:** mỗi issue dùng một branch từ `main`, một worktree, một PR vào `main`; PR có `Closes #<issue>` và squash merge sau vòng review bắt buộc.
3. **CI đúng cấu hình:** `.github/workflows/ci.yml` chạy trên mọi `pull_request`; job `verify` tổng hợp kiểm chứng. `.github/workflows/deploy-check.yml` chạy `verify-stack` trên PR vào `main`. Ruleset của `main` hiện yêu cầu `verify-workspace` và `verify-stack`; ngoài các check bắt buộc của GitHub, phải kiểm chứng `verify` thành công trên head cuối trước merge. CI không thay thế review.
4. **Hotfix:** mở branch từ `main` và PR vào `main`, không được bỏ qua vòng Agent review hoặc cổng CI. Không tạo PR đồng bộ tới nhánh không tồn tại.

### Văn bản tự chứa

1. **Issue là bản đặc tả tự chứa.** Mọi issue phải chứa đủ: bối cảnh và vấn đề, mục tiêu, phạm vi (làm / không làm), chi tiết việc cần làm, quyết định liên quan và mục `## Nghiệm thu` gồm các tiêu chí kiểm chứng được. Người đọc chỉ có repo này phải hiểu, thi công và kiểm chứng được toàn bộ việc chỉ từ nội dung issue. Tương tự, mọi PR phải sao chép từng tiêu chí trong mục Nghiệm thu của issue liên kết, ghi cách đáp ứng kèm bằng chứng cụ thể, và ghi rõ kiểm chứng đã chạy (lệnh, kết quả, trạng thái CI lấy từ log thật).
2. **Quyết định viết trọn vẹn tại nơi sử dụng.** Khi một issue hoặc PR dựa trên một quyết định đã có, nội dung đầy đủ của quyết định đó phải được viết lại ngay trong văn bản đang dùng nó, trình bày dưới dạng yêu cầu/sự kiện kỹ thuật.
3. **Cấm trích dẫn quyết định mơ hồ.** Không viết các câu dạng "theo quyết định đã chốt", "như đã thống nhất", "theo chỉ đạo trước đó" hoặc trích kèm mốc thời gian của một cuộc trao đổi/sổ ghi nằm ngoài repo thay cho nội dung quyết định.
4. **Cấm dẫn file ngoài repo làm căn cứ.** Không viện dẫn sổ quyết định, hồ sơ nghiên cứu, ghi chú hay bất kỳ tệp nào nằm ngoài repo này — kể cả khi tệp đó tồn tại trên máy của người viết — làm căn cứ cho đặc tả, phạm vi hay tiêu chí nghiệm thu. Tài liệu trong repo (README, AGENTS.md, tài liệu trong `docs/`) được dẫn theo đường dẫn trong repo như bình thường.
5. **Ngôn ngữ và văn phong.** Code và cấu hình tuân theo mục "Chuẩn ngôn ngữ" của tài liệu này: code bằng tiếng Anh, không viết comment trong code; tài liệu, issue, PR, commit và trao đổi trên GitHub bằng tiếng Việt. Mọi văn bản thuộc codebase dùng văn phong kỹ thuật trung tính. Tuyệt đối không dùng danh xưng hay cách xưng hô nội bộ trong văn bản của codebase, và không ghi quyết định thuộc về cá nhân nào — quyết định luôn được trình bày là yêu cầu kỹ thuật.
6. **Mẫu là cơ chế thực thi chuẩn.** Issue mở qua một mẫu trong `.github/ISSUE_TEMPLATE/`; PR mở theo `.github/pull_request_template.md`. Issue trống (không theo mẫu) bị tắt có chủ đích trong `.github/ISSUE_TEMPLATE/config.yml` để mọi issue đều đi qua một mẫu có đủ các mục bắt buộc.

### Đặt tên branch

1. Mỗi issue mở một branch riêng từ `main` (nhánh tích hợp hiện hành).
2. Tên branch theo mẫu `<type>/<số issue>-<slug>`: `type` thuộc nhóm type của Conventional Commits (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`); `slug` là cụm tiếng Anh dạng kebab-case, ngắn, mô tả việc. Ví dụ: `fix/442-tenant-api-prefix`.
3. Branch hotfix mở từ `main`, đặt tên `hotfix/<số issue>-<slug>`.

### Tạo Issue

1. Dùng Issue template của repo (mẫu tính năng/nghiệp vụ hoặc mẫu báo lỗi trong `.github/ISSUE_TEMPLATE/`); issue trống bị tắt, không mở issue ngoài mẫu.
2. Thân issue tự chứa đầy đủ: bối cảnh và vấn đề; mục tiêu; phạm vi (làm / không làm); chi tiết việc cần làm kèm task list các việc con ngay trong issue; quyết định liên quan viết lại trọn vẹn; mục `## Nghiệm thu` dạng checklist kiểm chứng được; phụ thuộc và thứ tự.
3. Một issue là một đơn vị việc mạch lạc. Việc quá lớn cho một PR thì tách thành nhiều issue (mỗi issue một PR), không tách thành nhiều PR cho một issue. Khi tách, các issue con (child issue) phải được gắn vào issue cha bằng tính năng sub-issues native của GitHub ngay khi tạo — cấm chỉ nhắc tới nhau bằng chữ trong thân issue. Việc con nằm gọn trong một issue thì theo dõi bằng task list trong thân issue và thân PR, không tách thành issue riêng.
4. **Nhãn khi tạo issue.** Gắn nhãn loại và trạng thái triage ban đầu theo `docs/agents/triage-labels.md`. Tiến độ thi công và review được theo dõi trong issue và PR.
5. **Một issue = một feat.** Việc phát sinh thuộc cùng feat thì ghi vào đúng issue của feat đó (mở lại nếu đã đóng), không xé issue/PR mới.

### Chuẩn tiêu đề

1. **Tiêu đề issue.** Tối đa khoảng 70 ký tự, theo cấu trúc: động từ + đối tượng + tối đa một cụm phân biệt ngắn. Không liệt kê phạm vi trong tiêu đề và không chất chi tiết vào tiêu đề — toàn bộ chi tiết thuộc về thân issue.
2. **Tiêu đề PR.** Mang mẫu Conventional Commits theo mục "Chuẩn commit" ngay dưới đây, vì khi squash merge, tiêu đề PR trở thành thông điệp commit trên nhánh chính. Tiêu đề PR cũng nằm trong trần khoảng 70 ký tự.

### Chuẩn commit

1. Mọi thông điệp commit tuân theo Conventional Commits 1.0.0, dạng `type(scope): mô tả`.
2. `type` thuộc nhóm: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
3. `scope` là tên module hoặc package ngắn, viết bằng tiếng Anh.
4. Phần mô tả viết bằng tiếng Việt, ngắn gọn; toàn bộ dòng subject tối đa khoảng 72 ký tự.
5. Thay đổi phá vỡ tương thích ghi `type(scope)!:` và thêm footer `BREAKING CHANGE:` ở thân commit. Phần thân commit (khi cần) viết bằng tiếng Việt.

### Tạo PR

1. Một nhánh từ `main` và đúng một PR vào `main` cho mỗi issue (theo mục "Flow nhánh hiện hành" ở trên).
2. Thân PR theo `.github/pull_request_template.md`, gồm: `Closes #<số issue>`; tóm tắt thay đổi; bản đồ thay đổi theo phạm vi; task list toàn bộ việc con của issue (mang từ issue sang) và tích khi xong từng mục; đối chiếu nghiệm thu từng tiêu chí kèm bằng chứng; kết quả kiểm chứng và CI.
3. Toàn bộ việc con nằm trong PR duy nhất này (nhiều commit là bình thường). Tuyệt đối không mở PR thứ hai cho cùng một issue. Nếu PR có nguy cơ quá lớn tới mức không đánh giá nổi thì dừng và báo điều phối — việc chia là ngoại lệ hiếm, phải được duyệt trước, giữ số PR ở mức tối thiểu và vẫn theo dõi bằng task list trong issue.
4. Thân PR có đủ các mục "Việc con", "Bản đồ thay đổi theo phạm vi" và "Kỷ luật đã giữ" theo mẫu PR của repo, mở đầu bằng mục "Liên kết issue". Dòng `Closes #<số issue>` ở các điểm trên là bắt buộc — đây là cơ chế đóng issue được triển khai, theo mục "Đóng issue" trong tài liệu này.

### Phối hợp nhiều Agent và nhiều môi trường

1. **Quy trình độc lập công cụ:** mỗi Agent có thể làm việc trên máy, container, phiên và bộ quyền truy cập khác nhau. Không giả định mọi môi trường có `gh`, có cùng worktree, cùng tài khoản GitHub hay cùng công cụ điều phối. Dùng giao diện web, API, connector hoặc CLI **sẵn có và được cấp quyền** để thao tác PR/issue; không cài công cụ, yêu cầu bí mật hay tự mở quyền chỉ để đáp ứng một ví dụ lệnh. Git và remote repository là điểm chung cho code; PR/issue và comment trên hệ thống quản lý mã nguồn là điểm chung cho trạng thái.
2. **Phân công và sở hữu rõ ràng:** người điều phối giao vai trò, phạm vi issue, nhánh đích, branch được phép push, người chịu trách nhiệm tích hợp, reviewer và bên có quyền merge. Mỗi Agent làm trong worktree/clone riêng của mình; không sửa, xóa hoặc dọn worktree/branch do bên khác đang dùng. Không tự khởi chạy hoặc giao thêm Agent, không tự nhận vai trò reviewer/merger.
3. **Nhiều bên cùng làm:** các việc khác issue dùng branch/PR riêng. Nếu nhiều bên cùng xử lý **một issue**, người tích hợp được giao quản lý **một PR chính**; các bên triển khai phần việc trên branch/clone riêng hoặc theo cơ chế phối hợp được giao, bàn giao commit/patch để người tích hợp đưa vào PR chính. Không đồng thời push hoặc force-push cùng một branch khi chưa có thỏa thuận quyền ghi; kiểm tra remote head trước push và không ghi đè commit của bên khác. Xung đột hoặc phụ thuộc chưa giải quyết phải trả về người điều phối.
4. **Bàn giao có thể kiểm chứng:** mỗi lần chuyển vai phải nêu issue, repo/remote, PR URL hoặc trạng thái chưa tạo được PR, branch và head commit SHA, người đang giữ quyền sửa, phạm vi thay đổi, kết quả kiểm chứng, các finding chưa giải quyết và việc tiếp theo cần giao. Nơi lưu trạng thái chính là PR/issue khi có quyền; nếu không có quyền đăng, bàn giao nội dung và trạng thái **chưa được đăng** cho người điều phối, không giả vờ thao tác đã thành công.

### Vòng Agent triển khai → Agent review → đồng thuận

1. **Agent code:** hoàn thành phạm vi được giao, kiểm chứng local phù hợp, commit và **push ngay lên branch được phân công**. Mở/cập nhật PR nếu môi trường có quyền; nếu không, bàn giao branch, SHA và thông tin để người có quyền tạo/cập nhật PR. **Không chờ CI hoàn thành**, không theo dõi/poll CI trước khi kết thúc lượt và không tự spawn reviewer. Ghi đúng trạng thái CI `chưa kiểm tra/đang chạy`, không nhận xanh khi thiếu bằng chứng.
2. **Agent review độc lập:** người điều phối chuyển PR cho reviewer được giao. Reviewer đọc diff và bằng chứng trên **head SHA mới nhất**, không sửa branch của Agent code. Ngay khi review xong, phải công bố kết luận **CHANGES_REQUESTED** hoặc **APPROVED** kèm SHA, findings (mức độ, vị trí, bằng chứng) hoặc xác nhận không có finding, và giới hạn kiểm chứng **trực tiếp trên PR** bằng phương thức được cấp quyền (giao diện, API, connector, CLI). Không chỉ báo trong chat. Nếu reviewer không có quyền đăng, chuyển nguyên nội dung cho đầu mối có quyền đăng ngay; trạng thái vẫn là **chưa công bố/chưa hoàn tất review** cho đến khi xác nhận comment hiện trên PR. Comment Agent không tự động là approval chính thức của nền tảng.
3. **Sửa và review lại trên cùng PR:** Agent code/đầu mối tích hợp nhận findings từ PR, sửa trong phạm vi đã giao, kiểm chứng local, push SHA mới rồi phản hồi và bàn giao lại; **không chờ CI**. Reviewer phải đọc SHA mới, kiểm tra ảnh hưởng và đăng kết luận mới trên PR. Kết luận ở SHA cũ không còn hiệu lực; nếu có nhiều bên đang làm, người tích hợp phải chốt và công bố head để tránh review nhầm phiên bản.
4. **Đồng thuận:** Agent code xác nhận đã xử lý mọi finding; reviewer công bố **APPROVED** cho đúng SHA cuối, không còn finding chặn hay thảo luận tồn đọng. Không suy diễn đồng thuận từ im lặng, CI xanh hoặc lời xác nhận của một Agent tự đóng hai vai. Bất đồng chưa giải quyết được trả về người điều phối, không tự bỏ qua.
5. **Merge do vai trò được giao thực hiện:** chỉ sau khi đồng thuận và mọi required CI/status check trên **head cuối** đều thành công theo nguồn thật; repo hiện yêu cầu cả `verify`, `verify-stack` và các check bắt buộc. Kiểm tra lại SHA, quyền merge, trạng thái PR không draft và mergeable trước khi squash merge. **Agent code không chịu trách nhiệm đợi CI**; khâu merge/điều phối phụ trách cổng này.

### Dọn worktree và branch sau merge

1. Chỉ bên được giao dọn tài nguyên mới thực hiện, sau khi xác minh PR **đã merge** bằng thông tin từ giao diện/API/công cụ đang có, nhánh đích đã tích hợp thay đổi và issue đã đóng. Không giả định cùng máy, cùng clone hoặc công cụ với Agent code. Không dọn worktree/branch do bên khác sở hữu hoặc đang dùng; không xóa tài nguyên của PR còn mở hay dữ liệu đang làm dở.
2. **Kiểm kê cả dữ liệu Git ignore trước khi xóa:** từ worktree gốc, chạy `git -C .worktrees/<worktree> status --porcelain --untracked-files=all` và `git -C .worktrees/<worktree> ls-files --others --ignored --exclude-standard`. `git status --porcelain` báo sạch **không** bảo đảm worktree không có dữ liệu: `git worktree remove` có thể xóa cả file bị ignore như `.env` và `data/files/*`. Nếu có file sửa/chưa theo dõi, dừng và bảo toàn dữ liệu. Với mọi file bị ignore, phân loại rõ dữ liệu cần giữ và sản phẩm tái tạo được; so sánh `.env` với bản gốc bằng cách không in bí mật ra log, sao lưu bản khác biệt và chuyển dữ liệu local cần giữ ra ngoài worktree, kiểm tra bản sao có đủ trước khi tiếp tục. Không mặc định mọi file bị ignore đều có thể bỏ.
3. **Chỉ remove sau khi bảo toàn:** xác minh không có thay đổi chưa lưu, không còn file bị ignore có giá trị chưa được sao lưu, và những file còn lại được phép loại bỏ; khi đó mới chạy `git worktree remove .worktrees/<worktree>`. Cấm `reset --hard`, `clean -fd`, `worktree remove --force` để giải quyết cảnh báo.
4. Dọn **chỉ branch local thuộc quyền quản lý của mình** bằng `git branch -d <branch>`. Với squash merge, Git có thể không coi commit nhánh là tổ tiên của `main`: chỉ dùng `git branch -D <branch>` **sau khi xác minh PR đã merge, không còn commit/dữ liệu cần giữ và không còn bên nào đang làm trên branch**. Việc xóa remote branch chỉ do đầu mối có quyền thực hiện sau khi xác nhận không còn PR hoặc Agent khác cần branch; có thể dùng `git push origin --delete <branch>` nếu được giao và hệ thống chưa tự xóa. Không xóa `main` hoặc branch của bên khác.
5. Đồng bộ `main`, kiểm tra `git worktree list`, `git branch -vv` và tình trạng issue. Ghi kết quả cleanup vào PR/issue; nếu còn nhánh/worktree cần giữ vì có dữ liệu, ghi rõ lý do và bàn giao thay vì tuyên bố đã dọn xong.

### Đóng issue

1. Issue được triển khai chỉ đóng bằng cơ chế tự đóng qua dòng `Closes #<số issue>` trong thân PR khi PR merge. Cấm đóng tay issue đang triển khai trước khi PR của nó merge. Ngoại lệ: issue có kết luận triage `wontfix` được đóng kèm lý do sau khi người duy trì xác nhận kết luận, không cần PR triển khai.
2. Sau khi merge, phải kiểm chứng issue đã thật sự đóng. Nếu PR đã merge mà issue chưa đóng (sai từ khoá đóng hoặc sai nhánh đích), đóng issue kèm comment dẫn tới commit merge.
3. Issue cha chỉ đóng khi child issue cuối cùng về đích: PR cuối cùng ghi `Closes` cả child issue của nó lẫn issue cha.

## Agent skills

### Theo dõi issue

Khi đọc, tạo hoặc cập nhật issue trên GitHub, đọc `docs/agents/issue-tracker.md`.

### Nhãn triage

Khi phân loại issue, dùng nhãn triage mặc định theo `docs/agents/triage-labels.md`.

### Tài liệu miền nghiệp vụ

Trước khi khảo sát mã nguồn, đọc `docs/agents/domain.md`: một `CONTEXT.md` và `docs/adr/` ở gốc repo (single-context).
