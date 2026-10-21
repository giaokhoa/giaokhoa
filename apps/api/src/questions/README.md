# Questions

- `question_bank_entries` giữ danh tính câu hỏi; mỗi phiên bản nội dung nằm ở bảng `question`, được liên kết qua `question_versions` với trạng thái `draft` hoặc `ready`.
- `stimuli` là ngữ liệu dùng chung, không sở hữu câu hỏi. Một phiên bản câu hỏi có thể tham chiếu ngữ liệu qua `question.stimulus_id`.
- Câu hỏi hỗ trợ `multiple_choice`, `true_false`, `short_answer`, `essay`. `content` và `guidance` dùng Tiptap JSON; `solution` riêng, bắt buộc khi `ready` nhưng có thể thiếu khi `draft`.
- Sửa nội dung tạo phiên bản mới; chỉ đổi trạng thái thì cập nhật phiên bản hiện tại. `PATCH` yêu cầu `expectedVersion`.

Schema và quy tắc nội dung: `packages/shared/src/questions/`. HTTP API: `packages/shared/src/http/questions.ts` và `stimuli.ts`.
