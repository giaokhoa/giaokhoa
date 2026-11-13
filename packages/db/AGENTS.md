# AGENTS.md — Yêu cầu dành cho AI khi làm việc trong `packages/db`

## Nguồn sự thật (đọc trước khi sửa)

1. `README.md` của package này — quyết định nghiệp vụ còn hiệu lực của db.
2. Issue đặc tả của việc đang làm trên GitHub — nguồn sự thật cho việc đó: bối cảnh, phạm vi, các quyết định liên quan (viết trọn vẹn ngay trong issue) và tiêu chí nghiệm thu đều nằm trong chính issue. Không viện dẫn sổ quyết định, hồ sơ hay tệp ngoài repo làm căn cứ. Tài liệu trong repo mâu thuẫn với issue thì DỪNG, báo main chat.
3. `AGENTS.md` ở thư mục gốc của repo — quy định chung cho AI toàn repo, gồm chuẩn văn bản tự chứa cho issue và PR.

## Chuẩn ngôn ngữ

Code (định danh, tên hàm/biến/lớp, chuỗi kỹ thuật) viết bằng tiếng Anh. Cấm viết comment, gồm TSDoc/JSDoc, comment nội tuyến và comment mô tả luồng, trong mã nguồn hoặc cấu hình. Mã nguồn và cấu hình thực thi là nguồn sự thật duy nhất cho hành vi hiện hành; không dùng comment để lưu quyết định. Tài liệu trong repo và văn bản GitHub viết bằng tiếng Việt. Tuân thủ quy định tại `AGENTS.md` gốc.

## Ranh giới phạm vi

- 1 issue = 1 feat = 1 PR: đổi schema + baseline sinh từ schema + spec đếm ở apps/api là các chặng của CÙNG một PR, không tách.
- Định nghĩa dữ liệu và — với phần đã chuyển sang Kysely — các hàm truy cập dữ liệu thuần (repository nhận handle, không giữ kết nối, không đọc ngữ cảnh app) thuộc package này. Cần hành vi nghiệp vụ → `apps/api`; cần hình dạng API → `packages/contracts`.

## Điều cấm package-specific

- Cấm tạo bảng nghiệp vụ thiếu `tenant_id`/ngoài khuôn RLS fail-closed đã chốt, trừ bảng nền tảng được nêu đích danh trong quyết định đã chốt.
- Cấm đổi khoá chính sang kiểu khác UUIDv7 cho bảng nghiệp vụ mới (ngoại lệ phải có quyết định riêng).
- Cấm regen/gộp baseline làm mất SQL RLS viết tay: baseline chứa các câu RLS mà bộ sinh migration không sinh lại được — gộp phải giữ nguyên và kiểm chứng cây MERGE chứa đúng MỘT thư mục `*_baseline` (đếm THƯ MỤC, không đếm file).
- Cấm đổi FK của dữ liệu chuẩn GDPT về cascade (phải giữ `restrict`).
- Cấm literal múi giờ `Asia/Saigon` trong mọi SQL mặc định/giá trị sinh — chỉ `Asia/Ho_Chi_Minh`.

## Kiểm chứng bắt buộc

- **Typecheck + build trước khi push**: `pnpm --filter @giaokhoa/db typecheck` và build lại `dist`, rồi mới typecheck apps/api + apps/worker.
- Kiểm chứng migrate phải làm trên **cây merge** (hoặc chờ CI trên PR): kiểm trên cây branch riêng không đủ — bẫy hai baseline chỉ lộ ở cây merge.
- CI là cổng chính; kết luận CI chỉ từ LOG THẬT. Suite nặng local giữ khoá `flock /tmp/giaokhoa-heavy-suite.lock`, tối đa một vòng nặng một lúc.

## Kỷ luật khung Kysely (chiến dịch chuyển ORM)

- Kiểu của ba kho nằm ở `src/types/` và được SINH bằng lệnh `db:types` (kysely-codegen từ DB thật dựng từ rỗng bằng SQL mang dữ liệu). Cấm sửa tay file sinh; đổi hình dạng DB xong phải chạy lại `db:types` và commit kết quả sinh cùng lượt — CI kiểm `git diff` trên `src/types/` phải rỗng.
- Cấm bật camelCase ở mọi tầng (không `--camel-case` khi sinh kiểu, không `CamelCasePlugin` khi truy vấn): tên cột trong code giữ snake_case như DB.
- Cột jsonb có hình dạng nghiệp vụ (hình dạng giữ ở `src/jsonb-types.ts`) phải có override từng cột trong `scripts/codegen/<kho>.json` ở cùng lượt chạm tới cột đó; `--type-mapping` của codegen là ánh xạ theo kiểu dữ liệu toàn cục, cấm dùng thay override từng cột.
- Mọi repository Kysely nhận handle qua kiểu của `src/client.ts` (`CentreDb`/`CentreTx`, `ControlPlaneDb`/`ControlPlaneTx`, `SystemBankDb`/`SystemBankTx`); cấm repository import từ `apps/*`, đọc ALS/ngữ cảnh app, tự mở pool hay đọc biến môi trường. Package không tự mở pool ở bất kỳ đâu ngoài harness test (`src/test-support/`).
- Mọi đường dữ liệu đi qua Kysely; cấm giao dịch lai (một thao tác mở đồng thời hai giao dịch trên hai handle độc lập).
- Cổng đếm kiểu sinh trên cụm PG18: số cột `id` có mặc định `uuidv7()` theo catalog là trung tâm 189 / control plane 4 / ngân hàng hệ thống 11 — đổi schema làm lệch các con số này phải cập nhật README của package bằng con số đếm thật trong cùng PR.

## Kỷ luật test theo nghiệp vụ

- Bất biến dữ liệu phải có spec khoá: số bảng, số mặc định uuidv7, số policy RLS, index dẫn đầu cho FK — đếm lại trên baseline cuối và ghi con số thật, không nới khẳng định cho qua.
- Đổi một quan hệ nghiệp vụ trong schema (vd lớp–khoá, tenant) mà spec ở apps/api vẫn xanh nguyên = test chưa bám nghiệp vụ; bổ sung/sửa spec trong cùng PR.

## Không viết comment trong code

Không thêm, giữ lại hoặc tái tạo comment trong code, kể cả TSDoc/JSDoc, comment JSX, comment giải thích flow và comment cấu hình. Thể hiện hành vi bằng code rõ ràng và test kiểm chứng. Code là nguồn sự thật duy nhất; comment có nguy cơ lệch code và tốn token. Quy tắc chung nằm trong `AGENTS.md` gốc.

## Sổ tay chuyển đổi repository sang Kysely

Đúc từ pilot kho control plane (repository mẫu: `src/repositories/control-plane.ts`, spec khoá hành vi: `src/repositories/control-plane.int-spec.ts`). Mọi repository chuyển đổi sau làm theo đúng các khuôn này:

- **Ranh giới hình dạng.** Repository giữ nguyên hợp đồng dòng mà phía tiêu thụ đang dùng (hình camelCase của repository trước chuyển đổi): SELECT/RETURNING dùng danh sách cột tường minh có bí danh (`'database_name as databaseName'`), khai một hằng danh sách cột cho mỗi bảng dùng chung cho select và returning; giá trị ghi được ánh xạ từng trường camelCase → snake_case ở hàm ánh xạ riêng của bảng. Kiểu dòng công khai khai ngay trong file repository, không import từ bất kỳ file khai bảng nào.
- **Transaction.** Mọi phương thức nhận handle tuỳ chọn mặc định là handle gốc của repository; `transaction(fn)` mở giao dịch bằng handle đó và truyền handle giao dịch xuống các phương thức khác qua tham số. Một giao dịch chỉ chứa một ORM — cấm lai. Khi điều tra bề mặt chuyển đổi của một module, phải đếm cả các điểm consumer gọi `repo.transaction(...)`, không chỉ file repository.
- **`undefined` (thử nghiệm T-4, đã đo).** Kysely tự loại cột mang `undefined` khỏi values/set khi biên dịch, nhưng repository vẫn loại tường minh trong hàm ánh xạ ghi để hành vi không phụ thuộc mặc định thư viện. `undefined` trong mệnh đề WHERE biên dịch thành placeholder với tham số giữ nguyên `undefined` (driver gắn NULL khi chạy) và lặng lẽ trả 0 dòng — vì vậy mọi giá trị where là tham số bắt buộc, cấm truyền `undefined`.
- **jsonb.** Mọi giá trị ghi vào cột jsonb đi qua một helper serialize tường minh duy nhất (`sql<T>\`${JSON.stringify(value)}::jsonb\``): driver `pg`tự stringify object thường nhưng hiểu MẢNG cấp cao nhất là mảng PostgreSQL, khiến cột jsonb lỗi`invalid input syntax for type json`. Biến tích luỹ cho `.values()`có trường biểu thức phải khai kiểu`InsertObject<DB, '<bảng>'>`.
- **onConflict.** `doNothing()` khi trùng không ném lỗi và `returning` trả mảng rỗng — repository ánh xạ thành `undefined` cho hợp đồng insert-if-absent; bên trong transaction, doNothing không phá giao dịch. Khoá phức hợp dùng `oc.columns([...]).doUpdateSet({...})` với set đã loại `undefined` từng trường.
- **Lỗi Postgres (thử nghiệm T-10, đã đo).** Qua Kysely, lỗi pg ném thẳng ra: `code` và `constraint` nằm trực tiếp trên lỗi, không có `cause`. Qua bộ máy cũ trước chuyển đổi, lỗi bị bọc và lỗi pg thật nằm ở `cause`. Helper nhận diện lỗi phải duyệt chuỗi `cause` (vòng đầu kiểm chính lỗi được ném), khớp mã lỗi và tên constraint/chỉ số, và bắt buộc có spec ca âm tính (va chạm khác không được nhận diện nhầm) chạy trên database thật.
- **Khoá hàng.** Khoá hàng dùng `.forUpdate()` trên select builder; phương thức đọc kèm khoá bắt buộc nhận handle giao dịch tường minh.
- **Kiểu runtime (thử nghiệm T-7, đã đo).** `timestamptz` đọc thành `Date` ở cả hai ORM; `int8` đọc thành `string` (không bật setTypeParser toàn cục; phía tiêu thụ tự chuyển tường minh); jsonb đọc lại thành object/mảng JS. Khẳng định khớp byte của jsonb đặt ở tầng `::text` lưu trữ, không qua `JSON.stringify` của giá trị đọc lại.
- **UUIDv7.** Insert bỏ khoá chính + `returning` cho id sinh bởi `DEFAULT uuidv7()` — codegen đã sinh `Generated<string>` cho các cột này nên kiểu ghi không đòi id; spec khoá bằng regex UUIDv7 trên id trả về và ca insert có id tường minh giữ nguyên id.
- **Pool.** Instance Kysely tạo rất rẻ và pool lười mở kết nối: ngân sách kết nối tính theo tổng `max` của các pool ĐÃ chạm database. `destroy()` chờ truy vấn đang chạy kết thúc — khi tắt module phải tính độ trễ này.
