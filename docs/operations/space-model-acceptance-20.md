# Đối chiếu nghiệm thu tích hợp — issue #20 / #6

Ngày kiểm tra: 14/11/2026. Worktree `.worktrees/feat-20-integrated-acceptance`; phạm vi đo và cấu hình PostgreSQL/Redis ở [ngân sách tài nguyên](space-resource-budget.md). **Đây là biên bản kiểm chứng từng phần, không phải xác nhận issue #20 đã hoàn thành.**

## Lệnh và kết quả thực tế

| Lệnh/chạy thử trên worktree                                                                                                                                                                                                                                       | Kết quả          | Giới hạn                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm install --offline --frozen-lockfile`                                                                                                                                                                                                                        | Exit 0           | Extension native tuỳ chọn `msgpackr-extract` không build được trên Python 3.14, nhưng install hoàn tất |
| `pnpm exec turbo run build --concurrency=3`                                                                                                                                                                                                                       | 10/10 tác vụ đạt | Trước khi sửa cấu hình Dev Container/tài liệu; mã ứng dụng không thay đổi                              |
| `pnpm exec turbo run lint typecheck --concurrency=3`                                                                                                                                                                                                              | 30/30 tác vụ đạt | Trước khi định dạng tài liệu; mã TypeScript không thay đổi                                             |
| `pnpm exec vitest run --project e2e test/e2e/platform/public-learning-flow.e2e-spec.ts` trong `apps/api`                                                                                                                                                          | 14/14 đạt        | Có `FLEET_PG_BIN_DIR` và `LD_LIBRARY_PATH` trỏ bộ client PostgreSQL 18.6 tạm thời                      |
| `pnpm exec vitest run --project e2e test/e2e/exams/system-shared-exams.e2e-spec.ts test/e2e/platform/space-provisioning-flow.e2e-spec.ts test/e2e/platform/support-grants-flow.e2e-spec.ts` trong `apps/api`                                                      | 22/22 đạt        | Khóa `flock /tmp/giaokhoa-heavy-suite.lock`                                                            |
| `pnpm exec vitest run --project e2e test/e2e/system-bank/system-bank-flow.e2e-spec.ts test/e2e/system-bank/system-materials.e2e-spec.ts test/e2e/system-bank/programme-package-flow.e2e-spec.ts test/e2e/quiz/quiz-shared-questions.e2e-spec.ts` trong `apps/api` | 39/39 đạt        | Khóa suite nặng như trên                                                                               |
| `pnpm exec vitest run --project unit src/db/routing/space-periodic-sweep.spec.ts src/db/routing/space-job-runner.spec.ts` trong `apps/worker`                                                                                                                     | 18/18 đạt        | Đơn vị, không đại diện cho tải production                                                              |
| `pnpm exec vitest run --project int test/integration/db/space-job-routing.int-spec.ts` trong `apps/worker`                                                                                                                                                        | 4/4 đạt          | PostgreSQL/Redis thật, dữ liệu test                                                                    |

Lần chạy e2e khu công cộng đầu tiên thất bại 1 ca vì Dev Container thiếu `pg_dump` (`spawn pg_dump ENOENT`). Sau khi cung cấp `pg_dump` và `pg_restore` phiên bản 18.6 trong thư mục tạm, chạy lại **14/14 đạt**, bao gồm phục hồi sang database staging và đăng nhập HTTP bằng role runtime. Cấu hình `.devcontainer/devcontainer.json` được cập nhật để cài `postgresql-client-18` khi tạo container mới; **chưa kiểm thử xây lại toàn bộ Dev Container**.

Các lỗi `ProblemDetailsFilter` ở những ca tiêm lỗi có chủ đích được ghi trong log nhưng không làm suite thất bại. Không trộn kết quả của một suite khác/head khác với các lệnh trên.

## Đối chiếu AC01–AC27 của issue cha #6

Đánh dấu **có bằng chứng từng phần** chỉ khi lệnh trên thực sự chạy; không coi riêng một test cục bộ là đủ để đóng một AC gồm nhiều bề mặt.

| AC        | Bằng chứng từ các ca đã chạy                                                                                                                      | Phần còn thiếu                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| AC01–AC03 | Provisioning, public-learning, phân tách token, tài khoản và role                                                                                 | Chưa chạy vòng đời khởi tạo _từ trạng thái sạch hoàn toàn_ cho đủ 4 miền                       |
| AC04      | Các suite kho riêng không phụ thuộc directory người dùng toàn cục khi truy cập                                                                    | Chưa xác minh sạch schema/seed ở trạng thái đầu tiên                                           |
| AC05      | Public-learning 14/14                                                                                                                             | Chưa đồng kiểm trong deployment chung với worker                                               |
| AC06–AC07 | Kiểm tra file/host trong public-learning, định tuyến job worker 22/22                                                                             | Chưa chạy đủ các ca xoá file/realtime/search/cache và retry xuyên miền                         |
| AC08–AC10 | System-bank 17 ca; materials 9 ca; programme 3 ca, tất cả đạt                                                                                     | Chưa kiểm đủ các loại nguồn/chính sách ở mỗi trạng thái                                        |
| AC11–AC14 | Quiz-shared 10 ca, system-shared-exams 6 ca đạt                                                                                                   | Chưa chạy riêng giao diện web và hết mọi nhánh chấm                                            |
| AC15–AC18 | System-shared-exams có rút nguồn/fork/rollback; quiz-shared thử bank ngừng truy cập và snapshot; đều đạt                                          | Chưa tổng hợp đủ phiên bản của mọi loại tài nguyên                                             |
| AC19–AC20 | Public-learning có ca backup/restore DB staging, đăng nhập role runtime qua HTTP đạt                                                              | Chưa chạy diễn tập restore đồng thời dữ liệu tất cả loại tài nguyên và kiểm file đầy đủ        |
| AC21      | Chưa chạy ca đóng/xoá A cùng dữ liệu tích hợp                                                                                                     | Cần kiểm giữ nguyên B, công cộng và bank sau cleanup                                           |
| AC22–AC23 | Support-grants 9/9 đạt: không grant, thu hồi, hết hạn, audit                                                                                      | Chưa chạy mọi bề mặt hồ sơ/điểm và token lỗi                                                   |
| AC24      | Chưa chạy test UI với thao tác thực                                                                                                               | Cần chạy giao diện tạo/giao đề và fork                                                         |
| AC25      | **Chưa đạt toàn diện**: đã từ chối shared trong resolver, bỏ seed trường mặc định và chặn API/UI tạo school chung; còn luồng/fixture cũ và thiếu cài sạch bốn miền | Phải loại bỏ consumer và seed legacy, cập nhật test/hợp đồng, cài mới thật                     |
| AC26      | Có số đo PostgreSQL/Redis điểm thời gian, trần pool và concurrency cấu hình ở tài liệu tài nguyên                                                 | Thiếu đo **tải** worker với A/B/public chạy cùng lúc, RSS và đỉnh kết nối                      |
| AC27      | Build 10/10, lint/typecheck 30/30, 75/75 e2e đã chọn, 22/22 worker unit/integration                                                               | Chưa chạy toàn bộ tầng liên quan, `verify`, `verify-stack`, CI đúng SHA cuối và review độc lập |

## Lượt sửa theo review PR #62 (head mới chưa qua CI)

- Đã chặn mật khẩu demo quản trị production (Compose và validateEnv); kiểm bằng unit.
- Đã giới hạn Zod tạo/cập nhật registry ở `storageMode=dedicated`, vẫn giữ mô tả dòng legacy khi đọc dữ liệu lịch sử.
- Resolver API/worker từ chối registry shared; worker không còn route slug chưa chuẩn bị về handle mặc định; sweep các kho dedicated đang active và báo lỗi khi sổ có shared.
- Seed không còn gieo `truong-mac-dinh`; chỉ gieo registry Trang chính dedicated; reject seed trung tâm qua đường bootstrap.
- Unit hợp đồng 93/93, env 18/18, resolver API 11/11, resolver/sweep worker 9/9 và integration control plane 22/22 đã đạt trên worktree sửa; typecheck API/worker/contracts đạt.
- Lượt e2e ban đầu trên head sửa có 25/29 qua và 4 ca chưa đạt: một ca do không có `pg_dump` trong PATH và ba ca còn ràng buộc vào hành vi shared legacy (`space-routing-flow`). **Chưa thể coi là regression xanh/CI đạt.** Cần thay ca legacy bằng kiểm tra từ chối shared và chạy lại cùng PostgreSQL client 18.
- API/UI tạo trường trong shared đã được chặn/gỡ ở lượt sau; các test liên miền khác, cách tách tất cả consumer legacy và phép đo tải worker vẫn cần xử lý; AC25–AC27 **chưa đạt**. Không dùng kết quả trên head cũ để đóng PR.

## Lượt sửa phản hồi review thứ hai của PR #62 (chưa xác minh CI trên SHA mới)

- HTTP `POST /tenants` chặn cả `school` và `center` ở kho platform với `400 centre.provision_required`; UI không còn biểu mẫu tạo trường shared; bản dịch và test web đã cập nhật. Web unit 8/8 và typecheck đạt.
- `deploy-check` sinh `ADMIN_PASSWORD` ngẫu nhiên cho CI trong `GITHUB_ENV`, không đưa mật khẩu mặc định production trở lại; chưa chạy được Docker Compose tại máy cục bộ vì môi trường không có Docker.
- HTTP tại hostname legacy shared bị từ chối với mã định tuyến cố định khi đọc identity; request dùng token của platform vào hostname shared bị từ chối 401 từ tầng xác thực. E2E `space-routing-flow` 8/8 đạt.
- Seed xác minh người quản trị trong **database hiện hành** thay vì tin cache ID cũ sau khi tái tạo database cùng tên; integration bootstrap DB trống qua HTTP 5/5 đạt sau khi build mới API. DB routing integration 9/9, routed Kysely 10/10, program-package integration 4/4 cũng đạt.
- Sao lưu và khôi phục dữ liệu khu công cộng với PostgreSQL client 18: e2e `public-learning-flow` 14/14 đạt.
- **Chưa có CI head mới**, chưa hoàn tất chuyển toàn bộ test nghiệp vụ legacy sang quy trình tạo kho riêng, chưa diễn tập đầy đủ AC17–AC21/AC24 hoặc đo tải worker AC26. PR tiếp tục ở dạng Draft và cả #20/#6 vẫn mở.

## Chốt hạng mục chưa thể nghiệm thu

1. Thay seed trường học/kho chung bằng bootstrap chuyên biệt: control plane, bank-system, trung tâm A/B và khu công cộng đều phải có database/role/miền file riêng. Đối chiếu cả nghiệp vụ ở `apps/api/src/modules/seed/seed.service.ts`, `apps/api/src/modules/control-plane/control-plane.service.ts`, `apps/api/src/db/routing`, `apps/worker/src/db/routing` và `apps/worker/src/db/routing/space-periodic-sweep.spec.ts`; không bỏ chế độ platform vận hành bằng cách vô tình làm hỏng đăng nhập quản trị.
2. Xoá đường tạo trường học trong shared và thông điệp UI/tài liệu legacy còn tồn tại; thay test xác nhận hành vi shared cũ bằng test **từ chối** shared trong mô hình đích, không xoá test để làm xanh giả.
3. Chạy lại tất cả AC01–AC27 trên cây tích hợp cuối, đo worker dưới tải thật, thu thập bằng chứng `verify` và `verify-stack` từ đúng head. Chỉ đề xuất merge/đóng issue #20 và #6 sau khi vòng review độc lập chấp thuận.

Không coi việc mọi issue phụ thuộc đã đóng là bằng chứng tự động hoàn thành các điều kiện còn thiếu này.

## Đối chiếu CI đỏ trên SHA `bb19a9968b2b3f63c97b1abf367de03688ff43bb`

Báo cáo GitHub Actions thực tế ngày 14/11/2026: CI run `43568422387`, deploy-check run `43568422375` đều thất bại. `test-api` đạt, `verify-workspace` lỗi 2 import không dùng; `verify-stack` API không khởi động vì password CI tạo dạng hex không có chữ hoa nên `UsersService` từ chối seed (`user.password_policy`). Bốn shard e2e thất bại. Báo cáo gộp blob: 950/1040 test đạt, 12 lỗi, 78 bỏ qua; ngoài ra 9 suite lỗi ở setup. Vì phần lớn các fixture này còn gọi `POST /tenants kind=school` vốn đã bị vô hiệu hóa đúng theo yêu cầu AC25, không được bật lại API legacy để giữ test xanh.

Lượt sửa sau đối chiếu: loại bỏ import unused; mật khẩu bootstrap CI dùng chuỗi ngẫu nhiên có chữ hoa/chữ thường/số/ký tự đặc biệt; gói chương trình không coi hostname platform là trung tâm; sửa HTTP `support-centres` trả 403 `space_routing.shared_not_supported` thay vì 500 khi gặp registry shared; kiểm thử âm tính không cho tạo trường/cấp grant legacy, và kiểm thử payment sai tenant sử dụng dữ liệu giả cố ý trong DB test. Lint và typecheck API đạt; e2e mục tiêu ban đầu 30/31, sau vá support riêng 9/9 đạt; chưa có bằng chứng CI head mới.

**Vẫn chặn AC25–AC27:** 9 suite setup legacy (quiz-shared, space-membership, system-shared-exams, socket-space-auth, space-pre-migration-gates, system-materials, tenant-isolation, messaging-group-creation, users-my-access), cùng các ca về system-bank, payments-refund và payments-coupons-slots cần được chuyển thành fixture cấp **database và role riêng** và chạy lại đầy đủ. Không loại bỏ test/ngắt CI để né các lỗi này. `verify-stack` cần xác nhận lại bằng log trên commit mới và bộ đo tải worker AC26 vẫn thiếu.

## Đối chiếu review độc lập lần 3 — head `adbb0bc`, ngày 14/11/2026

Đã đối chiếu [comment review #6873708515](https://github.com/giaokhoa/giaokhoa/pull/62#issuecomment-6873708515) và log CI run `43569888739`. Đúng: `verify-stack` PASS nhưng CI tổng vẫn đỏ; worker integration có 33 assertion lỗi, integration API có PostgreSQL `57P01` từ lần đóng DB bằng `WITH (FORCE)`, còn nhiều HTTP E2E legacy tạo school/shared.

Phần đã sửa trong lượt này:

- Worker chỉ sweep **registry kind=center, active, dedicated**; không quét `platform` hoặc `public`, kiểm soát thay identity, retry khi A lỗi không bỏ B. `OutboxRelayScheduler` quét center còn `publishPending` platform duy trì riêng. Unit bổ sung platform/public và legacy shared, kiểm tra không chạy callback sai scope.
- Fixture worker integration khởi tạo **control plane database độc lập**, đăng ký trung tâm `worker-fixture` hoặc đúng slug của test dưới `storage_mode=dedicated`, kết nối bằng role worker thường; không bỏ `sweepDedicatedSpaces` về code cũ. Mock class reconcile được sửa đúng contract. Test worker shared cũ đổi thành ca **từ chối** với mã `space_routing.shared_not_supported` và không ghi dữ liệu; trường hợp không chuẩn bị fail-closed.
- Worker thanh toán dùng slug registry dedicated của riêng suite thay vì fallback platform cho trường test; kiểm tra payment shared vẫn pending, không tự ghi danh; bài test giao dịch cross-space vẫn kiểm tra thanh toán ở kho đúng. Fixture digest có thể tắt scheduler tự chạy để kiểm tra chính xác một nhịp thủ công, tránh cạnh tranh lịch chạy.
- Tên database và role ở test integration system bank của API có hậu tố ngẫu nhiên theo process; bỏ `DROP DATABASE ... WITH (FORCE)` trước và sau mỗi ca, yêu cầu đóng pool thật trước khi drop (lỗi connection tồn đọng phải hiện ra, không ép cắt kết nối). Test system bank mục tiêu **10/10 đạt**.

**Chưa tuyên bố CI xanh hoặc AC25–AC27 hoàn tất.** HTTP E2E vẫn còn nhiều fixture tạo trường shared và AC liên miền/backup/restore/tải thực chưa đủ. Trạng thái trên commit cuối phải lấy từ CI GitHub Actions mới. Không merge/đóng issue nếu chưa đạt review độc lập.

## Review độc lập lần 4 — công cộng bị bỏ sót khỏi job worker

Đã đối chiếu [review lần 4](https://github.com/giaokhoa/giaokhoa/pull/62#issuecomment-6874331666) trên SHA `85a6ccb`: `verify-workspace`, `test-api`, `verify-stack` đã PASS, nhưng tất cả shard E2E vẫn FAIL; không hồi quy thành công các finding đã đóng. Phát hiện mới về `cong-cong` đúng: lệnh `provision-public` ghi `kind=platform`, còn bộ lọc worker cũ chỉ chọn `center`, làm mất quét outbox và job định kỳ của khu công cộng.

Sửa bộ lọc dùng đúng hợp đồng registry `kind=center` **hoặc** `kind=platform` và `slug=cong-cong`, luôn yêu cầu active/dedicated; `trang-chinh` không được thực thi callback học tập. Worker trả giá trị rỗng đúng kiểu cho các processor khi registry chưa có kho học tập active, không phát sinh lỗi retry giả; lỗi control plane mất kết nối và kho shared legacy vẫn được từ chối. Job relay giữ cơ chế platform riêng và dùng `spaceSlug`/`spaceId` bất biến cho khu công cộng.

Bằng chứng mục tiêu: worker unit routing/sweep/outbox **31/31**, integration PostgreSQL thật `space-job-routing.int-spec.ts` **6/6** (bao gồm outbox công cộng và nhịp `enrol-expiry` ở DB công cộng, không nhân đôi và không ghi nhầm platform/A/B). Fixture công cộng dùng đúng `kind=platform`, database và role riêng; không dựa trên `kind=public` không tồn tại trong contract.

Bổ sung ổn định fixture worker: `guardian-digest-delivery`, `guardian-digest` và `notification-events-catchup` trước đây dựng UUID qua `Date.now() % 991/997`, có thể trùng qua lần chạy DB test khác; nay UUID gắn phần ngẫu nhiên riêng cho mỗi run nhưng ổn định trong run. Ba suite này chạy lại **16/16 PASS**. Lượt full worker integration **trước sửa fixture** đạt 178/179 với lỗi unique active guardian link; **sau sửa fixture chạy lại toàn bộ 34 file / 179 test PASS**. Toàn bộ worker unit **21 file / 140 test PASS**; lint/typecheck/build worker PASS. Đây là bằng chứng local, chưa thay cho CI head cuối.

**Còn thiếu:** HTTP E2E legacy chưa di trú sang provision database/role riêng; thử nghiệm đồng thời/queue thực qua toàn bộ AC, số đo RSS/pool AC26 và các ca chốt AC01–AC27. Không đánh dấu hoàn tất khi CI trên commit cuối chưa đạt.

## CI E2E trên head `a53c682` — phân nhóm chặn và sửa local chưa push

Đã tải và gộp bốn blob test từ GitHub Actions run `43577129239`: **12 file fail / 136 file pass**, **8 test fail / 954 pass / 78 skipped**. Những nhóm `verify-workspace`, `test-api`, `verify-stack` PASS; fail nằm ở HTTP E2E và hậu quả `merge-e2e-reports` / `verify`. Không xem unit worker xanh là kết luận toàn PR.

Đã sửa local, chạy lại **5 file / 42 E2E PASS** cùng một lượt, bổ sung suite tenant-isolation lịch sử **11/11 PASS**:

- `messaging-group-creation-gate`: thay luồng tạo `school` qua API bằng `runSpaceProvision` cấp control-plane + role/database dedicated, kích hoạt lời mời rồi đăng nhập ở hostname trung tâm. Các kiểm tra quyền nhóm và chống xuyên kho giữ nguyên.
- `space-pre-migration-gates-587`, `space-membership-flow`, `messaging-socket-space-auth`: các suite tiền di trú đã có database/role dedicated riêng, nhưng còn dùng HTTP API để dựng **dữ liệu legacy trước di trú**. Fixture test hiện gieo dữ liệu lịch sử trực tiếp bằng SQL, sau đó sao sang kho riêng và kiểm các cổng thật; không mở lại API tạo shared. Kho legacy chỉ hợp lệ ở host gốc; thử dùng token legacy trên subdomain phải nhận 401.
- `users-my-access-equivalence`: fixture dữ liệu legacy cho oracle năng lực được gieo trực tiếp; tạo context đúng qua `ContextsService`, giữ nguyên phép đối chiếu năng lực.
- `platform/tenant-isolation`: fixture lịch sử TENANT-0 dùng dữ liệu legacy gieo trực tiếp, giữ các kiểm tra RLS và ẩn dữ liệu chéo; bài kiểm tra seed nay kiểm `POST /tenants kind=school` bị từ chối 400, không phụ thuộc một slug `truong-mac-dinh` cũ tồn tại trong DB tái sử dụng.

Cả nhóm API lint, typecheck, `git diff --check` PASS local. Các thay đổi này **chưa push**, vì còn 6 file E2E lỗi trên CI cũ: `quiz/quiz-shared-questions`, `exams/system-shared-exams`, `system-bank/system-bank-flow`, `system-bank/system-materials`, `payments/payments-refund-lifecycle`, `payments/payments-coupons-slots`. Những suite này cần tái cấu trúc các luồng shared thành dedicated cho đúng hành vi nghiệp vụ; không chỉ sửa mã trạng thái để qua test. CI chỉ được coi xanh sau khi tất cả E2E/verify PASS trên cùng SHA đã push, và AC01–AC27 vẫn cần kiểm chứng riêng.

## Sửa nốt sáu E2E CI đỏ trên head `a53c682` — bằng chứng local trước khi push

Nguồn lỗi đã xác định từ artifact Vitest `blob-report-e2e-{1,2,3,4}` trên GitHub run `43577129239` (không đoán theo job đỏ): `exams/system-shared-exams`, `quiz/quiz-shared-questions`, `system-bank/system-bank-flow`, `system-bank/system-materials`, `payments/payments-refund-lifecycle`, `payments/payments-coupons-slots`. Các thay đổi dưới đây thuộc **fixture E2E lịch sử** để không tái mở API `POST /tenants kind=school`: các bài test di trú đã có kho riêng vẫn giữ nguyên.

- `quiz/system-shared-questions`, `exams/system-shared-exams`, `system-bank/system-bank-flow`: tạo tiền trạng thái legacy bằng `seedLegacyCentreInShared` thay vì gọi cổng public hiện đã khóa, tạo context TENANT theo `ContextsService`; giữ nguyên các kiểm tra fork/snapshot/offline, media, điểm công bố, nhập gói/version và ca A/B dùng database/role dedicated thực. `quiz` + `exams` **16/16 PASS**, `system-bank-flow` **17/17 PASS** khi chạy cặp suite ngân hàng.
- `payments/payments-coupons-slots` và `payments/payments-refund-lifecycle`: tạo tiền trạng thái legacy cho các ca hạn mức/hoàn tiền, không mở lại API tạo trường; khóa SePay bank/XID/key ngẫu nhiên theo lượt chạy để tránh khớp IPN nhầm với tài khoản test cũ trên DB không reset. Đã xác minh bằng PostgreSQL thực, hai suite **25/25 PASS**.
- `system-bank/system-materials`: ca URL ký mới không chấp nhận token tenant trên host shared. Thay bằng A/B cấp qua `runSpaceProvision` có database và role dedicated thực, kích hoạt lời mời và đăng nhập đúng Host, chứng minh tải URL ký ở A, chặn B và host platform. Ca file legacy USER tiếp tục đọc ở kho legacy theo cổng hợp lệ nhưng phải từ chối token/URL legacy trên Host A/B không có kho dedicated. Suite **9/9 PASS**.

Đã có local **12 suite từng lỗi đều PASS khi chạy mục tiêu theo nhóm**; **full E2E 148 file**, GitHub Actions và độc lập nghiệm thu AC01–AC27 phải xác minh ở SHA cuối trước khi kết luận. Không bỏ/skip test, không nới cổng 400 `centre.provision_required` hay quyền đọc điểm.
