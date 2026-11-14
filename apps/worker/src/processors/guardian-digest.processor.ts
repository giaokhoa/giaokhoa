import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import type { Job } from 'bullmq';
import { sql, type CentreDB } from '@giaokhoa/db';
import { TaskLogService } from '../task-log.service';
import { tenantAls } from '../db/tenant-als';
import { SpaceDatabaseService } from '../db/routing/space-database.service';

export interface GuardianDigestQueuedItem {
  guardianUserId: string;
  studentUserId: string;
  kind: 'weekly' | 'daily' | 'overdue_alert';
  dedupeKey: string;
}
export interface GuardianDigestSweepResult {
  checkedAt: string;
  queued: GuardianDigestQueuedItem[];
}

export function guardianDigestFrequencyPreferenceName(studentUserId: string): string {
  return `guardian_digest_frequency:${studentUserId}`;
}

export const GUARDIAN_OVERDUE_ALERT_DAYS = 7;

const SUBMITTED_ATTEMPT_STATES = ['needsgrading', 'finished'];

type Frequency = 'weekly' | 'daily' | 'off';

interface GuardianLinkRow {
  guardianUserId: string;
  studentUserId: string;
  tenantId: string;
  createdAt: Date;
}

function dayStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function weekStartUtc(now: Date): Date {
  const start = dayStartUtc(now);
  const dow = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - ((dow + 6) % 7));
  return start;
}

@Processor('guardian-digests')



export class GuardianDigestProcessor extends ObservedWorkerHost {
  constructor(private readonly spaceDb: SpaceDatabaseService, private readonly taskLog: TaskLogService) { super(); }

  async process(_job: Job): Promise<GuardianDigestSweepResult> {
    return tenantAls.run({ platform: true }, () => this.processInContext(_job));
  }

  private async processInContext(_job: Job): Promise<GuardianDigestSweepResult> {
    void _job;
    return this.spaceDb.sweepDedicatedSpaces(() =>
      this.taskLog.run('guardian-digests', () => this.sweep(),
        (r) => `queued ${r.queued.length} guardian digest item(s)`), (a, b) => ({
          checkedAt: a.checkedAt, queued: [...a.queued, ...b.queued],
        }));
  }

  private async sweep(): Promise<GuardianDigestSweepResult> {
    const now = new Date();
    const queued: GuardianDigestQueuedItem[] = [];

    const links = await this.spaceDb.routedKysely
      .selectFrom('guardian_links')
      .select(['guardian_user_id as guardianUserId', 'student_user_id as studentUserId', 'tenant_id as tenantId', 'created_at as createdAt'])
      .where('status', '=', 'active')
      .execute();
    if (links.length === 0) return { checkedAt: now.toISOString(), queued };

    const frequencyByPair = await this.frequencyMap(links.map((l) => l.guardianUserId));

    const linksByTenant = new Map<string, typeof links>();
    for (const link of links) {
      const group = linksByTenant.get(link.tenantId) ?? [];
      group.push(link);
      linksByTenant.set(link.tenantId, group);
    }
    for (const [tenantId, tenantLinks] of linksByTenant) {
      await tenantAls.run({ ...tenantAls.getStore(), platform: false, tenantId }, async () => {
        for (const link of tenantLinks) {
          const frequency = frequencyByPair.get(`${link.guardianUserId}:${link.studentUserId}`) ?? 'weekly';
          await this.sweepLink(link, frequency, now, queued);
        }
      });
    }
    return { checkedAt: now.toISOString(), queued };
  }

  private async sweepLink(
    link: GuardianLinkRow,
    frequency: Frequency,
    now: Date,
    queued: GuardianDigestQueuedItem[],
  ): Promise<void> {
    if (frequency !== 'off') {
      const window = frequency === 'weekly'
        ? { start: new Date(weekStartUtc(now).getTime() - 7 * 24 * 3600_000), end: weekStartUtc(now) }
        : { start: new Date(dayStartUtc(now).getTime() - 24 * 3600_000), end: dayStartUtc(now) };
      if (link.createdAt < window.end) {
        const dedupeKey = `digest:${link.tenantId}:${link.guardianUserId}:${link.studentUserId}:${frequency}:${window.start.toISOString()}`;
        const digestId = await this.queueMark({
          guardianUserId: link.guardianUserId, studentUserId: link.studentUserId, kind: frequency,
          windowStart: window.start, windowEnd: window.end, activityCmId: null, dedupeKey, tenantId: link.tenantId,
        });
        if (digestId) {
          await this.spaceDb.routedKysely.insertInto('outbox_events').values({
            aggregate: 'guardian', type: 'guardian_digest_due', tenant_id: link.tenantId,
            payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify({
              guardianUserId: link.guardianUserId, studentUserId: link.studentUserId, digestId, tenantId: link.tenantId,
              kind: frequency, windowStart: window.start.toISOString(), windowEnd: window.end.toISOString(),
            })}::jsonb`,
          }).execute();
          queued.push({ guardianUserId: link.guardianUserId, studentUserId: link.studentUserId, kind: frequency, dedupeKey });
        }
      }
    }

    for (const item of await this.longOverdueItems(link.studentUserId, now)) {
      const dedupeKey = `overdue:${link.tenantId}:${link.guardianUserId}:${link.studentUserId}:${item.cmId}`;
      const digestId = await this.queueMark({
        guardianUserId: link.guardianUserId, studentUserId: link.studentUserId, kind: 'overdue_alert',
        windowStart: null, windowEnd: null, activityCmId: item.cmId, dedupeKey, tenantId: link.tenantId,
      });
      if (!digestId) continue;
      await this.spaceDb.routedKysely.insertInto('outbox_events').values({
        aggregate: 'guardian', type: 'guardian_overdue_alert', tenant_id: link.tenantId,
        payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify({
          guardianUserId: link.guardianUserId, studentUserId: link.studentUserId, digestId, tenantId: link.tenantId,
          cmId: item.cmId, activityKind: item.kind, courseId: item.courseId,
          activityName: item.name, dueAt: item.dueAt.toISOString(),
        })}::jsonb`,
      }).execute();
      queued.push({ guardianUserId: link.guardianUserId, studentUserId: link.studentUserId, kind: 'overdue_alert', dedupeKey });
    }
  }

  private async frequencyMap(guardianIds: string[]): Promise<Map<string, Frequency>> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('user_preferences')
      .select(['user_id as userId', 'name', 'value'])
      .where('user_id', 'in', [...new Set(guardianIds)])
      .where(sql<boolean>`${sql.ref('user_preferences.name')} like 'guardian_digest_frequency:%'`)
      .execute();
    const out = new Map<string, Frequency>();
    for (const row of rows) {
      const studentUserId = row.name.slice('guardian_digest_frequency:'.length);
      const value = row.value === 'daily' || row.value === 'off' ? row.value : 'weekly';
      out.set(`${row.userId}:${studentUserId}`, value);
    }
    return out;
  }

  private async queueMark(input: {
    guardianUserId: string; studentUserId: string; kind: string;
    windowStart: Date | null; windowEnd: Date | null; activityCmId: string | null; dedupeKey: string;
    tenantId: string;
  }): Promise<string | null> {
    const row = await this.spaceDb.routedKysely.insertInto('guardian_digests').values({
      guardian_user_id: input.guardianUserId, student_user_id: input.studentUserId, kind: input.kind,
      window_start: input.windowStart, window_end: input.windowEnd, activity_cm_id: input.activityCmId,
      dedupe_key: input.dedupeKey, status: 'queued', tenant_id: input.tenantId,
    }).onConflict((oc) => oc.doNothing()).returning('id').executeTakeFirst();
    return row?.id ?? null;
  }

  private async longOverdueItems(studentUserId: string, now: Date): Promise<{ cmId: string; courseId: string; kind: 'quiz' | 'assignment'; name: string; dueAt: Date }[]> {
    const courseIds = await this.enrolledCourseIds(studentUserId, now);
    if (courseIds.length === 0) return [];
    const threshold = new Date(now.getTime() - GUARDIAN_OVERDUE_ALERT_DAYS * 24 * 3600_000);
    const out: { cmId: string; courseId: string; kind: 'quiz' | 'assignment'; name: string; dueAt: Date }[] = [];

    const quizRows = await this.spaceDb.routedKysely
      .selectFrom('course_modules')
      .innerJoin('exam_pins', 'exam_pins.id', 'course_modules.instance_id')
      .innerJoin('exam_versions', 'exam_versions.id', 'exam_pins.exam_version_id')
      .select([
        'course_modules.id as cmId', 'course_modules.course as courseId', 'exam_pins.id as pinId',
        sql<string>`coalesce(${sql.ref('exam_pins.name')}, ${sql.ref('exam_versions.name')})`.as('name'),
        'exam_pins.time_close as dueAt',
      ])
      .where('course_modules.course', 'in', courseIds)
      .where('course_modules.component', '=', 'mod_quiz')
      .where('course_modules.visible', '=', true)
      .where('course_modules.deletion_in_progress', '=', false)
      .where('exam_pins.time_close', 'is not', null)
      .where('exam_pins.time_close', '<=', threshold)
      .execute();
    for (const row of quizRows) {
      if (!row.dueAt) continue;
      if (await this.hasSubmittedQuiz(row.pinId, studentUserId)) continue;
      out.push({ cmId: row.cmId, courseId: row.courseId, kind: 'quiz', name: row.name, dueAt: row.dueAt });
    }

    const assignRows = await this.spaceDb.routedKysely
      .selectFrom('course_modules')
      .innerJoin('assignments', 'assignments.id', 'course_modules.instance_id')
      .leftJoin('assign_submissions', (join) => join
        .onRef('assign_submissions.assignment_id', '=', 'assignments.id')
        .on('assign_submissions.user_id', '=', studentUserId))
      .select([
        'course_modules.id as cmId', 'course_modules.course as courseId', 'assignments.name',
        'assignments.due_date as dueAt', 'assign_submissions.status as submissionStatus',
      ])
      .where('course_modules.course', 'in', courseIds)
      .where('course_modules.component', '=', 'mod_assign')
      .where('course_modules.visible', '=', true)
      .where('course_modules.deletion_in_progress', '=', false)
      .where('assignments.due_date', 'is not', null)
      .where('assignments.due_date', '<=', threshold)
      .execute();
    for (const row of assignRows) {
      if (!row.dueAt) continue;
      if (row.submissionStatus === 'submitted') continue;
      out.push({ cmId: row.cmId, courseId: row.courseId, kind: 'assignment', name: row.name, dueAt: row.dueAt });
    }
    return out;
  }

  private async hasSubmittedQuiz(pinId: string, studentUserId: string): Promise<boolean> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('exam_attempts')
      .select('id')
      .where('pin_id', '=', pinId)
      .where('user_id', '=', studentUserId)
      .where('preview', '=', false)
      .where('state', 'in', SUBMITTED_ATTEMPT_STATES)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  private async enrolledCourseIds(studentUserId: string, now: Date): Promise<string[]> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .innerJoin('course', 'course.id', 'enrol.course_id')
      .select('enrol.course_id as courseId')
      .where('user_enrolments.user_id', '=', studentUserId)
      .where('user_enrolments.status', '=', 0)
      .where('enrol.status', '=', 0)
      .where('course.visible', '=', true)
      .where('user_enrolments.time_start', '<=', now)
      .where((eb) => eb.or([
        eb('user_enrolments.time_end', 'is', null),
        eb('user_enrolments.time_end', '>', now),
      ]))
      .execute();
    return [...new Set(rows.map((r) => r.courseId))];
  }
}
