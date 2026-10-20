# Quy ước repository dành cho agent lập trình

Các quy tắc trong tệp này là **bắt buộc**, không phải gợi ý. Mọi agent và subagent làm việc trong repository phải đọc và tuân thủ trong mọi phiên.

## Quy tắc chung bắt buộc

- **Ponytail full:** Trong mọi phiên làm việc, đọc `.agents/skills/ponytail/SKILL.md` và áp dụng mức `full`. Ưu tiên giải pháp đơn giản nhất thực sự đáp ứng yêu cầu; tái sử dụng code sẵn có, thư viện chuẩn và tính năng nền tảng trước khi thêm dependency hoặc abstraction. Không tự hạ xuống `lite` hay nâng lên `ultra`.
- **Tài liệu đúng phiên bản:** Trước mọi thay đổi liên quan đến framework hoặc package bên ngoài, xác định phiên bản **đang cài** từ manifest/lockfile và đọc lại tài liệu phù hợp chính phiên bản đó. Không áp dụng pattern của phiên bản khác hoặc dựa vào trí nhớ thay cho việc kiểm tra tài liệu.
- **Pattern tối thiểu:** Chỉ triển khai phần nhỏ nhất trong pattern được tài liệu phiên bản tương ứng hướng dẫn để hoàn thành yêu cầu. Không thêm config, abstraction, dependency, boilerplate hoặc thiết lập dự phòng khi không thật sự cần.
- **Ngôn ngữ tài liệu:** Viết bằng **tiếng Việt** đối với mọi nội dung Markdown (`.md`), comment trong code, nội dung issue và nội dung PR. Giữ nguyên tên riêng, thuật ngữ kỹ thuật, đường dẫn, lệnh và đoạn code khi cần.
- **Ngôn ngữ code:** Viết **tiếng Anh** đối với code, định danh, tên biến/hàm/class/type, tên API, key cấu hình, script và test. Comment vẫn phải bằng tiếng Việt theo quy tắc ở trên.
- Các quy tắc này áp dụng cho cả công việc được giao lại cho agent khác. Agent thực hiện phải tự kiểm tra việc tuân thủ trước khi bàn giao.

## Quy trình bắt buộc cho issue và yêu cầu: GitHub Flow

- **Mỗi issue hoặc yêu cầu liên quan đến repository phải có một branch riêng và một Git worktree riêng** bên trong `.worktrees/<slug>`. Tạo worktree trước khi sửa file; không làm việc trực tiếp trên `main` hoặc nhánh mặc định và không dùng chung worktree cho những yêu cầu độc lập.
- Trước khi tạo nhánh, kiểm tra trạng thái Git, xác định nhánh mặc định và cập nhật thông tin từ remote khi có thể. Tạo branch ngắn, mô tả bằng tiếng Anh, dựa trên nhánh mặc định mới nhất; dùng `git worktree add -b <branch> .worktrees/<slug> <base>`.
- Thực hiện việc đọc code, chỉnh sửa, kiểm thử và commit trong worktree của yêu cầu. Không ghi đè, tự ý di chuyển hoặc xóa thay đổi chưa commit của người khác. Nếu yêu cầu đang có worktree tương ứng, tiếp tục tại đó.
- Theo GitHub Flow: tạo branch → thay đổi và kiểm thử → commit rõ ràng → push branch → mở pull request vào nhánh mặc định → xử lý review và CI → merge khi được phê duyệt → dọn branch/worktree sau khi merge. Không push trực tiếp lên nhánh mặc định.
- Tiêu đề và nội dung PR phải bằng tiếng Việt, nêu mục đích, thay đổi, cách kiểm tra và liên kết issue nếu có. Giữ commit message và tên branch bằng tiếng Anh theo quy tắc code.
- Không tự merge PR khi chưa đủ phê duyệt hoặc kiểm tra bắt buộc chưa đạt. Chỉ xóa worktree/branch sau khi chắc chắn thay đổi đã được merge và không còn dữ liệu chưa lưu.

## Trách nhiệm của các package

- `@giaokhoa/shared` là nguồn từ vựng dùng chung, độc lập với framework và hạ tầng.
  Package này sở hữu Zod schema chuẩn, kiểu dữ liệu suy ra, hằng số và mô tả giao thức HTTP.
- `@giaokhoa/application` sở hữu các use case nghiệp vụ, lỗi domain/application và repository port.
  Package này phụ thuộc vào `@giaokhoa/shared` và không được phụ thuộc vào NestJS, Drizzle hoặc PostgreSQL.
- `@giaokhoa/database` sở hữu Drizzle schema, migration, kiểu dữ liệu persistence và
  PostgreSQL repository adapter. Package này triển khai repository port từ `@giaokhoa/application`.
- `apps/api` là HTTP/Nest adapter. Controller dùng `@giaokhoa/shared/http/*` cho route contract,
  inject application service và không truy vấn trực tiếp bảng Drizzle.
- Có thể thêm `apps/mcp` như một runtime riêng. Runtime này phải kết hợp lại cùng các application service
  và database adapter, không tự triển khai logic persistence khác.
- Package web và editor có thể phụ thuộc vào `@giaokhoa/shared`, nhưng không được phụ thuộc vào
  application hoặc database package.

Chiều phụ thuộc:

```text
@giaokhoa/shared
       ↑
@giaokhoa/application
       ↑
@giaokhoa/database

apps compose application + database at their runtime boundary
```

`@giaokhoa/database` cũng phụ thuộc trực tiếp vào `@giaokhoa/shared` khi kiểm tra dữ liệu persistence
bằng schema chuẩn.

## Shared package

Các public subpath của domain được tổ chức theo bounded context:

```text
@giaokhoa/shared/questions
@giaokhoa/shared/curriculum
@giaokhoa/shared/images
```

HTTP descriptor thuộc riêng tầng transport:

```text
@giaokhoa/shared/http/questions
@giaokhoa/shared/http/stimuli
@giaokhoa/shared/http/subjects
@giaokhoa/shared/http/curricula
@giaokhoa/shared/http/curriculum-nodes
@giaokhoa/shared/http/learning-outcomes
@giaokhoa/shared/http/images
@giaokhoa/shared/http/auth
```

Không tạo export gốc cho `@giaokhoa/shared`. Các public entry phải được khai báo tường minh
trong package exports.

Schema chuẩn dùng tên thể hiện đúng ngữ nghĩa:

```text
questionSchema
questionCreateSchema
questionPatchSchema
subjectSchema
subjectCreateSchema
subjectPatchSchema
```

Khi HTTP body/response có cùng cấu trúc với schema chuẩn, HTTP descriptor phải dùng trực tiếp
schema chuẩn. Không tạo alias như `CreateQuestionBody` hoặc `questionResponseSchema` chỉ để đổi tên
một cấu trúc giống hệt.

Dùng `schema.ts` (số ít) cho module schema. Tránh tồn tại song song hai quy ước
`schema.ts` và `schemas.ts`. Dùng tên file theo một trách nhiệm duy nhất như `service.ts`,
`repository.ts`, hoặc public entry trực tiếp như `questions.ts`. Không thêm barrel
`index.ts` ở cấp resource chỉ để tái export các file bên cạnh.

## Application package

Application service chứa hành vi dùng chung cho mọi transport:

- kiểm tra quyền sở hữu
- gộp dữ liệu và xác thực lại
- quy tắc vòng đời của câu hỏi
- xác thực cây chương trình học
- lỗi domain/application

Repository interface nằm cùng hành vi application sử dụng nó.
Các lỗi riêng của persistence, chẳng hạn mã lỗi PostgreSQL, phải được database adapter
chuyển thành application error.

## Lỗi application do client gây ra

Các lỗi application do client gây ra dùng thống nhất kiểu `ClientError` từ
`@giaokhoa/application/client-error`.

- `kind` nhận một trong các giá trị `invalid`, `not_found` hoặc `conflict`.
- `code` là mã ổn định, đặc thù cho domain và có thể được máy xử lý.
- `message` là phần giải thích để người dùng đọc.
- `details` là ngữ cảnh có cấu trúc tùy chọn, chẳng hạn các vấn đề xác thực.
- Không tạo subclass lỗi theo từng resource hoặc file `errors.ts` chỉ để ánh xạ một trường hợp sang HTTP.
- Transport adapter ánh xạ `ClientError.kind` sang ngữ nghĩa giao thức tương ứng.

## Database package

`@giaokhoa/database` là nguồn chuẩn duy nhất của tầng persistence.

- Bảng Drizzle tại runtime nằm trong `src/schema/*.ts`.
- Migration và công cụ Drizzle thuộc trách nhiệm của `packages/database`.
- PostgreSQL adapter được đặt tên `Postgres{Context}Repository`.
- Code application tại runtime bên ngoài `@giaokhoa/database` không được truy vấn Drizzle trực tiếp.
- Composition root của API có thể import database schema để khởi tạo Drizzle, nhưng controller
  và application service không được import bảng runtime.
- Việc thêm cột nội bộ vào database không được tự động làm lộ cột đó qua shared canonical schema.

## HTTP descriptor

Registry của HTTP resource tiếp tục được đặt tên `<resource>Contract`, ví dụ `questionsContract`.
Các trường operation được phép gồm `method`, `path`, `pathParams`, `query`, `headers`,
`body`, `file` và `responses`.

- Dùng `responses` với key là HTTP status.
- Dùng `204: null` cho phản hồi thành công không có body.
- Dùng `'binary'` cho phản hồi nhị phân.
- Path phải là đường dẫn public API đầy đủ.

## Kiểm tra bắt buộc

Sau khi thay đổi ranh giới package, persistence, shared schema hoặc HTTP descriptor, chạy:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @giaokhoa/api test:e2e
git diff --check
```

`packages/shared/test/http-contracts.spec.ts` bảo đảm tuân thủ quy ước HTTP descriptor.
