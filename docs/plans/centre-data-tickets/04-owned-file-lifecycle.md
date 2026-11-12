# Issue #10 — Cách ly vòng đời file theo miền sở hữu

[Mở issue #10](https://github.com/giaokhoa/giaokhoa/issues/10).

## Issue cha

#6 — Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung. Các yêu cầu cần cho ticket được viết đầy đủ bên dưới.

## Bối cảnh và vấn đề

Metadata đã theo kho trung tâm nhưng byte file dùng hash chung và cleanup chưa giữ đầy đủ miền sở hữu. Cần upload, tải, URL có ký và xoá độc lập giữa các kho.

## Mục tiêu

A, B, khu công cộng và ngân hàng lưu file trong miền riêng; người dùng tải được file có quyền và xoá ở A không làm hỏng file cùng nội dung tại B.

## Phạm vi

### Làm

- Đưa miền sở hữu ổn định vào khoá lưu trữ, tham chiếu và quyền truy cập cho adapter local và S3 hiện có.
- Nối đầy đủ upload, tải, URL có ký, xoá mềm và cleanup qua worker với đúng kho/miền.
- Giữ dedupe trong cùng miền nếu đang dùng; kiểm chứng vòng đời cùng hash ở nhiều miền.

### Không làm

- Không triển khai backup/restore đầy đủ trong ticket này.
- Không di trú file/hash cũ hoặc bổ sung một hệ object storage mới.

## Chi tiết việc cần làm

A, B, khu công cộng và ngân hàng lưu file trong miền riêng; người dùng tải được file có quyền và xoá ở A không làm hỏng file cùng nội dung tại B.

Mỗi issue giao một hành vi mạch lạc trong một PR; thay đổi schema, hợp đồng, API/CLI, giao diện cần thiết và test của hành vi đó đi cùng nhau. Không mở PR riêng chỉ cho một tầng.

Các kiểm chứng đi qua HTTP của ứng dụng thật cho hành vi sản phẩm; CLI/queue thật cho vận hành và tác vụ nền. Test gọi trực tiếp service là integration. Dùng database/file test cô lập; giữ quy định khoá suite nặng, RLS, Kysely, Zod và i18n hiện có.

Tài liệu, mô tả test và văn bản GitHub bằng tiếng Việt; định danh kỹ thuật bằng tiếng Anh. Kiểm chứng chỉ báo đạt từ lệnh/log thực tế, không suy từ trạng thái của một head khác.

## Việc con dự kiến

- [ ] Hoàn thiện hợp đồng storage và các adapter theo miền sở hữu.
- [ ] Nối các luồng file và job cleanup với miền/handle đúng.
- [ ] Kiểm chứng upload, tải, chữ ký và xoá cùng hash qua API/queue cùng adapter local/S3.
- [ ] Chạy kiểm chứng hành vi, cập nhật tài liệu liên quan và ghi bằng chứng trong PR duy nhất của issue.

## Quyết định liên quan

- Miền file gồm từng kho trung tâm/khu công cộng và ngân hàng hệ thống; hash nội dung không tự xác định chủ sở hữu.
- Đổi hostname hoặc tên trung tâm không đổi miền sở hữu.
- Cleanup đếm tham chiếu và xoá trong đúng miền; job thiếu/sai miền bị từ chối, không đoán kho.
- URL có ký và metadata không cấp quyền đọc chéo chỉ vì hai file có cùng hash.

## Nghiệm thu

- [ ] A/B/công cộng và ngân hàng lưu cùng bytes nhưng có quyền truy cập và vòng đời riêng.
- [ ] Người dùng A không tải được file B bằng cách thay file id, hash, miền hoặc URL có ký.
- [ ] Xoá file cuối ở A và thực thi cleanup không làm mất file cùng hash còn được B/công cộng/ngân hàng tham chiếu.
- [ ] Job cleanup sai/thiếu miền bị từ chối và không xoá byte ở miền khác.
- [ ] Bản local và S3 đều thực hiện cùng hợp đồng miền sở hữu; test không chỉ mock việc gọi phương thức xoá.
- [ ] Upload/tải/xoá hiện có vẫn hoạt động trong đúng miền, hợp đồng và giao diện liên quan được đồng bộ.

Truy vết với đặc tả cha: AC06, AC07. Các tiêu chí cụ thể của ticket là checklist ở trên; kiểm chứng liên miền đầy đủ được đối chiếu lại ở #20.

## Phụ thuộc và thứ tự

- #8 — Tách dữ liệu khu học tập công cộng: Cần định danh kho và ngữ cảnh ổn định cho cả trung tâm lẫn khu công cộng để mọi file đều có miền sở hữu rõ ràng.

Blocker ở trên được gắn bằng quan hệ native của GitHub; quan hệ issue cha/con không thay cho blocker. Khi thi công, dùng branch/worktree riêng cho issue và mở đúng một PR. Không tự merge hoặc đóng issue trước khi PR được merge.
