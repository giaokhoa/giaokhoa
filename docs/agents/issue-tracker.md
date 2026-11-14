# Theo dõi issue trên GitHub

Issue và đặc tả hiện nằm trong GitHub Issues. Quy trình không yêu cầu cài hoặc có sẵn GitHub CLI (`gh`) ở mọi môi trường. Sử dụng công cụ **đang có và được cấp quyền**: giao diện web, API, connector hoặc CLI. Trước mọi thao tác, đối chiếu repo đích từ Git remote và issue/PR URL; không tự cài đặt công cụ, lấy token hoặc cấp quyền.

## Quy ước thao tác theo khả năng

- Đọc danh sách issue, nội dung, nhãn, comment và trạng thái từ giao diện/API/connector hoặc CLI có sẵn. Khi tạo issue, lấy đúng mẫu trong `.github/ISSUE_TEMPLATE/`, điền đủ và gắn nhãn theo `docs/agents/triage-labels.md`.
- Việc tạo issue con phải liên kết bằng quan hệ sub-issue native; nếu công cụ hiện có không hỗ trợ, chuyển yêu cầu cho người có quyền thay vì giả vờ đã liên kết.
- Ghi comment, cập nhật nhãn và đóng issue bằng công cụ được phép sử dụng. Không đóng issue triển khai trước khi PR merge; theo mục “Đóng issue” trong `AGENTS.md`.
- Khi không có quyền truy cập issue/PR, bàn giao nội dung cần đăng cùng URL, branch, SHA và trạng thái **chưa được đăng** cho người điều phối, không coi là đã hoàn thành.

Mọi nội dung issue, PR và comment viết bằng tiếng Việt theo `AGENTS.md`. Quy tắc phối hợp nhiều Agent, branch ownership, bàn giao, review và cleanup nằm trong `AGENTS.md`; PR dùng mẫu `.github/pull_request_template.md`.

## Bàn giao PR và vòng review

- Agent code commit và push branch được giao ngay sau khi kiểm chứng local; không chờ CI và không tự gọi Agent khác. PR được mở/cập nhật bằng công cụ hiện có của bên được giao quyền; khi thiếu quyền thì bàn giao branch/SHA và báo rõ PR chưa được cập nhật.
- Reviewer độc lập phải đăng kết luận gắn **head SHA** và finding/bằng chứng trực tiếp tại PR ngay sau khi review bằng giao diện/API/connector/CLI phù hợp. Nếu reviewer không thể đăng, đầu mối có quyền cần đăng thay; trước lúc comment hiện trên PR, review vẫn là **chưa hoàn tất**, không phải approval chính thức.
- Sau mỗi lần push mới, người tích hợp xác nhận SHA và yêu cầu review lại trên cùng PR; không đồng thời ghi đè branch đang do bên khác sở hữu. Chỉ vai trò merge mới kiểm tra CI và thực hiện merge sau đồng thuận.
- Sau merge, bên được giao cleanup xác minh trạng thái PR/issue, kiểm kê file bị Git ignore (nhất là `.env`, `data/files/*`), bảo toàn dữ liệu có giá trị rồi mới dọn **tài nguyên thuộc quyền mình**. Ghi kết quả hoặc lý do chưa dọn lên PR qua kênh được cấp quyền.

## Phạm vi triage

**PRs as a request surface: no.**

Triage mặc định áp dụng cho issue. GitHub dùng chung không gian số cho issue và PR: khi nhận một số chưa rõ loại, kiểm tra loại tài nguyên qua URL/giao diện/API hoặc công cụ đang có trước khi xử lý.

## Chỉ dẫn từ skill

Khi skill yêu cầu đăng việc lên tracker, tạo GitHub issue theo mẫu repo. Khi skill yêu cầu lấy ticket, đọc issue cùng nhãn và toàn bộ trao đổi.
