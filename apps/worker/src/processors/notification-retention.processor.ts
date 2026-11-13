import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { TaskLogService } from '../task-log.service';
import { tenantAls } from '../db/tenant-als';
import { SpaceDatabaseService } from '../db/routing/space-database.service';

export const NOTIFICATION_READ_RETENTION_DAYS = 90;
export const NOTIFICATION_UNREAD_RETENTION_DAYS = 180;
export const DISPATCH_LOG_RETENTION_DAYS = 90;

export interface NotificationRetentionResult {
  readDeleted: number;
  unreadDeleted: number;
  dispatchLogDeleted: number;
}

const DAY_MS = 24 * 3600_000;

@Processor('notification-retention')
export class NotificationRetentionProcessor extends WorkerHost {
  constructor(private readonly spaceDb: SpaceDatabaseService, private readonly taskLog: TaskLogService) { super(); }

  async process(_job: Job): Promise<NotificationRetentionResult> {
    void _job;
    return this.spaceDb.sweepSharedAndDedicated(() =>
      this.taskLog.run('notification-retention', () => this.sweepInContext(new Date()),
        (r) => `deleted ${r.readDeleted} read notification(s), ${r.unreadDeleted} unread notification(s), ${r.dispatchLogDeleted} dispatch log row(s)`), (a, b) => ({
          readDeleted: a.readDeleted + b.readDeleted,
          unreadDeleted: a.unreadDeleted + b.unreadDeleted,
          dispatchLogDeleted: a.dispatchLogDeleted + b.dispatchLogDeleted,
        }));
  }

  async sweep(now: Date): Promise<NotificationRetentionResult> {
    return tenantAls.run({ platform: true }, () => this.sweepInContext(now));
  }

  private async sweepInContext(now: Date): Promise<NotificationRetentionResult> {
    const readCutoff = new Date(now.getTime() - NOTIFICATION_READ_RETENTION_DAYS * DAY_MS);
    const unreadCutoff = new Date(now.getTime() - NOTIFICATION_UNREAD_RETENTION_DAYS * DAY_MS);
    const dispatchCutoff = new Date(now.getTime() - DISPATCH_LOG_RETENTION_DAYS * DAY_MS);

    const readDeleted = (await this.spaceDb.routedKysely
      .deleteFrom('notifications')
      .where('time_read', 'is not', null)
      .where('time_read', '<', readCutoff)
      .returning('id')
      .execute()).length;
    const unreadDeleted = (await this.spaceDb.routedKysely
      .deleteFrom('notifications')
      .where('time_read', 'is', null)
      .where('created_at', '<', unreadCutoff)
      .returning('id')
      .execute()).length;
    const dispatchLogDeleted = (await this.spaceDb.routedKysely
      .deleteFrom('notification_dispatch_log')
      .where('created_at', '<', dispatchCutoff)
      .returning('id')
      .execute()).length;

    return { readDeleted, unreadDeleted, dispatchLogDeleted };
  }
}
