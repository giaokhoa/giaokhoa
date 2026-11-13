import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

@Injectable()
export class ActivityDueReminderScheduler implements OnModuleInit {
  private readonly logger = new Logger(ActivityDueReminderScheduler.name);
  constructor(@InjectQueue('activity-due-reminders') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'activity-due-reminder-scheduler',
      { every: 5 * 60 * 1000 },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true } },
    ).catch((err: Error) => this.logger.warn(`Could not register activity-due-reminder scheduler: ${err.message}`));
  }
}
