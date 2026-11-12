# Issue #11 — Cách ly tác vụ nền và dữ liệu trả về theo trung tâm

[Mở issue #11](https://github.com/giaokhoa/giaokhoa/issues/11).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

API, worker và Redis dùng chung nên định tuyến job, cache, tìm kiếm và realtime phải giữ miền trung tâm từ đầu đến cuối, kể cả retry hoặc trùng định danh nội bộ.

## Mục tiêu

Một hành động tại A đi qua queue, cập nhật kết quả và phản hồi tìm kiếm/realtime của A; B và khu công cộng không nhận dữ liệu hoặc tác động của A.

## Phạm vi

### Làm

- Rà outbox/job và runner hiện có để mang đúng định danh kho, kiểm trạng thái trước khi xử lý và retry.
- Cách ly cache/khoá, tìm kiếm và room/kênh realtime theo trung tâm, giữ kiểm capability/audience.
- Kiểm các luồng người dùng có tác vụ nền và phản hồi trực tiếp bằng API/queue/socket thật.

### Không làm

- Vòng đời file và cleanup file thuộc #10.
- Không thêm queue, cache server hoặc cơ chế tìm kiếm mới.

## Chi tiết việc cần làm

Một hành động tại A đi qua queue, cập nhật kết quả và phản hồi tìm kiếm/realtime của A; B và khu công cộng không nhận dữ liệu hoặc tác động của A.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Hoàn thiện payload/định tuyến và xử lý lỗi cho các job/outbox liên quan.
- [ ] Chuẩn hoá key cache/khoá và phạm vi truy vấn/kênh realtime.
- [ ] Khoá các ca trùng id, retry và ngữ cảnh sai bằng integration/HTTP/socket phù hợp.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Thiếu, giả mạo hoặc bị thu hồi ngữ cảnh trung tâm phải báo lỗi; không rơi về kho khác.
- Cùng id nghiệp vụ ở hai database không làm trùng key/room hoặc dùng lẫn kết quả.
- Retry giữ nguyên miền sở hữu của công việc; quyền platform không được dùng thay cho một space bị thiếu.
- Kết quả tìm kiếm và realtime vẫn tuân quyền và audience của người nhận.

## Nghiệm thu

- [ ] Job sinh từ hành động của A chỉ đọc/ghi kho A và retry không đổi kho.
- [ ] Job thiếu/sai/thu hồi phạm vi bị từ chối, không tạo dữ liệu ở kho chung hoặc B.
- [ ] Hai trung tâm có cùng id nội bộ không dùng lẫn kết quả cache, khoá hoặc kết quả tìm kiếm.
- [ ] Socket của B/công cộng không nhận sự kiện, presence hoặc typing của A; socket A vẫn nhận đúng sự kiện được phép.
- [ ] Tìm kiếm không lộ nội dung hoặc metadata của miền khác qua dữ liệu, số đếm hoặc cache dùng lại.
- [ ] Các luồng được kiểm từ hành động đầu vào đến dữ liệu/hiệu ứng cuối; không chỉ kiểm tên key hoặc số lần gọi helper.

Truy vết với đặc tả cha: AC03, AC07. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #9 — Giới hạn control plane ở dữ liệu vận hành: Cần tài khoản/ngữ cảnh không còn phụ thuộc directory toàn cục và quyền vận hành đã tách khỏi dữ liệu nghiệp vụ.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
