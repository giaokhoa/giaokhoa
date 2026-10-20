# Quy tắc chung cho mọi agent

Các quy tắc này là bắt buộc đối với mọi agent và subagent làm việc trong repository.

## Phạm vi hướng dẫn

- Trước khi làm việc, đọc `AGENTS.md` ở root và mọi `AGENTS.md` trên đường dẫn đến thư mục chứa file cần sửa, theo thứ tự từ ngoài vào trong.
- Nếu một yêu cầu đụng đến nhiều package hoặc app, đọc `AGENTS.md` của từng khu vực liên quan. Hướng dẫn theo thư mục chỉ áp dụng trong phạm vi đó và bổ sung cho quy tắc chung.
- Chỉ để quy tắc áp dụng toàn repository trong file này. Quy ước riêng của package hoặc app phải đặt trong `AGENTS.md` tại thư mục tương ứng.

## Quy tắc bắt buộc

- **Ponytail full:** Mỗi phiên phải đọc `.agents/skills/ponytail/SKILL.md` và áp dụng mức `full`. Chọn giải pháp đơn giản nhất đáp ứng yêu cầu, ưu tiên code sẵn có, thư viện chuẩn và tính năng nền tảng. Không tự chuyển sang `lite` hoặc `ultra`.
- **Đúng phiên bản:** Trước khi thay đổi phần liên quan đến framework hoặc package bên ngoài, xác định phiên bản đang cài qua manifest/lockfile rồi đọc lại tài liệu phù hợp chính phiên bản đó.
- **Tối thiểu:** Chỉ dùng phần cần thiết của pattern trong tài liệu để hoàn thành yêu cầu. Không thêm config, abstraction, dependency hay boilerplate thừa.
- **Tiếng Việt:** Mọi file Markdown, comment trong code, nội dung issue và PR phải viết bằng tiếng Việt; giữ nguyên thuật ngữ kỹ thuật, đường dẫn, lệnh và đoạn code khi cần.
- **Tiếng Anh:** Code, định danh, tên hàm/class/type, API, key cấu hình, script, test, tên branch và commit message phải viết bằng tiếng Anh. Comment vẫn bằng tiếng Việt.
- Agent giao việc cho agent khác phải bảo đảm các quy tắc trên cũng được áp dụng.

## Quy trình GitHub Flow

- Mỗi issue hoặc yêu cầu liên quan đến repository phải có branch riêng và Git worktree riêng trong `.worktrees/<slug>`. Tạo worktree trước khi sửa; không làm việc trực tiếp trên nhánh mặc định hoặc dùng chung worktree cho yêu cầu độc lập.
- Kiểm tra Git status, xác định nhánh mặc định và cập nhật remote khi có thể. Tạo branch tên ngắn bằng tiếng Anh từ nhánh mặc định mới nhất bằng `git worktree add -b <branch> .worktrees/<slug> <base>`.
- Đọc code, chỉnh sửa, kiểm thử và commit tại worktree của yêu cầu. Giữ nguyên mọi thay đổi chưa commit của người khác. Với cùng yêu cầu, tiếp tục tại worktree đã tạo.
- Thực hiện GitHub Flow: thay đổi và kiểm thử → commit → push branch → mở PR vào nhánh mặc định → xử lý review/CI → merge khi được phê duyệt → dọn branch/worktree sau merge. Không push trực tiếp lên nhánh mặc định.
- Tiêu đề và nội dung PR bằng tiếng Việt, mô tả thay đổi, cách kiểm tra và liên kết issue nếu có. Không tự merge khi thiếu phê duyệt hoặc kiểm tra chưa đạt; không xóa worktree còn dữ liệu chưa lưu.

## Kiểm tra chung

Sau khi thay đổi ranh giới package, persistence, shared schema hoặc HTTP descriptor, chạy:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @giaokhoa/api test:e2e
git diff --check
```
