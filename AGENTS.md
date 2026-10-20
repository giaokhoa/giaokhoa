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

- **Một công việc, một worktree:** Mỗi issue hoặc yêu cầu, cùng PR giải quyết nó, chỉ được dùng **một branch và một Git worktree** trong `.worktrees/<slug>`. Tạo worktree một lần trước khi sửa; không làm việc trực tiếp trên nhánh mặc định hoặc dùng chung worktree cho công việc độc lập.
- **Tiếp tục đúng worktree:** Mọi yêu cầu bổ sung, audit, sửa lỗi, kiểm thử, review và chỉnh sửa theo PR/CI thuộc cùng công việc phải tiếp tục tại worktree ban đầu. Không tạo worktree hoặc PR mới chỉ vì có tin nhắn tiếp theo hay chuyển giai đoạn. Chỉ tạo worktree mới cho công việc thực sự độc lập; nếu chưa rõ, hỏi người dùng trước.
- Kiểm tra Git status, xác định nhánh mặc định và cập nhật remote khi có thể. Tạo branch tên ngắn bằng tiếng Anh từ nhánh mặc định mới nhất bằng `git worktree add -b <branch> .worktrees/<slug> <base>`.
- **Sao chép `.env` khi tạo worktree:** Ngay sau khi tạo worktree, tìm và sao chép mọi file cấu hình `.env` và `.env.*` từ worktree gốc sang worktree mới, kể cả file bị Git ignore; giữ nguyên đường dẫn tương đối, quyền truy cập và không ghi đè file đã có. Các file mẫu như `.env.example` đã được Git quản lý thì không cần sao chép lại. Trước khi chạy hoặc kết luận không chạy được test/app, kiểm tra các biến môi trường cần thiết và dịch vụ phụ thuộc; nếu thiếu biến, kiểm tra việc sao chép `.env` trước. Không in giá trị bí mật, không stage/commit/push file chứa thông tin bí mật.
- Đọc code, chỉnh sửa, kiểm thử và commit tại worktree của công việc. Giữ nguyên mọi thay đổi chưa commit của người khác.
- **Bắt buộc dùng `gh` khi làm việc với GitHub:** Dùng GitHub CLI `gh` để đọc/tạo/cập nhật issue, PR, review, CI/check và gọi GitHub API (qua `gh api` khi cần). Dùng `git` cho thao tác Git như worktree, branch, commit, fetch và push. Nếu `gh` không khả dụng hoặc bị từ chối quyền, báo chặn và hỏi hướng xử lý; không tự chuyển sang cách khác để lách giới hạn.
- Thực hiện GitHub Flow: thay đổi và kiểm thử → commit → push branch → mở PR vào nhánh mặc định → xử lý review/CI → merge khi được phê duyệt → dọn branch/worktree sau merge. Không push trực tiếp lên nhánh mặc định.
- Tiêu đề và nội dung PR bằng tiếng Việt, mô tả thay đổi, cách kiểm tra và liên kết issue nếu có. Không tự merge khi thiếu phê duyệt hoặc kiểm tra chưa đạt; không xóa worktree còn dữ liệu chưa lưu.
