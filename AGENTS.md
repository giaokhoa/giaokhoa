# Quy tắc chung cho agent

- Đọc `AGENTS.md` ở root và các thư mục liên quan trước khi sửa. Quy tắc theo thư mục chỉ áp dụng trong phạm vi đó.
- Mỗi phiên đọc `.agents/skills/ponytail/SKILL.md`, áp dụng mức `full`: ưu tiên cách ngắn nhất đủ đúng, không thêm abstraction hoặc dependency không cần.
- Khi sửa code phụ thuộc framework/thư viện, kiểm tra phiên bản đã cài và tài liệu tương ứng.
- Markdown, comment, nội dung issue/PR viết tiếng Việt; code, định danh, script, tên branch/commit viết tiếng Anh.
- README/AGENTS chỉ ghi ràng buộc, nguồn chuẩn và lệnh thiết yếu; không chép lại flow đã có trong code.
- Agent giao việc phải chuyển tiếp các quy tắc này cho subagent.

## Git và GitHub

- Mỗi công việc/PR dùng một branch và worktree tại `.worktrees/<slug>`, không sửa trên branch mặc định. Các lượt bổ sung, audit, review và CI của cùng PR tiếp tục trong worktree đó.
- Tạo worktree từ nhánh mặc định mới nhất (fetch khi có thể); sao chép mọi `.env` và `.env.*` cục bộ từ worktree gốc, giữ đường dẫn/quyền và không ghi đè. Không stage hoặc push secret.
- Dùng `git` cho version control và `gh` cho issue, PR, review, CI, GitHub API; nếu `gh` không khả dụng hoặc thiếu quyền, báo chặn thay vì dùng cách khác.
- Kiểm tra thay đổi trước khi commit/push branch, tạo PR vào nhánh mặc định với tiêu đề và mô tả tiếng Việt. Không push trực tiếp lên branch mặc định, không tự merge khi chưa được phê duyệt hoặc CI chưa đạt, không xóa worktree còn thay đổi chưa lưu.
