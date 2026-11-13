import { sql, type InsertObject, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { CourseRow } from './courses';

/**
 * Kho dữ liệu lớp học trên Kysely: quản lý lớp, mã tham gia, hàng chờ tự báo danh và các truy vấn khoá/ghi danh của lớp. Transaction tạo lớp gộp thao tác tạo cohort nền, tạo lớp và gắn context cho cohort để không để lại dữ liệu dở dang.
 *
 * Ràng buộc về truy vấn và hình dạng dữ liệu tại biên repository:
 * - Cột đọc khai tường minh kèm bí danh camelCase dùng chung cho
 *   select và returning — KHÔNG bật CamelCasePlugin.
 * - Ghi qua hàm ánh xạ Insert/Update loại `undefined` tường minh
 *   từng trường (thử nghiệm T-4).
 * - Khoá chính `uuidv7()` do database sinh (phụ lục U): insert bỏ
 *   qua `id` và lấy id qua `returning`.
 * - Hai truy vấn `selectDistinct` của bản cũ trước chuyển đổi dùng
 *   `SelectQueryBuilder#distinct` tương đương (đính chính C-1 của chiến dịch: `distinct` là họ API CÓ dùng, lớp A).
 * - `count(*)` ép `::int` tường minh để giữ kiểu `number` của hợp
 *   đồng cũ (T-7: `count(*)` là int8, qua pg sẽ là `string` nếu không ép).
 *
 * Kiểu dòng công khai dùng camelCase, được ánh xạ từ tên cột snake_case của database.
 */

/** Handle kho trung tâm mà repository chấp nhận: thường hoặc trong giao dịch. */
export type ClassesDb = CentreDb | CentreTx;
/** Handle giao dịch kho trung tâm. */
export type ClassesTx = CentreTx;

/** Nhóm "cả lớp" tự sinh trong mọi khoá thuộc lớp — đích giao mặc định cho hoạt động nhắm cả lớp (issue #184, mục 4.2 của hồ sơ). */
export const CLASS_WHOLE_GROUP_NAME = 'Cả lớp';

/** Component đánh dấu backing cohort do module classes quản (không hiện ở bề mặt quản cohort thủ công). */
export const CLASS_COHORT_COMPONENT = 'class';

// Kiểu dòng công khai: tên thuộc tính camelCase ánh xạ từ cột PostgreSQL.

/** Dòng `classes`. */
export interface ClassRow {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  schoolYear: string | null;
  ownerId: string;
  cohortId: string;
  allowSelfReport: boolean;
  joinCode: string | null;
  joinAutoApprove: boolean;
  onLeave: string;
  status: string;
  description: string;
  feeCost: number | null;
  feeCurrency: string;
  feePaymentAccountId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Dòng `cohort` (chỉ đọc tại đây — ghi cohort thuộc repository groups). */
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

/** Dòng `class_join_requests`. */
export interface ClassJoinRequestRow {
  id: string;
  tenantId: string;
  classId: string;
  userId: string;
  status: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Kiểu ghi vào (khớp `$inferInsert` của repository cũ)
// ---------------------------------------------------------------------------

/** Giá trị chèn `classes` (id do database sinh bằng uuidv7; các trường còn lại theo mặc định của bảng khi bỏ qua). */
export interface NewClass {
  tenantId: string;
  name: string;
  code?: string | null;
  schoolYear?: string | null;
  ownerId: string;
  cohortId: string;
  allowSelfReport?: boolean;
  joinCode?: string | null;
  onLeave?: string;
  status?: string;
  description?: string;
}

/** Giá trị chèn `class_join_requests`. */
export interface NewClassJoinRequest {
  id?: string;
  tenantId: string;
  classId: string;
  userId: string;
  status?: string;
  decidedBy?: string | null;
  decidedAt?: Date | null;
}

// ---------------------------------------------------------------------------
// Danh sách cột đọc (dùng chung cho select và returning)
// ---------------------------------------------------------------------------

const CLASS_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'name',
  'code',
  'school_year as schoolYear',
  'owner_id as ownerId',
  'cohort_id as cohortId',
  'allow_self_report as allowSelfReport',
  'join_code as joinCode',
  'join_auto_approve as joinAutoApprove',
  'on_leave as onLeave',
  'status',
  'description',
  'fee_cost as feeCost',
  'fee_currency as feeCurrency',
  'fee_payment_account_id as feePaymentAccountId',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const JOIN_REQUEST_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'class_id as classId',
  'user_id as userId',
  'status',
  'decided_by as decidedBy',
  'decided_at as decidedAt',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const CLASS_COURSE_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'category',
  'class_id as classId',
  'full_name as fullName',
  'short_name as shortName',
  'id_number as idNumber',
  'summary',
  'format',
  'visible',
  'start_date as startDate',
  'end_date as endDate',
  'group_mode as groupMode',
  'group_mode_force as groupModeForce',
  'sort_order as sortOrder',
  'subject_id as subjectId',
  'grade',
  'is_template as isTemplate',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

// ---------------------------------------------------------------------------
// Ánh xạ ghi: loại `undefined` tường minh từng trường (T-4).
// ---------------------------------------------------------------------------

function classInsertValues(values: NewClass): InsertObject<CentreDB, 'classes'> {
  return {
    tenant_id: values.tenantId,
    name: values.name,
    ...(values.code !== undefined ? { code: values.code } : {}),
    ...(values.schoolYear !== undefined ? { school_year: values.schoolYear } : {}),
    owner_id: values.ownerId,
    cohort_id: values.cohortId,
    ...(values.allowSelfReport !== undefined ? { allow_self_report: values.allowSelfReport } : {}),
    ...(values.joinCode !== undefined ? { join_code: values.joinCode } : {}),
    ...(values.onLeave !== undefined ? { on_leave: values.onLeave } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
  };
}

function classUpdateSet(patch: Partial<ClassRow>): UpdateObject<CentreDB, 'classes'> {
  return {
    ...(patch.tenantId !== undefined ? { tenant_id: patch.tenantId } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.code !== undefined ? { code: patch.code } : {}),
    ...(patch.schoolYear !== undefined ? { school_year: patch.schoolYear } : {}),
    ...(patch.ownerId !== undefined ? { owner_id: patch.ownerId } : {}),
    ...(patch.cohortId !== undefined ? { cohort_id: patch.cohortId } : {}),
    ...(patch.allowSelfReport !== undefined ? { allow_self_report: patch.allowSelfReport } : {}),
    ...(patch.joinCode !== undefined ? { join_code: patch.joinCode } : {}),
    ...(patch.joinAutoApprove !== undefined ? { join_auto_approve: patch.joinAutoApprove } : {}),
    ...(patch.onLeave !== undefined ? { on_leave: patch.onLeave } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.feeCost !== undefined ? { fee_cost: patch.feeCost } : {}),
    ...(patch.feeCurrency !== undefined ? { fee_currency: patch.feeCurrency } : {}),
    ...(patch.feePaymentAccountId !== undefined ? { fee_payment_account_id: patch.feePaymentAccountId } : {}),
  };
}

function joinRequestInsertValues(values: NewClassJoinRequest): InsertObject<CentreDB, 'class_join_requests'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    tenant_id: values.tenantId,
    class_id: values.classId,
    user_id: values.userId,
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.decidedBy !== undefined ? { decided_by: values.decidedBy } : {}),
    ...(values.decidedAt !== undefined ? { decided_at: values.decidedAt } : {}),
  };
}

function joinRequestUpdateSet(patch: Partial<ClassJoinRequestRow>): UpdateObject<CentreDB, 'class_join_requests'> {
  return {
    ...(patch.tenantId !== undefined ? { tenant_id: patch.tenantId } : {}),
    ...(patch.classId !== undefined ? { class_id: patch.classId } : {}),
    ...(patch.userId !== undefined ? { user_id: patch.userId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.decidedBy !== undefined ? { decided_by: patch.decidedBy } : {}),
    ...(patch.decidedAt !== undefined ? { decided_at: patch.decidedAt } : {}),
  };
}

/**
 * Kho dữ liệu lớp học: bảng `classes` + các truy vấn vật chất hoá phía lớp (instance cohort của các khoá trong lớp). Thuần dữ liệu — quyết định quyền nằm ở ClassesService / PermissionEvaluator.
 */
export class ClassesRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): ClassesDb {
    return this.handle;
  }

  /** Mở một transaction trên kho trung tâm. */
  async transaction<T>(fn: (tx: ClassesTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }

  /** Lấy lớp theo id. */
  async getClass(id: string, db: ClassesDb = this.db()): Promise<ClassRow | undefined> {
    return db
      .selectFrom('classes')
      .select(CLASS_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Lấy lớp theo mã lớp trong một tenant. */
  async getClassByCode(tenantId: string, code: string, db: ClassesDb = this.db()): Promise<ClassRow | undefined> {
    return db
      .selectFrom('classes')
      .select(CLASS_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
  }

  /** Lấy lớp theo backing cohort. */
  async getClassByCohortId(cohortId: string, db: ClassesDb = this.db()): Promise<ClassRow | undefined> {
    return db
      .selectFrom('classes')
      .select(CLASS_COLUMNS)
      .where('cohort_id', '=', cohortId)
      .executeTakeFirst();
  }

  /** Mọi lớp của một tenant, theo thời điểm tạo. */
  async listClassesByTenant(tenantId: string, db: ClassesDb = this.db()): Promise<ClassRow[]> {
    return db
      .selectFrom('classes')
      .select(CLASS_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  /** Chèn lớp mới; nhận handle giao dịch khi gọi trong transaction tạo lớp. */
  async insertClass(v: NewClass, db: ClassesDb = this.db()): Promise<ClassRow> {
    return db
      .insertInto('classes')
      .values(classInsertValues(v))
      .returning(CLASS_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Cập nhật lớp. */
  async updateClass(id: string, patch: Partial<ClassRow>, db: ClassesDb = this.db()): Promise<void> {
    await db
      .updateTable('classes')
      .set({ ...classUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Xoá lớp. */
  async deleteClass(id: string, db: ClassesDb = this.db()): Promise<void> {
    await db.deleteFrom('classes').where('id', '=', id).execute();
  }

  /** Xoá backing cohort của lớp (bảng `cohort` do module groups sở hữu — xoá qua đây như repository cũ). */
  async deleteCohort(cohortId: string, db: ClassesDb = this.db()): Promise<void> {
    await db.deleteFrom('cohort').where('id', '=', cohortId).execute();
  }

  /** Số khoá đang thuộc lớp — chốt chặn xoá lớp (FK RESTRICT ở DB là lưới cuối). */
  async countCoursesInClass(classId: string, db: ClassesDb = this.db()): Promise<number> {
    const row = await db
      .selectFrom('course')
      .select(sql<number>`count(*)::int`.as('value'))
      .where('class_id', '=', classId)
      .executeTakeFirst();
    return row?.value ?? 0;
  }

  /** Mọi khoá thuộc lớp (gồm cả khoá ẩn — bề mặt lớp là bề mặt quản trị của staff lớp). */
  async listCoursesInClass(classId: string, db: ClassesDb = this.db()): Promise<CourseRow[]> {
    return db
      .selectFrom('course')
      .select(CLASS_COURSE_COLUMNS)
      .where('class_id', '=', classId)
      .orderBy('sort_order', 'asc')
      .execute() as Promise<CourseRow[]>;
  }

  /**
   * Các khoá của lớp mà một học sinh đang ghi danh ACTIVE (status = 0 — `ENROL_ACTIVE` của module enrol; xét mọi instance của khoá, đường chính là instance cohort của lớp). Đình chỉ ở một khoá đặt dòng ghi danh thành SUSPENDED (status = 1) nên khoá đó rơi khỏi tập này — dashboard phía học sinh (CLASS-2) chỉ hiện các khoá trong tập này.
   */
  async listActiveEnrolledCourseIds(classId: string, userId: string, db: ClassesDb = this.db()): Promise<string[]> {
    const rows = await db
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .innerJoin('course', 'course.id', 'enrol.course_id')
      .select('enrol.course_id as courseId')
      .distinct()
      .where('course.class_id', '=', classId)
      .where('user_enrolments.user_id', '=', userId)
      .where('user_enrolments.status', '=', 0)
      .execute();
    return rows.map((r) => r.courseId);
  }

  /**
   * Đẩy chế độ rời lớp mới xuống `custom_text1` của mọi instance cohort của lớp (các khoá đã tạo trước khi lớp đổi `on_leave` phải theo chế độ hiện hành của lớp, không giữ ảnh chụp lúc tạo khoá).
   */
  async syncOnLeaveToInstances(cohortId: string, onLeave: string, db: ClassesDb = this.db()): Promise<void> {
    await db
      .updateTable('enrol')
      .set({ custom_text1: onLeave, updated_at: new Date() })
      .where('enrol', '=', 'cohort')
      .where('custom_int1', '=', cohortId)
      .execute();
  }

  // --- tự báo danh (CLASS-1) ---------------------------------------------------

  /** Lớp theo mã tham gia: `join_code` là unique toàn hệ khi có đặt, nên tra cứu không cần tenant. */
  async getClassByJoinCode(joinCode: string, db: ClassesDb = this.db()): Promise<ClassRow | undefined> {
    return db
      .selectFrom('classes')
      .select(CLASS_COLUMNS)
      .where('join_code', '=', joinCode)
      .executeTakeFirst();
  }

  /** Chèn một yêu cầu tham gia lớp. */
  async insertJoinRequest(v: NewClassJoinRequest, db: ClassesDb = this.db()): Promise<ClassJoinRequestRow> {
    return db
      .insertInto('class_join_requests')
      .values(joinRequestInsertValues(v))
      .returning(JOIN_REQUEST_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Lấy yêu cầu tham gia theo id. */
  async getJoinRequest(id: string, db: ClassesDb = this.db()): Promise<ClassJoinRequestRow | undefined> {
    return db
      .selectFrom('class_join_requests')
      .select(JOIN_REQUEST_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Yêu cầu đang chờ của một học sinh cho một lớp (unique từng phần ở DB là lưới cuối). */
  async findPendingJoinRequest(classId: string, userId: string, db: ClassesDb = this.db()): Promise<ClassJoinRequestRow | undefined> {
    return db
      .selectFrom('class_join_requests')
      .select(JOIN_REQUEST_COLUMNS)
      .where('class_id', '=', classId)
      .where('user_id', '=', userId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
  }

  /** Các yêu cầu tham gia của một lớp theo trạng thái, theo thời điểm tạo. */
  async listJoinRequests(classId: string, status: string, db: ClassesDb = this.db()): Promise<ClassJoinRequestRow[]> {
    return db
      .selectFrom('class_join_requests')
      .select(JOIN_REQUEST_COLUMNS)
      .where('class_id', '=', classId)
      .where('status', '=', status)
      .orderBy('created_at', 'asc')
      .execute();
  }

  /** Cập nhật yêu cầu tham gia. */
  async updateJoinRequest(id: string, patch: Partial<ClassJoinRequestRow>, db: ClassesDb = this.db()): Promise<void> {
    await db
      .updateTable('class_join_requests')
      .set({ ...joinRequestUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Học sinh đã đình chỉ khỏi lớp: còn dòng ghi danh SUSPENDED (status = 1) trên instance cohort của lớp nhưng KHÔNG còn trong backing cohort — suy ra từ chính vật chất hoá ghi danh, không bảng phụ
   * (roster chỉ có hai trạng thái thuộc/không thuộc, xem hồ sơ mục 4.3).
   */
  async listSuspendedMemberIds(cohortId: string, db: ClassesDb = this.db()): Promise<string[]> {
    const rows = await db
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select('user_enrolments.user_id as userId')
      .distinct()
      .where('enrol.enrol', '=', 'cohort')
      .where('enrol.custom_int1', '=', cohortId)
      .where('user_enrolments.status', '=', 1)
      .execute();
    return rows.map((r) => r.userId);
  }
}
