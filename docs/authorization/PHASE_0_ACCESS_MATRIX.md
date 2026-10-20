# Giaokhoa — Phase 0: Permission & access-test matrix

> Trạng thái **Proposed / chờ phê duyệt** — 20/10/2026. Đây là **test design**, không phải các test đã chạy.
> Mọi `Dxx` trong cột kỳ vọng là quyết định chưa được chủ dự án chấp thuận.
> Tham chiếu [ADR/architecture spec](PHASE_0_ARCHITECTURE.md).

## 1. Fixture chuẩn và cách đọc

| Actor      | Account role / quan hệ                                                       |
| ---------- | ---------------------------------------------------------------------------- |
| `U1`, `U2` | `user`, `class_student` với active enrolment tại `C1`                        |
| `U3`       | `user`, không thuộc `C1`                                                     |
| `U4`       | `user`, đã suspended enrolment tại `C1`, còn role/recipient lịch sử          |
| `U5`       | `user`, pending enrolment tại `C1`                                           |
| `T1`       | `teacher`, `class_owner` của `C1`, sở hữu `Q1` và `E1`                       |
| `T2`       | `teacher`, `class_owner` của `C2`, không có vai trò ở `C1`                   |
| `T3`       | `teacher`, `class_owner` của `C3`, đồng thời `class_student` active của `C1` |
| `AD`       | `admin` hệ thống; **không** tự có `class:manage_any`                         |
| `P1`       | `user`, tự khai quan hệ guardian với `U1` nhưng chưa verified                |
| `P2`       | `teacher`, future verified guardian link với `U1`, không có link với `U2`    |

Tài nguyên: `B1` là bank logic riêng của `T1`; `Q1` private, `Q2` public nhưng `solution` private; `E1R1` là exam revision; `A1` published ở `C1` giao `U1,U2`; `A2` published chỉ giao `U1`; `A3` draft; `AT1` attempt của `U1`; `R1` kết quả `AT1` chưa release. `C2` thuộc `T2`. `NOW` là thời điểm kiểm thử cố định, không phụ thuộc đồng hồ thật.

Ký hiệu `Allow` là pass **chỉ nếu mọi điều kiện ghi trong hàng đều đúng**; `Deny` là từ chối tại backend, với 401 chưa xác thực, 403 khi authenticated thiếu quyền, hoặc 404 ở private-resource lookup chống enumeration. Các route cụ thể được khóa khi implement; response không được leak dữ liệu nhạy cảm dù status nào.

## 2. Authentication, context, role và owner

| ID  | Actor                        | Resource/context   | Action và trạng thái                              | Kỳ vọng                                                                                     |
| --- | ---------------------------- | ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A01 | New signup                   | `SYSTEM`           | Đăng ký email/password                            | **Allow:** `users.role='user'`, không tự làm student/teacher                                |
| A02 | Google/social signup         | `SYSTEM`           | Đăng ký mới                                       | **Allow** nếu normalize về `user`; test đường social chưa được xác minh trong code hiện tại |
| A03 | Anonymous                    | Protected `C1`     | Create/view private                               | **Deny 401**                                                                                |
| A04 | `U1`                         | `SYSTEM`           | `class:create`                                    | **Deny 403**: không có grant                                                                |
| A05 | `T1`                         | `SYSTEM`           | `class:create`                                    | **Allow**, sau đó class/context/owner role trong một transaction                            |
| A06 | `T1`                         | `C1`               | `class:update`                                    | **Allow**: `class_owner` đúng context                                                       |
| A07 | `T2`                         | `C1`               | `class:update`                                    | **Deny 403/404**: teacher cấp site không sở hữu C1                                          |
| A08 | `U1`                         | `C1`               | `class:enrolment_manage`                          | **Deny**: student role                                                                      |
| A09 | `T1`                         | `C2`               | `assignment:publish`                              | **Deny**: role C1 không kế thừa ngang C2                                                    |
| A10 | `T3`                         | `C1/A1`            | Start attempt                                     | **Allow** khi active student role, recipient và policy đủ; teacher account không cản        |
| A11 | Actor không có role/grant    | Protected resource | Quyền nhạy cảm bất kỳ                             | **Deny by default**                                                                         |
| A12 | `AD`                         | `C1`               | `class:manage_any` chưa bật                       | **Deny** mặc dù có system admin; D08                                                        |
| A13 | `T1` đã bị revoke owner      | `C1`               | Update ở request mới                              | **Deny ngay** dù session chưa hết hạn                                                       |
| A14 | `T1`                         | `C1`               | Create class nhưng transaction fail ở assign role | **Rollback** class + context + assignment; không còn orphan                                 |
| A15 | `T1`                         | `Q1/B1`            | Read/update authoring                             | **Allow** chỉ đúng owner và manage capability                                               |
| A16 | `T2`                         | `Q1/B1`            | GET/PUT/DELETE guessed ID                         | **Deny 404/403**; IDOR âm                                                                   |
| A17 | `T1`                         | `Q1/B1`            | List own private questions                        | **Allow** đúng tập và count                                                                 |
| A18 | `T2`                         | `B1`               | List/search/count/export private rows             | **Deny/filter**, không leak row/count/metadata                                              |
| A19 | Actor accountRole `NULL`/lạ  | `SYSTEM`           | `class:create`                                    | **Deny**, không suy đoán là teacher                                                         |
| A20 | `T1` mang thêm class_student | `C1`               | `class:update`                                    | **Allow** nếu không có explicit PREVENT/PROHIBIT; nhiều role phải kết hợp đúng D10          |

## 3. Public content, media và exam security

| ID  | Actor | Resource/context                      | Action và trạng thái                                 | Kỳ vọng                                                                        |
| --- | ----- | ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| R01 | `U1`  | Public `Q2`                           | Public reading projection                            | **Allow** chỉ nội dung public, không solution                                  |
| R02 | `U1`  | Public `Q2`                           | GET authoring/protected solution DTO                 | **Deny**                                                                       |
| R03 | `U1`  | Private `Q1`                          | GET detail/version bằng ID                           | **Deny**, không leak content                                                   |
| R04 | `U1`  | Stimulus của `Q1`                     | GET/PATCH/DELETE trực tiếp                           | **Deny**; không vòng qua policy của Q1                                         |
| R05 | `T2`  | Stimulus chưa gắn question thuộc `T1` | CRUD bằng ID                                         | **Deny** theo owner policy Phase 2; cần thêm owner/visibility                  |
| R06 | `U1`  | Image private của `T1`                | GET binary/variant/source                            | **Deny** dù biết ID; đóng lỗ hiện trạng Phase 2                                |
| R07 | `U1`  | Image được giao qua `A1`              | Student delivery attachment                          | **Allow** bằng policy scoped A1, không mở toàn bộ image bank                   |
| R08 | `U1`  | `A1/E1R1`                             | GET student exam delivery                            | **Allow** khi recipient/active/published/time view policy; không cấp bank read |
| R09 | `U1`  | `A1/E1R1`                             | Dò `solution`/`correctAnswer`/rubric qua nested JSON | **Không có** answer key trước release, kể cả metadata/export/images            |
| R10 | `T1`  | Published `E1R1`                      | Sửa Q1/exam gốc                                      | **Không đổi** nội dung E1R1/snapshot                                           |
| R11 | `T1`  | Question version trong E1R1           | Hard delete/retire                                   | **Deny hoặc preserve snapshot**; FK/invariant không để assignment gãy          |
| R12 | `U1`  | Private bank `B1`                     | Truy cập từ link trong assignment                    | **Deny**: delivery ≠ bank authorization                                        |
| R13 | `T2`  | `E1R1` private                        | Reuse/publish vào C2 không được share                | **Deny** cả khi T2 có quyền publish ở C2                                       |

## 4. Classes, membership, publish và recipients

| ID  | Actor                            | Resource/context | Action và trạng thái                          | Kỳ vọng                                                                                      |
| --- | -------------------------------- | ---------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| C01 | `U1`                             | `C1`             | Join code hợp lệ, `AUTO`                      | **Allow** tạo/upsert active enrolment + student role; D01                                    |
| C02 | `U3`                             | `C1`             | Join code hợp lệ, `APPROVAL`                  | **Allow request → pending**, **Deny** class activity trước duyệt; D01                        |
| C03 | `U3`                             | `C1`             | Code hết hạn/thu hồi/sai                      | **Deny**, không tạo active enrolment                                                         |
| C04 | `U4`                             | `C1`             | View/new assignment khi suspended             | **Deny** dù vẫn có role/recipient                                                            |
| C05 | `T1`                             | `C1`             | Suspend `U1`                                  | **Allow** owner; effect ngay sau commit                                                      |
| C06 | `T2`                             | `C1`             | Suspend `U1`                                  | **Deny** teacher khác lớp                                                                    |
| C07 | `U1`                             | `C1`             | Join lặp cùng user/class                      | **Idempotent**, một row active, không duplicate role                                         |
| C08 | `U1`                             | `C1`             | Rời lớp                                       | **Allow** theo exit policy; giữ audit/results, chặn hoạt động mới; D06                       |
| C09 | `T1`                             | `C1`             | Assign `class_teacher` cho người khác         | **Deny trong MVP** nếu `grant_teacher` chưa bật; D03                                         |
| C10 | `T1`                             | `C1`             | Publish `A1 ALL_CLASS`                        | **Allow**, snapshot tất cả và chỉ active enrolments tại publish; D02                         |
| C11 | `T1`                             | `C1`             | Publish `A2 SELECTED_USERS=[U1]`              | **Allow**, duy nhất U1 nhận assignment                                                       |
| C12 | `T1`                             | `C1`             | Chọn `U3` ngoài lớp hoặc `U4` suspended       | **Deny** không insert recipient                                                              |
| C13 | `U3`                             | `A1`             | Join lớp sau publish                          | **Không tự nhận** bài cũ; D02                                                                |
| C14 | `U2`                             | `A2`             | View/start khi không là recipient             | **Deny**, enrolment không đủ                                                                 |
| C15 | `U1`                             | `A3`             | Student view/start draft                      | **Deny**, chưa published                                                                     |
| C16 | `T1`                             | `A1`             | Publish retry cùng request                    | **Idempotent**, unique (`assignment_id`, `user_id`)                                          |
| C17 | `T2`                             | `A1/C1`          | Publish/update                                | **Deny**, role C2 không áp dụng                                                              |
| C18 | `T1`                             | `A1`             | Publish selected nhưng một member vừa suspend | **Deterministic**, check/snapshot trong transaction, không giao cho user inactive tại commit |
| C19 | `U1` đã bị revoke recipient      | `A1`             | Start mới                                     | **Deny** ngay, attempt cũ còn lưu; D15                                                       |
| C20 | `T1` đã downgrade `teacher→user` | `SYSTEM/C1`      | Create new class/publish new assignment       | **Deny** theo entitlement D04; không xóa dữ liệu cũ                                          |

## 5. Attempt lifecycle, grading và release

| ID  | Actor           | Resource/context            | Action và trạng thái                                     | Kỳ vọng                                                                                |
| --- | --------------- | --------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| T01 | `U1`            | `A1/C1`                     | Start: active, recipient, published, in window, còn lượt | **Allow** và tạo attempt thuộc `U1`                                                    |
| T02 | `U1`            | `A1`                        | Start trước `open_at`                                    | **Deny**                                                                               |
| T03 | `U1`            | `A1`                        | Start sau `close_at`                                     | **Deny**                                                                               |
| T04 | `U1`            | `A1`                        | Start khi hết lượt                                       | **Deny**, concurrency-safe                                                             |
| T05 | `U4`            | `A1`                        | Start có recipient nhưng suspended                       | **Deny**                                                                               |
| T06 | `U2`            | `AT1` của U1                | GET/save/submit                                          | **Deny**, independent attempt ownership check                                          |
| T07 | `U1`            | `AT1` in-progress           | Save answer trước deadline                               | **Allow** nếu state/clock hợp lệ, D12                                                  |
| T08 | `U1`            | `AT1` submitted             | PATCH answer                                             | **Deny**, không sửa bài nộp                                                            |
| T09 | `U1`            | `AT1` in-progress           | Submit trước deadline                                    | **Allow** đúng state + transactional once-only                                         |
| T10 | `U1`            | `AT1`                       | Submit trễ/grace                                         | **Deny hoặc controlled allow** theo D12, không mặc định                                |
| T11 | `T1`            | `AT1/C1`                    | View/grade                                               | **Allow** có `assignment:grade` đúng context                                           |
| T12 | `T2`            | `AT1/C1`                    | View/grade                                               | **Deny** khác lớp                                                                      |
| T13 | `U1`            | `R1` chưa release           | View score                                               | **Deny hoặc redacted response** không có điểm chưa công bố; D13                        |
| T14 | `U1`            | `R1` released               | View own result                                          | **Allow** với `result:view_own` + release checks                                       |
| T15 | `U2`            | `R1` của U1                 | View result                                              | **Deny** dù cùng lớp                                                                   |
| T16 | `U1`            | `E1R1`                      | Read answer key trước release, kể cả đã submit           | **Deny** qua mọi route/DTO                                                             |
| T17 | `U1`            | `E1R1`                      | Read solutions sau release                               | **Allow** chỉ nếu separate solution policy D13 cho phép                                |
| T18 | `U1` đã left C1 | Own submitted `R1` released | View historical result                                   | **Proposed Allow** self-only theo D06, không cho xem active assignment                 |
| T19 | `T1`            | `C1`                        | Count/list results                                       | **Allow** đúng lớp, không leak lớp khác                                                |
| T20 | `U1`            | `AT1`                       | Save/submit sau bị suspended/recipient revoke            | **Deny hoặc controlled historical submit** phải khóa tại D12/D15; mặc định fail closed |

Lưu ý: policy `canViewAssignment`, `canStartAttempt`, `canReadAttempt`, `canSaveAttemptResponses`, `canSubmitAttempt`, `canGradeAttempt`, `canViewResult` và `canViewSolution` là **khác nhau**. Không cho phép start ≠ cấm xem lịch sử; xem được đề ≠ xem đáp án.

## 6. Guardian extensibility — design-only, feature chưa bật

| ID  | Actor                | Resource/context     | Action                               | Kỳ vọng                                                                                  |
| --- | -------------------- | -------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| G01 | `P1`                 | `R1/U1`              | View child's result, link unverified | **Deny**                                                                                 |
| G02 | `P2`                 | `R1/U1` chưa release | View child's result                  | **Deny** bất kể verified link                                                            |
| G03 | `P2`                 | `R1/U1` released     | View limited child summary           | **Allow trong future feature** khi verified + explicit capability + consent/release; D07 |
| G04 | `P2`                 | `AT1`/`B1`           | Edit attempt/read private bank       | **Deny**; guardian link không trao author rights                                         |
| G05 | `P2`                 | `R` của `U2`         | View child's result                  | **Deny** vì không có link với U2                                                         |
| G06 | `P2` sau revoke link | `R1/U1`              | View child's result                  | **Deny ngay**                                                                            |

Tất cả G01–G06 bị deny trong hệ thống hiện tại vì guardian feature **chưa triển khai**; G03 mô tả acceptance tương lai, không phải quyền được kích hoạt.

## 7. Engine, transport và regression

| ID  | Tình huống                                                           | Kỳ vọng                                                              |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| E01 | Không role/capability                                                | Default deny                                                         |
| E02 | System `class:create` nhưng không có context `C2` manage             | Deny manage C2                                                       |
| E03 | Multi-role cùng context `ALLOW+INHERIT`                              | Allow nếu domain policy pass                                         |
| E04 | Multi-role cùng context `ALLOW+PREVENT`                              | Deny theo đề xuất D10                                                |
| E05 | `PROHIBIT` ở ancestor, `ALLOW` ở child                               | Deny tuyệt đối                                                       |
| E06 | `PREVENT` ở ancestor, `ALLOW` ở child                                | Allow theo specificity nếu không `PROHIBIT`/domain deny              |
| E07 | Context bị vòng, parent sai loại, resource/context mismatch          | Fail closed                                                          |
| E08 | Revoke role/enrolment/recipient, sau đó request khác dùng session cũ | Deny ngay, không dùng stale cache                                    |
| E09 | List/count/filter/pagination/export                                  | Chỉ tập row authorized, không leak total count                       |
| E10 | Admin elevated `class:manage_any` (nếu bật)                          | Require explicit grant và audit actor/action/resource/reason/outcome |
| E11 | Anonymous → private HTTP; user → admin Curriculum HTTP               | 401 và 403 như convention hiện tại                                   |
| E12 | MCP `create_curriculum` từ principal chưa định danh                  | Deny trừ khi trusted CLI actor được cấu hình/audit rõ; D11           |
| E13 | Student DTO nested/attachment/serialization                          | Không có `solution`/key trước release                                |
| E14 | Ownership check và mutation cạnh tranh (TOCTOU)                      | Transaction/repository predicates không cho unauthorized write       |
| E15 | PostgreSQL constraint/transaction rollback                           | Không có role assignment/context/recipient orphan                    |

## 8. Traceability và exit gate

| User story roadmap                             | Matrix tương ứng          |
| ---------------------------------------------- | ------------------------- |
| Đăng ký `user`                                 | A01–A03, A19              |
| Nâng `teacher`, sở hữu bank/question/exam      | A04–A05, A15–A18, R10–R13 |
| Tạo lớp và học sinh tham gia                   | A06–A10, C01–C09          |
| Giao cả lớp/chọn học sinh                      | C10–C20                   |
| Làm bài, chấm, xem kết quả                     | T01–T20, R08–R09          |
| Guardian về sau                                | G01–G06                   |
| Inheritance, revoke, answer leakage, transport | E01–E15, R01–R07          |

Khi implement từng phase, chuyển mỗi hàng thành unit/integration/E2E với: authenticated actor fixture, persisted resource/context, action, domain state, expected status + response shape, kiểm **không có sensitive fields**. Tests được chạy với PostgreSQL thật cho transaction, concurrency và constraints; static design review của Phase 0 **không được báo là CI xanh**.

**Phase 0 chỉ qua gate khi** owner review matrix, giải quyết hoặc chủ động chấp nhận quyết định còn mở D01–D15, đối chiếu không thiếu actor/context/action/Allow-Deny trong user stories và duyệt ADR. Phase 1 tuyệt đối chưa bắt đầu bằng tài liệu này.
