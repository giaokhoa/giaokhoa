import { type InsertObject, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';

/**
 * Kho dữ liệu nhóm trên Kysely: quản lý group, grouping, thành viên nhóm và cohort dùng cho phân nhóm theo ngữ cảnh.
 *
 * Ràng buộc về truy vấn và hình dạng dữ liệu tại biên repository:
 * - Cột đọc khai tường minh kèm bí danh camelCase dùng chung cho
 *   select và returning — KHÔNG bật CamelCasePlugin.
 * - Ghi qua hàm ánh xạ Insert/Update loại `undefined` tường minh
 *   từng trường (thử nghiệm T-4).
 * - Khoá chính `uuidv7()` do database sinh (phụ lục U): insert bỏ
 *   qua `id` và lấy id qua `returning`.
 * - Ba điểm `onConflictDoNothing` của bản cũ trước chuyển đổi (thêm thành
 *   viên nhóm, đưa nhóm vào grouping, thêm thành viên cohort) dùng `onConflict … doNothing()` tương đương; riêng `addCohortMember` suy luận "đã chèn thật hay chưa" từ độ dài của `returning` như bản cũ.
 *
 * `removeCohortMember` nhận handle tuỳ chọn (mặc định handle thường): đường gỡ thành viên TRONG transaction của bên gọi
 * (settle hoàn tiền — điểm nối C-8/C, đã đóng ở #656) truyền
 * transaction của bên gọi vào để việc gỡ và ghi sổ hoàn commit cùng nhau.
 *
 * Kiểu dòng công khai dùng camelCase, được ánh xạ tường minh từ các cột snake_case.
 */

/** Handle kho trung tâm mà repository chấp nhận: thường hoặc trong giao dịch. */
export type GroupsDb = CentreDb | CentreTx;
/** Handle giao dịch kho trung tâm. */
export type GroupsTx = CentreTx;

// Kiểu dòng công khai: tên thuộc tính camelCase ánh xạ từ cột PostgreSQL.

/** Dòng `course_groups`. */
export interface GroupRow {
  id: string;
  courseId: string;
  name: string;
  idNumber: string;
  description: string;
  enrolmentKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Dòng `groups_members`. */
export interface GroupMemberRow {
  id: string;
  groupId: string;
  userId: string;
  timeAdded: Date;
  component: string;
  itemId: string | null;
}

/** Dòng `groupings`. */
export interface GroupingRow {
  id: string;
  courseId: string;
  name: string;
  idNumber: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Dòng `cohort`. */
export interface CohortRow {
  id: string;
  tenantId: string;
  name: string;
  idNumber: string;
  description: string;
  contextId: string;
  component: string;
  visible: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Dòng `cohort_members`. */
export interface CohortMemberRow {
  cohortId: string;
  userId: string;
  timeAdded: Date;
}

// ---------------------------------------------------------------------------
// Kiểu ghi vào (khớp `$inferInsert` của repository cũ)
// ---------------------------------------------------------------------------

/** Giá trị chèn `course_groups`. */
export interface NewGroup {
  id?: string;
  courseId: string;
  name: string;
  idNumber?: string;
  description?: string;
  enrolmentKey?: string | null;
}

/** Giá trị chèn `groupings`. */
export interface NewGrouping {
  id?: string;
  courseId: string;
  name: string;
  idNumber?: string;
  description?: string;
}

/** Giá trị chèn `cohort`. */
export interface NewCohort {
  id?: string;
  tenantId: string;
  name: string;
  idNumber?: string;
  description?: string;
  contextId: string;
  component?: string;
  visible?: boolean;
}

// ---------------------------------------------------------------------------
// Danh sách cột đọc (dùng chung cho select và returning)
// ---------------------------------------------------------------------------

const GROUP_COLUMNS = [
  'id',
  'course_id as courseId',
  'name',
  'id_number as idNumber',
  'description',
  'enrolment_key as enrolmentKey',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const GROUP_MEMBER_COLUMNS = [
  'id',
  'group_id as groupId',
  'user_id as userId',
  'time_added as timeAdded',
  'component',
  'item_id as itemId',
] as const;

const GROUPING_COLUMNS = [
  'id',
  'course_id as courseId',
  'name',
  'id_number as idNumber',
  'description',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const COHORT_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'name',
  'id_number as idNumber',
  'description',
  'context_id as contextId',
  'component',
  'visible',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const COHORT_MEMBER_COLUMNS = ['cohort_id as cohortId', 'user_id as userId', 'time_added as timeAdded'] as const;

// ---------------------------------------------------------------------------
// Ánh xạ ghi: loại `undefined` tường minh từng trường (T-4).
// ---------------------------------------------------------------------------

function groupInsertValues(values: NewGroup): InsertObject<CentreDB, 'course_groups'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    course_id: values.courseId,
    name: values.name,
    ...(values.idNumber !== undefined ? { id_number: values.idNumber } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
    ...(values.enrolmentKey !== undefined ? { enrolment_key: values.enrolmentKey } : {}),
  };
}

function groupUpdateSet(patch: Partial<NewGroup>): UpdateObject<CentreDB, 'course_groups'> {
  return {
    ...(patch.courseId !== undefined ? { course_id: patch.courseId } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.idNumber !== undefined ? { id_number: patch.idNumber } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.enrolmentKey !== undefined ? { enrolment_key: patch.enrolmentKey } : {}),
  };
}

function groupingInsertValues(values: NewGrouping): InsertObject<CentreDB, 'groupings'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    course_id: values.courseId,
    name: values.name,
    ...(values.idNumber !== undefined ? { id_number: values.idNumber } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
  };
}

function cohortInsertValues(values: NewCohort): InsertObject<CentreDB, 'cohort'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    tenant_id: values.tenantId,
    name: values.name,
    ...(values.idNumber !== undefined ? { id_number: values.idNumber } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
    context_id: values.contextId,
    ...(values.component !== undefined ? { component: values.component } : {}),
    ...(values.visible !== undefined ? { visible: values.visible } : {}),
  };
}

function cohortUpdateSet(patch: Partial<NewCohort>): UpdateObject<CentreDB, 'cohort'> {
  return {
    ...(patch.tenantId !== undefined ? { tenant_id: patch.tenantId } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.idNumber !== undefined ? { id_number: patch.idNumber } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.contextId !== undefined ? { context_id: patch.contextId } : {}),
    ...(patch.component !== undefined ? { component: patch.component } : {}),
    ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
  };
}

/**
 * Kho dữ liệu nhóm: group, grouping, thành viên nhóm và cohort
 * (nhóm hệ thống/danh mục).
 */
export class GroupsRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): GroupsDb {
    return this.handle;
  }

  /** Mở một transaction trên kho trung tâm. */
  async transaction<T>(fn: (tx: GroupsTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }

  /** Chèn nhóm khoá học. */
  async insertGroup(v: NewGroup, db: GroupsDb = this.db()): Promise<GroupRow> {
    return db
      .insertInto('course_groups')
      .values(groupInsertValues(v))
      .returning(GROUP_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Lấy nhóm theo id. */
  async getGroup(id: string, db: GroupsDb = this.db()): Promise<GroupRow | undefined> {
    return db
      .selectFrom('course_groups')
      .select(GROUP_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Liệt kê nhóm của khoá học. */
  async listGroups(courseId: string, db: GroupsDb = this.db()): Promise<GroupRow[]> {
    return db
      .selectFrom('course_groups')
      .select(GROUP_COLUMNS)
      .where('course_id', '=', courseId)
      .orderBy('id', 'asc')
      .execute();
  }

  /** Cập nhật nhóm. */
  async updateGroup(id: string, v: Partial<NewGroup>, db: GroupsDb = this.db()): Promise<void> {
    await db
      .updateTable('course_groups')
      .set({ ...groupUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Xoá nhóm. */
  async deleteGroup(id: string, db: GroupsDb = this.db()): Promise<void> {
    await db.deleteFrom('course_groups').where('id', '=', id).execute();
  }

  /** Thêm thành viên vào nhóm (trùng thì bỏ qua). */
  async addMember(groupId: string, userId: string, component = '', itemId: string | null = null, db: GroupsDb = this.db()): Promise<void> {
    await db
      .insertInto('groups_members')
      .values({ group_id: groupId, user_id: userId, component, item_id: itemId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /** Gỡ thành viên khỏi nhóm. */
  async removeMember(groupId: string, userId: string, db: GroupsDb = this.db()): Promise<void> {
    await db
      .deleteFrom('groups_members')
      .where('group_id', '=', groupId)
      .where('user_id', '=', userId)
      .execute();
  }

  /** Thành viên của một nhóm. */
  async listMembers(groupId: string, db: GroupsDb = this.db()): Promise<GroupMemberRow[]> {
    return db
      .selectFrom('groups_members')
      .select(GROUP_MEMBER_COLUMNS)
      .where('group_id', '=', groupId)
      .orderBy('id', 'asc')
      .execute();
  }

  /** Thành viên của nhiều nhóm (gộp). */
  async listMembersOfGroups(groupIds: string[], db: GroupsDb = this.db()): Promise<GroupMemberRow[]> {
    if (!groupIds.length) return [];
    return db
      .selectFrom('groups_members')
      .select(GROUP_MEMBER_COLUMNS)
      .where('group_id', 'in', groupIds)
      .execute();
  }

  /** Các nhóm user thuộc về trong khoá học. */
  async groupsOfUser(courseId: string, userId: string, db: GroupsDb = this.db()): Promise<GroupRow[]> {
    const memberRows = (await db
      .selectFrom('groups_members')
      .select(GROUP_MEMBER_COLUMNS)
      .where('user_id', '=', userId)
      .execute()) as GroupMemberRow[];
    const ids = memberRows.map((m) => m.groupId);
    if (!ids.length) return [];
    return db
      .selectFrom('course_groups')
      .select(GROUP_COLUMNS)
      .where('course_id', '=', courseId)
      .where('id', 'in', ids)
      .execute();
  }

  /** User có là thành viên nhóm hay không. */
  async isMember(groupId: string, userId: string, db: GroupsDb = this.db()): Promise<boolean> {
    const row = await db
      .selectFrom('groups_members')
      .select(GROUP_MEMBER_COLUMNS)
      .where('group_id', '=', groupId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return !!row;
  }

  /** Chèn grouping (nhóm của các nhóm). */
  async insertGrouping(v: NewGrouping, db: GroupsDb = this.db()): Promise<GroupingRow> {
    return db
      .insertInto('groupings')
      .values(groupingInsertValues(v))
      .returning(GROUPING_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Lấy grouping theo id. */
  async getGrouping(id: string, db: GroupsDb = this.db()): Promise<GroupingRow | undefined> {
    return db
      .selectFrom('groupings')
      .select(GROUPING_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Liệt kê grouping của khoá học. */
  async listGroupings(courseId: string, db: GroupsDb = this.db()): Promise<GroupingRow[]> {
    return db
      .selectFrom('groupings')
      .select(GROUPING_COLUMNS)
      .where('course_id', '=', courseId)
      .orderBy('id', 'asc')
      .execute();
  }

  /** Xoá grouping. */
  async deleteGrouping(id: string, db: GroupsDb = this.db()): Promise<void> {
    await db.deleteFrom('groupings').where('id', '=', id).execute();
  }

  /** Đưa nhóm vào grouping (trùng thì bỏ qua). */
  async addGroupToGrouping(groupingId: string, groupId: string, db: GroupsDb = this.db()): Promise<void> {
    await db
      .insertInto('groupings_groups')
      .values({ grouping_id: groupingId, group_id: groupId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /** Gỡ nhóm khỏi grouping. */
  async removeGroupFromGrouping(groupingId: string, groupId: string, db: GroupsDb = this.db()): Promise<void> {
    await db
      .deleteFrom('groupings_groups')
      .where('grouping_id', '=', groupingId)
      .where('group_id', '=', groupId)
      .execute();
  }

  /** Các nhóm thuộc grouping. */
  async groupsInGrouping(groupingId: string, db: GroupsDb = this.db()): Promise<GroupRow[]> {
    const links = await db
      .selectFrom('groupings_groups')
      .select(['grouping_id as groupingId', 'group_id as groupId', 'time_added as timeAdded'])
      .where('grouping_id', '=', groupingId)
      .execute();
    if (!links.length) return [];
    return db
      .selectFrom('course_groups')
      .select(GROUP_COLUMNS)
      .where('id', 'in', links.map((l) => l.groupId))
      .execute();
  }

  /** Chèn cohort; nhận handle giao dịch khi gọi trong transaction tạo lớp. */
  async insertCohort(v: NewCohort, db: GroupsDb = this.db()): Promise<CohortRow> {
    return db
      .insertInto('cohort')
      .values(cohortInsertValues(v))
      .returning(COHORT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Lấy cohort theo id. */
  async getCohort(id: string, db: GroupsDb = this.db()): Promise<CohortRow | undefined> {
    return db
      .selectFrom('cohort')
      .select(COHORT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Liệt kê cohort. */
  async listCohorts(db: GroupsDb = this.db()): Promise<CohortRow[]> {
    return db
      .selectFrom('cohort')
      .select(COHORT_COLUMNS)
      .orderBy('id', 'asc')
      .execute();
  }

  /** Cập nhật cohort; nhận handle giao dịch khi gọi trong transaction tạo lớp. */
  async updateCohort(id: string, v: Partial<NewCohort>, db: GroupsDb = this.db()): Promise<void> {
    await db
      .updateTable('cohort')
      .set({ ...cohortUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Xoá cohort. */
  async deleteCohort(id: string, db: GroupsDb = this.db()): Promise<void> {
    await db.deleteFrom('cohort').where('id', '=', id).execute();
  }

  /** Thêm thành viên cohort; trả `true` khi dòng thật sự được chèn (chưa là thành viên). */
  async addCohortMember(cohortId: string, userId: string, db: GroupsDb = this.db()): Promise<boolean> {
    const inserted = await db
      .insertInto('cohort_members')
      .values({ cohort_id: cohortId, user_id: userId })
      .onConflict((oc) => oc.doNothing())
      .returning('cohort_id as cohortId')
      .execute();
    return inserted.length > 0;
  }

  /** Gỡ thành viên cohort; trả `true` khi có dòng bị xoá. */
  async removeCohortMember(cohortId: string, userId: string, db: GroupsDb = this.db()): Promise<boolean> {
    const deleted = await db
      .deleteFrom('cohort_members')
      .where('cohort_id', '=', cohortId)
      .where('user_id', '=', userId)
      .returning('cohort_id as cohortId')
      .execute();
    return deleted.length > 0;
  }

  /** Thành viên của cohort. */
  async listCohortMembers(cohortId: string, db: GroupsDb = this.db()): Promise<CohortMemberRow[]> {
    return db
      .selectFrom('cohort_members')
      .select(COHORT_MEMBER_COLUMNS)
      .where('cohort_id', '=', cohortId)
      .orderBy('time_added', 'asc')
      .execute();
  }

  /** User có thuộc cohort hay không. */
  async isCohortMember(cohortId: string, userId: string, db: GroupsDb = this.db()): Promise<boolean> {
    const row = await db
      .selectFrom('cohort_members')
      .select(COHORT_MEMBER_COLUMNS)
      .where('cohort_id', '=', cohortId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return !!row;
  }
}
