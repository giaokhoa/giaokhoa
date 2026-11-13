import { sql } from 'kysely';
import type { CentreDb, CentreTx } from '../client';

export type GuardianViewDb = CentreDb | CentreTx;

export interface GuardianViewStateRow {
  guardianUserId: string;
  studentUserId: string;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GuardianQuizDueRow {
  cmId: string;
  courseId: string;
  name: string;
  dueAt: Date | null;
  attemptState: string | null;
}

export interface GuardianAssignmentDueRow {
  cmId: string;
  courseId: string;
  name: string;
  dueAt: Date | null;
  submissionStatus: string | null;
}

export interface GuardianNotificationRow {
  id: string;
  subject: string;
  fullMessage: string;
  eventType: string;
  contextUrl: string | null;
  createdAt: Date;
}

export interface GuardianCourseProgressRow {
  courseId: string;
  total: number;
  completed: number;
}

const GUARDIAN_VIEW_STATE_COLUMNS = [
  'guardian_user_id as guardianUserId',
  'student_user_id as studentUserId',
  'last_seen_at as lastSeenAt',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

export class GuardianViewRepository {
  constructor(private readonly handle: GuardianViewDb) {}

  private db(): GuardianViewDb {
    return this.handle;
  }

  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async getViewState(
    guardianUserId: string,
    studentUserId: string,
    db: GuardianViewDb = this.db(),
  ): Promise<GuardianViewStateRow | undefined> {
    return db
      .selectFrom('guardian_view_state')
      .select(GUARDIAN_VIEW_STATE_COLUMNS)
      .where('guardian_user_id', '=', guardianUserId)
      .where('student_user_id', '=', studentUserId)
      .limit(1)
      .executeTakeFirst();
  }

  async touchViewState(
    guardianUserId: string,
    studentUserId: string,
    at: Date,
    db: GuardianViewDb = this.db(),
  ): Promise<void> {
    await db
      .insertInto('guardian_view_state')
      .values({ guardian_user_id: guardianUserId, student_user_id: studentUserId, last_seen_at: at })
      .onConflict((oc) =>
        oc.columns(['guardian_user_id', 'student_user_id']).doUpdateSet({
          last_seen_at: at,
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  async quizDueRows(
    courseIds: string[],
    studentUserId: string,
    until: Date,
    db: GuardianViewDb = this.db(),
  ): Promise<GuardianQuizDueRow[]> {
    if (!courseIds.length) return [];
    return db
      .selectFrom('course_modules')
      .innerJoin('exam_pins', 'exam_pins.id', 'course_modules.instance_id')
      .innerJoin('exam_versions', 'exam_versions.id', 'exam_pins.exam_version_id')
      .leftJoin('exam_attempts', (join) =>
        join
          .onRef('exam_attempts.pin_id', '=', 'exam_pins.id')
          .on('exam_attempts.user_id', '=', studentUserId)
          .on('exam_attempts.preview', '=', false),
      )
      .select([
        'course_modules.id as cmId',
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

  async assignmentDueRows(
    courseIds: string[],
    studentUserId: string,
    until: Date,
    db: GuardianViewDb = this.db(),
  ): Promise<GuardianAssignmentDueRow[]> {
    if (!courseIds.length) return [];
    return db
      .selectFrom('course_modules')
      .innerJoin('assignments', 'assignments.id', 'course_modules.instance_id')
      .leftJoin('assign_submissions', (join) =>
        join
          .onRef('assign_submissions.assignment_id', '=', 'assignments.id')
          .on('assign_submissions.user_id', '=', studentUserId),
      )
      .select([
        'course_modules.id as cmId',
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

  async recentNotificationsForStudent(
    studentUserId: string,
    limit: number,
    db: GuardianViewDb = this.db(),
  ): Promise<GuardianNotificationRow[]> {
    return db
      .selectFrom('notifications')
      .select([
        'id',
        'subject',
        'full_message as fullMessage',
        'event_type as eventType',
        'context_url as contextUrl',
        'created_at as createdAt',
      ])
      .where('user_id_to', '=', studentUserId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
  }

  async courseProgressRows(
    courseIds: string[],
    studentUserId: string,
    db: GuardianViewDb = this.db(),
  ): Promise<GuardianCourseProgressRow[]> {
    if (!courseIds.length) return [];
    return db
      .selectFrom('course_modules')
      .leftJoin('course_modules_completion', (join) =>
        join
          .onRef('course_modules_completion.course_module_id', '=', 'course_modules.id')
          .on('course_modules_completion.user_id', '=', studentUserId)
          .on('course_modules_completion.completion_state', '<>', 0),
      )
      .select([
        'course_modules.course as courseId',
        sql<number>`count(*)::int`.as('total'),
        sql<number>`count(course_modules_completion.id)::int`.as('completed'),
      ])
      .where('course_modules.course', 'in', courseIds)
      .where('course_modules.visible', '=', true)
      .where('course_modules.deletion_in_progress', '=', false)
      .where('course_modules.completion', '<>', 0)
      .groupBy('course_modules.course')
      .execute();
  }
}
