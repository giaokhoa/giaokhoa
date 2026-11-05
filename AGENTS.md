# Quy tắc dành cho AI Agent

## Ngôn ngữ
- Sử dụng **tiếng Việt** khi trao đổi, viết đặc tả, kế hoạch, task, tài liệu và báo cáo review/audit.
- Giữ nguyên tên kỹ thuật, lệnh, đường dẫn, định danh trong code và các thuật ngữ không nên dịch.

## Trước khi viết code
- Trước mọi tác vụ viết, sửa lỗi hoặc tái cấu trúc code, phải đọc `.agents/skills/ponytail/SKILL.md` và áp dụng skill `ponytail` ở mức **full** trong suốt tác vụ.
- Tuân thủ các nguyên tắc về phạm vi, sự tối giản, an toàn và kiểm thử của skill. Không tự ý hạ mức.
- Khi viết code, phải bám sát các pattern, convention và API chính thống của framework đang sử dụng (Spring Boot, Spring Security, Next.js, v.v.) và cách triển khai nhất quán trong project. Ưu tiên giải pháp được framework hỗ trợ sẵn; không tự tạo abstraction hoặc cách làm riêng khi framework đã có pattern phù hợp.

## Trước khi merge
- Trước khi merge **bất kỳ** PR hoặc nhánh nào vào `main`, phải đọc `.agents/skills/ponytail-review/SKILL.md` và dùng `ponytail-review` để review thay đổi so với nhánh đích, bao gồm cả code liên quan.
- Phải xử lý toàn bộ lỗi **Must fix** trước khi merge và review lại phần đã sửa. Không merge nếu review chưa hoàn tất hoặc kết luận chưa đủ điều kiện merge.
- Báo cáo kết luận review trước khi thực hiện merge. CI chạy thành công không thay thế cho bước review này.

## Chất lượng backend Java
- Trước khi bàn giao thay đổi backend, chạy `./backend/mvnw -B -ntp -f backend/pom.xml clean verify` bằng JDK 25. Lệnh này kiểm tra compiler, unit test, Spotless, PMD và SpotBugs cho cả code chính và test.
- Tự format bằng `./backend/mvnw -B -ntp -f backend/pom.xml spotless:apply`. Không format tay theo một convention khác.
- Sửa nguyên nhân warning và vi phạm. Không giảm rule, bỏ qua source/test, thêm suppression hoặc dùng cờ skip chỉ để làm build xanh. Ngoại lệ đã xác minh do framework hoặc test cố ý kiểm tra đầu vào sai phải hẹp và có giải thích cụ thể.
- Với thay đổi DB, session, OIDC hoặc security, chạy thêm `./backend/mvnw -B -ntp -f backend/pom.xml -Pintegration verify` trên stack TEST riêng theo `backend/README.md`. Profile này tự tìm integration test của stack TEST theo convention `*IT`; native Keycloak chạy qua script riêng bên dưới.
- Báo cáo rõ lệnh đã chạy và kết quả. Không báo integration test thành công nếu chỉ chạy unit test hoặc compile test.
- Với thay đổi client Keycloak hoặc bootstrap realm, chạy thêm `bash infra/keycloak/verify-native.sh`; script tạo stack native riêng, chạy acceptance test và tự dọn container.
