import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import type { Job } from 'bullmq';
import { sql, type CentreDB } from '@giaokhoa/db';
import { TaskLogService } from '../task-log.service';
import { tenantAls } from '../db/tenant-als';
import { SpaceDatabaseService } from '../db/routing/space-database.service';

export interface ActivityDueReminderPair { userId: string; pinId?: string; assignmentId?: string }
export interface ActivityDueReminderResult { checkedAt: string; reminded: ActivityDueReminderPair[] }

export const ACTIVITY_DUE_REMINDER_WINDOW_HOURS = 24;

const SUBMITTED_ATTEMPT_STATES = ['needsgrading', 'finished'];

@Processor('activity-due-reminders')



export class ActivityDueReminderProcessor extends ObservedWorkerHost {
  constructor(private readonly spaceDb: SpaceDatabaseService, private readonly taskLog: TaskLogService) { super(); }

  async process(_job: Job): Promise<ActivityDueReminderResult> {
    return tenantAls.run({ platform: true }, () => this.processInContext(_job));
  }

  private async processInContext(_job: Job): Promise<ActivityDueReminderResult> {
    void _job;
    return this.spaceDb.sweepSharedAndDedicated(() =>
      this.taskLog.run('activity-due-reminders', () => this.sweep(),
        (r) => `reminded ${r.reminded.length} (student, activity) pair(s)`), (a, b) => ({
          checkedAt: a.checkedAt, reminded: [...a.reminded, ...b.reminded],
        }));
  }

  private async sweep(): Promise<ActivityDueReminderResult> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + ACTIVITY_DUE_REMINDER_WINDOW_HOURS * 3600_000);
    const due = await this.spaceDb.routedKysely
      .selectFrom('exam_pins')
      .innerJoin('exam_versions', 'exam_versions.id', 'exam_pins.exam_version_id')
      .innerJoin('course', 'course.id', 'exam_pins.course_id')
      .leftJoin('course_modules', 'course_modules.id', 'exam_pins.cm_id')
      .select([
        'exam_pins.id as pinId',
        sql<string>`coalesce(${sql.ref('exam_pins.name')}, ${sql.ref('exam_versions.name')})`.as('pinName'),
        'exam_pins.time_close as timeClose',
        'exam_pins.course_id as courseId',
        'course.tenant_id as tenantId',
        'course_modules.visible as cmVisible',
        'course_modules.deletion_in_progress as cmDeletionInProgress',
      ])
      .where('course.visible', '=', true)
      .where('exam_pins.time_close', '>', now)
      .where('exam_pins.time_close', '<=', windowEnd)
      .execute();
    const reminded: ActivityDueReminderPair[] = [];
    const studentsByCourse = new Map<string, Promise<string[]>>();
    const studentsOf = (courseId: string): Promise<string[]> => {
      let cached = studentsByCourse.get(courseId);
      if (!cached) {
        cached = this.enrolledStudentIds(courseId, now);
        studentsByCourse.set(courseId, cached);
      }
      return cached;
    };
    for (const row of due) {
      if (!row.timeClose) continue;
      if (row.cmVisible === false || row.cmDeletionInProgress === true) continue;
      const students = await studentsOf(row.courseId);
      if (students.length === 0) continue;
      const submitted = await this.submittedUserIdsForPin(row.pinId, students);
      const remindedKeys = await this.remindedKeysForPin(row.pinId);
      const timeCloseIso = row.timeClose.toISOString();
      for (const userId of students) {
        if (submitted.has(userId)) continue;
        const remindedKey = `${userId}|${timeCloseIso}`;
        if (remindedKeys.has(remindedKey)) continue;
        await this.spaceDb.routedKysely.insertInto('outbox_events').values({
          aggregate: 'activity', type: 'activity_due_reminder', tenant_id: row.tenantId,
          payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify({
            userId, courseId: row.courseId, pinId: row.pinId, tenantId: row.tenantId,
            activityType: 'quiz', activityName: row.pinName,
            timeClose: timeCloseIso,
          })}::jsonb`,
        }).execute();
        remindedKeys.add(remindedKey);
        reminded.push({ userId, pinId: row.pinId });
      }
    }
    const dueAssignments = await this.spaceDb.routedKysely
      .selectFrom('assignments')
      .innerJoin('course', 'course.id', 'assignments.course')
      .leftJoin('course_modules', 'course_modules.id', 'assignments.cm_id')
      .select([
        'assignments.id as assignmentId', 'assignments.name as assignmentName',
        'assignments.due_date as dueDate', 'assignments.course as courseId',
        'course_modules.visible as cmVisible',
        'course_modules.deletion_in_progress as cmDeletionInProgress',
      ])
      .where('course.visible', '=', true)
      .where('assignments.due_date', '>', now)
      .where('assignments.due_date', '<=', windowEnd)
      .execute();
    for (const row of dueAssignments) {
      if (!row.dueDate) continue;
      if (row.cmVisible === false || row.cmDeletionInProgress === true) continue;
      const students = await studentsOf(row.courseId);
      if (students.length === 0) continue;
      const submitted = await this.submittedUserIdsForAssignment(row.assignmentId, students);
      const remindedKeys = await this.remindedKeysForAssignment(row.assignmentId);
      const dueDateIso = row.dueDate.toISOString();
      for (const userId of students) {
        if (submitted.has(userId)) continue;
        const remindedKey = `${userId}|${dueDateIso}`;
        if (remindedKeys.has(remindedKey)) continue;
        await this.spaceDb.routedKysely.insertInto('outbox_events').values({
          aggregate: 'activity', type: 'activity_due_reminder',
          tenant_id: null,
          payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify({
            userId, courseId: row.courseId, assignmentId: row.assignmentId,
            activityType: 'assign', activityName: row.assignmentName,
            timeClose: dueDateIso,
          })}::jsonb`,
        }).execute();
        remindedKeys.add(remindedKey);
        reminded.push({ userId, assignmentId: row.assignmentId });
      }
    }
    return { checkedAt: now.toISOString(), reminded };
  }

  private async enrolledStudentIds(courseId: string, now: Date): Promise<string[]> {
    const instances = await this.spaceDb.routedKysely
      .selectFrom('enrol')
      .select('id')
      .where('course_id', '=', courseId)
      .where('status', '=', 0)
      .execute();
    if (instances.length === 0) return [];
    const rows = await this.spaceDb.routedKysely
      .selectFrom('user_enrolments')
      .select('user_id as userId')
      .where('enrol_id', 'in', instances.map((i) => i.id))
      .where('status', '=', 0)
      .where('time_start', '<=', now)
      .where((eb) => eb.or([
        eb('time_end', 'is', null),
        eb('time_end', '>', now),
      ]))
      .execute();
    return [...new Set(rows.map((r) => r.userId))];
  }

  private async submittedUserIdsForPin(pinId: string, studentIds: string[]): Promise<Set<string>> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('exam_attempts')
      .select('user_id as userId')
      .where('pin_id', '=', pinId)
      .where('user_id', 'in', studentIds)
      .where('preview', '=', false)
      .where('state', 'in', SUBMITTED_ATTEMPT_STATES)
      .execute();
    return new Set(rows.map((r) => r.userId));
  }

  private async remindedKeysForPin(pinId: string): Promise<Set<string>> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('outbox_events')
      .select('payload')
      .where('type', '=', 'activity_due_reminder')
      .where(sql<boolean>`${sql.ref('outbox_events.payload')}->>'pinId' = ${pinId}`)
      .execute();
    return new Set(rows.map((r) => remindedKeyOf(r.payload)));
  }

  private async submittedUserIdsForAssignment(assignmentId: string, studentIds: string[]): Promise<Set<string>> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('assign_submissions')
      .select('user_id as userId')
      .where('assignment_id', '=', assignmentId)
      .where('user_id', 'in', studentIds)
      .where('status', '=', 'submitted')
      .execute();
    return new Set(rows.map((r) => r.userId));
  }

  private async remindedKeysForAssignment(assignmentId: string): Promise<Set<string>> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('outbox_events')
      .select('payload')
      .where('type', '=', 'activity_due_reminder')
      .where(sql<boolean>`${sql.ref('outbox_events.payload')}->>'assignmentId' = ${assignmentId}`)
      .execute();
    return new Set(rows.map((r) => remindedKeyOf(r.payload)));
  }
}

function remindedKeyOf(payload: unknown): string {
  const p = (payload ?? {}) as { userId?: unknown; timeClose?: unknown };
  return `${typeof p.userId === 'string' ? p.userId : ''}|${typeof p.timeClose === 'string' ? p.timeClose : ''}`;
}
