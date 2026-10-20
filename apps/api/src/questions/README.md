# Quyết định miền Questions

Module Questions có hai entity canonical:

- **Question** là một assessment item độc lập trong question bank.
- **Stimulus** là ngữ liệu hoặc dữ kiện dùng chung mà nhiều question có thể cùng tham chiếu qua
  `questions.stimulus_id`.

Stimulus không sở hữu question. Các question cùng stimulus vẫn được chọn, sắp xếp và tái sử dụng độc
lập trong sách hoặc đề.

## Question content

Question có bốn loại: `multiple_choice`, `true_false`, `short_answer`, `essay`.

`questions.content` là Tiptap JSON và cả bốn loại đều dùng root `doc` chuẩn của Tiptap. Domain node chỉ xuất hiện ở cuối document khi loại câu hỏi cần danh sách con:

```text
multiple_choice
doc
├─ rich block+
└─ choiceList
   └─ choice{4}

true_false
doc
├─ rich block+
└─ statementList
   └─ statement{4}

short_answer
doc
└─ rich block+

essay
doc
├─ rich block+
└─ partList?
   └─ part+
```

`choice`, `statement` và `part` chứa `block+`, nên nội dung con vẫn dùng rich-text schema. Multiple choice và Đúng/Sai đều có đúng 4 child theo định dạng câu hỏi hiện hành; label hiển thị như `A/B/C/D` hoặc `a/b/c/d` được suy ra từ thứ tự, không persist. Child ID do Tiptap `UniqueID` quản lý dưới dạng UUIDv4; solution reference ID, không reference array index.

`questions.guidance` nằm riêng ngay sau `content` trong canonical shape. Đây chỉ là một Tiptap rich document tùy chọn; backend không tách nhỏ hay gán domain node bên trong. Guidance dùng cho hướng dẫn làm câu hỏi và không chứa response/solution.

Solution được lưu riêng khỏi student-visible content và là bắt buộc với canonical question. Nội dung authored không được rỗng. Multiple choice reference `choiceId`; true/false có đúng bốn answer theo `statementId`; short answer lưu từ 1 đến 4 ký tự chữ/số hoặc dấu `,`, `+`, `-`; essay không có part dùng một rich answer, còn essay có part dùng answers theo `partId`. Solution dạng danh sách phải bao phủ đủ statement/part. OTP và vùng nhập bài của học sinh là response UI, không nằm trong `questions.content`.

## Persistence

`questions` và `stimuli` dùng UUIDv7 do PostgreSQL sinh. Mỗi lần thay đổi nội dung question đều tạo một phiên bản nội dung bất biến, kể cả khi câu hỏi
đang ở trạng thái nháp. Chỉ thay đổi trạng thái được cập nhật trực tiếp trên phiên bản hiện tại;
mọi cập nhật đều kiểm tra `expectedVersion`. Stimulus được quản lý riêng.

## API

Questions module dùng Better Auth guard mặc định của application.

```text
POST   /questions
GET    /questions/:id
PATCH  /questions/:id
DELETE /questions/:id

POST   /stimuli
GET    /stimuli/:id
PATCH  /stimuli/:id
DELETE /stimuli/:id
```

`PATCH /questions/:id` merge patch với record hiện tại rồi validate lại toàn bộ question để giữ đồng bộ
giữa `type`, `content` và `solution`.
