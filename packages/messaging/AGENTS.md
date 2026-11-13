# AGENTS.md — Yêu cầu dành cho AI khi làm việc trong `packages/messaging`

## Nguồn sự thật (đọc trước khi sửa)

1. `README.md` của package này — quyết định nghiệp vụ còn hiệu lực; ngữ nghĩa chi tiết nằm ở comment đầu từng file nguồn.
2. Issue đặc tả của việc đang làm trên GitHub — nguồn sự thật cho việc đó: bối cảnh, phạm vi, các quyết định liên quan (viết trọn vẹn ngay trong issue) và tiêu chí nghiệm thu đều nằm trong chính issue. Không viện dẫn sổ quyết định, hồ sơ hay tệp ngoài repo làm căn cứ. Tài liệu trong repo mâu thuẫn với issue thì DỪNG, báo main chat.
3. `AGENTS.md` ở thư mục gốc của repo — quy định chung cho AI toàn repo, gồm chuẩn văn bản tự chứa cho issue và PR.

## Chuẩn ngôn ngữ

Code (định danh, tên hàm/biến/lớp, chuỗi kỹ thuật) viết bằng tiếng Anh. Cấm viết comment, gồm TSDoc/JSDoc, comment nội tuyến và comment mô tả luồng, trong mã nguồn hoặc cấu hình. Mã nguồn và cấu hình thực thi là nguồn sự thật duy nhất cho hành vi hiện hành; không dùng comment để lưu quyết định. Tài liệu trong repo và văn bản GitHub viết bằng tiếng Việt. Tuân thủ quy định tại `AGENTS.md` gốc.

## Ranh giới phạm vi

- 1 issue = 1 feat = 1 PR. Package thuần TypeScript: không thêm phụ thuộc Nest, Socket.IO hay client Redis vào package này — việc phát đi qua cổng `RealtimeEmitter`, việc đọc đi qua handle Kysely do app gọi truyền vào.
- Schema bảng lấy từ `@giaokhoa/db`, hợp đồng sự kiện lấy từ `@giaokhoa/contracts` — cấm sao chép định nghĩa bảng hay tên sự kiện vào package.

## Điều cấm package-specific

- Cấm phát realtime vòng qua tầng phân phối (`distribution-service.ts`): mọi lần phát vào room của một conversation đều phải qua cổng chặn cặp 1–1 fail-closed và rà soát membership tại thời điểm phân phối đã cài ở đó.
- Cấm nới kỷ luật fail-closed của cổng chặn (nuốt lỗi tra danh sách chặn thành danh sách rỗng) — không xác minh được quan hệ chặn thì nén toàn bộ lượt phân phối.
- Cấm dựng bản cài đặt truy vấn đọc thứ hai cho cùng một luật (đếm chưa đọc, lọc tin đã xoá, dựng trích dẫn): bề mặt đọc ở `distribution-store.ts` là bản cài đặt duy nhất cho cả đường REST phía API lẫn đường phân phối phía worker.
