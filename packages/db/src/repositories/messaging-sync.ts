/**
 * Đồng bộ conversation nhóm/khoá học/lớp từ dữ liệu nhóm, ghi danh và lớp (đồng bộ lười, không hook bên module gốc).
 *
 * Một miền của {@link MessagingRepository} (xem `messaging.ts`): nhận handle kho trung tâm qua constructor, mọi phương thức nhận handle tuỳ chọn `db` mặc định là handle gốc (khuôn S6) — facade ở `messaging.ts` giữ nguyên API public và uỷ quyền sang đây.
 */
import {
  sql,
} from 'kysely';
import type { CentreDb } from '../client';
import { CONTEXT_LEVEL_CLASS } from './dashboard';
import {
  CONVERSATION_COLUMNS,
  COURSE_GROUP_COLUMNS,
  STAFF_ARCHETYPES,
  USER_DISPLAY_NAME_EXPR,
  type ClassRosterRawRow,
  type ConversationRow,
  type CourseGroupRow,
  type MessagingDb,
  type MessagingTx,
} from './messaging';
import type { MessagingRepository } from './messaging';

/** Đồng bộ conversation nhóm/khoá học/lớp từ dữ liệu nhóm, ghi danh và lớp (đồng bộ lười, không hook bên module gốc). */
export class MessagingSyncRepository {
  constructor(
    private readonly handle: CentreDb,
    private readonly repo: MessagingRepository,
  ) {}

  /** Handle gốc của miền (điểm mở giao dịch + truy vấn ngoài giao dịch). */
  private db(): MessagingDb {
    return this.handle;
  }


  // --- đồng bộ cuộc trò chuyện nhóm ------------------------------------------------
  // Đọc trực tiếp bảng groups/groups_members qua barrel schema (không import
  // GroupsModule): đồng bộ lười phía messaging, không cần hook bên groups.

  /**
   * Lấy một course group theo id (kèm courseId để resolve context/staff).
   */
  async getCourseGroup(groupId: string, db: MessagingDb = this.db()): Promise<CourseGroupRow | undefined> {
    return db
      .selectFrom('course_groups')
      .select(COURSE_GROUP_COLUMNS)
      .where('id', '=', groupId)
      .executeTakeFirst();
  }

  /**
   * Thành viên hiện tại của một course group.
   */
  async listGroupMemberIds(groupId: string, db: MessagingDb = this.db()): Promise<string[]> {
    const rows = await db
      .selectFrom('groups_members')
      .select('user_id as userId')
      .where('group_id', '=', groupId)
      .execute();
    return rows.map((r) => r.userId);
  }

  /**
   * Mọi group mà user hiện là thành viên (để tầng service phát hiện
   * membership conversation đã cũ so với group).
   */
  async listGroupIdsForUser(userId: string, db: MessagingDb = this.db()): Promise<string[]> {
    const rows = await db
      .selectFrom('groups_members')
      .select('group_id as groupId')
      .where('user_id', '=', userId)
      .execute();
    return rows.map((r) => r.groupId);
  }

  /**
   * Conversation gắn với một course group qua (component, itemType, itemId).
   */
  async findGroupConversation(groupId: string, db: MessagingDb = this.db()): Promise<ConversationRow | undefined> {
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_group')
      .where('item_type', '=', 'groups')
      .where('item_id', '=', groupId)
      .executeTakeFirst();
  }

  /**
   * Mọi conversation gắn group mà user là thành viên của group tương ứng —
   * để thao tác liệt kê cũng kích hoạt đồng bộ (người mới vào group thấy
   * conversation ngay cả khi chưa từng là thành viên conversation).
   */
  async listGroupConversationsForGroupMember(userId: string, db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    const memberships = await db
      .selectFrom('groups_members')
      .select('group_id as groupId')
      .where('user_id', '=', userId)
      .execute();
    if (!memberships.length) return [];
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_group')
      .where('item_type', '=', 'groups')
      .where('item_id', 'in', memberships.map((m) => m.groupId))
      .execute();
  }


  // --- đồng bộ cuộc trò chuyện khoá học ----------------------------------------------
  // Conversation CẤP KHOÁ (chat toàn lớp): một conversation type 2 gắn
  // với chính khoá qua (component 'core_course', itemType 'course',
  // itemId = course id). Thành viên đúng nghĩa = ghi danh đang hiệu lực
  // ∪ staff của khoá — đọc trực tiếp enrol/user_enrolments +
  // role_assignments qua barrel schema như phần roster/staff phía trên.

  /**
   * Conversation gắn với chính một khoá qua (component, itemType, itemId).
   * Nhận tx tuỳ chọn để re-check TRONG transaction đã giữ khoá advisory
   * (xem {@link acquireCourseConversationLock}) — đường đọc mặc định
   * vẫn qua kết nối thường.
   */
  async findCourseConversation(courseId: string, db: MessagingDb = this.db()): Promise<ConversationRow | undefined> {
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_course')
      .where('item_type', '=', 'course')
      .where('item_id', '=', courseId)
      .executeTakeFirst();
  }

  /**
   * Khoá advisory cấp transaction theo courseId cho đường ensure
   * conversation cấp khoá: mọi lượt ensure song song của cùng một khoá
   * xếp hàng tại đây, và vì là xact lock (giữ tới commit/rollback) nên
   * lượt xếp sau re-check sẽ thấy conversation của lượt trước đã
   * commit. Đây là điểm đồng bộ duy nhất giữ bất biến "mỗi khoá đúng
   * một conversation cấp khoá" mà không cần unique trên schema.
   */
  async acquireCourseConversationLock(tx: MessagingTx, courseId: string): Promise<void> {
    const key = `messaging:core_course:${courseId}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(tx);
  }

  /**
   * User đang ghi danh HIỆU LỰC trong một khoá (instance enabled + ghi
   * danh ACTIVE + trong cửa sổ thời gian — cùng ngữ nghĩa activeCourseIds).
   */
  async listActiveEnrolledUserIds(courseId: string, db: MessagingDb = this.db()): Promise<string[]> {
    const now = new Date();
    const rows = await db
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select('user_enrolments.user_id as userId')
      .where((eb) => eb.and([
        eb('enrol.course_id', '=', courseId),
        eb('user_enrolments.status', '=', 0),
        eb('enrol.status', '=', 0),
        eb('user_enrolments.time_start', '<=', now),
        eb.or([
          eb('user_enrolments.time_end', 'is', null),
          eb('user_enrolments.time_end', '>=', now),
        ]),
      ]))
      .execute();
    return [...new Set(rows.map((r) => r.userId))];
  }

  /**
   * Tập thành viên của conversation cấp khoá: ghi danh đang hiệu lực ∪
   * staff của khoá ({@link listCourseStaffUserIds} — gán vai staff tại
   * context khoá hoặc tổ tiên).
   */
  async listCourseConversationMemberIds(courseId: string): Promise<string[]> {
    const enrolled = await this.listActiveEnrolledUserIds(courseId);
    const staff = await this.repo.listCourseStaffUserIds(courseId);
    return [...new Set([...enrolled, ...staff])];
  }

  /**
   * Mọi conversation cấp khoá thuộc các khoá mà user là thành viên theo
   * định nghĩa roster (ghi danh hiệu lực ∪ gán vai tại context khoá) —
   * để thao tác liệt kê cũng kích hoạt đồng bộ lười như đường group.
   */
  async listCourseConversationsForMember(userId: string, db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    const courseIds = await this.repo.listMembershipCourseIds(userId, db);
    if (!courseIds.length) return [];
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_course')
      .where('item_type', '=', 'course')
      .where('item_id', 'in', courseIds)
      .execute();
  }


  // --- class conversation sync (lát MSG-T2, issue #184) ----------------------
  // Conversation CẤP LỚP (chat của chính lớp): một conversation type 2
  // gắn với lớp qua (component 'core_class', itemType 'class',
  // itemId = class id) — conversation RIÊNG, không dùng lại nhóm con
  // "Cả lớp" của khoá trong lớp. Thành viên đúng nghĩa = roster lớp
  // hiệu lực (≡ cohort_members của backing cohort, định nghĩa của
  // module classes) ∪ chủ lớp ∪ staff của lớp (gán vai archetype staff
  // tại context lớp mức 45 hoặc tổ tiên) — đọc trực tiếp qua barrel
  // schema như phần cây nhóm ở dưới, không import ClassesModule.

  /**
   * Tóm tắt một lớp (cho đường ensure + roster phía messages).
   *
   * @param classId - Id lớp cần tra.
   * @returns Tên, chủ lớp, cohort đỡ roster, tenant và trạng thái
   *   của lớp; `undefined` khi lớp không tồn tại.
   */
  async getClassSummary(classId: string, db: MessagingDb = this.db()): Promise<{ classId: string; name: string; ownerId: string; cohortId: string; tenantId: string; status: string } | undefined> {
    return db
      .selectFrom('classes')
      .select(['id as classId', 'name', 'owner_id as ownerId', 'cohort_id as cohortId', 'tenant_id as tenantId', 'status'])
      .where('id', '=', classId)
      .executeTakeFirst();
  }

  /**
   * Mọi user mang vai trò staff tại context của lớp hoặc một context
   * tổ tiên của nó — tập "giáo viên của lớp" (chủ lớp có editingteacher
   * tại context lớp nên nằm trong tập này), khớp
   * {@link listCourseStaffUserIds} ở cấp khoá.
   *
   * @param classId - Id lớp làm phạm vi.
   * @returns Danh sách id người dùng thuộc tập staff của lớp (rỗng
   *   khi lớp chưa có context).
   */
  async listClassStaffUserIds(classId: string, db: MessagingDb = this.db()): Promise<string[]> {
    const classCtx = await db
      .selectFrom('context')
      .select(['id', 'path'])
      .where('context_level', '=', CONTEXT_LEVEL_CLASS)
      .where('instance_id', '=', classId)
      .executeTakeFirst();
    if (!classCtx) return [];
    const pathIds = classCtx.path.split('/').filter((part) => part.length > 0);
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

  /**
   * User có gán vai archetype staff TẠI context của đúng lớp này hay
   * không — "giáo viên của lớp" theo cùng định nghĩa roster khoá dùng
   * cho cờ nhắn thẳng GV–HS (chủ lớp mang editingteacher tại context
   * lớp nên qua được kiểm này).
   *
   * @param classId - Id lớp làm phạm vi.
   * @param userId - Người cần kiểm.
   * @returns `true` khi có gán vai staff ngay tại context lớp.
   */
  async isClassTeachingStaff(classId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const classCtx = await db
      .selectFrom('context')
      .select('id')
      .where('context_level', '=', CONTEXT_LEVEL_CLASS)
      .where('instance_id', '=', classId)
      .executeTakeFirst();
    if (!classCtx) return false;
    const rows = await db
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.id as id')
      .where('role_assignments.context_id', '=', classCtx.id)
      .where('role_assignments.user_id', '=', userId)
      .where('role.archetype', 'in', [...STAFF_ARCHETYPES])
      .limit(1)
      .execute();
    return rows.length > 0;
  }

  /**
   * Thành viên roster hiệu lực của lớp (≡ cohort_members của backing
   * cohort).
   *
   * @param classId - Id lớp.
   * @returns Danh sách id thành viên roster (rỗng khi lớp không còn).
   */
  async listClassRosterMemberIds(classId: string, db: MessagingDb = this.db()): Promise<string[]> {
    const cls = await this.getClassSummary(classId, db);
    if (!cls) return [];
    const rows = await db
      .selectFrom('cohort_members')
      .select('user_id as userId')
      .where('cohort_id', '=', cls.cohortId)
      .execute();
    return rows.map((r) => r.userId);
  }

  /**
   * Tập thành viên của conversation cấp lớp: roster lớp hiệu lực ∪
   * chủ lớp ∪ staff của lớp. Đây là TẬP ĐÍCH duy nhất mà mọi đường
   * đồng bộ lười của chat lớp hướng về — roster lớp là nguồn sự
   * thật, thành viên chat chỉ là hình chiếu của nó.
   *
   * @param classId - Id lớp.
   * @returns Danh sách id thành viên (đã khử trùng) của chat lớp.
   */
  async listClassConversationMemberIds(classId: string): Promise<string[]> {
    const cls = await this.getClassSummary(classId);
    if (!cls) return [];
    const roster = await this.listClassRosterMemberIds(classId);
    const staff = await this.listClassStaffUserIds(classId);
    return [...new Set([...roster, cls.ownerId, ...staff])];
  }

  /**
   * User có thuộc lớp theo định nghĩa thành viên của chat lớp hay
   * không: thành viên roster, chủ lớp, hoặc có BẤT KỲ gán vai nào tại
   * context lớp (gán vai tại lớp cũng là quan hệ thuộc lớp, như định
   * nghĩa thành viên khoá gồm gán vai tại context khoá).
   *
   * @param classId - Id lớp.
   * @param userId - Người cần kiểm.
   * @returns `true` khi người dùng thuộc lớp theo bất kỳ vế nào.
   */
  async isClassMember(classId: string, userId: string, db: MessagingDb = this.db()): Promise<boolean> {
    const cls = await this.getClassSummary(classId, db);
    if (!cls) return false;
    if (cls.ownerId === userId) return true;
    const inRoster = await db
      .selectFrom('cohort_members')
      .select('user_id as userId')
      .where('cohort_id', '=', cls.cohortId)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
    if (inRoster) return true;
    const classCtx = await db
      .selectFrom('context')
      .select('id')
      .where('context_level', '=', CONTEXT_LEVEL_CLASS)
      .where('instance_id', '=', classId)
      .executeTakeFirst();
    if (!classCtx) return false;
    const assigned = await db
      .selectFrom('role_assignments')
      .select('id')
      .where('context_id', '=', classCtx.id)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
    return Boolean(assigned);
  }

  /**
   * Conversation gắn với chính một lớp qua (component, itemType,
   * itemId). Nhận tx tuỳ chọn để re-check TRONG transaction đã giữ
   * khoá advisory (xem {@link acquireClassConversationLock}).
   *
   * @param classId - Id lớp.
   * @param tx - Transaction đang chạy (khi re-check trong ensure),
   *   bỏ trống thì đọc bằng kết nối thường.
   * @returns Conversation cấp lớp của lớp, hoặc `undefined`.
   */
  async findClassConversation(classId: string, db: MessagingDb = this.db()): Promise<ConversationRow | undefined> {
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_class')
      .where('item_type', '=', 'class')
      .where('item_id', '=', classId)
      .executeTakeFirst();
  }

  /**
   * Khoá advisory cấp transaction theo classId cho đường ensure
   * conversation cấp lớp — cùng khuôn khoá cấp khoá, giữ bất biến
   * "mỗi lớp đúng một conversation cấp lớp" mà không cần unique trên
   * schema.
   *
   * @param tx - Transaction sẽ giữ khoá tới khi commit/rollback.
   * @param classId - Id lớp làm khoá.
   */
  async acquireClassConversationLock(tx: MessagingTx, classId: string): Promise<void> {
    const key = `messaging:core_class:${classId}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(tx);
  }

  /**
   * Mọi conversation cấp lớp thuộc các lớp mà user có quan hệ (chủ
   * lớp / staff tại context lớp / thành viên roster — đúng tập lớp
   * của cây nhóm) — để thao tác liệt kê cũng kích hoạt đồng bộ lười
   * như đường khoá.
   *
   * @param userId - Người đang liệt kê.
   * @returns Các conversation cấp lớp đã tồn tại của những lớp mà
   *   người dùng có quan hệ (chưa ensure thì lớp chưa có dòng nào).
   */
  async listClassConversationsForMember(userId: string, db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    const relations = await this.repo.listTreeClassesForUser(userId, db);
    if (!relations.length) return [];
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_class')
      .where('item_type', '=', 'class')
      .where('item_id', 'in', relations.map((r) => r.classId))
      .execute();
  }

  /**
   * Một trang roster của lớp, sắp tăng dần theo (displayName,
   * username, id) — cùng khuôn trang roster khoá
   * ({@link listCourseRosterPage}): tập thành viên = roster lớp
   * (cohort_members của backing cohort; cờ `enrolled` = thuộc roster)
   * ∪ gán vai tại context lớp (cờ `staff` = archetype staff tại
   * context lớp); tài khoản đã xoá/tạm ngưng/khách, chính người xem
   * và quan hệ chặn hai chiều bị loại ngay tại SQL.
   *
   * @param classId - Id lớp.
   * @param actorId - Người xem (bị loại khỏi kết quả).
   * @param cursor - Mốc (displayName, username, id) của dòng cuối
   *   trang trước; null khi lấy trang đầu.
   * @param limit - Số dòng tối đa (service truyền limit + 1 để dò
   *   còn trang sau hay không).
   * @returns Các dòng roster của trang, đã sắp xếp ổn định.
   */
  async listClassRosterPage(classId: string, actorId: string, cursor: { displayName: string; username: string; userId: string } | null, limit: number, db: MessagingDb = this.db()): Promise<{
    userId: string; username: string; firstName: string; lastName: string; displayName: string; staff: boolean; enrolled: boolean;
  }[]> {
    const cursorCond = cursor
      ? sql`and ((${USER_DISPLAY_NAME_EXPR}), u.username, u.id) > (${cursor.displayName}, ${cursor.username}, ${cursor.userId}::uuid)`
      : sql``;
    const executed = await sql<ClassRosterRawRow>`
      with class_row as (
        select cohort_id, owner_id from classes where id = ${classId}
      ),
      class_ctx as (
        select id from "context" where context_level = ${CONTEXT_LEVEL_CLASS} and instance_id = ${classId}
      ),
      member_flags as (
        select cm.user_id as user_id, false as staff, true as enrolled
        from cohort_members cm
        where cm.cohort_id = (select cohort_id from class_row)
        union all
        select ra.user_id as user_id, (r.archetype in (${sql.join([...STAFF_ARCHETYPES].map((a) => sql`${a}`), sql`, `)})) as staff, false as enrolled
        from role_assignments ra
        join role r on r.id = ra.role_id
        where ra.context_id = (select id from class_ctx)
        union all
        select owner_id as user_id, true as staff, false as enrolled
        from class_row
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

  /**
   * Lớp chung của một cặp (giáo viên, học sinh) theo quan hệ mở cổng
   * nhắn riêng trực tiếp — bản cấp lớp của
   * {@link findTeacherStudentSharedCourseId} (sổ quyết định mục D:
   * GV nhắn riêng trực tiếp HS thuộc khoá/LỚP của mình): MỘT phía là
   * giáo viên của lớp (gán vai archetype staff tại context lớp — chủ
   * lớp mang editingteacher tại context lớp nên nằm trong vế này) và
   * phía KIA là thành viên roster hiệu lực của chính lớp đó. Trả id
   * lớp đầu tiên khớp, không có thì null.
   *
   * @param userA - Một phía của cặp.
   * @param userB - Phía còn lại của cặp.
   * @returns Id lớp chung đầu tiên theo quan hệ GV–HS, hoặc null.
   */
  async findTeacherStudentSharedClassId(userA: string, userB: string, db: MessagingDb = this.db()): Promise<string | null> {
    const rows = await db
      .selectFrom('context')
      .innerJoin('role_assignments', 'role_assignments.context_id', 'context.id')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('classes', 'classes.id', 'context.instance_id')
      .innerJoin('cohort_members', 'cohort_members.cohort_id', 'classes.cohort_id')
      .select('context.instance_id as classId')
      .where((eb) => eb.and([
        eb('context.context_level', '=', CONTEXT_LEVEL_CLASS),
        eb('classes.status', '=', 'active'),
        eb('role.archetype', 'in', [...STAFF_ARCHETYPES]),
        eb.or([
          eb.and([eb('role_assignments.user_id', '=', userA), eb('cohort_members.user_id', '=', userB)]),
          eb.and([eb('role_assignments.user_id', '=', userB), eb('cohort_members.user_id', '=', userA)]),
        ]),
      ]))
      .limit(1)
      .execute();
    return rows[0]?.classId ?? null;
  }
}
