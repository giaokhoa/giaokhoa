# AGENTS.md — Yêu cầu dành cho AI khi làm việc trong `packages/enrol`

## Nguồn sự thật (đọc trước khi sửa)

1. `README.md` của package này — quyết định nghiệp vụ còn hiệu lực; phần ngữ nghĩa chi tiết nằm ở comment đầu các file trong `src/`.
2. Issue đặc tả của việc đang làm trên GitHub — nguồn sự thật cho việc đó: bối cảnh, phạm vi, các quyết định liên quan (viết trọn vẹn ngay trong issue) và tiêu chí nghiệm thu đều nằm trong chính issue. Không viện dẫn sổ quyết định, hồ sơ hay tệp ngoài repo làm căn cứ. Tài liệu trong repo mâu thuẫn với issue thì DỪNG, báo main chat.
3. `AGENTS.md` ở thư mục gốc của repo — quy định chung cho AI toàn repo, gồm chuẩn văn bản tự chứa cho issue và PR.

## Chuẩn ngôn ngữ

Code (định danh, tên hàm/biến/lớp, chuỗi kỹ thuật) viết bằng tiếng Anh. Cấm viết comment, gồm TSDoc/JSDoc, comment nội tuyến và comment mô tả luồng, trong mã nguồn hoặc cấu hình. Mã nguồn và cấu hình thực thi là nguồn sự thật duy nhất cho hành vi hiện hành; không dùng comment để lưu quyết định. Tài liệu trong repo và văn bản GitHub viết bằng tiếng Việt. Tuân thủ quy định tại `AGENTS.md` gốc.

## Ranh giới phạm vi

- 1 issue = 1 feat = 1 PR. Package thuần tầng dữ liệu: không thêm phụ thuộc Nest/HTTP/framework ứng dụng vào package này dưới bất kỳ lý do nào — hạ tầng riêng của từng app (ghi outbox, ngữ cảnh tenant/platform) đi qua các cổng trong `src/types.ts` do app cấp vào.
- Nghiệp vụ thuộc về tiến trình (kiểm capability của người thao tác, tin nhắn chào mừng, consumer quét outbox, DTO/API) thuộc `apps/api` / `apps/worker` — không kéo vào đây.

## Điều cấm package-specific

- Cấm định nghĩa lại các kiểm đã có lõi dùng chung trong package (tách vai, đếm slot, toàn vẹn gán do ghi danh cấp) ở bất kỳ file nào khác — mọi chốt chặn phải gọi về đúng các lõi ở đây.
- Cấm đổi ngữ nghĩa đã chốt trong `README.md` của package (giữ/xoá dòng ghi danh theo dữ liệu liên quan, neo vật chất hoá vào trạng thái hiện tại của `cohort_members`, sự kiện tái tổng hợp hoàn thành phát trong cùng transaction với gỡ ghi danh) kể cả khi "thấy lạ": muốn đổi phải có quyết định mới viết trọn vẹn trong issue của việc đó và cập nhật README này cùng lượt.
- Cấm đưa sự kiện `course_completion_reaggregation_requested` vào bảng định tuyến relay của worker: phía API tiêu thụ nó qua mốc `seq` riêng của module hoàn thành.
