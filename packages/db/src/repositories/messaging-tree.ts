/**
 * Cây nhóm theo vai: lớp/khoá học của user cùng quan hệ (chủ lớp, staff, roster).
 *
 * Một miền của {@link MessagingRepository} (xem `messaging.ts`): nhận handle kho trung tâm qua constructor, mọi phương thức nhận handle tuỳ chọn `db` mặc định là handle gốc (khuôn S6) — facade ở `messaging.ts` giữ nguyên API public và uỷ quyền sang đây.
 */
import type { CentreDb } from '../client';
import { CONTEXT_LEVEL_CLASS, CONTEXT_LEVEL_COURSE } from './dashboard';
import {
  CONVERSATION_COLUMNS,
  STAFF_ARCHETYPES,
  type ConversationRow,
  type MessagingDb,
} from './messaging';

/** Cây nhóm theo vai: lớp/khoá học của user cùng quan hệ (chủ lớp, staff, roster). */
export class MessagingTreeRepository {
  constructor(private readonly handle: CentreDb) {}

  /** Handle gốc của miền (điểm mở giao dịch + truy vấn ngoài giao dịch). */
  private db(): MessagingDb {
    return this.handle;
  }


  // --- cây nhóm theo vai (lát MSG-T1, issue #33) ------------------------------
  // Cây dựng hoàn toàn ở server từ classes + enrol + conversations.
  // Messaging KHÔNG import ClassesModule (tránh vòng lặp module như
  // tiền lệ enrol ở trên): quan hệ của user với lớp đọc trực tiếp qua
  // barrel schema — chủ lớp (ownerId), gán vai tại context lớp (mức
  // 45), và roster lớp ≡ cohort_members của backing cohort (định
  // nghĩa của module classes). Lớp đã lưu trữ (status 'archived')
  // không thuộc cây đang hoạt động nên bị loại ở mọi đường.

  /** Quan hệ của user với MỘT lớp: chủ lớp hay có gán vai archetype staff tại context lớp (mức 45) hay không. */
  async listTreeClassesForUser(userId: string, db: MessagingDb = this.db()): Promise<{ classId: string; name: string; isOwner: boolean; isClassStaff: boolean; isRosterMember: boolean }[]> {
    const owned = await db
      .selectFrom('classes')
      .select(['id as classId', 'name'])
      .where('owner_id', '=', userId)
      .where('status', '=', 'active')
      .execute();
    const staffRows = await db
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('context', 'context.id', 'role_assignments.context_id')
      .innerJoin('classes', 'classes.id', 'context.instance_id')
      .select(['context.instance_id as classId', 'classes.name as name'])
      .distinct()
      .where((eb) => eb.and([
        eb('role_assignments.user_id', '=', userId),
        eb('context.context_level', '=', CONTEXT_LEVEL_CLASS),
        eb('role.archetype', 'in', [...STAFF_ARCHETYPES]),
        eb('classes.status', '=', 'active'),
      ]))
      .execute();
    const rosterRows = await db
      .selectFrom('cohort_members')
      .innerJoin('classes', 'classes.cohort_id', 'cohort_members.cohort_id')
      .select(['classes.id as classId', 'classes.name as name'])
      .distinct()
      .where('cohort_members.user_id', '=', userId)
      .where('classes.status', '=', 'active')
      .execute();
    const byId = new Map<string, { classId: string; name: string; isOwner: boolean; isClassStaff: boolean; isRosterMember: boolean }>();
    const ensure = (classId: string | null, name: string) => {
      if (!classId) return undefined;
      let entry = byId.get(classId);
      if (!entry) {
        entry = { classId, name, isOwner: false, isClassStaff: false, isRosterMember: false };
        byId.set(classId, entry);
      }
      return entry;
    };
    for (const r of owned) { const e = ensure(r.classId, r.name); if (e) e.isOwner = true; }
    for (const r of staffRows) { const e = ensure(r.classId, r.name); if (e) e.isClassStaff = true; }
    for (const r of rosterRows) { const e = ensure(r.classId, r.name); if (e) e.isRosterMember = true; }
    return [...byId.values()];
  }


  /** Mọi khoá THẬT (không phải mẫu) thuộc một tập lớp — để neo cây theo quan hệ lớp–khoá. */
  async listCoursesByClassIds(classIds: string[], db: MessagingDb = this.db()): Promise<{ courseId: string; fullName: string; classId: string }[]> {
    if (!classIds.length) return [];
    const rows = await db
      .selectFrom('course')
      .select(['id as courseId', 'full_name as fullName', 'class_id as classId'])
      .where('class_id', 'in', classIds)
      .where('is_template', '=', false)
      .execute();
    return rows.filter((r): r is { courseId: string; fullName: string; classId: string } => r.classId !== null);
  }


  /** Lớp chứa từng khoá trong tập cho trước (khoá không thuộc lớp nào thì vắng khỏi kết quả). */
  async listClassesOfCourses(courseIds: string[], db: MessagingDb = this.db()): Promise<{ courseId: string; classId: string; className: string; classStatus: string }[]> {
    if (!courseIds.length) return [];
    const rows = await db
      .selectFrom('course')
      .innerJoin('classes', 'classes.id', 'course.class_id')
      .select(['course.id as courseId', 'course.class_id as classId', 'classes.name as className', 'classes.status as classStatus'])
      .where('course.id', 'in', courseIds)
      .execute();
    return rows.filter((r): r is { courseId: string; classId: string; className: string; classStatus: string } => r.classId !== null);
  }


  /** Tên hiển thị của một tập khoá (cho các nút khoá của cây). */
  async listCourseNames(courseIds: string[], db: MessagingDb = this.db()): Promise<{ courseId: string; fullName: string }[]> {
    if (!courseIds.length) return [];
    return db
      .selectFrom('course')
      .select(['id as courseId', 'full_name as fullName'])
      .where('id', 'in', courseIds)
      .execute();
  }


  /**
   * Các khoá trong tập cho trước mà user có gán vai archetype staff
   * TẠI context khoá (mức 50) — căn cứ vai "đang dạy" của nút khoá,
   * cùng định nghĩa "giáo viên của khoá" với roster.
   */
  async listTeachingCourseIds(userId: string, courseIds: string[], db: MessagingDb = this.db()): Promise<string[]> {
    if (!courseIds.length) return [];
    const rows = await db
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('context', 'context.id', 'role_assignments.context_id')
      .select('context.instance_id as courseId')
      .distinct()
      .where((eb) => eb.and([
        eb('role_assignments.user_id', '=', userId),
        eb('context.context_level', '=', CONTEXT_LEVEL_COURSE),
        eb('context.instance_id', 'in', courseIds),
        eb('role.archetype', 'in', [...STAFF_ARCHETYPES]),
      ]))
      .execute();
    return rows.map((r) => r.courseId).filter((id): id is string => id !== null);
  }


  /** Tên của một tập course group (cho các nút nhóm con của cây). */
  async listGroupNames(groupIds: string[], db: MessagingDb = this.db()): Promise<{ groupId: string; name: string; courseId: string }[]> {
    if (!groupIds.length) return [];
    return db
      .selectFrom('course_groups')
      .select(['id as groupId', 'name', 'course_id as courseId'])
      .where('id', 'in', groupIds)
      // Nhóm cấu trúc "Cả lớp" (CLASS_WHOLE_GROUP_NAME của module
      // classes — kênh cả khoá do hệ tự tạo cho khoá thuộc lớp,
      // roster vật chất hoá vào đó) KHÔNG phải nhóm con do GV chia
      // nên không hiện ở mức nhóm con của cây.
      .where('name', '<>', 'Cả lớp')
      .execute();
  }


  /** Conversation CẤP KHOÁ của một tập khoá (itemType 'course') — tra "đã ensure hay chưa" cho nút cây. */
  async listCourseConversationsByCourseIds(courseIds: string[], db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    if (!courseIds.length) return [];
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_course')
      .where('item_type', '=', 'course')
      .where('item_id', 'in', courseIds)
      .execute();
  }


  /** Conversation CẤP LỚP của một tập lớp (itemType 'class' — có từ MSG-T2; ở MSG-T1 thường rỗng). */
  async listClassConversations(classIds: string[], db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    if (!classIds.length) return [];
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_class')
      .where('item_type', '=', 'class')
      .where('item_id', 'in', classIds)
      .execute();
  }


  /**
   * Mọi conversation gắn lớp/khoá (chat toàn khoá, chat cấp lớp) —
   * đầu vào cho hàng tổng hợp của quản trị có phạm vi nhưng chưa
   * từng mở (issue #592): service liệt kê chỉ ĐỌC tập này để tổng
   * hợp hàng, tuyệt đối không ghi dòng thành viên cho các
   * conversation đó.
   */
  async listCourseAndClassConversations(db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where((eb) => eb.or([
        eb.and([eb('component', '=', 'core_course'), eb('item_type', '=', 'course')]),
        eb.and([eb('component', '=', 'core_class'), eb('item_type', '=', 'class')]),
      ]))
      .execute();
  }


  /** Conversation NHÓM CON của một tập group (itemType 'groups'). */
  async listGroupConversationsByGroupIds(groupIds: string[], db: MessagingDb = this.db()): Promise<ConversationRow[]> {
    if (!groupIds.length) return [];
    return db
      .selectFrom('message_conversations')
      .select(CONVERSATION_COLUMNS)
      .where('component', '=', 'core_group')
      .where('item_type', '=', 'groups')
      .where('item_id', 'in', groupIds)
      .execute();
  }
}
