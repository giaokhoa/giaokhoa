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
| AC25      | **Chưa đạt**: resolver API/worker vẫn có `mode='shared'`, seed vẫn đăng ký trường học mặc định vào database chung, worker sweep vẫn đọc kho chung | Phải loại bỏ consumer và seed legacy, cập nhật test/hợp đồng, cài mới thật                     |
| AC26      | Có số đo PostgreSQL/Redis điểm thời gian, trần pool và concurrency cấu hình ở tài liệu tài nguyên                                                 | Thiếu đo **tải** worker với A/B/public chạy cùng lúc, RSS và đỉnh kết nối                      |
| AC27      | Build 10/10, lint/typecheck 30/30, 75/75 e2e đã chọn, 22/22 worker unit/integration                                                               | Chưa chạy toàn bộ tầng liên quan, `verify`, `verify-stack`, CI đúng SHA cuối và review độc lập |

## Lượt sửa theo review PR #62 (head mới chưa qua CI)

- Đã chặn mật khẩu demo quản trị production (Compose và validateEnv); kiểm bằng unit.
- Đã giới hạn Zod tạo/cập nhật registry ở `storageMode=dedicated`, vẫn giữ mô tả dòng legacy khi đọc dữ liệu lịch sử.
- Resolver API/worker từ chối registry shared; worker không còn route slug chưa chuẩn bị về handle mặc định; sweep các kho dedicated đang active và báo lỗi khi sổ có shared.
- Seed không còn gieo `truong-mac-dinh`; chỉ gieo registry Trang chính dedicated; reject seed trung tâm qua đường bootstrap.
- Unit hợp đồng 93/93, env 18/18, resolver API 11/11, resolver/sweep worker 9/9 và integration control plane 22/22 đã đạt trên worktree sửa; typecheck API/worker/contracts đạt.
- Lượt e2e ban đầu trên head sửa có 25/29 qua và 4 ca chưa đạt: một ca do không có `pg_dump` trong PATH và ba ca còn ràng buộc vào hành vi shared legacy (`space-routing-flow`). **Chưa thể coi là regression xanh/CI đạt.** Cần thay ca legacy bằng kiểm tra từ chối shared và chạy lại cùng PostgreSQL client 18.
- UI tạo trường học trong kho chung, test liên miền và phép đo tải worker vẫn còn cần xử lý; AC25–AC27 **chưa đạt**. Không dùng kết quả trên head cũ để đóng PR.

## Chốt hạng mục chưa thể nghiệm thu

1. Thay seed trường học/kho chung bằng bootstrap chuyên biệt: control plane, bank-system, trung tâm A/B và khu công cộng đều phải có database/role/miền file riêng. Đối chiếu cả nghiệp vụ ở `apps/api/src/modules/seed/seed.service.ts`, `apps/api/src/modules/control-plane/control-plane.service.ts`, `apps/api/src/db/routing`, `apps/worker/src/db/routing` và `apps/worker/src/db/routing/space-periodic-sweep.spec.ts`; không bỏ chế độ platform vận hành bằng cách vô tình làm hỏng đăng nhập quản trị.
2. Xoá đường tạo trường học trong shared và thông điệp UI/tài liệu legacy còn tồn tại; thay test xác nhận hành vi shared cũ bằng test **từ chối** shared trong mô hình đích, không xoá test để làm xanh giả.
3. Chạy lại tất cả AC01–AC27 trên cây tích hợp cuối, đo worker dưới tải thật, thu thập bằng chứng `verify` và `verify-stack` từ đúng head. Chỉ đề xuất merge/đóng issue #20 và #6 sau khi vòng review độc lập chấp thuận.

Không coi việc mọi issue phụ thuộc đã đóng là bằng chứng tự động hoàn thành các điều kiện còn thiếu này.
