# Quy tắc chung cho mọi trợ lý lập trình

Các quy tắc này bắt buộc với trợ lý chính và trợ lý phụ (subagent) làm việc trong kho mã nguồn.

## Phạm vi hướng dẫn

- Trước khi làm việc, đọc `AGENTS.md` ở thư mục gốc và mọi `AGENTS.md` trên đường dẫn tới thư mục cần sửa, theo thứ tự từ ngoài vào trong.
- Nếu thay đổi liên quan nhiều gói hoặc ứng dụng, đọc hướng dẫn của từng khu vực. Quy ước riêng chỉ áp dụng trong phạm vi đó và bổ sung cho quy tắc chung.
- `AGENTS.md` chỉ quy định vai trò, trách nhiệm, ranh giới phụ thuộc và quy ước chung của vùng mã. Quy tắc riêng cho từng luồng nghiệp vụ phải nằm ngay tại dịch vụ, kho dữ liệu, hợp đồng hoặc kiểm thử sở hữu luồng đó; không đưa trình tự xử lý, điều kiện hay ngoại lệ nghiệp vụ vào `AGENTS.md` hoặc `README.md`.

## Ngôn ngữ và tính nhất quán

- **Viết thuần tiếng Việt** trong tài liệu, chú thích mã, mô tả nhóm và ca kiểm thử (`describe`, `it`, `test`), nội dung vấn đề, yêu cầu hợp nhất mã và trao đổi bằng văn bản. Không xen từ tiếng Anh tùy tiện vào câu tiếng Việt.
- Khi thật sự cần ghi thuật ngữ chuyên môn tiếng Anh, viết cách diễn đạt tiếng Việt trước và ghi thuật ngữ tiếng Anh trong ngoặc ngay sau đó; ví dụ: bản di trú (migration), kho truy cập dữ liệu (repository). Tên riêng, đường dẫn, định danh, từ khóa của ngôn ngữ lập trình, tên thư viện và câu lệnh phải giữ nguyên chính tả kỹ thuật.
- Mã nguồn, định danh, tên hàm/lớp/kiểu, khóa cấu hình, câu lệnh, tên nhánh và thông điệp ghi nhận thay đổi (commit) viết bằng tiếng Anh. **Phần mô tả của kiểm thử vẫn viết bằng tiếng Việt**.
- **Sửa mã có chú thích thì phải sửa ngay chú thích liên quan trong cùng thay đổi**, không được để lời giải thích mô tả hành vi cũ.
- Khi thay đổi hành vi nghiệp vụ, cập nhật mô tả tại nơi triển khai (chú thích mã, hợp đồng, kiểm thử); chỉ cập nhật `README.md` hoặc `AGENTS.md` nếu trách nhiệm, cấu trúc hay quy ước chung của dự án hoặc gói thực sự thay đổi. Trước khi kết thúc phải đối chiếu để không còn mô tả mâu thuẫn.
- **Không làm mất quy tắc nghiệp vụ khi dọn tài liệu:** nếu `README.md` hay `AGENTS.md` đang mô tả một luồng cụ thể, đối chiếu và chuyển phần còn cần thiết vào nơi triển khai luồng đó trước khi bỏ khỏi tài liệu tổng quát. Kiểm thử phải tiếp tục bảo vệ điều kiện, quyền truy cập và các chuyển trạng thái quan trọng.

## Quy tắc kỹ thuật

- **Đơn giản nhưng đủ đúng:** Mỗi lượt làm việc phải đọc `.agents/skills/ponytail/SKILL.md` và áp dụng mức `full`. Ưu tiên giải pháp sẵn có, thư viện chuẩn và tính năng nền tảng. Không tự đổi mức hoặc thêm tầng trừu tượng, thư viện phụ thuộc hay mã lặp không cần thiết.
- **Đúng phiên bản:** Khi sửa phần sử dụng khung phần mềm (framework) hoặc thư viện, kiểm tra phiên bản thực tế trong tệp khai báo và tệp khóa rồi tra tài liệu tương ứng.
- Trợ lý giao việc phải chuyển tiếp đầy đủ quy tắc trong tệp này và hướng dẫn của các thư mục liên quan cho trợ lý phụ; chịu trách nhiệm kiểm tra kết quả theo các quy tắc đó.

## Quy trình Git và GitHub

- **Một công việc, một cây làm việc (worktree):** Mỗi yêu cầu hoặc vấn đề và yêu cầu hợp nhất mã tương ứng dùng một nhánh cùng một cây làm việc tại `.worktrees/<slug>`. Không làm việc trực tiếp trên nhánh mặc định hoặc dùng chung cây làm việc cho công việc độc lập.
- **Tiếp tục đúng cây làm việc:** Các lượt bổ sung, rà soát, sửa lỗi, kiểm thử và phản hồi đánh giá thuộc cùng công việc phải thực hiện ở cây làm việc ban đầu. Không tạo cây làm việc mới chỉ vì chuyển giai đoạn.
- Kiểm tra trạng thái Git và cập nhật nhánh mặc định từ máy chủ khi có thể. Tạo nhánh từ nhánh mặc định mới nhất bằng `git worktree add -b <branch> .worktrees/<slug> <base>`.
- **Sao chép cấu hình môi trường:** Ngay sau khi tạo cây làm việc, sao chép mọi `.env` và `.env.*` cục bộ từ cây gốc, kể cả tệp bị bỏ qua bởi Git, giữ nguyên đường dẫn tương đối và quyền truy cập, không ghi đè tệp đã có. Trước khi kết luận thiếu môi trường để chạy kiểm thử, phải kiểm tra bước này và các dịch vụ phụ thuộc. Không in, đưa vào lịch sử Git hoặc đẩy lên máy chủ bất kỳ thông tin bí mật nào.
- Đọc, sửa, kiểm thử và ghi nhận thay đổi trong đúng cây làm việc; giữ nguyên những thay đổi chưa được ghi nhận của người khác.
- **Dùng đúng công cụ:** Dùng `git` để quản lý nhánh, cây làm việc, ghi nhận thay đổi và đẩy mã. Dùng `gh` để đọc hoặc cập nhật vấn đề, yêu cầu hợp nhất, đánh giá, kiểm tra tự động và giao diện lập trình GitHub (`gh api`). Nếu thiếu quyền hoặc công cụ, báo trở ngại; không tìm cách lách quyền.
- Quy trình: thay đổi → kiểm thử → ghi nhận thay đổi → đẩy nhánh → mở yêu cầu hợp nhất vào nhánh mặc định → xử lý đánh giá và kiểm tra tự động → hợp nhất khi được phê duyệt → dọn dẹp sau khi hợp nhất. Không đẩy trực tiếp lên nhánh mặc định.
- Tiêu đề và mô tả yêu cầu hợp nhất bằng tiếng Việt, nêu thay đổi, cách kiểm tra và vấn đề liên quan. Không tự hợp nhất khi chưa có phê duyệt hoặc kiểm tra chưa đạt; không xóa cây làm việc còn dữ liệu chưa lưu.
