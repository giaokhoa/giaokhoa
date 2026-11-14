# AGENTS.md — Quy định chung cho AI làm việc trong repo này

Tài liệu này chứa các quy định chung áp dụng cho mọi app/package trong repo. Luật riêng của từng package nằm trong `AGENTS.md` của chính package đó (`apps/api`, `apps/web`, `apps/worker` và các thư mục trong `packages/`) và vẫn phải được đọc trước khi sửa package tương ứng.

## Nguồn sự thật

Code và cấu hình thực thi là nguồn sự thật duy nhất về hành vi, hợp đồng và thực trạng của hệ thống. Tài liệu và issue hỗ trợ xác định yêu cầu, quy trình và phạm vi, nhưng không thay thế hoặc diễn giải trái với code. Các nguồn ngữ cảnh được phép tham khảo:

1. `README.md` ở thư mục gốc — cấu trúc repo, cách chạy, quy ước chung và định nghĩa kiểm chứng.
2. `README.md` của package — quyết định nghiệp vụ còn hiệu lực của package đó.
3. `AGENTS.md` của package — luật làm việc riêng của package đó.
4. Tài liệu còn giữ trong thư mục `docs/` của repo — gồm các quyết định kiến trúc đã được ghi thành văn bản trong repo.
5. Issue đặc tả của việc đang làm — bối cảnh, phạm vi, quyết định liên quan (viết trọn vẹn trong issue) và tiêu chí nghiệm thu.

## Quy tắc làm việc chung

- **Bám pattern chính thức của package/framework bên ngoài:** khi dùng hay cấu hình bất kỳ package hay framework bên ngoài nào (thư viện bên thứ ba, ví dụ Vitest, NestJS, Kysely hay plugin ESLint), đội thi công PHẢI nghiên cứu pattern chính thức của chính thư viện đó trước — tài liệu, cách dùng khuyến nghị, bộ rule và quy ước của nhà phát hành — và dùng đúng như vậy. Cấm đoán hành vi của thư viện hay uốn nó theo thói quen từ nơi khác.
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

### Vòng Agent triển khai → Agent review → đồng thuận

1. **Phân vai độc lập:** Agent triển khai chịu trách nhiệm code, test, commit, push, mở/cập nhật PR và trả lời finding. Agent review là một lượt đánh giá độc lập (agent/phiên khác), phải đọc diff và bằng chứng thật thay vì dùng kết luận của Agent triển khai. Không tự đóng cả hai vai bằng một lời tự xác nhận; nếu không có reviewer độc lập, PR phải chờ.
2. **Agent code kết thúc lượt ngay sau khi push:** Khi hoàn tất phần việc và các kiểm chứng local cần thiết, Agent triển khai phải commit, push code lên remote, mở/cập nhật PR theo mẫu và bàn giao head SHA, phạm vi thay đổi, kết quả kiểm chứng đã chạy cùng phần chưa chạy. **Không chờ GitHub CI hoàn thành** mới bàn giao hoặc kết thúc lượt; ghi rõ CI đang chờ/đang chạy, không tự nhận CI xanh khi chưa có log. Không dùng `gh pr checks --watch`, `gh run watch` hoặc polling để đợi CI trong lượt Agent code. Không tự khởi chạy Agent review; người điều phối giao lượt review riêng sau khi PR đã được push. Mọi vòng sửa tiếp tục trên **chính PR đó**, không mở PR khác.
3. **Review phải công khai ngay trên PR:** sau khi hoàn tất mỗi lượt review, Agent review **phải đăng comment lên PR trước khi kết thúc lượt**, bằng `gh pr review <số> --comment --body-file <tệp>` hoặc `gh pr comment <số> --body-file <tệp>`. Comment nêu SHA đã đọc, kết luận **CHANGES_REQUESTED** hoặc **APPROVED**, từng finding có mức độ và vị trí file/dòng (hoặc ghi rõ không có finding), bằng chứng kiểm tra và phần chưa xác minh. Kết quả chỉ ở chat hoặc tài liệu local **không được tính**. Nếu dùng comment thay GitHub review chính thức, phải nói rõ đây là kết luận Agent, không ngụy nhận là approval của GitHub.
4. **Vòng lặp bắt buộc:** nếu có finding chặn, Agent triển khai xử lý, tự kiểm chứng, push commit mới, phản hồi tại PR với thay đổi và bằng chứng, rồi yêu cầu Agent review đánh giá lại. Reviewer đọc head SHA **mới nhất**, kiểm tra lại cả tác động dây chuyền và đăng comment kết luận mới. Approval/kết luận cũ không còn hiệu lực sau khi head thay đổi. Không giới hạn số vòng; nếu bất đồng chưa giải quyết, ghi rõ trên PR và chờ điều phối, không tự bỏ qua finding.
5. **Điều kiện đồng thuận:** Agent triển khai xác nhận đã xử lý mọi finding; Agent review đăng comment **APPROVED** cho **đúng head SHA cuối**, không còn finding chặn hoặc luồng thảo luận tồn đọng. Hai vai cùng thống nhất về kết quả và phạm vi; không suy diễn đồng thuận từ im lặng, CI xanh hoặc review ở SHA cũ. Review comment không thể thay thế các approval chính thức nếu ruleset GitHub yêu cầu.
6. **Cổng merge:** chỉ người/Agent được giao quyền merge mới thực hiện sau đồng thuận, PR không draft, mergeable sạch, job `verify`, `verify-stack` và mọi required status check trên head cuối đều thành công theo log GitHub thật. Kiểm tra lại SHA, trạng thái review và CI **ngay trước lệnh merge**. Issue PR merge bằng squash; issue tự đóng qua `Closes #<issue>`. Không tự merge chỉ vì một check hoặc Agent nói "xong".

### Dọn worktree và branch sau merge

1. Chỉ bắt đầu sau khi xác minh PR ở trạng thái **MERGED** trên GitHub (ví dụ `gh pr view <số> --json state,mergedAt,headRefName,baseRefName`), nhánh đích đã chứa thay đổi và issue đã đóng theo mục dưới. Không xóa worktree của PR còn mở, branch chưa merge hoặc dữ liệu đang làm dở.
2. **Kiểm kê cả dữ liệu Git ignore trước khi xóa:** từ worktree gốc, chạy `git -C .worktrees/<worktree> status --porcelain --untracked-files=all` và `git -C .worktrees/<worktree> ls-files --others --ignored --exclude-standard`. `git status --porcelain` báo sạch **không** bảo đảm worktree không có dữ liệu: `git worktree remove` có thể xóa cả file bị ignore như `.env` và `data/files/*`. Nếu có file sửa/chưa theo dõi, dừng và bảo toàn dữ liệu. Với mọi file bị ignore, phân loại rõ dữ liệu cần giữ và sản phẩm tái tạo được; so sánh `.env` với bản gốc bằng cách không in bí mật ra log, sao lưu bản khác biệt và chuyển dữ liệu local cần giữ ra ngoài worktree, kiểm tra bản sao có đủ trước khi tiếp tục. Không mặc định mọi file bị ignore đều có thể bỏ.
3. **Chỉ remove sau khi bảo toàn:** xác minh không có thay đổi chưa lưu, không còn file bị ignore có giá trị chưa được sao lưu, và những file còn lại được phép loại bỏ; khi đó mới chạy `git worktree remove .worktrees/<worktree>`. Cấm `reset --hard`, `clean -fd`, `worktree remove --force` để giải quyết cảnh báo.
4. Dọn branch local bằng `git branch -d <branch>`. Với squash merge, Git có thể không coi commit nhánh là tổ tiên của `main`: chỉ dùng `git branch -D <branch>` **sau khi xác minh đúng PR đã merge, toàn bộ commit thuộc PR đã được tích hợp và không còn thay đổi/commit cần giữ**. Xóa remote branch bằng `git push origin --delete <branch>` nếu GitHub chưa tự xóa sau merge; không xóa `main` hoặc nhánh của công việc khác.
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
