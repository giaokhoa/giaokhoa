import type { CentreDb, CentreTx } from '../client';
import { pickDefined } from './mapping';


export type EnrolDb = CentreDb | CentreTx;
export type EnrolTx = CentreTx;


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

export interface NewUserEnrolment {
  id?: string;
  enrolId: string;
  userId: string;
  status?: number;
  timeStart?: Date;
  timeEnd?: Date | null;
  modifierId?: string | null;
}


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


function enrolInsertValues(v: NewEnrolInstance) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    course_id: v.courseId,
    enrol: v.enrol,
    ...pickDefined(v, [
      ['name', 'name'],
      ['roleId', 'role_id'],
      ['status', 'status'],
      ['enrolPeriod', 'enrol_period'],
      ['timeStart', 'time_start'],
      ['timeEnd', 'time_end'],
      ['enrolmentKey', 'enrolment_key'],
      ['customInt1', 'custom_int1'],
      ['customInt2', 'custom_int2'],
      ['customText1', 'custom_text1'],
      ['cost', 'cost'],
      ['currency', 'currency'],
      ['paymentAccountId', 'payment_account_id'],
      ['sendWelcomeMessage', 'send_welcome_message'],
      ['welcomeMessage', 'welcome_message'],
    ]),
  };
}

function enrolUpdateValues(v: Partial<NewEnrolInstance>) {
  return {
    ...pickDefined(v, [
      ['courseId', 'course_id'],
      ['enrol', 'enrol'],
      ['name', 'name'],
      ['roleId', 'role_id'],
      ['status', 'status'],
      ['enrolPeriod', 'enrol_period'],
      ['timeStart', 'time_start'],
      ['timeEnd', 'time_end'],
      ['enrolmentKey', 'enrolment_key'],
      ['customInt1', 'custom_int1'],
      ['customInt2', 'custom_int2'],
      ['customText1', 'custom_text1'],
      ['cost', 'cost'],
      ['currency', 'currency'],
      ['paymentAccountId', 'payment_account_id'],
      ['sendWelcomeMessage', 'send_welcome_message'],
      ['welcomeMessage', 'welcome_message'],
    ]),
  };
}

function userEnrolmentInsertValues(v: NewUserEnrolment) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    enrol_id: v.enrolId,
    user_id: v.userId,
    ...pickDefined(v, [
      ['status', 'status'],
      ['timeStart', 'time_start'],
      ['timeEnd', 'time_end'],
      ['modifierId', 'modifier_id'],
    ]),
  };
}

function userEnrolmentUpdateValues(v: Partial<NewUserEnrolment>) {
  return {
    ...pickDefined(v, [
      ['enrolId', 'enrol_id'],
      ['userId', 'user_id'],
      ['status', 'status'],
      ['timeStart', 'time_start'],
      ['timeEnd', 'time_end'],
      ['modifierId', 'modifier_id'],
    ]),
  };
}

export class EnrolRepository {
  constructor(private readonly handle: CentreDb) {}

  async transaction<T>(fn: (tx: EnrolTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }

  async insertInstance(v: NewEnrolInstance, db: EnrolDb = this.handle): Promise<EnrolRow> {
    return db
      .insertInto('enrol')
      .values(enrolInsertValues(v))
      .returning(ENROL_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<EnrolRow>;
  }

  async getInstance(id: string): Promise<EnrolRow | undefined> {
    return this.handle
      .selectFrom('enrol')
      .select(ENROL_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<EnrolRow | undefined>;
  }

  async listInstances(courseId: string): Promise<EnrolRow[]> {
    return this.handle
      .selectFrom('enrol')
      .select(ENROL_COLUMNS)
      .where('course_id', '=', courseId)
      .orderBy('id', 'asc')
      .execute() as Promise<EnrolRow[]>;
  }

  async listInstancesByMethod(method: string): Promise<EnrolRow[]> {
    return this.handle
      .selectFrom('enrol')
      .select(ENROL_COLUMNS)
      .where('enrol', '=', method)
      .orderBy('id', 'asc')
      .execute() as Promise<EnrolRow[]>;
  }

  async listCohortInstances(cohortId: string): Promise<EnrolRow[]> {
    const rows = (await this.handle
      .selectFrom('enrol')
      .select(ENROL_COLUMNS)
      .where('enrol', '=', 'cohort')
      .execute()) as EnrolRow[];
    return rows.filter((r) => r.customInt1 === cohortId);
  }

  async updateInstance(id: string, v: Partial<NewEnrolInstance>): Promise<void> {
    await this.handle
      .updateTable('enrol')
      .set({ ...enrolUpdateValues(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteInstance(id: string): Promise<void> {
    await this.handle.deleteFrom('enrol').where('id', '=', id).execute();
  }

  async insertUserEnrolment(v: NewUserEnrolment, db: EnrolDb = this.handle): Promise<UserEnrolmentRow> {
    return db
      .insertInto('user_enrolments')
      .values(userEnrolmentInsertValues(v))
      .returning(USER_ENROLMENT_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<UserEnrolmentRow>;
  }

  async getUserEnrolment(enrolId: string, userId: string): Promise<UserEnrolmentRow | undefined> {
    return this.handle
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('enrol_id', '=', enrolId)
      .where('user_id', '=', userId)
      .executeTakeFirst() as Promise<UserEnrolmentRow | undefined>;
  }

  async updateUserEnrolment(id: string, v: Partial<NewUserEnrolment>, db: EnrolDb = this.handle): Promise<void> {
    await db
      .updateTable('user_enrolments')
      .set({ ...userEnrolmentUpdateValues(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteUserEnrolment(id: string): Promise<void> {
    await this.handle.deleteFrom('user_enrolments').where('id', '=', id).execute();
  }

  async listUserEnrolmentsForCourse(courseId: string): Promise<(UserEnrolmentRow & { enrolMethod: string })[]> {
    const instances = await this.listInstances(courseId);
    if (!instances.length) return [];
    const rows = (await this.handle
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('enrol_id', 'in', instances.map((i) => i.id))
      .execute()) as UserEnrolmentRow[];
    const methodById = new Map(instances.map((i) => [i.id, i.enrol]));
    return rows.map((r) => ({ ...r, enrolMethod: methodById.get(r.enrolId) ?? '' }));
  }

  async listUserEnrolmentsForUser(userId: string): Promise<UserEnrolmentRow[]> {
    return this.handle
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('user_id', '=', userId)
      .execute() as Promise<UserEnrolmentRow[]>;
  }

  async listUserEnrolmentsForInstance(enrolId: string): Promise<UserEnrolmentRow[]> {
    return this.handle
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('enrol_id', '=', enrolId)
      .execute() as Promise<UserEnrolmentRow[]>;
  }

  async listExpiredActive(now: Date): Promise<UserEnrolmentRow[]> {
    const rows = (await this.handle
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('status', '=', 0)
      .execute()) as UserEnrolmentRow[];
    return rows.filter((r) => r.timeEnd !== null && r.timeEnd < now);
  }
}
