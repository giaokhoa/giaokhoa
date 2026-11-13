import { type InsertObject, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';

/**
 * Kho dữ liệu ghi danh trên Kysely: quản lý phương thức ghi danh của khoá học và trạng thái ghi danh của từng người dùng.
 *
 * Hai bảng này DÙNG CHUNG với package `@giaokhoa/enrol` (bề mặt vật chất hoá cohort) — thứ tự chuyển đổi G5 trước, D5 (#657) sau giữ nguyên như kế hoạch; repository này không đổi hình dạng bảng hay ngữ nghĩa ghi nào của bề mặt đó.
 *
 * Ràng buộc về truy vấn và hình dạng dữ liệu tại biên repository:
 * - Cột đọc khai tường minh kèm bí danh camelCase dùng chung cho
 *   select và returning — KHÔNG bật CamelCasePlugin.
 * - Ghi qua hàm ánh xạ Insert/Update loại `undefined` tường minh
 *   từng trường (thử nghiệm T-4).
 * - Khoá chính `uuidv7()` do database sinh (phụ lục U): insert bỏ
 *   qua `id` và lấy id qua `returning`.
 * - Điểm mở giao dịch của repository là `transaction(fn)`; các
 *   phương thức nhận handle tuỳ chọn (`EnrolDb` = handle thường hoặc handle giao dịch) để phía gọi lồng thao tác vào giao dịch của mình (luồng hết hạn ghi danh, đường tự mở giao dịch của `setSuspended`).
 *
 * Hai ca lọc tại bộ nhớ của repository cũ (`listCohortInstances`, `listExpiredActive`) giữ nguyên cách làm: chúng là một phần của hợp đồng hành vi đã chốt, không đổi sang lọc tại SQL.
 *
 * Kiểu dòng công khai dùng camelCase, được ánh xạ từ tên cột snake_case của database.
 */

/** Handle kho trung tâm mà repository chấp nhận: thường hoặc trong giao dịch. */
export type EnrolDb = CentreDb | CentreTx;
/** Handle giao dịch kho trung tâm. */
export type EnrolTx = CentreTx;

// Kiểu dòng công khai: tên thuộc tính camelCase ánh xạ từ cột PostgreSQL.

/** Dòng `enrol` (instance ghi danh của một khoá học). */
export interface EnrolRow {
  id: string;
  courseId: string;
  enrol: string;
  name: string | null;
  roleId: string | null;
  status: number;
  enrolPeriod: number;
  timeStart: Date | null;
  timeEnd: Date | null;
  enrolmentKey: string | null;
  customInt1: string | null;
  customInt2: string | null;
  customText1: string;
  cost: number;
  currency: string;
  paymentAccountId: string | null;
  sendWelcomeMessage: boolean;
  welcomeMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Dòng `user_enrolments` (ghi danh của một user qua một instance). */
export interface UserEnrolmentRow {
  id: string;
  enrolId: string;
  userId: string;
  status: number;
  timeStart: Date;
  timeEnd: Date | null;
  modifierId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Kiểu ghi vào (khớp `$inferInsert` của repository cũ)
// ---------------------------------------------------------------------------

/** Giá trị chèn `enrol`. */
export interface NewEnrolInstance {
  id?: string;
  courseId: string;
  enrol: string;
  name?: string | null;
  roleId?: string | null;
  status?: number;
  enrolPeriod?: number;
  timeStart?: Date | null;
  timeEnd?: Date | null;
  enrolmentKey?: string | null;
  customInt1?: string | null;
  customInt2?: string | null;
  customText1?: string;
  cost?: number;
  currency?: string;
  paymentAccountId?: string | null;
  sendWelcomeMessage?: boolean;
  welcomeMessage?: string | null;
}

/** Giá trị chèn `user_enrolments`. */
export interface NewUserEnrolment {
  id?: string;
  enrolId: string;
  userId: string;
  status?: number;
  timeStart?: Date;
  timeEnd?: Date | null;
  modifierId?: string | null;
}

// ---------------------------------------------------------------------------
// Danh sách cột đọc (dùng chung cho select và returning)
// ---------------------------------------------------------------------------

const ENROL_COLUMNS = [
  'id',
  'course_id as courseId',
  'enrol',
  'name',
  'role_id as roleId',
  'status',
  'enrol_period as enrolPeriod',
  'time_start as timeStart',
  'time_end as timeEnd',
  'enrolment_key as enrolmentKey',
  'custom_int1 as customInt1',
  'custom_int2 as customInt2',
  'custom_text1 as customText1',
  'cost',
  'currency',
  'payment_account_id as paymentAccountId',
  'send_welcome_message as sendWelcomeMessage',
  'welcome_message as welcomeMessage',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const USER_ENROLMENT_COLUMNS = [
  'id',
  'enrol_id as enrolId',
  'user_id as userId',
  'status',
  'time_start as timeStart',
  'time_end as timeEnd',
  'modifier_id as modifierId',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

// ---------------------------------------------------------------------------
// Ánh xạ ghi: loại `undefined` tường minh từng trường (T-4).
// ---------------------------------------------------------------------------

function enrolInsertValues(values: NewEnrolInstance): InsertObject<CentreDB, 'enrol'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    course_id: values.courseId,
    enrol: values.enrol,
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.roleId !== undefined ? { role_id: values.roleId } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.enrolPeriod !== undefined ? { enrol_period: values.enrolPeriod } : {}),
    ...(values.timeStart !== undefined ? { time_start: values.timeStart } : {}),
    ...(values.timeEnd !== undefined ? { time_end: values.timeEnd } : {}),
    ...(values.enrolmentKey !== undefined ? { enrolment_key: values.enrolmentKey } : {}),
    ...(values.customInt1 !== undefined ? { custom_int1: values.customInt1 } : {}),
    ...(values.customInt2 !== undefined ? { custom_int2: values.customInt2 } : {}),
    ...(values.customText1 !== undefined ? { custom_text1: values.customText1 } : {}),
    ...(values.cost !== undefined ? { cost: values.cost } : {}),
    ...(values.currency !== undefined ? { currency: values.currency } : {}),
    ...(values.paymentAccountId !== undefined ? { payment_account_id: values.paymentAccountId } : {}),
    ...(values.sendWelcomeMessage !== undefined ? { send_welcome_message: values.sendWelcomeMessage } : {}),
    ...(values.welcomeMessage !== undefined ? { welcome_message: values.welcomeMessage } : {}),
  };
}

function enrolUpdateSet(patch: Partial<NewEnrolInstance>): UpdateObject<CentreDB, 'enrol'> {
  return {
    ...(patch.courseId !== undefined ? { course_id: patch.courseId } : {}),
    ...(patch.enrol !== undefined ? { enrol: patch.enrol } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.roleId !== undefined ? { role_id: patch.roleId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.enrolPeriod !== undefined ? { enrol_period: patch.enrolPeriod } : {}),
    ...(patch.timeStart !== undefined ? { time_start: patch.timeStart } : {}),
    ...(patch.timeEnd !== undefined ? { time_end: patch.timeEnd } : {}),
    ...(patch.enrolmentKey !== undefined ? { enrolment_key: patch.enrolmentKey } : {}),
    ...(patch.customInt1 !== undefined ? { custom_int1: patch.customInt1 } : {}),
    ...(patch.customInt2 !== undefined ? { custom_int2: patch.customInt2 } : {}),
    ...(patch.customText1 !== undefined ? { custom_text1: patch.customText1 } : {}),
    ...(patch.cost !== undefined ? { cost: patch.cost } : {}),
    ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
    ...(patch.paymentAccountId !== undefined ? { payment_account_id: patch.paymentAccountId } : {}),
    ...(patch.sendWelcomeMessage !== undefined ? { send_welcome_message: patch.sendWelcomeMessage } : {}),
    ...(patch.welcomeMessage !== undefined ? { welcome_message: patch.welcomeMessage } : {}),
  };
}

function userEnrolmentInsertValues(values: NewUserEnrolment): InsertObject<CentreDB, 'user_enrolments'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    enrol_id: values.enrolId,
    user_id: values.userId,
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.timeStart !== undefined ? { time_start: values.timeStart } : {}),
    ...(values.timeEnd !== undefined ? { time_end: values.timeEnd } : {}),
    ...(values.modifierId !== undefined ? { modifier_id: values.modifierId } : {}),
  };
}

function userEnrolmentUpdateSet(patch: Partial<NewUserEnrolment>): UpdateObject<CentreDB, 'user_enrolments'> {
  return {
    ...(patch.enrolId !== undefined ? { enrol_id: patch.enrolId } : {}),
    ...(patch.userId !== undefined ? { user_id: patch.userId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.timeStart !== undefined ? { time_start: patch.timeStart } : {}),
    ...(patch.timeEnd !== undefined ? { time_end: patch.timeEnd } : {}),
    ...(patch.modifierId !== undefined ? { modifier_id: patch.modifierId } : {}),
  };
}

/**
 * Kho dữ liệu ghi danh: enrol instance (phương thức ghi danh của khoá học) và user enrolment (ghi danh của từng user).
 */
export class EnrolRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): EnrolDb {
    return this.handle;
  }

  /** Mở một transaction trên kho trung tâm. */
  async transaction<T>(fn: (tx: EnrolTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }

  /** Chèn enrol instance. */
  async insertInstance(v: NewEnrolInstance, db: EnrolDb = this.db()): Promise<EnrolRow> {
    return db
      .insertInto('enrol')
      .values(enrolInsertValues(v))
      .returning(ENROL_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Lấy instance theo id. */
  async getInstance(id: string, db: EnrolDb = this.db()): Promise<EnrolRow | undefined> {
    return db
      .selectFrom('enrol')
      .select(ENROL_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Instance của một khoá học. */
  async listInstances(courseId: string, db: EnrolDb = this.db()): Promise<EnrolRow[]> {
    return db
      .selectFrom('enrol')
      .select(ENROL_COLUMNS)
      .where('course_id', '=', courseId)
      .orderBy('id', 'asc')
      .execute();
  }

  /** Instance theo phương thức (manual, self, cohort, paypal…). */
  async listInstancesByMethod(method: string, db: EnrolDb = this.db()): Promise<EnrolRow[]> {
    return db
      .selectFrom('enrol')
      .select(ENROL_COLUMNS)
      .where('enrol', '=', method)
      .orderBy('id', 'asc')
      .execute();
  }

  /** Các instance đồng bộ cohort đang trỏ tới một cohort. */
  async listCohortInstances(cohortId: string, db: EnrolDb = this.db()): Promise<EnrolRow[]> {
    const rows = (await db
      .selectFrom('enrol')
      .select(ENROL_COLUMNS)
      .where('enrol', '=', 'cohort')
      .execute()) as EnrolRow[];
    return rows.filter((r) => r.customInt1 === cohortId);
  }

  /** Cập nhật instance. */
  async updateInstance(id: string, v: Partial<NewEnrolInstance>, db: EnrolDb = this.db()): Promise<void> {
    await db
      .updateTable('enrol')
      .set({ ...enrolUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Xoá instance. */
  async deleteInstance(id: string, db: EnrolDb = this.db()): Promise<void> {
    await db.deleteFrom('enrol').where('id', '=', id).execute();
  }

  /** Chèn ghi danh của user. */
  async insertUserEnrolment(v: NewUserEnrolment, db: EnrolDb = this.db()): Promise<UserEnrolmentRow> {
    return db
      .insertInto('user_enrolments')
      .values(userEnrolmentInsertValues(v))
      .returning(USER_ENROLMENT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Lấy ghi danh theo (instance, user). */
  async getUserEnrolment(enrolId: string, userId: string, db: EnrolDb = this.db()): Promise<UserEnrolmentRow | undefined> {
    return db
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('enrol_id', '=', enrolId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  /** Cập nhật ghi danh (trạng thái, thời hạn). */
  async updateUserEnrolment(id: string, v: Partial<NewUserEnrolment>, db: EnrolDb = this.db()): Promise<void> {
    await db
      .updateTable('user_enrolments')
      .set({ ...userEnrolmentUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Xoá ghi danh. */
  async deleteUserEnrolment(id: string, db: EnrolDb = this.db()): Promise<void> {
    await db.deleteFrom('user_enrolments').where('id', '=', id).execute();
  }

  /** Mọi ghi danh trong khoá học, kèm phương thức của instance sở hữu. */
  async listUserEnrolmentsForCourse(courseId: string, db: EnrolDb = this.db()): Promise<(UserEnrolmentRow & { enrolMethod: string })[]> {
    const instances = await this.listInstances(courseId, db);
    if (!instances.length) return [];
    const rows = (await db
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('enrol_id', 'in', instances.map((i) => i.id))
      .execute()) as UserEnrolmentRow[];
    const methodById = new Map(instances.map((i) => [i.id, i.enrol]));
    return rows.map((r) => ({ ...r, enrolMethod: methodById.get(r.enrolId) ?? '' }));
  }

  /** Mọi ghi danh của một user. */
  async listUserEnrolmentsForUser(userId: string, db: EnrolDb = this.db()): Promise<UserEnrolmentRow[]> {
    return db
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('user_id', '=', userId)
      .execute();
  }

  /** Mọi ghi danh qua một instance — đầu vào của việc gán lại role khi instance đổi role. */
  async listUserEnrolmentsForInstance(enrolId: string, db: EnrolDb = this.db()): Promise<UserEnrolmentRow[]> {
    return db
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('enrol_id', '=', enrolId)
      .execute();
  }

  /** Các ghi danh đang hiệu lực nhưng đã quá hạn — đầu vào của tiến trình hết hạn. */
  async listExpiredActive(now: Date, db: EnrolDb = this.db()): Promise<UserEnrolmentRow[]> {
    const rows = (await db
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('status', '=', 0)
      .execute()) as UserEnrolmentRow[];
    return rows.filter((r) => r.timeEnd !== null && r.timeEnd < now);
  }
}
