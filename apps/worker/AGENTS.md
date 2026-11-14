# AGENTS.md — Yêu cầu dành cho AI khi làm việc trong `apps/worker`

## Nguồn sự thật (đọc trước khi sửa)

1. `README.md` của package này — quyết định nghiệp vụ còn hiệu lực của `apps/worker`.
2. Issue đặc tả của việc đang làm trên GitHub — nguồn sự thật cho việc đó: bối cảnh, phạm vi, các quyết định liên quan (viết trọn vẹn ngay trong issue) và tiêu chí nghiệm thu đều nằm trong chính issue. Không viện dẫn sổ quyết định, hồ sơ hay tệp ngoài repo làm căn cứ. Tài liệu trong repo mâu thuẫn với issue thì DỪNG, báo main chat.
3. `AGENTS.md` ở thư mục gốc của repo — quy định chung cho AI toàn repo, gồm chuẩn văn bản tự chứa cho issue và PR.

## Chuẩn ngôn ngữ

Code (định danh, tên hàm/biến/lớp, chuỗi kỹ thuật) viết bằng tiếng Anh. Cấm viết comment, gồm TSDoc/JSDoc, comment nội tuyến và comment mô tả luồng, trong mã nguồn hoặc cấu hình. Mã nguồn và cấu hình thực thi là nguồn sự thật duy nhất cho hành vi hiện hành; không dùng comment để lưu quyết định. Tài liệu trong repo và văn bản GitHub viết bằng tiếng Việt. Tuân thủ quy định tại `AGENTS.md` gốc.

## Ranh giới phạm vi

- 1 issue = 1 feat = 1 PR; việc phát sinh của cùng feat comment vào đúng issue đó.
- Worker chỉ thực thi luật đã chốt. Cần luật mới → đặc tả và cập nhật tại issue, API và test liên quan; không tự chế luật trong processor/scheduler.

## Điều cấm package-specific

- Cấm phát thông báo/realtime qua đường riêng không qua hàm luật phân phối chung (mọi hàm `distribute*`/đường phát vào room đều phải qua cổng chặn — liệt kê đủ mọi đường phát trước khi khẳng định "đã gác hết", bài học PR #94).
- Cấm đưa điểm số/nội dung tin nhắn vào payload kênh ngoài (email/push/Zalo) — P4 là luật cứng.
- Cấm custom jobId BullMQ chứa dấu `:`.
- Cấm consumer giữ watermark chỉ trong bộ nhớ mà không có cơ chế tự neo khi DB reset (seq tối đa < watermark → neo lại).
- Cấm bản sao schema/logic riêng: schema lấy từ `packages/db`; không định nghĩa lại bảng trong worker.
- Khi dựng cụm Postgres local để test: cụm phải gọn (giữ ở `~/workspace` hoặc `/dev/shm` có cap WAL), tắt postmaster + xoá pgdata ngay khi xong.

## Kiểm chứng bắt buộc

- **Typecheck trước khi push**: `pnpm --filter @giaokhoa/worker typecheck`; build lại dist của `packages/db`/`packages/contracts` trước khi kết luận lỗi type.
- CI là cổng chính (suite worker có DB riêng `giaokhoa_test_worker` — không chạy đồng thời với suite api trên cùng DB); kết luận CI chỉ từ LOG THẬT.
- Local chỉ test targeted; suite nặng giữ khoá `flock /tmp/giaokhoa-heavy-suite.lock` suốt lượt chạy.

## Kỷ luật test theo nghiệp vụ

- Test worker phải thể hiện hệ quả nghiệp vụ quan sát được (thông báo bị chặn thì KHÔNG tới người nhận kể cả qua đường nền; đối soát không ghi danh lại người bị đình chỉ tay; digest không chứa điểm), không test chi tiết triển khai (thứ tự gọi nội bộ, tên job). Đổi luật nghiệp vụ thì test tương ứng phải fail.
- Job định kỳ phải có test về tính idempotent/chạy lại an toàn (chạy trùng không phát trùng, không cấp trùng quyền lợi).

## Không viết comment trong code

Không thêm, giữ lại hoặc tái tạo comment trong code, kể cả TSDoc/JSDoc, comment JSX, comment giải thích flow và comment cấu hình. Thể hiện hành vi bằng code rõ ràng và test kiểm chứng. Code là nguồn sự thật duy nhất; comment có nguy cơ lệch code và tốn token. Quy tắc chung nằm trong `AGENTS.md` gốc.

## Bản đồ flow của package

- **Điểm vào:** `src/main.ts` khởi động tiến trình nền (không HTTP); `src/worker.module.ts` lắp scheduler, processor và service. Cấu hình ở `src/config/env.ts`, bản dịch ở `src/i18n/`.
- **Luồng việc nền tổng thể:** lịch/kích hoạt → scheduler (`*.scheduler.ts`) quét điều kiện (outbox chờ chuyển tiếp, hạn hoạt động/ghi danh tới, mốc retention, chu kỳ đối soát) → đẩy job vào hàng đợi BullMQ (custom jobId **không chứa dấu `:`**) → processor trong `src/processors/` thực thi luật đã được đặc tả trong issue và thể hiện ở API/test → ghi DB dùng chung với API (schema lấy từ `packages/db`, ngữ cảnh tenant qua `src/db/` — `tenant-pool`, `tenant-als`, `relations`, `default-tenant`) → phát ra ngoài qua `notification-delivery.service.ts` và hàm luật phân phối chung (kênh ngoài tối thiểu hoá theo P4) → ghi vết bằng `event-log-writer.service.ts` / `task-log.service.ts`. Consumer outbox giữ watermark và **tự neo lại** khi seq của DB thấp hơn watermark sau reset.
- **Scheduler hiện có:** `outbox-relay` (chuyển tiếp outbox sang realtime), `activity-due-reminder` (nhắc hạn hoạt động), `enrol-expiry` (nhắc/hết hạn ghi danh), `guardian-digest` (digest phụ huynh), `notification-retention` (dọn thông báo theo retention), `class-enrol-reconcile` (đối soát ghi danh lớp theo roster).
- **Processor hiện có:** `notification-dispatch`, `activity-due-reminder`, `calendar-reminder`, `calendar-import`, `badge-award`, `completion-recalculate`, `enrol-expiry`, `class-enrol-reconcile`, `file-cleanup`, `guardian-digest`, `notification-retention`, `platform-services`.
