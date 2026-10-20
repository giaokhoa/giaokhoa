# Giaokhoa — Phase 0: Đặc tả kiến trúc phân quyền

> Trạng thái: **Proposed / chờ phê duyệt** — 20/10/2026.
> Phạm vi: `giaokhoa.com`, không triển khai trung tâm/multi-tenant/payment/guardian.
> Đây là ADR và schema draft, **không phải migration/API contract đã phát hành**. Các quyết định D01–D15 chưa được chủ dự án duyệt.
> Tài liệu đi kèm: [Ma trận kiểm thử truy cập](PHASE_0_ACCESS_MATRIX.md).

## 1. Kết quả đối chiếu repository (read-only)

Đã rà soát commit `ef32fcf` trên `main`, các `AGENTS.md` và quy ước Ponytail `full`. Các đường dẫn dưới đây phản ánh **code hiện tại**, không coi ghi chú mục 7 của roadmap là bằng chứng còn đúng.

| Thành phần                                                                                          | Hiện trạng xác minh                                                                                                                                          | Hệ quả cho phase sau                                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `packages/database/src/schema/auth.generated.ts`                                                    | `users.role` là `text` nullable, chưa có default/check ở DB                                                                                                  | Phase 1 phải xử lý `NULL`/giá trị lạ theo nguyên tắc không nâng quyền                                            |
| `apps/api/src/auth/auth.ts`                                                                         | Better Auth + admin plugin; email/password `customSyntheticUser` đặt `role: 'user'`                                                                          | Kiểm tiếp social signup và dữ liệu lịch sử; giữ Better Auth làm nguồn account role                               |
| `apps/api/src/questions/questions.controller.ts` và `packages/application/src/questions/service.ts` | Đọc chi tiết/version, sửa, xóa đều truyền actor ID và kiểm `findQuestionOwned`; non-owner nhận 404                                                           | **Roadmap mục 7 đã cũ**: giữ owner guard đã có, không viết lại vô ích                                            |
| `packages/database/src/schema/questions.ts`                                                         | Có `question_bank_entries`, `question_versions`, `question` chứa `solution`; version content riêng, status `draft/ready` có thể đổi; xóa entry có cascade    | Phase 4 ưu tiên tái sử dụng version hiện có; khóa xóa/sửa ngữ nghĩa version đã phát hành                         |
| `apps/api/src/questions/stimuli.controller.ts` + service/repository                                 | Stimulus chưa có owner/visibility; controller CRUD không truyền actor                                                                                        | Phase 2 cần policy sở hữu và chống IDOR theo parent resource                                                     |
| `apps/api/src/images/images.controller.ts` + service/repository                                     | Upload/source/variant mutation có kiểm owner; GET binary ảnh và variant chưa kiểm owner/visibility                                                           | Phase 2 phải định nghĩa secure image delivery cho cả author và student                                           |
| `packages/shared/src/questions/schema.ts`                                                           | Schema authoring chứa `solution`                                                                                                                             | Tạo projection/DTO student bằng whitelist, cả nested data                                                        |
| `apps/api/src/curriculum/curriculum.controller.ts`                                                  | `@Roles(['admin'])` ở controller curriculum, gồm các route GET/CRUD                                                                                          | Giữ hành vi hiện tại đến khi chuyển policy; không coi guard là bảo vệ các transport khác                         |
| `apps/mcp/src/index.ts`, `apps/mcp/src/curriculum-tools.ts`                                         | MCP stdio compose trực tiếp `CurriculumService`, có 3 công cụ ghi không truyền actor                                                                         | **Trust boundary riêng**: nếu MCP mở cho user/agent, authz phải đặt tại application; không dựa vào HTTP `@Roles` |
| `packages/application/src/common/client-error.ts` và API filter                                     | `ClientErrorKind` chỉ có `invalid/not_found/conflict`; HTTP 400/404/409                                                                                      | Phase 1 thêm `forbidden` → 403 theo convention                                                                   |
| Tests                                                                                               | Có owner-negative tests cho Questions/Images và PostgreSQL repository E2E; chưa có evaluator, class, recipient hay IDOR end-to-end cho Stimuli/binary Images | Dùng matrix Phase 0 để phân kỳ test, không tuyên bố đã pass những test tương lai                                 |

`apps/api` hiện có 8 controller: Auth, Questions, Stimuli, Images và 4 controller Curriculum. Chưa có controller hoặc bảng Classes, Assignments, Exams/Exam revisions hay Attempts theo roadmap.

## 2. ADR-001 — Ranh giới khái niệm và context

**Đề xuất:** tách `account role` (quyền sản phẩm toàn site), `context role`, `active enrolment`, `assignment recipient`, ownership, status/time policy và guardian link. Một điều kiện không thay thế điều kiện còn lại. Mọi hành động nhạy cảm phải được kiểm ở application service, deny by default.

| Context logic | Parent                     | Lưu `authz_contexts`?                                            | Cách quyết định quyền                                                                            |
| ------------- | -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `SYSTEM`      | —                          | Có, singleton từ Phase 1                                         | `users.role` → system role template                                                              |
| `USER`        | `SYSTEM`                   | Chưa                                                             | Policy profile/owner; dành chỗ mở rộng                                                           |
| `BANK`        | `SYSTEM`                   | Chưa; chỉ tạo DB context khi có bank collection/shared role thật | Owner/share policy; `question_bank_entries` hiện là identity câu hỏi, không phải bank collection |
| `QUESTION`    | `BANK` logic hoặc `SYSTEM` | Chưa                                                             | Owner + visibility + projection theo mục đích                                                    |
| `EXAM`        | `BANK` logic hoặc `SYSTEM` | Chưa                                                             | Owner + revision/snapshot + release policy                                                       |
| `CLASS`       | `SYSTEM`                   | Có từ Phase 3                                                    | Role assignment riêng cho từng lớp                                                               |
| `ASSIGNMENT`  | `CLASS`                    | Chưa                                                             | Class capability + enrolment + recipient + trạng thái                                            |
| `ATTEMPT`     | `ASSIGNMENT` logic         | Không                                                            | Owner attempt, lifecycle, deadline, publication                                                  |

**Quy tắc materialize:** chỉ tạo DB context khi cần gán role/override độc lập. `ContextResolver` nhận resource ID rồi resolve parent từ repository phía server; **không tin** `contextId`, `ownerId` hoặc `classId` do client tự khai báo. API evaluator hỗ trợ mở rộng loại context mà không đổi chữ ký công khai.

`Class A` không cấp quyền sang `Class B`; quyền học sinh của lớp không cấp quyền đọc ngân hàng đề riêng. `teacher` ở `SYSTEM` được cấp `class:create`, tuyệt đối **không** cấp `class:update`/`assignment:publish` ở System.

## 3. ADR-002 — Roles, capabilities và chính sách tài nguyên

**Nguồn account role:** `users.role` tiếp tục là nguồn sự thật cho `user/teacher/admin` trong giai đoạn chuyển tiếp, vì Better Auth đang dùng trường đó. Không đồng thời ghi system role assignment thứ hai gây drift. Adapter biến role hợp lệ thành grants ở `SYSTEM`. `NULL` hoặc chuỗi không được hỗ trợ ⇒ chỉ tập quyền public tối thiểu hoặc deny theo từng route, **không** suy đoán là teacher. Cách normalize dữ liệu cần kiểm chứng trong Phase 1.

### Role ở System — role template mặc định

| Capability                | `user` | `teacher` |                `admin`                |
| ------------------------- | :----: | :-------: | :-----------------------------------: |
| `resource:view_public`    | Allow  |   Allow   |                 Allow                 |
| `practice:attempt_public` | Allow  |   Allow   |                 Allow                 |
| `class:join`              | Allow  |   Allow   |                 Allow                 |
| `question:create_own`     |   —    |   Allow   |                 Allow                 |
| `question:manage_own`     |   —    |   Allow   |                 Allow                 |
| `exam:create_own`         |   —    |   Allow   |                 Allow                 |
| `exam:manage_own`         |   —    |   Allow   |                 Allow                 |
| `class:create`            |   —    |   Allow   |                 Allow                 |
| `platform:moderate`       |   —    |     —     |                 Allow                 |
| `class:manage_any`        |   —    |     —     | **Off**; chỉ opt-in + audit nếu duyệt |

`—` = `INHERIT`/không grant, không phải implicit `PREVENT`; thiếu grant thì deny. `admin` không tự bypass ownership, recipient, answer-release hoặc mọi context. Public resource cho anonymous phải có policy riêng, không suy diễn từ bảng user.

### Role ở Class — gán đúng Class context

| Capability                 | `class_owner` | `class_teacher` (chưa bật MVP) | `class_student` |
| -------------------------- | :-----------: | :----------------------------: | :-------------: |
| `class:view`               |     Allow     |             Allow              |     Allow*      |
| `class:update`             |     Allow     |               —                |        —        |
| `class:enrolment_manage`   |     Allow     |               —                |        —        |
| `assignment:create`        |     Allow     |             Allow              |        —        |
| `assignment:publish`       |     Allow     |             Allow              |        —        |
| `assignment:grade`         |     Allow     |             Allow              |        —        |
| `assignment:view_assigned` |       —       |               —                |     Allow*      |
| `assignment:attempt`       |       —       |               —                |     Allow*      |
| `result:view_own`          |       —       |               —                |     Allow*      |
| `result:view_class`        |     Allow     |             Allow              |        —        |
| `class:grant_teacher`      |    **Off**    |               —                |        —        |

`*` Chỉ đủ quyền sau khi **cùng lúc** thỏa active enrolment, recipient, state, owner, release policy tương ứng. `class_teacher` có chỗ trong schema nhưng không tự bật UI; `class:grant_teacher` tắt ở MVP. `teacher` cấp Site có thể là `class_student` của lớp khác.

### Các policy domain bắt buộc

- **Questions/Exams:** `canManageOwn` phải kiểm created-by + visibility/share, không cho đọc `solution` chỉ vì câu hỏi public. Đề đã giao chỉ tham chiếu revision bất biến; delivery của học sinh không làm lộ bank private.
- **Stimuli/Images:** kiểm quyền tài nguyên gốc hoặc explicit sharing/public reference tại mọi GET binary/source/variant, list và mutation. Không suy ra quyền từ việc đoán được ID.
- **Class:** mọi student activity kiểm **active enrolment** ở thời điểm request. Role còn sót không vượt qua được suspended/left.
- **Assignment:** recipient thực tế được lưu (không tính động từ enrolment), có trạng thái; role hoặc enrolment đơn lẻ không cho xem/làm.
- **Attempt:** mỗi read/save/submit phải kiểm `attempt.userId === actor.id`, trạng thái và hạn; giáo viên grade cần capability lớp + đúng assignment/class.
- **Result/Solution:** điểm, feedback, correct answers là các projection riêng, mỗi projection có release policy độc lập. Không dựa vào UI ẩn trường.
- **Guardian (sau Phase 6):** verified relationship + scoped capability + release policy; không thêm account role `parent`. Trước khi triển khai, default deny.

## 4. ADR-003 — Kế thừa và xung đột quyền

Mô hình dữ liệu hỗ trợ 4 effect `INHERIT`, `ALLOW`, `PREVENT`, `PROHIBIT`. **Đề xuất cho Giaokhoa** (chưa duyệt thuật toán D10):

1. Load identity, resource, context chain từ server. Context sai loại, parent sai hoặc vòng ⇒ fail closed.
2. Thu các role assignment **còn hiệu lực** theo chain; System role qua Better Auth adapter; kiểm capability đúng scope.
3. Nếu có `PROHIBIT` áp dụng ở bất kỳ mức nào ⇒ deny tuyệt đối; không có admin implicit bypass.
4. Các mức còn lại xét từ context cụ thể nhất đến `SYSTEM`. Ở cùng độ sâu: `PREVENT` thắng `ALLOW` (đề xuất fail-closed của Giaokhoa, **không tự nhận là bản sao thuật toán Moodle**); `INHERIT` bỏ qua.
5. Không có `ALLOW` ⇒ deny. Có `ALLOW` ⇒ mới đánh giá ownership/enrolment/recipient/lifecycle/projection. Domain deny luôn thắng.
6. Không cache quyết định xuyên request trong MVP. Sau này chỉ cache khi revoke/invalidation có bằng chứng test.

Chỉ role templates cần dùng ở MVP; `authz_permission_overrides` theo context là **schema option hoãn**, chưa mở giao diện custom permissions. Không gán `PREVENT` tràn lan cho capability thiếu grant (tránh role student vô hiệu hóa role owner cùng context).

## 5. ADR-004 — Contract và phân tầng

Interface thiết kế, không phải code sẽ tạo trong Phase 0:

```ts
type ResourceRef =
    | { type: 'system' }
    | {
          type: 'question' | 'bank' | 'exam' | 'class' | 'assignment' | 'attempt' | 'result';
          id: string;
      };

type AuthorizationRequest = {
    actor: { id: string; accountRole: 'user' | 'teacher' | 'admin' | null };
    capability: Capability;
    resource: ResourceRef;
};

type AuthorizationDecision = {
    allowed: boolean;
    reason:
        | 'granted'
        | 'no_grant'
        | 'prohibited'
        | 'inactive_enrolment'
        | 'not_recipient'
        | 'not_owner'
        | 'invalid_state'
        | 'not_released';
    matchedContextId?: string;
};

interface AuthorizationService {
    authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
    assertAuthorized(request: AuthorizationRequest): Promise<void>;
}
```

- `actor` được dựng từ principal đã xác thực phía server; application không tin user/role từ request body. `resource` chỉ là ID; resolver đọc owner/context thật từ repository.
- `AuthorizationService` và repository ports thuộc `@giaokhoa/application`, không import NestJS/Drizzle. Transaction-aware repository được composition root inject vào cùng Unit of Work, để **check + write** dùng cùng transaction khi cần. Clock injectable/testable trong policy; không gắn `Date.now()` tùy tiện.
- API/Nest: Better Auth guard xác thực, Zod pipe xác thực input, controller chuyển lệnh sang service; `ClientErrorFilter` map `forbidden`→403 ở Phase 1, unauthenticated→401. Private resource có thể trả 404 để chống enumeration theo policy nhất quán; internal reason không tiết lộ cho caller.
- Application: `assertAuthorized` trước sensitive read/write, domain policy cho owner/enrolment/recipient/release. Repository dùng owner/class/user scoped predicates và transaction/unique constraints để chống TOCTOU; không xem guard/UI là đủ.
- `apps/mcp`: nếu là trusted admin CLI, phải xác định actor hệ thống tường minh và audit; nếu user-facing, cần authentication + application authorization giống API. D11 cần quyết định trước khi chuyển quyền Curriculum.
- Student DTO: whitelist các field không chứa `solution`/answer key/rubric bí mật, kiểm recursive/nested response, attachments và export. Author DTO tách khỏi student/guardian projection.

## 6. Luồng nghiệp vụ — service transaction và trạng thái

1. **Teacher tạo lớp:** `authorize(class:create, SYSTEM)` + product entitlement ⇒ transaction tạo `classes`, `CLASS context` và `class_owner assignment`. Rollback tất cả nếu bất kỳ bước lỗi. Teacher khác không sở hữu lớp này.
2. **Join:** kiểm `class:join`, mã còn hiệu lực, lớp cho tham gia; class config `AUTO` thì enrolment `active` và gán `class_student` cùng transaction; `APPROVAL` thì `pending`, **chưa cấp quyền hoạt động**. Join lặp idempotent, banned/revoked code deny.
3. **Suspend/leave:** đổi enrolment status, thu hồi/vô hiệu student role theo transaction; lưu lịch sử attempts/results. Mọi activity vẫn kiểm active enrolment nên role/cache còn sót không cấp quyền. Chính sách lịch sử xem lại thuộc D06.
4. **Publish assignment:** owner/teacher có `assignment:publish` tại Class; verify quyền dùng `exam_revision` và state. `ALL_CLASS` lấy snapshot tập enrolment `active`; `SELECTED_USERS` yêu cầu từng ID là active member. Insert `assignment_recipients` unique `(assignment_id,user_id)` trong transaction, idempotent publish; người vào sau không tự nhận (D02). Cần giải quyết isolation/race với join/suspend.
5. **Start attempt:** `assignment:attempt` **AND** active enrolment **AND** active recipient **AND** published **AND** time window **AND** remaining attempts > 0; cấp attempt bằng transaction an toàn concurrency.
6. **Save/submit/view/grade/result:** policy riêng cho mỗi hành động; không tái dùng `canStartAttempt`. Submit xong không sửa; giáo viên grade chỉ lớp mình; own result/solution chịu release policy. Không cho bypass bằng URL attempt ID.
7. **Downgrade teacher:** giữ class/question/history dữ liệu, không xóa; giới hạn hành động tạo/publish mới ở entitlement policy, mức bảo trì lớp cũ và quyền sửa tài nguyên còn chờ D04.

## 7. Schema draft và lộ trình migration Phase 1+

**Không chạy SQL/migration trong Phase 0.** Dự thảo cột chính/constraint (tên và kiểu cuối cùng đối chiếu Drizzle/PostgreSQL trước khi implement):

| Bảng                                                 | Cột và ràng buộc quan trọng                                                                                                   | Phase                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `authz_contexts`                                     | `id PK`, `kind`, `resource_key`, `parent_id FK self`, `created_at`; unique `(kind,resource_key)`; singleton `SYSTEM`          | 1; `CLASS` rows từ 3                |
| `authz_roles`                                        | `id PK`, `key UNIQUE` (`system:user`, `class:owner`...), `assignable_kind`, `is_builtin`                                      | 1                                   |
| `authz_capabilities`                                 | `id PK`, `key UNIQUE`, `context_kind`, `description`                                                                          | 1                                   |
| `authz_role_permissions`                             | `(role_id,capability_id) UNIQUE`, `effect` check 4 values                                                                     | 1                                   |
| `authz_role_assignments`                             | `id PK`, `user_id`, `role_id`, `context_id`, `source`, `granted_by`, `granted_at`, `revoked_at`; unique partial active triple | 1                                   |
| `authz_permission_overrides`                         | `context_id`, `role_id`, `capability_id`, `effect`, unique triple                                                             | **Hoãn** đến khi có override cụ thể |
| `classes`                                            | `id PK`, `created_by`, `status`, `join_mode`, timestamps                                                                      | 3                                   |
| `class_enrolments`                                   | `class_id,user_id` unique; `pending/active/suspended/left`, timestamps, audit metadata                                        | 3                                   |
| `class_join_codes`                                   | `class_id`, hashed token, expiry, revoked, usage limits                                                                       | 3                                   |
| `exams`, `exam_revisions`, `exam_revision_questions` | immutable revision, tham chiếu `question_versions` hiện có; restrict xóa version đã tham chiếu                                | 4                                   |
| `assignments`                                        | `class_id`, `exam_revision_id`, `audience_mode`, `status`, window, max attempts, release config                               | 5                                   |
| `assignment_recipients`                              | `assignment_id,user_id` unique, `status`, `source`, `assigned_at`, `revoked_at`                                               | 5                                   |
| `attempts`, `attempt_responses`                      | `assignment_id,user_id`, attempt number/status, submitted time, response ownership/uniques                                    | 6                                   |
| `guardian_student_links`                             | verification, consent, scope, expiry/revocation                                                                               | Sau 6; **chưa tạo**                 |

Không tạo bảng `question_revisions` thứ hai nếu `question_versions` đáp ứng invariant. Phase 4 phải kiểm khả năng chuyển status và xóa cascade của version đang được đề đã phát hành tham chiếu; ưu tiên FK `RESTRICT`/soft-delete theo use case đã duyệt.

**Rollout Phase 1:** migration additive → idempotent seed System/roles/capabilities/template → `users.role` adapter và null handling → resolver/evaluator không cache → transaction assign/revoke → unit tests + integration tests trên PostgreSQL thật → áp vào domain ở Phase 2. Không thay Better Auth schema và không mở access của các endpoint hiện tại qua migration.

## 8. Sổ quyết định phải xác nhận trước khi khóa ADR

Trạng thái của tất cả mục dưới đây: **Proposed, NOT APPROVED**. Chỉ `user` mặc định và tên account role `teacher` đã được roadmap coi là xác nhận.

| ID  | Câu hỏi                                         | Đề xuất mặc định                                                                                      | Phụ thuộc |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- |
| D01 | Mã lớp vào ngay hay cần duyệt?                  | Cấu hình `AUTO/APPROVAL` theo lớp; pending không có activity access                                   | 3         |
| D02 | Người vào sau nhận đề cũ?                       | Không; bổ sung recipients thủ công, snapshot khi publish                                              | 5         |
| D03 | Nhiều giáo viên/lớp?                            | Schema hỗ trợ, chỉ owner hoạt động MVP; `grant_teacher` tắt                                           | 3         |
| D04 | Teacher downgrade?                              | Giữ dữ liệu; chặn tạo/publish mới; bảo trì lớp cũ cần chốt cụ thể                                     | 1/3/5     |
| D05 | Đề riêng và lời giải?                           | Private mặc định; author/student DTO tách biệt; release mới được xem                                  | 2/4       |
| D06 | Học sinh rời lớp xem lịch sử?                   | Cho xem own submitted result sau release (trừ policy khóa tài khoản/kỷ luật); không mở assignment mới | 6         |
| D07 | Phụ huynh xem kết quả?                          | Hoãn; verified link + scoped capability + release, default deny                                       | Sau 6     |
| D08 | Admin manage mọi lớp?                           | Off mặc định; capability riêng, audit actor/reason/outcome nếu bật                                    | 1/3       |
| D09 | Context nào materialize?                        | `SYSTEM`/`CLASS`; bank/assignment/attempt virtual cho tới khi cần role riêng                          | 1/3       |
| D10 | Quy tắc override/multi-role?                    | `PROHIBIT` tuyệt đối, cùng context `PREVENT` thắng, depth cụ thể thắng ancestor                       | 1         |
| D11 | MCP Curriculum có phải trusted admin CLI?       | Coi chưa xác minh; không mở user-facing writes cho đến khi có principal/authz                         | 1/2       |
| D12 | Deadline, attempts, grace period?               | Chưa chọn cụ thể; phải tách `start/save/submit`                                                       | 5/6       |
| D13 | Công bố score, feedback, solution?              | Thời điểm/cờ độc lập, deny trước release                                                              | 5/6       |
| D14 | Class teacher quản lý enrolment?                | Không mặc định, chỉ class owner                                                                       | 3         |
| D15 | Revoke assignment recipient và historical data? | Ngắt quyền start ngay; giữ attempt/grade, lịch sử xem theo D06                                        | 5/6       |

**Exit gate Phase 0:** rà soát ADR + matrix, chủ dự án xác nhận/chỉnh D01–D15 (đặc biệt D04/D06/D10/D11), khóa version/spec rồi mới mở Phase 1. Khi còn quyết định chưa được duyệt, trạng thái Phase 0 vẫn `review pending`, không tuyên bố hoàn tất.

## 9. Tài liệu tham khảo

- [Moodle Access API 4.5](https://moodledev.io/docs/4.5/apis/subsystems/access) — context tree, role/capability.
- [Moodle Roles API 5.0](https://moodledev.io/docs/5.0/apis/subsystems/roles) — `INHERIT/ALLOW/PREVENT/PROHIBIT`; `PROHIBIT` luôn thắng.
- [Moodle Enrolment API 4.5](https://moodledev.io/docs/4.5/apis/subsystems/enrol) — enrolment tách role assignment; suspended không đồng nghĩa xóa lịch sử.
- `GIAOKHOA_AUTHORIZATION_ROADMAP.md` — phạm vi, roadmap và các decision D01–D07 gốc.
