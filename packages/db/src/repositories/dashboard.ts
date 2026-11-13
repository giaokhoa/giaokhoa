import { sql } from 'kysely';
import type { CentreDb } from '../client';

export const CONTEXT_LEVEL_KEYS = [
  'SYSTEM',
  'TENANT',
  'USER',
  'COURSECAT',
  'CLASS',
  'COURSE',
  'MODULE',
  'BLOCK',
] as const;

export type ContextLevelKey = (typeof CONTEXT_LEVEL_KEYS)[number];

export interface ContextLevels {
  readonly SYSTEM: number;
  readonly TENANT: number;
  readonly USER: number;
  readonly COURSECAT: number;
  readonly CLASS: number;
  readonly COURSE: number;
  readonly MODULE: number;
  readonly BLOCK: number;
}

export type DashboardDb = CentreDb;

export interface DashboardStateRow {
  userId: string;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CardPrefRow {
  userId: string;
  courseId: string;
  color: string | null;
  nickname: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardQuizDueRow {
  cmId: string;
  activityId: string | null;
  courseId: string;
  name: string;
  dueAt: Date | null;
  attemptState: string | null;
}

export interface DashboardAssignmentDueRow {
  cmId: string;
  activityId: string | null;
  courseId: string;
  name: string;
  dueAt: Date | null;
  submissionStatus: string | null;
}

export interface DashboardGradeRow {
  gradeId: string;
  courseId: string;
  itemId: string;
  itemName: string;
  itemType: string;
  finalGrade: number | null;
  gradeMax: number;
  feedback: string | null;
  updatedAt: Date;
}

export interface DashboardGradePublicationRow {
  id: string;
  courseId: string;
  itemId: string | null;
  scope: string;
  action: string;
  actorId: string;
  note: string | null;
  createdAt: Date;
}

export interface DashboardAssignmentPendingRow {
  courseId: string;
  submittedAt: Date | null;
  gradeStatus: string | null;
}

export interface DashboardQuizPendingRow {
  courseId: string;
  timeFinish: Date | null;
  timeStart: Date;
}

export interface DashboardPaperPendingRow {
  courseId: string;
  pinId: string;
  createdAt: Date;
}

const STATE_COLUMNS = [
  'user_id as userId',
  'last_seen_at as lastSeenAt',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const PREF_COLUMNS = [
  'user_id as userId',
  'course_id as courseId',
  'color',
  'nickname',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const PUBLICATION_COLUMNS = [
  'id',
  'course_id as courseId',
  'item_id as itemId',
  'scope',
  'action',
  'actor_id as actorId',
  'note',
  'created_at as createdAt',
] as const;

const GRADE_COLUMNS = [
  'grade_grades.id as gradeId',
  'grade_items.course_id as courseId',
  'grade_grades.item_id as itemId',
  'grade_items.item_name as itemName',
  'grade_items.item_type as itemType',
  'grade_grades.final_grade as finalGrade',
  'grade_items.grade_max as gradeMax',
  'grade_grades.feedback as feedback',
  'grade_grades.updated_at as updatedAt',
] as const;

function stateInsertValues(userId: string, at: Date) {
  return { user_id: userId, last_seen_at: at };
}

function prefInsertValues(userId: string, courseId: string, color: string | null, nickname: string | null) {
  return { user_id: userId, course_id: courseId, color, nickname };
}

export class DashboardRepository {
  constructor(
    private readonly handle: CentreDb,
    private readonly contextLevels: ContextLevels,
  ) {}

  private db(): CentreDb {
    return this.handle;
  }

  async enrolledCourseIds(userId: string, now: Date): Promise<string[]> {
    const rows = await this.db()
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select('enrol.course_id as courseId')
      .distinct()
      .where('user_enrolments.user_id', '=', userId)
      .where('user_enrolments.status', '=', 0)
      .where((eb) =>
        eb.or([
          eb('user_enrolments.time_end', 'is', null),
          eb('user_enrolments.time_end', '>', now),
        ]),
      )
      .execute();
    return rows.map((r) => r.courseId);
  }

  async roleAssignedCourseIds(userId: string): Promise<string[]> {
    const rows = await this.db()
      .selectFrom('role_assignments')
      .innerJoin('context', 'context.id', 'role_assignments.context_id')
      .select('context.instance_id as courseId')
      .distinct()
      .where('role_assignments.user_id', '=', userId)
      .where('context.context_level', '=', this.contextLevels.COURSE)
      .where('context.instance_id', 'is not', null)
      .execute();
    return rows.map((r) => r.courseId!).filter(Boolean);
  }

  async courseNames(courseIds: string[]): Promise<Map<string, string>> {
    if (!courseIds.length) return new Map();
    const rows = await this.db()
      .selectFrom('course')
      .select(['id', 'full_name as fullName'])
      .where('id', 'in', courseIds)
      .execute();
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }

  async quizDueRows(courseIds: string[], userId: string, until: Date): Promise<DashboardQuizDueRow[]> {
    if (!courseIds.length) return [];
    return this.db()
      .selectFrom('course_modules')
      .innerJoin('exam_pins', 'exam_pins.id', 'course_modules.instance_id')
      .innerJoin('exam_versions', 'exam_versions.id', 'exam_pins.exam_version_id')
      .leftJoin('exam_attempts', (join) =>
        join
          .onRef('exam_attempts.pin_id', '=', 'exam_pins.id')
          .on('exam_attempts.user_id', '=', userId)
          .on('exam_attempts.preview', '=', false),
      )
      .select([
        'course_modules.id as cmId',
        'course_modules.instance_id as activityId',
        'course_modules.course as courseId',
        sql<string>`coalesce(exam_pins.name, exam_versions.name)`.as('name'),
        'exam_pins.time_close as dueAt',
        'exam_attempts.state as attemptState',
      ])
      .where('course_modules.course', 'in', courseIds)
      .where('course_modules.component', '=', 'mod_quiz')
      .where('course_modules.visible', '=', true)
      .where('course_modules.deletion_in_progress', '=', false)
      .where('exam_pins.time_close', 'is not', null)
      .where('exam_pins.time_close', '<=', until)
      .orderBy('exam_pins.time_close', 'asc')
      .execute();
  }

  async assignmentDueRows(courseIds: string[], userId: string, until: Date): Promise<DashboardAssignmentDueRow[]> {
    if (!courseIds.length) return [];
    return this.db()
      .selectFrom('course_modules')
      .innerJoin('assignments', 'assignments.id', 'course_modules.instance_id')
      .leftJoin('assign_submissions', (join) =>
        join
          .onRef('assign_submissions.assignment_id', '=', 'assignments.id')
          .on('assign_submissions.user_id', '=', userId),
      )
      .select([
        'course_modules.id as cmId',
        'course_modules.instance_id as activityId',
        'course_modules.course as courseId',
        'assignments.name as name',
        'assignments.due_date as dueAt',
        'assign_submissions.status as submissionStatus',
      ])
      .where('course_modules.course', 'in', courseIds)
      .where('course_modules.component', '=', 'mod_assign')
      .where('course_modules.visible', '=', true)
      .where('course_modules.deletion_in_progress', '=', false)
      .where('assignments.due_date', 'is not', null)
      .where('assignments.due_date', '<=', until)
      .orderBy('assignments.due_date', 'asc')
      .execute();
  }

  private gradeRowsQuery() {
    return this.db()
      .selectFrom('grade_grades')
      .innerJoin('grade_items', 'grade_items.id', 'grade_grades.item_id')
      .select(GRADE_COLUMNS)
      .where((eb) =>
        eb.or([
          eb('grade_grades.final_grade', 'is not', null),
          eb.and([
            eb('grade_grades.feedback', 'is not', null),
            eb('grade_grades.feedback', '<>', ''),
          ]),
        ]),
      );
  }

  async gradeRowsSince(courseIds: string[], userId: string, since: Date): Promise<DashboardGradeRow[]> {
    if (!courseIds.length) return [];
    return this.gradeRowsQuery()
      .where('grade_grades.user_id', '=', userId)
      .where('grade_items.course_id', 'in', courseIds)
      .where('grade_grades.updated_at', '>', since)
      .orderBy('grade_grades.updated_at', 'asc')
      .execute();
  }

  async itemPublications(courseIds: string[]): Promise<DashboardGradePublicationRow[]> {
    if (!courseIds.length) return [];
    return this.db()
      .selectFrom('grade_publications')
      .select(PUBLICATION_COLUMNS)
      .where('grade_publications.course_id', 'in', courseIds)
      .where('grade_publications.scope', '=', 'item')
      .orderBy('grade_publications.created_at', 'asc')
      .execute();
  }

  async gradeRowsForItems(itemIds: string[], userId: string): Promise<DashboardGradeRow[]> {
    if (!itemIds.length) return [];
    return this.gradeRowsQuery()
      .where('grade_grades.user_id', '=', userId)
      .where('grade_grades.item_id', 'in', itemIds)
      .execute();
  }

  async assignmentPendingRows(courseIds: string[]): Promise<DashboardAssignmentPendingRow[]> {
    if (!courseIds.length) return [];
    return this.db()
      .selectFrom('assign_submissions')
      .innerJoin('assignments', 'assignments.id', 'assign_submissions.assignment_id')
      .leftJoin('assign_grades', (join) =>
        join
          .onRef('assign_grades.assignment_id', '=', 'assign_submissions.assignment_id')
          .onRef('assign_grades.user_id', '=', 'assign_submissions.user_id')
          .onRef('assign_grades.attempt_number', '=', 'assign_submissions.attempt_number'),
      )
      .select([
        'assignments.course as courseId',
        'assign_submissions.submitted_at as submittedAt',
        'assign_grades.status as gradeStatus',
      ])
      .where('assignments.course', 'in', courseIds)
      .where('assign_submissions.status', '=', 'submitted')
      .execute();
  }

  async quizPendingRows(courseIds: string[]): Promise<DashboardQuizPendingRow[]> {
    if (!courseIds.length) return [];
    return this.db()
      .selectFrom('exam_attempts')
      .innerJoin('exam_pins', 'exam_pins.id', 'exam_attempts.pin_id')
      .select([
        'exam_pins.course_id as courseId',
        'exam_attempts.time_finish as timeFinish',
        'exam_attempts.time_start as timeStart',
      ])
      .where('exam_pins.course_id', 'in', courseIds)
      .where('exam_attempts.state', '=', 'needsgrading')
      .where('exam_attempts.preview', '=', false)
      .execute();
  }

  async paperPendingRows(courseIds: string[]): Promise<DashboardPaperPendingRow[]> {
    if (!courseIds.length) return [];
    return this.db()
      .selectFrom('exam_scans')
      .innerJoin('exam_pins', 'exam_pins.id', 'exam_scans.exam_pin_id')
      .select([
        'exam_pins.course_id as courseId',
        'exam_scans.exam_pin_id as pinId',
        'exam_scans.created_at as createdAt',
      ])
      .where('exam_pins.course_id', 'in', courseIds)
      .where('exam_scans.status', 'in', ['needs_identity', 'needs_review'])
      .execute();
  }

  async getState(userId: string): Promise<DashboardStateRow | undefined> {
    return this.db()
      .selectFrom('user_dashboard_state')
      .select(STATE_COLUMNS)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  async touchState(userId: string, at: Date): Promise<void> {
    await this.db()
      .insertInto('user_dashboard_state')
      .values(stateInsertValues(userId, at))
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet({ last_seen_at: at, updated_at: new Date() }),
      )
      .execute();
  }

  async listPrefs(userId: string): Promise<CardPrefRow[]> {
    return this.db()
      .selectFrom('user_course_card_prefs')
      .select(PREF_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('course_id', 'asc')
      .execute();
  }

  async upsertPref(
    userId: string,
    courseId: string,
    color: string | null,
    nickname: string | null,
  ): Promise<CardPrefRow> {
    const rows = await this.db()
      .insertInto('user_course_card_prefs')
      .values(prefInsertValues(userId, courseId, color, nickname))
      .onConflict((oc) =>
        oc.columns(['user_id', 'course_id']).doUpdateSet({
          color,
          nickname,
          updated_at: new Date(),
        }),
      )
      .returning(PREF_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async deletePref(userId: string, courseId: string): Promise<void> {
    await this.db()
      .deleteFrom('user_course_card_prefs')
      .where('user_id', '=', userId)
      .where('course_id', '=', courseId)
      .execute();
  }
}
