import type { Insertable, Updateable } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import { applyDefined } from './mapping';

export type CompletionDb = CentreDb | CentreTx;

export interface CmCompletionRow {
  id: string;
  courseModuleId: string;
  userId: string;
  completionState: number;
  viewed: boolean;
  overrideBy: string | null;
  updatedAt: Date;
}

export interface CriteriaRow {
  id: string;
  course: string;
  criteriaType: string;
  moduleInstance: string | null;
  date: Date | null;
  courseInstance: string | null;
  enrolPeriodDays: number | null;
  roleId: string | null;
  sortOrder: number;
  createdAt: Date;
}

export interface CritComplRow {
  id: string;
  criteriaId: string;
  userId: string;
  markedBy: string | null;
  timeCompleted: Date;
}

export interface CourseCompletionRow {
  id: string;
  userId: string;
  course: string;
  status: string;
  timeEnrolled: Date;
  timeStarted: Date | null;
  timeCompleted: Date | null;
  reAggregate: Date;
}

export interface NewCmCompletion {
  id?: string;
  courseModuleId: string;
  userId: string;
  completionState?: number;
  viewed?: boolean;
  overrideBy?: string | null;
  updatedAt?: Date;
}

export interface NewCriteria {
  id?: string;
  course: string;
  criteriaType: string;
  moduleInstance?: string | null;
  date?: Date | null;
  courseInstance?: string | null;
  enrolPeriodDays?: number | null;
  roleId?: string | null;
  sortOrder?: number;
  createdAt?: Date;
}

export interface NewCritCompl {
  id?: string;
  criteriaId: string;
  userId: string;
  markedBy?: string | null;
  timeCompleted?: Date;
}

export interface NewCourseCompletion {
  id?: string;
  userId: string;
  course: string;
  status?: string;
  timeEnrolled?: Date;
  timeStarted?: Date | null;
  timeCompleted?: Date | null;
  reAggregate?: Date;
}

const CM_COMPLETION_COLUMNS = [
  'id',
  'course_module_id as courseModuleId',
  'user_id as userId',
  'completion_state as completionState',
  'viewed',
  'override_by as overrideBy',
  'updated_at as updatedAt',
] as const;

const CRITERIA_COLUMNS = [
  'id',
  'course',
  'criteria_type as criteriaType',
  'module_instance as moduleInstance',
  'date',
  'course_instance as courseInstance',
  'enrol_period_days as enrolPeriodDays',
  'role_id as roleId',
  'sort_order as sortOrder',
  'created_at as createdAt',
] as const;

const CRIT_COMPL_COLUMNS = [
  'id',
  'criteria_id as criteriaId',
  'user_id as userId',
  'marked_by as markedBy',
  'time_completed as timeCompleted',
] as const;

const COURSE_COMPLETION_COLUMNS = [
  'id',
  'user_id as userId',
  'course',
  'status',
  'time_enrolled as timeEnrolled',
  'time_started as timeStarted',
  'time_completed as timeCompleted',
  're_aggregate as reAggregate',
] as const;

function cmCompletionInsertValues(values: NewCmCompletion): Insertable<CentreDB['course_modules_completion']> {
  const row: Insertable<CentreDB['course_modules_completion']> = {
    course_module_id: values.courseModuleId,
    user_id: values.userId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['completionState', 'completion_state'],
    ['viewed', 'viewed'],
    ['overrideBy', 'override_by'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function criteriaInsertValues(values: NewCriteria): Insertable<CentreDB['course_completion_criteria']> {
  const row: Insertable<CentreDB['course_completion_criteria']> = {
    course: values.course,
    criteria_type: values.criteriaType,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['moduleInstance', 'module_instance'],
    ['date', 'date'],
    ['courseInstance', 'course_instance'],
    ['enrolPeriodDays', 'enrol_period_days'],
    ['roleId', 'role_id'],
    ['sortOrder', 'sort_order'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function critComplInsertValues(values: NewCritCompl): Insertable<CentreDB['course_completion_crit_compl']> {
  const row: Insertable<CentreDB['course_completion_crit_compl']> = {
    criteria_id: values.criteriaId,
    user_id: values.userId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['markedBy', 'marked_by'],
    ['timeCompleted', 'time_completed'],
  ]);
  return row;
}

function courseCompletionInsertValues(values: NewCourseCompletion): Insertable<CentreDB['course_completions']> {
  const row: Insertable<CentreDB['course_completions']> = {
    user_id: values.userId,
    course: values.course,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['status', 'status'],
    ['timeEnrolled', 'time_enrolled'],
    ['timeStarted', 'time_started'],
    ['timeCompleted', 'time_completed'],
    ['reAggregate', 're_aggregate'],
  ]);
  return row;
}

export class CompletionRepository {
  constructor(private readonly handle: CompletionDb) {}

  private db(): CompletionDb {
    return this.handle;
  }

  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async getCmCompletion(cmid: string, userId: string, db: CompletionDb = this.db()): Promise<CmCompletionRow | undefined> {
    return db
      .selectFrom('course_modules_completion')
      .select(CM_COMPLETION_COLUMNS)
      .where('course_module_id', '=', cmid)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
  }

  async upsertCmCompletion(v: NewCmCompletion, db: CompletionDb = this.db()): Promise<CmCompletionRow> {
    const set: Updateable<CentreDB['course_modules_completion']> = { updated_at: new Date() };
    applyDefined(set, v, [
      ['completionState', 'completion_state'],
      ['viewed', 'viewed'],
      ['overrideBy', 'override_by'],
    ]);
    const rows = await db
      .insertInto('course_modules_completion')
      .values(cmCompletionInsertValues(v))
      .onConflict((oc) => oc.columns(['course_module_id', 'user_id']).doUpdateSet(set))
      .returning(CM_COMPLETION_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listCmCompletionsForUser(
    userId: string,
    cmIds: string[],
    db: CompletionDb = this.db(),
  ): Promise<CmCompletionRow[]> {
    if (!cmIds.length) return [];
    return db
      .selectFrom('course_modules_completion')
      .select(CM_COMPLETION_COLUMNS)
      .where('user_id', '=', userId)
      .where('course_module_id', 'in', cmIds)
      .execute();
  }

  async listCmCompletionsForCm(cmid: string, db: CompletionDb = this.db()): Promise<CmCompletionRow[]> {
    return db
      .selectFrom('course_modules_completion')
      .select(CM_COMPLETION_COLUMNS)
      .where('course_module_id', '=', cmid)
      .execute();
  }

  async deleteCmCompletionsForCm(cmid: string, db: CompletionDb = this.db()): Promise<number> {
    const deleted = await db
      .deleteFrom('course_modules_completion')
      .where('course_module_id', '=', cmid)
      .returning(['id'])
      .execute();
    return deleted.length;
  }

  async hasAnyCmCompletion(userId: string, cmIds: string[], db: CompletionDb = this.db()): Promise<boolean> {
    const rows = await this.listCmCompletionsForUser(userId, cmIds, db);
    return rows.length > 0;
  }

  async insertCriteria(v: NewCriteria, db: CompletionDb = this.db()): Promise<CriteriaRow> {
    const rows = await db
      .insertInto('course_completion_criteria')
      .values(criteriaInsertValues(v))
      .returning(CRITERIA_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listCriteria(courseId: string, db: CompletionDb = this.db()): Promise<CriteriaRow[]> {
    return db
      .selectFrom('course_completion_criteria')
      .select(CRITERIA_COLUMNS)
      .where('course', '=', courseId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async deleteCriteria(id: string, db: CompletionDb = this.db()): Promise<void> {
    await db.deleteFrom('course_completion_criteria').where('id', '=', id).execute();
  }

  async getCriteria(id: string, db: CompletionDb = this.db()): Promise<CriteriaRow | undefined> {
    return db
      .selectFrom('course_completion_criteria')
      .select(CRITERIA_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
  }

  async listDependentCourseIds(prerequisiteCourseId: string, db: CompletionDb = this.db()): Promise<string[]> {
    const rows = await db
      .selectFrom('course_completion_criteria')
      .select(['course'])
      .where('criteria_type', '=', 'course')
      .where('course_instance', '=', prerequisiteCourseId)
      .execute();
    return [...new Set(rows.map((r) => r.course))];
  }

  async getCritCompl(criteriaId: string, userId: string, db: CompletionDb = this.db()): Promise<CritComplRow | undefined> {
    return db
      .selectFrom('course_completion_crit_compl')
      .select(CRIT_COMPL_COLUMNS)
      .where('criteria_id', '=', criteriaId)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
  }

  async listCritComplForUser(criteriaIds: string[], userId: string, db: CompletionDb = this.db()): Promise<CritComplRow[]> {
    if (!criteriaIds.length) return [];
    return db
      .selectFrom('course_completion_crit_compl')
      .select(CRIT_COMPL_COLUMNS)
      .where('user_id', '=', userId)
      .where('criteria_id', 'in', criteriaIds)
      .execute();
  }

  async upsertCritCompl(v: NewCritCompl, db: CompletionDb = this.db()): Promise<CritComplRow> {
    const set: Updateable<CentreDB['course_completion_crit_compl']> = { time_completed: new Date() };
    if (v.markedBy !== undefined) set.marked_by = v.markedBy;
    const rows = await db
      .insertInto('course_completion_crit_compl')
      .values(critComplInsertValues(v))
      .onConflict((oc) => oc.columns(['criteria_id', 'user_id']).doUpdateSet(set))
      .returning(CRIT_COMPL_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async deleteCritCompl(criteriaId: string, userId: string, db: CompletionDb = this.db()): Promise<void> {
    await db
      .deleteFrom('course_completion_crit_compl')
      .where('criteria_id', '=', criteriaId)
      .where('user_id', '=', userId)
      .execute();
  }

  async getSettings(courseId: string, db: CompletionDb = this.db()): Promise<{ method: number }> {
    const row = await db
      .selectFrom('course_completion_settings')
      .select(['method'])
      .where('course', '=', courseId)
      .limit(1)
      .executeTakeFirst();
    return row ?? { method: 1 };
  }

  async setSettings(courseId: string, method: number, db: CompletionDb = this.db()): Promise<void> {
    await db
      .insertInto('course_completion_settings')
      .values({ course: courseId, method })
      .onConflict((oc) => oc.column('course').doUpdateSet({ method }))
      .execute();
  }

  async getCourseCompletion(
    userId: string,
    courseId: string,
    db: CompletionDb = this.db(),
  ): Promise<CourseCompletionRow | undefined> {
    return db
      .selectFrom('course_completions')
      .select(COURSE_COMPLETION_COLUMNS)
      .where('user_id', '=', userId)
      .where('course', '=', courseId)
      .limit(1)
      .executeTakeFirst();
  }

  async upsertCourseCompletion(v: NewCourseCompletion, db: CompletionDb = this.db()): Promise<CourseCompletionRow> {
    const set: Updateable<CentreDB['course_completions']> = { re_aggregate: new Date() };
    applyDefined(set, v, [
      ['status', 'status'],
      ['timeStarted', 'time_started'],
      ['timeCompleted', 'time_completed'],
    ]);
    const rows = await db
      .insertInto('course_completions')
      .values(courseCompletionInsertValues(v))
      .returning(COURSE_COMPLETION_COLUMNS)
      .onConflict((oc) => oc.columns(['user_id', 'course']).doUpdateSet(set))
      .execute();
    return rows[0]!;
  }

  async listCourseCompletions(courseId: string, db: CompletionDb = this.db()): Promise<CourseCompletionRow[]> {
    return db
      .selectFrom('course_completions')
      .select(COURSE_COMPLETION_COLUMNS)
      .where('course', '=', courseId)
      .execute();
  }
}
