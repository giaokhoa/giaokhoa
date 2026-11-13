/**
 * Vai trò staff, báo cáo conversation và ghi danh/roster — các phép đọc bảng dùng chung (role, enrol, context) mà nghiệp vụ nhắn tin cần.
 *
 * Một miền của {@link MessagingRepository} (xem `messaging.ts`): nhận handle kho trung tâm qua constructor, mọi phương thức nhận handle tuỳ chọn `db` mặc định là handle gốc (khuôn S6) — facade ở `messaging.ts` giữ nguyên API public và uỷ quyền sang đây.
 */
import {
  sql,
} from 'kysely';
import type { CentreDb } from '../client';
import { CONTEXT_LEVEL_COURSE } from './dashboard';
import {
  REPORT_COLUMNS,
  STAFF_ARCHETYPES,
  USER_DISPLAY_NAME_EXPR,
  reportInsertValues,
  type ClassRosterRawRow,
  type MessagingDb,
  type NewReport,
  type ReportRow,
} from './messaging';

/** Vai trò staff, báo cáo conversation và ghi danh/roster — các phép đọc bảng dùng chung (role, enrol, context) mà nghiệp vụ nhắn tin cần. */
export class MessagingEnrolmentRepository {
  constructor(private readonly handle: CentreDb) {}

  /** Handle gốc của miền (điểm mở giao dịch + truy vấn ngoài giao dịch). */
  private db(): MessagingDb {
    return this.handle;
  }


  // --- staff (cho các cổng nghiệp vụ Lớp B) -----------------------------------
  // Đọc thẳng bảng role_assignments + role (barrel schema), cùng kỷ luật
  // "đọc bảng dùng chung, không import module khác" như phần enrol/groups.

  /**
   * User có ÍT NHẤT một gán vai trò staff (theo archetype) ở bất kỳ
   * context nào hay không — căn cứ của cổng "chỉ giáo viên/staff được
   * tạo nhóm tự do": người chỉ mang vai trò học sinh ở mọi nơi bị chặn,
   * giáo viên của bất kỳ khoá nào cũng qua được.
   */
  async hasStaffRoleAssignment(userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const rows = await db
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.id as id')
      .where('role_assignments.user_id', '=', userId)
      .where('role.archetype', 'in', [...STAFF_ARCHETYPES])
      .limit(1)
      .execute();
    return rows.length > 0;
  }


  /**
   * User có ÍT NHẤT một context HỌC SINH thật hay không — căn cứ của
   * tầng audience phía học sinh trong tuỳ chọn thông báo (lát phân
   * chia theo vai, issue #288). "Context học sinh" theo đúng hợp nhất
   * mà hệ đã dùng cho tư cách thành viên khoá (ghi danh hiệu lực ∪
   * gán vai tại context khoá): ở đây gồm (a) một ghi danh ĐANG HIỆU
   * LỰC ở bất kỳ khoá nào — cùng điều kiện hiệu lực với
   * `listActiveEnrolledUserIds` (trạng thái ghi danh + trạng thái
   * instance đều 0, nằm trong cửa sổ thời gian) nhưng không ghim một
   * khoá cụ thể; hoặc (b) một gán vai archetype `student` ở bất kỳ
   * context nào — đối xứng với `hasStaffRoleAssignment` phía nhân sự.
   * Giáo viên thuần (không ghi danh học viên ở đâu) trả false.
   */
  async hasStudentContext(userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const now = new Date();
    const enrolled = await db
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select('user_enrolments.id as id')
      .where((eb) => eb.and([
        eb('user_enrolments.user_id', '=', userId),
        eb('user_enrolments.status', '=', 0),
        eb('enrol.status', '=', 0),
        eb('user_enrolments.time_start', '<=', now),
        eb.or([
          eb('user_enrolments.time_end', 'is', null),
          eb('user_enrolments.time_end', '>=', now),
        ]),
      ]))
      .limit(1)
      .execute();
    if (enrolled.length > 0) return true;
    const assigned = await db
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.id as id')
      .where('role_assignments.user_id', '=', userId)
      .where('role.archetype', '=', 'student')
      .limit(1)
      .execute();
    return assigned.length > 0;
  }


  /**
   * User có ÍT NHẤT một liên kết giám hộ ĐANG HIỆU LỰC trong vai trò
   * PHỤ HUYNH hay không (`guardian_links.status = 'active'` với
   * guardianUserId là chính user) — căn cứ của tầng audience phía
   * phụ huynh trong tuỳ chọn thông báo (issue #288): chỉ người thật
   * sự đang là phụ huynh mới thấy hai loại guardian_*; liên kết đã
   * thu hồi không tính. Đọc thẳng bảng dùng chung như kỷ luật của
   * phần staff ở trên, không import module Guardians (module đó đang
   * phụ thuộc MessagingService để phát thông báo — import ngược sẽ
   * thành vòng).
   */
  async hasActiveGuardianLink(userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const rows = await db
      .selectFrom('guardian_links')
      .select('id')
      .where('guardian_user_id', '=', userId)
      .where('status', '=', 'active')
      .limit(1)
      .execute();
    return rows.length > 0;
  }

  /**
   * Mọi user mang vai trò staff tại context của khoá hoặc một context
   * tổ tiên của nó (kế thừa theo đường path của context, khớp ngữ
   * nghĩa evaluator) — tập "giáo viên phụ trách" nhận báo cáo và thông
   * báo về conversation của khoá.
   */
  async listCourseStaffUserIds(courseId: string, db: MessagingDb = this.db()): Promise<string[]> {
    const courseCtx = await db
      .selectFrom('context')
      .select(['id', 'path'])
      .where('context_level', '=', CONTEXT_LEVEL_COURSE)
      .where('instance_id', '=', courseId)
      .executeTakeFirst();
    if (!courseCtx) return [];
    // path của context là chuỗi id các context từ gốc tới chính nó
    // (định dạng '/<id>/.../<id>'): các id trong path là đúng tập
    // context mà gán vai trò tại đó kế thừa xuống khoá này.
    const pathIds = courseCtx.path.split('/').filter((part) => part.length > 0);
    if (!pathIds.length) return [];
    const rows = await db
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.user_id as userId')
      .distinct()
      .where('role.archetype', 'in', [...STAFF_ARCHETYPES])
      .where('role_assignments.context_id', 'in', pathIds)
      .execute();
    return rows.map((r) => r.userId);
  }


  // --- báo cáo conversation ---------------------------------------------------

  /** Ghi một báo cáo conversation mới (trạng thái open). */
  async insertReport(v: NewReport, db: MessagingDb = this.db()): Promise<ReportRow> {
    return db
      .insertInto('message_conversation_reports')
      .values(reportInsertValues(v))
      .returning(REPORT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Một báo cáo theo id. */
  async getReport(id: string, db: MessagingDb = this.db()): Promise<ReportRow | undefined> {
    return db
      .selectFrom('message_conversation_reports')
      .select(REPORT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Các báo cáo mới nhất trước (hàng đợi xử lý lọc theo thẩm quyền ở tầng service). */
  async listReports(limit = 200, db: MessagingDb = this.db()): Promise<ReportRow[]> {
    return db
      .selectFrom('message_conversation_reports')
      .select(REPORT_COLUMNS)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }

  /** Đổi trạng thái xử lý của báo cáo; resolved/dismissed ghi người xử lý + mốc, mở lại thì xoá hai dấu đó. */
  async updateReportStatus(id: string, status: string, resolvedBy: string | null, db: MessagingDb = this.db()): Promise<ReportRow | undefined> {
    const closing = status !== 'open';
    return db
      .updateTable('message_conversation_reports')
      .set({
        status,
        resolved_by: closing ? resolvedBy : null,
        resolved_at: closing ? new Date() : null,
      })
      .where('id', '=', id)
      .returning(REPORT_COLUMNS)
      .executeTakeFirst();
  }


  // --- ghi danh hiệu lực + roster thành viên khoá ------------------------------
  // Đọc trực tiếp bảng enrol/user_enrolments qua định nghĩa bảng dùng chung
  // (barrel schema) — Messaging KHÔNG import EnrolModule để tránh vòng lặp
  // module; ngữ nghĩa "đang active" chép đúng EnrolService.isEnrolled
  // (instance enabled, ghi danh ACTIVE, now trong [timeStart, timeEnd]).

  /**
   * Các khoá mà user có ghi danh đang hiệu lực (instance enabled + ghi danh
   * ACTIVE + trong cửa sổ thời gian).
   */
  async activeCourseIds(userId: string, db: MessagingDb = this.db()): Promise<string[]> {
    const now = new Date();
    const rows = await db
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select('enrol.course_id as courseId')
      .where((eb) => eb.and([
        eb('user_enrolments.user_id', '=', userId),
        eb('user_enrolments.status', '=', 0),
        eb('enrol.status', '=', 0),
        eb('user_enrolments.time_start', '<=', now),
        eb.or([
          eb('user_enrolments.time_end', 'is', null),
          eb('user_enrolments.time_end', '>=', now),
        ]),
      ]))
      .execute();
    return rows.map((r) => r.courseId);
  }

  /**
   * Khoá chung của một cặp (giáo viên, học sinh) theo quan hệ mở cổng
   * nhắn riêng trực tiếp (ngoại lệ đã chốt bổ sung 25/10/2026 trên
   * issue #33): MỘT phía có gán vai archetype staff
   * ({@link STAFF_ARCHETYPES}) TẠI context của khoá — đúng khái niệm
   * "giáo viên của khoá" mà roster dùng cho cờ teacher, hẹp hơn
   * capability `course:managegroups` (chỉ tổ trưởng/quản lý nhóm mới
   * có) — và phía KIA có ghi danh ĐANG HIỆU LỰC trong chính khoá đó.
   * Trả id khoá đầu tiên khớp, không có thì null. Một truy vấn duy
   * nhất neo theo cặp user (role_assignments theo user/context và
   * user_enrolments theo user đều có index sẵn) — không quét toàn bộ
   * danh sách khoá hay thành viên, không cần index/schema mới.
   */
  async findTeacherStudentSharedCourseId(userA: string, userB: string, db: MessagingDb = this.db()): Promise<string | null> {
    const now = new Date();
    const rows = await db
      .selectFrom('context')
      .innerJoin('role_assignments', 'role_assignments.context_id', 'context.id')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('enrol', 'enrol.course_id', 'context.instance_id')
      .innerJoin('user_enrolments', 'user_enrolments.enrol_id', 'enrol.id')
      .select('context.instance_id as courseId')
      .where((eb) => eb.and([
        eb('context.context_level', '=', CONTEXT_LEVEL_COURSE),
        eb('role.archetype', 'in', [...STAFF_ARCHETYPES]),
        eb('user_enrolments.status', '=', 0),
        eb('enrol.status', '=', 0),
        eb('user_enrolments.time_start', '<=', now),
        eb.or([
          eb('user_enrolments.time_end', 'is', null),
          eb('user_enrolments.time_end', '>=', now),
        ]),
        eb.or([
          eb.and([eb('role_assignments.user_id', '=', userA), eb('user_enrolments.user_id', '=', userB)]),
          eb.and([eb('role_assignments.user_id', '=', userB), eb('user_enrolments.user_id', '=', userA)]),
        ]),
      ]))
      .limit(1)
      .execute();
    return rows[0]?.courseId ?? null;
  }

  /**
   * User có gán vai archetype staff TẠI context của đúng khoá này hay
   * không — "giáo viên của khoá" theo cùng định nghĩa roster dùng,
   * dùng để tính cờ nhắn thẳng trên từng dòng roster.
   */
  async isCourseTeachingStaff(courseId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const courseCtx = await db
      .selectFrom('context')
      .select('id')
      .where('context_level', '=', CONTEXT_LEVEL_COURSE)
      .where('instance_id', '=', courseId)
      .executeTakeFirst();
    if (!courseCtx) return false;
    const rows = await db
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.id as id')
      .where('role_assignments.context_id', '=', courseCtx.id)
      .where('role_assignments.user_id', '=', userId)
      .where('role.archetype', 'in', [...STAFF_ARCHETYPES])
      .limit(1)
      .execute();
    return rows.length > 0;
  }

  /** Tóm tắt một khoá (cho danh sách "khoá của tôi" của luồng tìm bạn theo khoá). */
  async getCourseSummary(courseId: string, db: MessagingDb = this.db()): Promise<{ courseId: string; fullName: string; shortName: string } | undefined> {
    return db
      .selectFrom('course')
      .select(['id as courseId', 'full_name as fullName', 'short_name as shortName'])
      .where('id', '=', courseId)
      .executeTakeFirst();
  }

  /**
   * Các khoá mà user là THÀNH VIÊN theo định nghĩa roster đã chốt:
   * ghi danh đang hiệu lực ∪ có gán vai tại context của khoá (mọi
   * archetype — gán vai học viên tại context khoá cũng là thành viên).
   */
  async listMembershipCourseIds(userId: string, db: MessagingDb = this.db()): Promise<string[]> {
    const enrolled = await this.activeCourseIds(userId, db);
    const assigned = await db
      .selectFrom('role_assignments')
      .innerJoin('context', 'context.id', 'role_assignments.context_id')
      .select('context.instance_id as courseId')
      .distinct()
      .where('role_assignments.user_id', '=', userId)
      .where('context.context_level', '=', CONTEXT_LEVEL_COURSE)
      .execute();
    const assignedCourseIds = assigned.map((r) => r.courseId).filter((id): id is string => id !== null);
    return [...new Set([...enrolled, ...assignedCourseIds])];
  }

  /**
   * User có thuộc khoá theo định nghĩa thành viên roster hay không —
   * cổng xem roster: người ngoài khoá bị từ chối ở tầng service bằng
   * cùng một 404 như khoá không tồn tại (không lộ sự tồn tại của khoá).
   */
  async isCourseMember(courseId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const now = new Date();
    const enrolled = await db
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select('user_enrolments.user_id as userId')
      .where((eb) => eb.and([
        eb('enrol.course_id', '=', courseId),
        eb('user_enrolments.user_id', '=', userId),
        eb('user_enrolments.status', '=', 0),
        eb('enrol.status', '=', 0),
        eb('user_enrolments.time_start', '<=', now),
        eb.or([
          eb('user_enrolments.time_end', 'is', null),
          eb('user_enrolments.time_end', '>=', now),
        ]),
      ]))
      .limit(1)
      .executeTakeFirst();
    if (enrolled) return true;
    const courseCtx = await db
      .selectFrom('context')
      .select('id')
      .where('context_level', '=', CONTEXT_LEVEL_COURSE)
      .where('instance_id', '=', courseId)
      .executeTakeFirst();
    if (!courseCtx) return false;
    const assigned = await db
      .selectFrom('role_assignments')
      .select('id')
      .where('context_id', '=', courseCtx.id)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
    return Boolean(assigned);
  }

  /**
   * Một trang roster của khoá, sắp tăng dần theo (displayName,
   * username, id); `cursor` là mốc của dòng cuối trang trước (null =
   * trang đầu) — phân trang con trỏ ngay tại SQL, không nạp tập thành
   * viên về app (số đo của đội kiểm tra trên issue #33: roster 50.000
   * thành viên trả hết là ~6,3 MB JSON; OFFSET sâu chậm hơn hẳn).
   * Tập thành viên = ghi danh hiệu lực ∪ gán vai tại context khoá;
   * cờ `staff` = có gán vai archetype staff tại context khoá; cờ
   * `enrolled` = thành viên có ghi danh hiệu lực (dù đồng thời có gán
   * vai hay không) — căn cứ phía "học sinh" của quan hệ nhắn thẳng
   * GV–HS trên roster. Tài
   * khoản đã xoá/tạm ngưng/khách, chính người xem, và người có quan
   * hệ chặn với người xem (CẢ hai chiều) bị loại ngay tại SQL. Chỉ
   * các trường trong whitelist của hợp đồng roster được chọn ra.
   */
  async listCourseRosterPage(courseId: string, actorId: string, cursor: { displayName: string; username: string; userId: string } | null, limit: number, db: MessagingDb = this.db()): Promise<{
    userId: string; username: string; firstName: string; lastName: string; displayName: string; staff: boolean; enrolled: boolean;
  }[]> {
    const cursorCond = cursor
      ? sql`and ((${USER_DISPLAY_NAME_EXPR}), u.username, u.id) > (${cursor.displayName}, ${cursor.username}, ${cursor.userId}::uuid)`
      : sql``;
    const executed = await sql<ClassRosterRawRow>`
      with course_ctx as (
        select id from "context" where context_level = ${CONTEXT_LEVEL_COURSE} and instance_id = ${courseId}
      ),
      member_flags as (
        select ue.user_id as user_id, false as staff, true as enrolled
        from user_enrolments ue
        join enrol e on e.id = ue.enrol_id
        where e.course_id = ${courseId}
          and ue.status = 0 and e.status = 0
          and ue.time_start <= now() and (ue.time_end is null or ue.time_end >= now())
        union all
        select ra.user_id as user_id, (r.archetype in (${sql.join([...STAFF_ARCHETYPES].map((a) => sql`${a}`), sql`, `)})) as staff, false as enrolled
        from role_assignments ra
        join role r on r.id = ra.role_id
        where ra.context_id = (select id from course_ctx)
      ),
      members as (
        select user_id, bool_or(staff) as staff, bool_or(enrolled) as enrolled from member_flags group by user_id
      )
      select u.id as user_id, u.username as username, u.first_name as first_name, u.last_name as last_name,
        (${USER_DISPLAY_NAME_EXPR}) as display_name,
        m.staff as staff, m.enrolled as enrolled
      from members m
      join users u on u.id = m.user_id
      where u.deleted = false and u.suspended = false and u.is_guest = false
        and u.id <> ${actorId}
        and not exists (
          select 1 from message_users_blocked b
          where (b.user_id = ${actorId} and b.blocked_user_id = u.id)
             or (b.user_id = u.id and b.blocked_user_id = ${actorId})
        )
        ${cursorCond}
      order by display_name asc, u.username asc, u.id asc
      limit ${limit}
    `.execute(db);
    return executed.rows.map((raw) => ({
      userId: raw.user_id,
      username: raw.username,
      firstName: raw.first_name,
      lastName: raw.last_name,
      displayName: raw.display_name,
      staff: Boolean(raw.staff),
      enrolled: Boolean(raw.enrolled),
    }));
  }
}
