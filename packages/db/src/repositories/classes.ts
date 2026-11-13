import { sql } from 'kysely';
import type { CentreDb, CentreTx } from '../client';
import type { CourseRow } from './courses';


export type ClassesDb = CentreDb | CentreTx;
export type ClassesTx = CentreTx;

export const CLASS_WHOLE_GROUP_NAME = 'Cả lớp';

export const CLASS_COHORT_COMPONENT = 'class';


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

export interface NewClassJoinRequest {
  id?: string;
  tenantId: string;
  classId: string;
  userId: string;
  status?: string;
  decidedBy?: string | null;
  decidedAt?: Date | null;
}


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


function classInsertValues(v: NewClass) {
  return {
    tenant_id: v.tenantId,
    name: v.name,
    ...(v.code !== undefined ? { code: v.code } : {}),
    ...(v.schoolYear !== undefined ? { school_year: v.schoolYear } : {}),
    owner_id: v.ownerId,
    cohort_id: v.cohortId,
    ...(v.allowSelfReport !== undefined ? { allow_self_report: v.allowSelfReport } : {}),
    ...(v.joinCode !== undefined ? { join_code: v.joinCode } : {}),
    ...(v.onLeave !== undefined ? { on_leave: v.onLeave } : {}),
    ...(v.status !== undefined ? { status: v.status } : {}),
    ...(v.description !== undefined ? { description: v.description } : {}),
  };
}

function classUpdateValues(v: Partial<ClassRow>) {
  return {
    ...(v.tenantId !== undefined ? { tenant_id: v.tenantId } : {}),
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.code !== undefined ? { code: v.code } : {}),
    ...(v.schoolYear !== undefined ? { school_year: v.schoolYear } : {}),
    ...(v.ownerId !== undefined ? { owner_id: v.ownerId } : {}),
    ...(v.cohortId !== undefined ? { cohort_id: v.cohortId } : {}),
    ...(v.allowSelfReport !== undefined ? { allow_self_report: v.allowSelfReport } : {}),
    ...(v.joinCode !== undefined ? { join_code: v.joinCode } : {}),
    ...(v.joinAutoApprove !== undefined ? { join_auto_approve: v.joinAutoApprove } : {}),
    ...(v.onLeave !== undefined ? { on_leave: v.onLeave } : {}),
    ...(v.status !== undefined ? { status: v.status } : {}),
    ...(v.description !== undefined ? { description: v.description } : {}),
    ...(v.feeCost !== undefined ? { fee_cost: v.feeCost } : {}),
    ...(v.feeCurrency !== undefined ? { fee_currency: v.feeCurrency } : {}),
    ...(v.feePaymentAccountId !== undefined ? { fee_payment_account_id: v.feePaymentAccountId } : {}),
  };
}

function joinRequestInsertValues(v: NewClassJoinRequest) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    tenant_id: v.tenantId,
    class_id: v.classId,
    user_id: v.userId,
    ...(v.status !== undefined ? { status: v.status } : {}),
    ...(v.decidedBy !== undefined ? { decided_by: v.decidedBy } : {}),
    ...(v.decidedAt !== undefined ? { decided_at: v.decidedAt } : {}),
  };
}

function joinRequestUpdateValues(v: Partial<ClassJoinRequestRow>) {
  return {
    ...(v.tenantId !== undefined ? { tenant_id: v.tenantId } : {}),
    ...(v.classId !== undefined ? { class_id: v.classId } : {}),
    ...(v.userId !== undefined ? { user_id: v.userId } : {}),
    ...(v.status !== undefined ? { status: v.status } : {}),
    ...(v.decidedBy !== undefined ? { decided_by: v.decidedBy } : {}),
    ...(v.decidedAt !== undefined ? { decided_at: v.decidedAt } : {}),
  };
}

export class ClassesRepository {
  constructor(private readonly handle: CentreDb) {}

  async transaction<T>(fn: (tx: ClassesTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }

  async getClass(id: string): Promise<ClassRow | undefined> {
    return this.handle
      .selectFrom('classes')
      .select(CLASS_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<ClassRow | undefined>;
  }

  async getClassByCode(tenantId: string, code: string): Promise<ClassRow | undefined> {
    return this.handle
      .selectFrom('classes')
      .select(CLASS_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst() as Promise<ClassRow | undefined>;
  }

  async getClassByCohortId(cohortId: string): Promise<ClassRow | undefined> {
    return this.handle
      .selectFrom('classes')
      .select(CLASS_COLUMNS)
      .where('cohort_id', '=', cohortId)
      .executeTakeFirst() as Promise<ClassRow | undefined>;
  }

  async listClassesByTenant(tenantId: string): Promise<ClassRow[]> {
    return this.handle
      .selectFrom('classes')
      .select(CLASS_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'asc')
      .execute() as Promise<ClassRow[]>;
  }

  async insertClass(v: NewClass, tx?: ClassesDb): Promise<ClassRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('classes')
      .values(classInsertValues(v))
      .returning(CLASS_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<ClassRow>;
  }

  async updateClass(id: string, patch: Partial<ClassRow>): Promise<void> {
    await this.handle
      .updateTable('classes')
      .set({ ...classUpdateValues(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteClass(id: string): Promise<void> {
    await this.handle.deleteFrom('classes').where('id', '=', id).execute();
  }

  async deleteCohort(cohortId: string): Promise<void> {
    await this.handle.deleteFrom('cohort').where('id', '=', cohortId).execute();
  }

  async countCoursesInClass(classId: string): Promise<number> {
    const row = await this.handle
      .selectFrom('course')
      .select(sql<number>`count(*)::int`.as('value'))
      .where('class_id', '=', classId)
      .executeTakeFirst();
    return row?.value ?? 0;
  }

  async listCoursesInClass(classId: string): Promise<CourseRow[]> {
    return this.handle
      .selectFrom('course')
      .select(CLASS_COURSE_COLUMNS)
      .where('class_id', '=', classId)
      .orderBy('sort_order', 'asc')
      .execute() as Promise<CourseRow[]>;
  }

  async listActiveEnrolledCourseIds(classId: string, userId: string): Promise<string[]> {
    const rows = await this.handle
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

  async syncOnLeaveToInstances(cohortId: string, onLeave: string): Promise<void> {
    await this.handle
      .updateTable('enrol')
      .set({ custom_text1: onLeave, updated_at: new Date() })
      .where('enrol', '=', 'cohort')
      .where('custom_int1', '=', cohortId)
      .execute();
  }


  async getClassByJoinCode(joinCode: string): Promise<ClassRow | undefined> {
    return this.handle
      .selectFrom('classes')
      .select(CLASS_COLUMNS)
      .where('join_code', '=', joinCode)
      .executeTakeFirst() as Promise<ClassRow | undefined>;
  }

  async insertJoinRequest(v: NewClassJoinRequest): Promise<ClassJoinRequestRow> {
    return this.handle
      .insertInto('class_join_requests')
      .values(joinRequestInsertValues(v))
      .returning(JOIN_REQUEST_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<ClassJoinRequestRow>;
  }

  async getJoinRequest(id: string): Promise<ClassJoinRequestRow | undefined> {
    return this.handle
      .selectFrom('class_join_requests')
      .select(JOIN_REQUEST_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<ClassJoinRequestRow | undefined>;
  }

  async findPendingJoinRequest(classId: string, userId: string): Promise<ClassJoinRequestRow | undefined> {
    return this.handle
      .selectFrom('class_join_requests')
      .select(JOIN_REQUEST_COLUMNS)
      .where('class_id', '=', classId)
      .where('user_id', '=', userId)
      .where('status', '=', 'pending')
      .executeTakeFirst() as Promise<ClassJoinRequestRow | undefined>;
  }

  async listJoinRequests(classId: string, status: string): Promise<ClassJoinRequestRow[]> {
    return this.handle
      .selectFrom('class_join_requests')
      .select(JOIN_REQUEST_COLUMNS)
      .where('class_id', '=', classId)
      .where('status', '=', status)
      .orderBy('created_at', 'asc')
      .execute() as Promise<ClassJoinRequestRow[]>;
  }

  async updateJoinRequest(id: string, patch: Partial<ClassJoinRequestRow>): Promise<void> {
    await this.handle
      .updateTable('class_join_requests')
      .set({ ...joinRequestUpdateValues(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async listSuspendedMemberIds(cohortId: string): Promise<string[]> {
    const rows = await this.handle
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
