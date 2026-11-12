# Theo dõi issue trên GitHub

Issue và đặc tả của repo nằm trong GitHub Issues. Dùng GitHub CLI (`gh`);
repo đích được xác định từ Git remote của worktree hiện tại.

## Quy ước thao tác

- Đọc issue, nhãn và trao đổi: `gh issue view <số> --json number,title,body,labels,comments,state,url`.
- Liệt kê issue: `gh issue list --state open --json number,title,body,labels`,
  lọc thêm bằng `--label` khi cần.
- Tạo issue: lấy nội dung mẫu phù hợp trong `.github/ISSUE_TEMPLATE/`,
  điền đủ các mục rồi dùng `gh issue create --title '<tiêu đề>' --body-file <tệp>`.
  Gắn nhãn theo `docs/agents/triage-labels.md`.
- Ghi comment: `gh issue comment <số> --body-file <tệp>`.
- Đổi nhãn: `gh issue edit <số> --add-label <nhãn-mới> --remove-label <nhãn-cũ>`.
- Issue con phải dùng quan hệ sub-issue native của GitHub;
  `gh issue create --parent <số-cha>` tạo và liên kết ngay khi mở issue con.
- Đóng issue theo mục “Đóng issue” trong `AGENTS.md`: issue được triển khai
  đóng qua PR có `Closes #<số>`; kết luận `wontfix` chỉ đóng sau khi
  người duy trì xác nhận và có giải thích cụ thể.

Mọi nội dung issue, PR và comment viết bằng tiếng Việt theo `AGENTS.md`.
Quy trình nhánh, worktree, PR và cổng review nằm trong `AGENTS.md`;
PR dùng mẫu `.github/pull_request_template.md`.

## Phạm vi triage

**PRs as a request surface: no.**

Triage mặc định áp dụng cho issue. GitHub dùng chung không gian số cho
issue và PR: khi nhận một số chưa rõ loại, kiểm tra bằng
`gh pr view <số>`, rồi dùng `gh issue view <số>` nếu đó không phải PR.

## Chỉ dẫn từ skill

Khi skill yêu cầu đăng việc lên tracker, tạo GitHub issue theo mẫu repo.
Khi skill yêu cầu lấy ticket, đọc issue cùng nhãn và toàn bộ trao đổi.
