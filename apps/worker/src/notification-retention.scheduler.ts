import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

@Injectable()
export class NotificationRetentionScheduler implements OnModuleInit {
  private readonly logger = new Logger(NotificationRetentionScheduler.name);
  constructor(@InjectQueue('notification-retention') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'notification-retention-scheduler',
      { every: 24 * 3600 * 1000 },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true } },
    ).catch((err: Error) => this.logger.warn(`Could not register notification-retention scheduler: ${err.message}`));
  }
}
