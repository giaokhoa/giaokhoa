# @giaokhoa/db — README nghiệp vụ

> File này ghi các **quyết định nghiệp vụ quan trọng và còn đang hiệu lực** của package. Nguồn sự thật về quyết định của package là chính file này, `AGENTS.md` của package và `AGENTS.md` ở thư mục gốc; quyết định liên quan tới một việc cụ thể được viết trọn vẹn trong issue đặc tả của việc đó trên GitHub.

## Package phụ trách nghiệp vụ gì

`packages/db` là **định nghĩa dữ liệu dùng chung duy nhất** của hệ thống: toàn bộ bảng của mọi miền nghiệp vụ (access, courses, questions, quiz, grades, messaging, payments, tenants, books, curriculum…) khai ở đây, để `apps/api` và `apps/worker` đọc/ghi trên **cùng một mô hình dữ liệu** — không còn bản sao schema riêng theo từng app (việc hợp nhất này là lý do package tồn tại). Hình dạng bảng ở đây quyết định những sự thật nghiệp vụ nào được lưu bền: trạng thái công bố điểm, quan hệ lớp–khoá, tenant của mọi bản ghi, vết audit.

Package này là tầng dữ liệu **Kysely** duy nhất của hệ: kiểu sinh từ DB thật, factory dựng instance, harness test và các repository Kysely trong `src/repositories/`. Chiến dịch chuyển tầng dữ liệu đã kết thúc — bộ máy ORM cũ đã gỡ hẳn khỏi cây mã ở hạng mục cuối của chiến dịch, và quy ước một ORM duy nhất ở mục "Quy ước tầng dữ liệu" dưới đây là trạng thái thường trực.

## Quyết định nghiệp vụ còn hiệu lực

| Quyết định                                                                                                                                                                                                                                                                                 | Nguồn                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Multi-tenant bằng shared DB: mọi bảng nghiệp vụ mang `tenant_id` và được PostgreSQL **RLS ép fail-closed** (policy theo GUC `app.tenant_id`; thiếu ngữ cảnh tenant = không thấy dữ liệu). Tenant = TRUNG TÂM; trang chính là tenant nền tảng.                                              | Sổ mục A; issue #166, TENANT-0                      |
| Khoá chính mặc định **UUIDv7** cho các bảng nghiệp vụ (trừ ngoại lệ đã chốt, vd bảng OAuth của Better Auth). Số lượng bảng/số mặc định uuidv7/số policy RLS là bất biến được spec ở apps/api khoá cứng — thay đổi schema phải cập nhật các đếm đó bằng con số đếm thật trên baseline cuối. | Nền uuidv7 toàn hệ; spec `uuidv7-primary-keys-flow` |
| Lớp–khoá: một khoá thuộc đúng một lớp (`course.class_id`); roster lớp nằm ở cohort đi kèm lớp (không bảng roster riêng) — schema phải giữ quan hệ này, không tạo đường ghi danh song song thứ hai.                                                                                         | Sổ mục A; issue #184                                |
| Dữ liệu chuẩn GDPT neo bằng UUIDv5 theo khoá tự nhiên; 4 FK từ dữ liệu chuẩn dùng `restrict` (không cascade) để import diff không xoá được dữ liệu đã neo.                                                                                                                                 | Phương án D, chốt 25/10/2026; issue #161            |
| Dự án xây từ đầu: **reset dữ liệu thoải mái tới khi chốt version** — schema tiến hoá bằng baseline mới, không thiết kế migration giữ dữ liệu live.                                                                                                                                         | Sổ mục F, chốt 23/10/2026                           |
| Hai dòng tiền tách bạch trong schema thanh toán: bản ghi thanh toán gắn tenant sở hữu và tài khoản nhận của chính chủ sở hữu; platform không thu hộ học phí trung tâm.                                                                                                                     | Sổ mục E; issue #189                                |

## Bản chụp gửi duyệt tại kho ngân hàng hệ thống (issue #13)

Migration `20261113143000_question_submissions` bổ sung `system_question_submissions` chỉ trong database `system-bank`, không thêm FK tới database trung tâm: mỗi dòng chụp JSONB package/checksum, trung tâm, id câu và version nguồn, người gửi, trạng thái pending/approved/rejected, người duyệt/thời điểm/lý do và id/version công bố. UNIQUE theo (centre_slug, source_question_id, source_version_id) làm idempotency khi gửi lại. FK công bố chỉ trỏ `system_questions` trong cùng kho. CHECK bắt buộc lý do khi từ chối và id/version công bố khi duyệt. `SystemBankSubmissionsRepository` duyệt trong một giao dịch Kysely với row lock + advisory lock theo câu nguồn, nên song song không tạo hai câu hay ghi trùng phiên bản. Bản đã công bố nằm ở `system_question_versions` bất biến cùng checksum, không giữ FK xuyên tenant.

## Miền sở hữu byte file (issue #10)

Cột files.storage_domain thuộc migration native 20261113050000_file_storage_domain. Mỗi file mới phải có miền space-<space_registry.id> (trung tâm/khu công cộng) hoặc bank-system (ngân hàng/Trang chính). Định danh miền không phụ thuộc hostname/tên; hai kho có cùng content_hash không dùng chung byte hoặc refcount. FilesRepository.countByHash(hash, domain) yêu cầu miền. Hàm thuần fileDomainForSpace, fileContentKey và assertFileStorageDomain từ barrel @giaokhoa/db là hợp đồng chung của API/worker. Bản ghi trước migration có miền legacy và đọc tương thích qua kiểm tra tenant sở hữu context, kể cả trên host trung tâm có quyền; HMAC còn gắn miền host hiện hành. Cleanup không xóa legacy, không di trú byte/hash cũ trong issue này.

## Khung Kysely

### Kiểu sinh từ DB thật (codegen)

- Ba file kiểu của ba kho — `src/types/centre-db.d.ts`, `src/types/control-plane-db.d.ts`, `src/types/system-bank-db.d.ts` — được **kysely-codegen sinh từ cơ sở dữ liệu thật**, không viết tay và không sửa tay. Lệnh `pnpm --filter @giaokhoa/db db:types` dựng ba database từ rỗng bằng đúng bộ SQL đang mang dữ liệu hiện hành (script `scripts/generate-types.mjs`), rồi chạy codegen cho từng kho. CI (job `verify`) chạy lại lệnh này và yêu cầu `git diff` trên `src/types/` rỗng — file kiểu lệch khỏi DB thật là CI đỏ.
- Kết nối quản trị cho `db:types` lấy từ biến môi trường `DB_TYPES_ADMIN_URL`, hoặc suy từ `DATABASE_URL` (thay tên database thành `postgres`). Cụm dưới PostgreSQL 18 được cài shim `uuidv7()` viết tay trước khi áp SQL (PG18 có hàm tích hợp); shim nằm ngoài nội dung SQL mang dữ liệu.
- **Không camelCase ở bất kỳ tầng nào**: không bật `--camel-case` của codegen, không dùng `CamelCasePlugin` — tên bảng/cột trong kiểu giữ đúng snake_case của DB (`row.tenant_id`), một nguồn sự thật duy nhất là DB thật.
- Ánh xạ kiểu mặc định của codegen được giữ nguyên: `uuid` → `string`, `timestamptz` → `ColumnType<Date, …>`, `numeric` → `string` (hiện repo chưa có cột numeric nào — đây là kỷ luật phòng ngừa cho cột đầu tiên xuất hiện).
- **Cột có giá trị mặc định** được codegen bọc trong `Generated<…>`: cổng đếm theo kho trên cụm PG18 thật — số cột `id` có mặc định `uuidv7()` là **trung tâm 189 (187 baseline + 2 bảng quyền hỗ trợ issue #19), control plane 4, ngân hàng hệ thống 14** (đếm trên catalog của DB dựng từ rỗng; riêng `oauth_client.id` mang mặc định `gen_random_uuid()` nên số `id: Generated<string>` trong file sinh của kho trung tâm là 190).
- **Cột jsonb có hình dạng nghiệp vụ thật** (hình dạng được giữ ở `src/jsonb-types.ts`) phải có override từng cột trong file cấu hình codegen của kho (`scripts/codegen/<kho>.json`, khoá `overrides.columns` theo dạng `bảng.cột`, kèm `customImports` trỏ về nơi định nghĩa kiểu thật). Chuỗi override thay toàn bộ kiểu của cột nên phải tự mang `| null` khi cột nullable và `Generated<…>` khi cột có mặc định. Hiện có 21 cột như vậy (liệt kê trong chính các file cấu hình). Lưu ý `--type-mapping` của kysely-codegen ánh xạ theo **kiểu dữ liệu PostgreSQL** trên toàn cục — không dùng nó cho override từng cột.
- Sau khi đổi hình dạng DB, migration mới viết tay và `db:types` là cơ chế bắt lệch kiểu (không còn `db:generate` cho phần đã chuyển sang Kysely).

### Factory và kiểu handle

- `src/client.ts` khai ba factory — `createCentreKysely(pool)`, `createControlPlaneKysely(pool)`, `createSystemBankKysely(pool)` — dùng `PostgresDialect` với pool do tầng ứng dụng cấp, kèm các kiểu handle `CentreDb`/`CentreTx`, `ControlPlaneDb`/`ControlPlaneTx`, `SystemBankDb`/`SystemBankTx`. Mọi repository Kysely nhận handle qua các kiểu này; kiểu hàng suy bằng `Selectable`/`Insertable`/`Updateable` của Kysely trên interface schema (thay `$inferSelect`/`$inferInsert`).
- Vòng đời instance đi theo vòng đời pool của ứng dụng: `instance.destroy()` đóng luôn pool đã truyền vào.

### Luật của package đối với mã Kysely

- Package **không tự mở pool, không đọc biến môi trường** — pool luôn do tầng ứng dụng tạo (đã gắn ngữ cảnh tenant/GUC nếu là kho trung tâm) và truyền vào factory.
- Repository trong package **không import từ `apps/*`**, **không đọc ALS hay ngữ cảnh của app**, **không giữ kết nối riêng ngoài factory**: mọi truy vấn đi qua handle được truyền vào. Ngữ cảnh tenant đến từ pool (GUC ở tầng kết nối), không đến từ tham số của repository.
- Điểm vào test-support (`@giaokhoa/db/test-support`, thư mục `src/test-support/`) chỉ dùng trong test: dựng DB test từ rỗng bằng SQL mang dữ liệu (`buildTestDatabase`), pool test gắn ngữ cảnh tenant theo đúng hợp đồng GUC của hệ (`TestTenantPool`), và `createTestKysely(...)` bọc ba factory production cho spec.

## Quy ước tầng dữ liệu

- **Một ORM duy nhất**: mọi đường dữ liệu của mọi module đi qua handle Kysely của package này; không đưa ORM thứ hai vào cây mã.
- **Một giao dịch một handle**: một thao tác nghiệp vụ mở giao dịch trên đúng một handle Kysely — tính nguyên tử không bắc qua hai handle độc lập được.
- Hình dạng bảng không khai tay: kiểu của ba kho sinh bằng `kysely-codegen` từ database thật vào `src/types/`; hình dạng jsonb nghiệp vụ mà codegen tham chiếu sống ở `src/jsonb-types.ts`.

## Ranh giới — package này KHÔNG làm gì

- Không chứa logic nghiệp vụ hay gác quyền theo capability: package giữ định nghĩa dữ liệu và (phần đã chuyển) các hàm truy cập dữ liệu thuần qua handle; luật chạy nằm ở `apps/api`.
- Carrier migration hiện hành nằm ở `packages/db/migrations/<kho>` (centre, control-plane, system-bank) — bộ SQL đóng băng dời từ `apps/api` ở hạng mục nền thứ hai của chiến dịch (issue #639); bộ máy áp là Migrator của Kysely trong `src/migrate/` (provider đọc carrier, runner CLI `dist/migrate/run.js <kho>`, hậu kiểm số đếm). Bảng nhật ký của bộ máy cũ trong các database đang sống giữ nguyên không đụng vào (không xoá); mã nguồn không còn đọc nó.
- Không phải hợp đồng API: hình dạng request/response thuộc `packages/contracts`.

## Kỹ thuật tối thiểu

- Hình dạng dữ liệu canonical được sinh từ database thật vào `src/types/{centre-db,control-plane-db,system-bank-db}.d.ts`; package **không còn** các file `*.schema.ts` hay `infrastructure.schema.ts` viết tay. Factory và kiểu handle ở `src/client.ts`; repository Kysely theo bounded context ở `src/repositories/<miền>.ts`. Ba bộ SQL migration tách dưới `migrations/{centre,control-plane,system-bank}/`; runner ở `src/migrate/`.
- Các kho có điểm vào riêng theo public `exports`: `@giaokhoa/db` (`src/index.ts`, kho trung tâm), `@giaokhoa/db/control-plane` (`src/control-plane.ts`), `@giaokhoa/db/system-bank` (`src/system-bank.ts`), `@giaokhoa/db/repositories/*` (repository), `@giaokhoa/db/migrate` và `@giaokhoa/db/test-support`. Không đưa các kho khác vào barrel trung tâm để tránh trộn quyền truy cập và migration giữa các database. Test của package colocate: unit `src/**/*.spec.ts`, integration với DB thật `src/**/*.int-spec.ts`, chạy hai Vitest project riêng. Đây là ngoại lệ của package dữ liệu so với bố trí `test/integration/` của các backend app; không di chuyển hàng loạt spec nếu chưa kiểm soát được import và fixture.
- Subpath repository khai bằng **một** wildcard duy nhất (`"./repositories/*"` trong `package.json`, một dòng `paths` wildcard tương ứng trong tsconfig của `apps/api` và `apps/worker`) — không khai thêm đường dẫn riêng cho từng module repository.
- App tiêu thụ dùng bản `dist` — sửa package xong phải build lại trước khi typecheck/migrate ở app (dist cũ = lỗi giả kinh điển). Build của package chép cả ba file kiểu sinh vào `dist/types/` (tsc không tự chép file `.d.ts` đầu vào).

### Ranh giới schema control plane (issue #9)

Kho control plane chỉ giữ bốn bảng vận hành: space_registry (slug, trạng thái,
chế độ lưu trữ, tham chiếu cấu hình kết nối, gói dịch vụ và phiên bản schema),
space_registry_history, space_schema_registry và space_schema_migration_runs.
Migration 20261113043200_remove_business_directories xoá hai bảng
space_membership_directory và space_join_code_directory; không giữ
nhánh đọc/ghi hoặc backfill tương thích với dữ liệu cũ. Dữ liệu người học,
giáo viên và mã tham gia lớp phải tồn tại trong đúng database nghiệp vụ
của Host. Khi nâng cấp, áp migration control plane bằng Migrator có sẵn
trước khi khởi động API mới; không sửa các migration cũ.
File kiểu src/types/control-plane-db.d.ts được sinh lại bằng db:types
trên database dựng từ rỗng, không sửa tay.

## Dữ liệu cấp quyền hỗ trợ hữu hạn (issue #19)

Migration trung tâm `20261113100000_support_grants` tạo `support_grants` và `support_access_events`, đều mang `tenant_id` bắt buộc, PK UUIDv7, `ENABLE/FORCE ROW LEVEL SECURITY` với policy tenant fail-closed. Grant không liên kết token nghiệp vụ: gắn `recipient_id` của nhân sự platform, `scopes` tập thao tác đóng, `expires_at`, `revoked_at`; không có scope wildcard. Audit chỉ lưu tenant/grant/actor/action/scope/thời điểm, **không có payload nghiệp vụ**. Repository `src/repositories/support-grants.ts` chạy trên Kysely routed handle, nhận DB/transaction từ caller và không tự mở kết nối. Mọi truy vấn phục vụ grant trên kho đích ghim GUC tenant thật, không dùng platform bypass; cổng cấp và thu hồi ghi sự kiện trong cùng transaction. FK grant_id của bảng audit có index riêng; hậu kiểm migration trung tâm mong đợi 204 bảng, 25 policy RLS, 420 index nghiệp vụ và 5 dòng nhật ký migration (sau migration học liệu #16 và gói chương trình #17).

## Phiên bản học liệu và bản tiếp nhận (issue #16)

Migration `system-bank/20261113160000_system_materials` thêm ba bảng `system_materials`, `system_material_versions`, `system_material_submissions`, không FK xuyên kho. Package JSONB có override codegen theo `SystemMaterialPackage` tại `src/jsonb-types.ts`. UNIQUE nguồn/revision và khoá giao dịch chống phát hành trùng; trigger từ chối UPDATE/DELETE phiên bản. Kho ngân hàng sau migration có 14 bảng/14 PK mặc định UUIDv7 và 4 dòng nhật ký, không có dữ liệu khoá/người học.

Migration `centre/20261113160000_system_material_references` thêm id/version/checksum vào `resources`. Ba trường cùng rỗng hoặc cùng có giá trị hợp lệ; bản tiếp nhận không chứa fileId/URL/nội dung biên tập. `resources` kế thừa RLS của `course` qua policy EXISTS. `content_bank_content` nhận tenant_id bắt buộc, FK/index và RLS fail-closed; dữ liệu cũ neo khoá/tổ lấy tenant tương ứng; học liệu cá nhân/trường neo ở context USER/SYSTEM lấy tenant khi tác giả có duy nhất một membership lịch sử. Nếu thiếu chứng cứ hoặc nhiều membership mâu thuẫn, migration báo lỗi `contentbank.legacy_owner_unresolved` và rollback, không tự gán về Trang chính. Cần xác minh và làm rõ quyền sở hữu dữ liệu lịch sử trước khi nâng cấp; không đoán tenant cho bản ghi mơ hồ. Mỗi lần tạo mới ghi tenant hiệu lực tường minh; không có ngữ cảnh tenant thì không tạo học liệu. Số bảng/UUIDv7 trung tâm giữ 204/189; hậu kiểm có 25 policy, 420 index nghiệp vụ và 5 dòng nhật ký. Byte công bố giữ khoá riêng trong miền bank-system, không thuộc refcount/cleanup file riêng của trung tâm.
