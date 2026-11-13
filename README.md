# Giáo khoa — TypeScript (NestJS + React)

Giáo khoa là nền tảng quản lý học tập viết bằng TypeScript (NestJS + React),
có phạm vi nghiệp vụ tương đương các phân hệ lõi của Moodle ở backend.
Hệ thống không tương thích ngược với cơ sở dữ liệu, định dạng file hay
giao thức của Moodle (xem báo cáo nghiên cứu).

## Cấu trúc thư mục

```
apps/
  api/      REST API NestJS 12 (TypeScript 6), Kysely, BullMQ, cache Redis
  worker/   Tiến trình nền NestJS 12: các processor BullMQ, outbox relay, các job chạy theo lịch
  web/      SPA React + Vite + React Router (TypeScript 7), shadcn/ui + Tailwind
packages/
  contracts/  Các schema zod dùng chung (Problem Details, health, …) — hợp đồng duy nhất giữa api và web
  config/     Các tsconfig cơ sở dùng chung
```

Luật phụ thuộc: `web` chỉ phụ thuộc vào `contracts`; `api`/`worker` dùng
chung cơ sở dữ liệu và Redis nhưng chạy ở các tiến trình riêng. Frontend
không bao giờ import code backend hay schema cơ sở dữ liệu.

## Điều kiện tiên quyết

- Node 24 (trường `engines` của `package.json` gốc), pnpm theo trường `packageManager` của `package.json` gốc
- PostgreSQL 18.6 tại `localhost:5432` (người dùng `postgres`/`postgres`, DB `giaokhoa` và hai DB test riêng `giaokhoa_test_api`/`giaokhoa_test_worker`) — bắt buộc bản 18.x: khoá chính mặc định dùng hàm `uuidv7()` native
- Redis tại `localhost:6379`

### Triển khai khu học tập công cộng (issue #8)

Khi triển khai **mới**, khu học tập công cộng sử dụng database và
role riêng, độc lập với các trung tâm và kho ngân hàng hệ thống. Xem
[quy trình cấp phát kho, đăng ký và cô lập phiên](docs/public-learning.md)
trước khi bật `PUBLIC_LEARNING_ENABLED`; mặc định công tắc tắt để
không thay đổi dữ liệu dùng chung hiện hữu.

## Phát triển trong Dev Container

Chỉ cần Docker và VS Code với extension Dev Containers trên máy host.
Cấu hình `.devcontainer/` dùng image Ubuntu dành cho Dev Container và
Features để cài Node 24, pnpm 12.14.0 (theo `packageManager` trong
`package.json`) cùng GitHub CLI. Service `app` chia sẻ network
namespace với PostgreSQL 18.6 và Redis 7, vì vậy API, worker và test
tiếp tục kết nối qua `localhost:5432` và `localhost:6379`.

PostgreSQL tạo database `giaokhoa` qua biến `POSTGRES_DB`; hai database
`giaokhoa_test_api` và `giaokhoa_test_worker` được khởi tạo bởi cơ chế chính
thức `/docker-entrypoint-initdb.d` của PostgreSQL (tài khoản/mật
khẩu: `postgres`/`postgres`). API và worker test dùng database
riêng để không giẫm lên dữ liệu nhau. Dev Container chỉ khởi động
sau khi PostgreSQL và Redis báo healthy. Với volume PostgreSQL đã
tồn tại, `init-db.sql` không chạy lại; cần tạo riêng các database
còn thiếu, không xóa volume nếu muốn giữ dữ liệu.

Lần đầu tạo container sẽ chạy `pnpm install --frozen-lockfile` và tạo
`apps/api/.env` / `apps/worker/.env` từ `.env.example` nếu chưa tồn
tại. GitHub CLI lưu cấu hình đăng nhập trong Docker volume riêng để
không mất khi rebuild container.

Mở repo trong VS Code, chọn "Dev Containers: Reopen in Container",
sau đó chạy migrate, seed, `pnpm dev` trong terminal container.
Chỉ cổng 3000 (API) và 5173 (web) được tự động forward để truy cập
từ máy host; cổng PostgreSQL 5432 và Redis 6379 chỉ dùng nội bộ
(trừ khi forward thủ công trong VS Code).

Container này CHỈ phục vụ phát triển. Đường triển khai production
dùng `Dockerfile` đa target và `compose.yaml` ở gốc repo như mô
tả ở mục [Triển khai production (tự host)](#triển-khai-production-tự-host) —
hai bộ file phục vụ hai mục đích khác nhau: devcontainer cho phát
triển local, compose ở gốc cho production tự host.

## Chạy ứng dụng

Từ gốc monorepo, chạy `pnpm dev` để Turbo biên dịch các workspace
package phụ thuộc trước khi mở API, worker và web ở chế độ watch.
Các bản build của package trong `dist/` có thể tồn tại từ lần checkout
trước, nên không khởi động trực tiếp các app trước khi Turbo hoàn tất
bước `^build`.

```bash
pnpm install
cp -n apps/api/.env.example apps/api/.env
cp -n apps/worker/.env.example apps/worker/.env
pnpm exec turbo run build --filter=@giaokhoa/db
pnpm --filter @giaokhoa/api db:migrate
pnpm dev
```

Lệnh migrate tự đọc `apps/api/.env` bằng cơ chế `--env-file-if-exists`
của Node 24, nhưng vẫn ưu tiên biến môi trường đã được export. API chạy
ở cổng 3000, web ở cổng 5173; worker xử lý tác vụ nền.

Mỗi Git worktree có thư mục `apps/api` và `apps/worker` riêng:
file `.env` không được Git đưa sang worktree mới. **Ngay sau khi tạo
worktree**, sao chép cả hai file `.env` từ worktree gốc sang worktree
đích (không ghi đè file đã có), theo lệnh và yêu cầu bảo vệ bí mật trong
`AGENTS.md`. Nếu file nguồn chưa tồn tại, tạo từ `.env.example` và
cấu hình trước khi chạy migrate hoặc `pnpm dev` trong worktree mới.

Nếu Dev Container sử dụng volume PostgreSQL **cũ** từ trước khi đổi tên
database `lms` thành `giaokhoa`, biến `POSTGRES_DB` và
`init-db.sql` không tạo lại database trong volume đã có dữ liệu.
Không xóa volume để sửa lỗi này. Trên **máy host** đang chạy Docker,
tạo thêm database mới một lần nếu chưa có:

```bash
docker compose -f .devcontainer/compose.yaml exec db createdb -U postgres giaokhoa
```

Sau đó kiểm tra `DATABASE_URL` trong hai file `.env` local đều
trỏ vào database `giaokhoa` (không ghi đè những giá trị bí mật khác),
rồi chạy lại lệnh migrate ở trên. Nếu database đã tồn tại, bỏ qua lệnh
`createdb`.

- Health: `GET http://localhost:3000/api/v1/health`
- OpenAPI: `http://localhost:3000/api/docs`

## Triển khai production (tự host)

Toàn bộ stack production chạy tự host bằng Docker Compose trên máy
chủ tự quản; nền tảng quản lý đích là Dokploy (quản lý chính file
compose này) và Cloudflare Tunnel công bố service web ra ngoài.

- `compose.yaml` ở gốc repo khai báo `postgres`, `redis`, `api`,
  `worker`, `web` và `gateway` (Caddy). PostgreSQL 18.6 cung cấp
  `uuidv7()` native. Healthcheck/depends_on quản lý thứ tự khởi động;
  volume giữ dữ liệu PostgreSQL, Redis và tệp tải lên.
- `Dockerfile` ở gốc repo build cả ba ứng dụng từ monorepo (pnpm +
  turbo) và đóng gói bằng `pnpm deploy --prod` thành ba target
  runtime `api`, `worker`, `web`.
- Topology một-origin: chỉ `gateway` (Caddy) publish cổng 8080,
  có thể đổi bằng `WEB_PORT`. `Caddyfile` chuyển `/api`,
  `/socket.io`, `/mcp` và OAuth metadata tới API, các request còn
  lại tới `@react-router/serve` của service `web`. Caddy giữ Host
  gốc, cookie và WebSocket/SSE; CSP gắn vào HTML. Web chạy SSR động,
  không prerender `/`/`/login` để loader luôn nhận cookie của request.

Dựng stack trên máy trống:

```bash
cp .env.example .env              # điền các bí mật bắt buộc và URL công khai
docker compose up -d --build      # migration tự áp xong trước khi api/worker khởi động
curl http://localhost:8080/api/v1/health   # kỳ vọng {"status":"ok",...}
```

- Migration được áp tự động ở mỗi lần khởi động stack: `api` và
  `worker` khai `depends_on` điều kiện
  `service_completed_successfully` vào service `migrate`, nên cơ sở
  dữ liệu trống được tự dựng ở lần `up` đầu tiên. Áp riêng khi cần:
  `docker compose run --rm migrate`.

- Lần đầu trên cơ sở dữ liệu trống, API tự tạo tài khoản quản trị
  theo `ADMIN_USERNAME` / `ADMIN_PASSWORD` trong `.env`; đổi mật
  khẩu ngay sau lần đăng nhập đầu tiên.
- Khôi phục dữ liệu từ hệ thống cũ: nạp bản `pg_dump` vào service
  `postgres` (bản đích cũng phải là PostgreSQL 18) trước khi khởi
  động `api`/`worker`; không chạy service `seed` trên dữ liệu đã
  khôi phục.
- Seed dữ liệu mẫu chỉ dùng cho môi trường thử nghiệm:
  `docker compose --profile seed run --rm seed`, rồi đăng nhập bằng
  các tài khoản mẫu ở mục [Môi trường review](#môi-trường-review).

## Môi trường review

Dùng các tài khoản mẫu trong bảng dưới đây để đăng nhập.

### Môi trường review local

Mọi nội dung dưới đây CHỈ dành cho **môi trường phát triển/review
local** — các mật khẩu là thông tin đăng nhập mẫu cho các tài khoản
demo được seed, tuyệt đối không dùng cho production.

### Khởi động toàn bộ stack (theo thứ tự)

```bash
# 1) Hạ tầng (máy này)
sudo pg_ctlcluster 18 main start          # PostgreSQL 18.6 tại localhost:5432 (hoặc: sudo service postgresql start)
redis-server --daemonize yes              # Redis tại localhost:6379 (hoặc: sudo service redis-server start)

# 2) Cài đặt + schema + dữ liệu mẫu (chỉ lần chạy đầu; seed có tính idempotent)
pnpm install
cp apps/api/.env.example apps/api/.env    # các mặc định khớp hạ tầng local (bỏ qua nếu .env đã có)
pnpm --filter @giaokhoa/api db:migrate
pnpm seed                                 # build API, rồi seed dữ liệu mẫu dưới đây

# 3) Chạy mọi thứ (API :3000, worker, web :5173) bằng một lệnh
pnpm dev
```

- Trang đăng nhập: `http://localhost:5173/login`
- Health của API: `http://localhost:3000/api/v1/health` · OpenAPI: `http://localhost:3000/api/docs`

### Tài khoản mẫu (được seed bằng `pnpm seed`)

| Vai trò                                         | Tên đăng nhập | Mật khẩu      |
| ----------------------------------------------- | ------------- | ------------- |
| Quản trị site                                   | `admin`       | `Admin123!`   |
| Giáo viên (giáo viên biên tập của khoá học mẫu) | `teacher1`    | `Teacher123!` |
| Học viên                                        | `student1`    | `Student123!` |
| Học viên                                        | `student2`    | `Student123!` |
| Phụ huynh (phụ huynh của học viên mẫu student1) | `parent1`     | `Parent123!`  |

Tài khoản admin do chính bootstrap của API tạo từ
`ADMIN_USERNAME` / `ADMIN_PASSWORD` (các giá trị mặc định ở trên; ghi đè qua
`apps/api/.env`). Seed bổ sung: tài khoản phụ huynh **parent1** liên kết
giám hộ sẵn với student1 (quan hệ Cha) để đăng nhập xem bề mặt phụ
huynh, và khoá học **DEMO101 — "Khoá học mẫu: Làm
quen với Giáo khoa"** với 3 section và 3 module, cả hai học viên đều đã ghi
danh, điểm mẫu (student1 = 8.5, student2 = 6.5 ở "Bài kiểm tra 1"), huy
hiệu "Huy hiệu khởi đầu" đã trao cho student1, và một sự kiện lịch của
khoá học vào 09:00 ngày mai.

Seed cũng nạp **toàn bộ chương trình GDPT 2018 cấp quốc gia**: cả 21
dataset đã kiểm chứng được đóng gói sẵn trong repo (2.115 bản ghi trên 19 môn
có dữ liệu — môn thứ 20, GDQP&AN, chưa có dataset đã kiểm chứng —
đối chiếu nguyên văn với tài liệu của Bộ). Seed **không** nạp từng
dataset theo từng bản ghi: nó restore bản dump chương trình đông
cứng đóng gói sẵn trong repo
(`apps/api/src/modules/curriculum/program-data-dump/program-dump.sql`,
được `ProgramDumpService` tạo một lần từ cơ sở dữ liệu chuẩn đã
kiểm chứng), nên một cơ sở dữ liệu dựng từ baseline + `pnpm seed`
đã chứa trọn cây chương trình với đúng cùng một tập định danh bản
ghi ở mọi môi trường — **sau khi reset không cần bước "import" thủ
công nào trong giao diện quản trị** (trang quản trị chỉ giữ đồng bộ
lại qua `ProgramImportService` như một tiện ích khi đính chính
dataset). Chạy lại seed sẽ bỏ qua phần chương trình khi dữ liệu đã
có mặt (restore theo cơ chế restore-if-empty), nên định danh chương
trình không bao giờ thay đổi khi seed lại. Đính chính một dataset
nghĩa là sửa ở cơ sở dữ liệu chuẩn rồi xuất lại dump
(`apps/api/src/modules/curriculum/export-program-dump.ts`), tuyệt đối không sửa tay
file dump.

### Các luồng chính cần review

Đăng nhập → mở khoá học mẫu → sổ điểm (giáo viên thấy báo cáo của
lớp) → ngân hàng câu hỏi → tin nhắn & thông báo → lịch → huy hiệu →
kế hoạch học tập → tìm kiếm → sao lưu / quyền riêng tư (các trang
platform, admin).

### Ngôn ngữ

Giao diện mặc định là **tiếng Việt**. Chuyển sang tiếng Anh bằng bộ
chọn "Ngôn ngữ / Language" trên thanh trên cùng; API cũng trả lời bằng
tiếng Việt theo mặc định và tôn trọng `Accept-Language: en`.

## Kiểm tra lint

`pnpm lint` tại root chỉ điều phối qua `turbo run lint`. Mỗi workspace
sở hữu lệnh `lint` và file cấu hình của mình; Turbo theo dõi cấu hình
shareable để cache không dùng lại kết quả cũ khi rule thay đổi.

- **TypeScript 6** (`api`, `worker`, `db`, `enrol`, `payments`): dùng
  ESLint 10 + `typescript-eslint` 8, config riêng `eslint.config.mjs`,
  kế thừa preset `@giaokhoa/eslint-config`. Parser dùng TypeScript 6
  riêng từ alias `@typescript/typescript6` (không bật typed linting).
- **TypeScript 7** (`web`, `contracts`, `editor`, `grades`, `messaging`,
  `ui`): dùng Oxlint 1.93.0 + `oxlint-tsgolint` 7,
  config riêng `.oxlintrc.json`, kế thừa preset `@giaokhoa/oxlint-config`.
  Oxlint chạy typed linting và kiểm tra kiểu bằng compiler TS7; rule
  React Compiler và Vitest quan trọng đều có severity `error`.
  Các workspace phụ thuộc vào declaration build của package khác
  (`web`, `editor`, `messaging`) khai `lint.dependsOn: ["^build"]`
  trong `turbo.json` riêng, vì type-aware lint cần `dist/*.d.ts` của
  dependency ngay cả trên checkout CI sạch.
- `packages/config` và `packages/oxlint-config` chỉ chứa JSON nên
  không cần task lint riêng; `packages/eslint-config` tự lint mã JS.

Lệnh chạy riêng: `pnpm --filter @giaokhoa/web lint` hoặc
`pnpm --filter @giaokhoa/api lint`. Chỉ API còn baseline
`eslint-suppressions.json` cho lỗi cũ; những workspace đã sạch đã bỏ file.
Khi sửa lỗi API, chạy
`pnpm --filter @giaokhoa/api exec eslint . --prune-suppressions` để
xóa những mục không còn cần.

## Kiểm chứng (định nghĩa "xanh")

```bash
pnpm install
turbo run build typecheck test
```

CI chạy các suite ngoài API ở `verify-workspace`, unit/integration API
ở `test-api`, và e2e API ở bốn shard độc lập. Mỗi job có PostgreSQL/Redis
riêng; `verify` là cổng tổng hợp, chỉ thành công khi mọi job kiểm chứng và
job gộp báo cáo e2e đều thành công. Cấu trúc này giữ đủ test nhưng không
bắt API chờ worker chạy xong.

GitHub Actions lưu `.turbo/cache` giữa các lượt để tái sử dụng build,
lint và typecheck theo input của Turbo. Task `test` đặt `cache: false`:
test luôn chạy trên PostgreSQL/Redis của lượt hiện tại, kể cả khi mã
nguồn không đổi. Docker tải dependency bằng `pnpm fetch` trước khi chép
nguồn, rồi `pnpm install --offline --frozen-lockfile`; sửa nguồn không
làm mất layer tải gói khi lockfile và cấu hình pnpm không đổi.
`deploy-check` xuất định nghĩa build bằng `docker compose build --print`,
chạy `docker/bake-action` để lưu/khôi phục cache layer GitHub Actions rồi
khởi động Compose bằng `--no-build` từ chính các image vừa dựng.

## Vận hành

Bảo vệ ở biên HTTP: các header bảo mật tiêu chuẩn trên mọi
response, CORS giới hạn trong `CORS_ORIGINS`, và giới hạn tốc độ hai lớp theo IP
bằng `@nestjs/throttler` chính thức — một giới hạn toàn cục
`RATE_LIMIT_PER_MINUTE` cộng một giới hạn chặt hơn
`RATE_LIMIT_AUTH_PER_MINUTE` cho các route auth có kiểm tra thông tin
đăng nhập. Hãy cân nhắc kỹ trước khi siết chặt: các trường học đứng
sau NAT dùng chung một IP công cộng.

## Chính sách phiên bản

Luôn dùng bản phát hành mới nhất của mọi dependency, trừ khi một trở
ngại đã ghi thành văn bản buộc phải ghim phiên bản (ghi ở dưới). Các
ghim/trở ngại hiện tại:

- Các app NestJS (`api`, `worker`): TypeScript **6.0.3** — `nest build`/toolchain của Nest
  chưa hỗ trợ TypeScript 7. Mọi thứ còn lại: 7.0.2.
- Tầng dữ liệu: Kysely qua package `@giaokhoa/db` — kiểu của ba kho sinh
  bằng `kysely-codegen` từ database thật, migration viết tay và áp
  bằng runner của chính package (các carrier đóng băng giữ nguyên
  từng byte).
- Test runner: Vitest ở mọi nơi — không dùng Jest.

## Các đơn giản hoá đã biết

- Hình dạng cơ sở dữ liệu là DÙNG CHUNG, không nhân đôi: kiểu sinh
  canonical nằm ở `packages/db` (sinh từ database thật bằng
  `kysely-codegen`) và được cả API lẫn worker dùng qua các
  repository của package — worker không giữ bản sao riêng.
- Script `dev` của API là `tsc --watch` + `node --watch` thay vì Nest
  CLI, để bản build giống hệt CI (`tsc`).

## Quy ước (chính thức)

- **I18n là bắt buộc và tập trung**: không có chuỗi hiển thị
  bị hardcode. Backend/worker dùng **@nestjs/i18n** chính thức (ghim chính xác
  `0.0.1`) với các catalog JSON ở `src/i18n/<locale>/` — locale mặc định
  là **tiếng Việt**, tiếng Anh đi kèm; lỗi mang `code` tiếng Anh ổn định
  và văn bản hiển thị của chúng được tra cứu theo code. Frontend dùng i18next +
  react-i18next với tài nguyên tập trung (`apps/web/src/i18n.ts`).
- **Validation chỉ dùng Zod**: các schema cơ sở nằm ở
  `packages/contracts` và là nguồn sự thật duy nhất cho API
  (Standard Schema pipe) và các form React; các trường chỉ dành cho server mở
  rộng từ schema cơ sở. class-validator/class-transformer đã bị loại bỏ
  hoàn toàn khỏi repo.
- **Ngôn ngữ của code và tài liệu**: code bằng tiếng Anh (định danh,
  khoá log, mã lỗi và các chuỗi kỹ thuật khác); **toàn bộ comment trong code
  bằng tiếng Việt theo phong cách TSDoc**
  (`/** */` kèm `@param`/`@returns`/`@throws` khi phù hợp) cho mọi
  API công khai và cho logic nghiệp vụ không hiển nhiên; **mọi tài liệu bằng tiếng Việt**
  — README, các tài liệu còn giữ trong repo, AGENTS.md và cả tài liệu API —
  không có ngoại lệ tiếng Anh cho bất kỳ tài liệu nào.
- **Hình dạng cơ sở dữ liệu chia theo bounded context**: hình dạng
  bảng của cả ba kho nằm ở package dùng chung `packages/db` dưới
  dạng kiểu sinh từ database thật (`packages/db/src/types/`), và
  mỗi bounded context sở hữu repository của mình tại
  `packages/db/src/repositories/` — cả API lẫn worker chỉ truy cập
  dữ kiện qua các repository và handle Kysely của package.
  Migration nằm ở `packages/db/migrations/<kho>` và áp bằng runner
  của package. Tên bảng/cột không bao giờ đổi khi tổ chức code
  thay đổi.
- **Đặt tên & vệ sinh repo**: mọi thứ được đặt tên theo
  nghiệp vụ / bounded context — **không có nhãn giai đoạn** trong code, comment, tên ca
  test hay tiêu đề commit; **không bao giờ commit sản phẩm đã biên dịch** (`dist/`,
  các file `.js`/`.d.ts` lạc cạnh mã nguồn). Đây là kỷ luật viết,
  được giữ bằng cách viết code đúng ngay từ đầu và bằng review —
  cố ý không có cơ chế cưỡng chế tự động cho việc này.
- **Nghiệm thu tính năng**: một tính năng chỉ được coi là xong khi
  luồng nghiệp vụ backend của nó được bao phủ bởi một flow test dịch từ
  oracle PHPUnit của Moodle.
- **Phiên bản luôn ưu tiên bản mới nhất**: luôn dùng bản phát hành mới
  nhất; chỉ ghim hoặc hạ phiên bản khi có trở ngại đã ghi thành văn bản ở trên
  (trở ngại hiện tại: TypeScript 6 cho các app NestJS).
