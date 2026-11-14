import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import type { Job } from 'bullmq';
import { sql, type CentreDB } from '@giaokhoa/db';
import { SpaceDatabaseService } from '../db/routing/space-database.service';
import { TaskLogService } from '../task-log.service';
import { tenantAls } from '../db/tenant-als';

export interface EnrolExpiryResult { checkedAt: string; suspendedIds: string[]; warnedIds: string[] }

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

export const ENROL_EXPIRY_WARNING_WINDOW_DAYS = 7;

@Processor('enrol-expiry')



export class EnrolExpiryProcessor extends ObservedWorkerHost {
  constructor(private readonly spaceDb: SpaceDatabaseService, private readonly taskLog: TaskLogService) { super(); }

  async process(_job: Job): Promise<EnrolExpiryResult> {
    return tenantAls.run({ platform: true }, () => this.processInContext(_job));
  }

  private async processInContext(_job: Job): Promise<EnrolExpiryResult> {
    void _job;
    return this.spaceDb.sweepSharedAndDedicated(() =>
      this.taskLog.run('enrol-expiry', () => this.sweep(),
        (r) => `suspended ${r.suspendedIds.length} enrolment(s), warned ${r.warnedIds.length}`), (a, b) => ({
          checkedAt: a.checkedAt,
          suspendedIds: [...a.suspendedIds, ...b.suspendedIds],
          warnedIds: [...a.warnedIds, ...b.warnedIds],
        }));
  }

  private async tenantIdOfCourse(courseId: string): Promise<string | null> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('course')
      .select('tenant_id as tenantId')
      .where('id', '=', courseId)
      .executeTakeFirst();
    return row?.tenantId ?? null;
  }

  private async tenantIdOfEnrol(enrolId: string): Promise<string | null> {
    const instance = await this.spaceDb.routedKysely
      .selectFrom('enrol')
      .select('course_id as courseId')
      .where('id', '=', enrolId)
      .executeTakeFirst();
    if (!instance) return null;
    return this.tenantIdOfCourse(instance.courseId);
  }

  private async sweep(): Promise<EnrolExpiryResult> {
    const now = new Date();
    const expired = await this.spaceDb.routedKysely
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('status', '=', 0)
      .where('time_end', '<', now)
      .execute();
    const suspendedIds: string[] = [];
    for (const ue of expired) {
      const tenantId = await this.tenantIdOfEnrol(ue.enrolId);
      await this.spaceDb.routedKysely.transaction().execute(async (tx) => {
        await tx.updateTable('user_enrolments')
          .set({ status: 1, updated_at: now })
          .where('id', '=', ue.id)
          .execute();
        await tx.insertInto('outbox_events')
          .values({
            aggregate: 'enrol', type: 'user_enrolment_suspended', tenant_id: tenantId,
            payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify({
              userId: ue.userId, enrolmentId: ue.id, enrolId: ue.enrolId, reason: 'expired', tenantId,
            })}::jsonb`,
          })
          .execute();
      });
      suspendedIds.push(ue.id);
    }
    const warnedIds = await this.warnExpiring(now);
    return { checkedAt: now.toISOString(), suspendedIds, warnedIds };
  }

  private async warnExpiring(now: Date): Promise<string[]> {
    const windowEnd = new Date(now.getTime() + ENROL_EXPIRY_WARNING_WINDOW_DAYS * 24 * 3600_000);
    const expiring = await this.spaceDb.routedKysely
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where('status', '=', 0)
      .where('time_end', '>', now)
      .where('time_end', '<=', windowEnd)
      .execute();
    const warnedIds: string[] = [];
    for (const ue of expiring) {
      if (!ue.timeEnd) continue;
      const already = await this.spaceDb.routedKysely
        .selectFrom('outbox_events')
        .select('id')
        .where('type', '=', 'enrol_expiry_warning')
        .where(sql<boolean>`payload ->> 'enrolmentId' = ${ue.id}`)
        .limit(1)
        .executeTakeFirst();
      if (already) continue;
      const instance = await this.spaceDb.routedKysely
        .selectFrom('enrol')
        .select('course_id as courseId')
        .where('id', '=', ue.enrolId)
        .executeTakeFirst();
      if (!instance) continue;
      const tenantId = await this.tenantIdOfCourse(instance.courseId);
      await this.spaceDb.routedKysely
        .insertInto('outbox_events')
        .values({
          aggregate: 'enrol', type: 'enrol_expiry_warning', tenant_id: tenantId,
          payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify({
            userId: ue.userId, enrolmentId: ue.id, enrolId: ue.enrolId, tenantId,
            courseId: instance.courseId, timeEnd: ue.timeEnd.toISOString(),
          })}::jsonb`,
        })
        .execute();
      warnedIds.push(ue.id);
    }
    return warnedIds;
  }
}
