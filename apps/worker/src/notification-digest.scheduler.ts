import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

@Injectable()
export class NotificationDigestScheduler implements OnModuleInit {
  private readonly logger = new Logger(NotificationDigestScheduler.name);
  constructor(@InjectQueue('notification-digests') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'notification-digest-scheduler',
      { pattern: '15 7 * * *', tz: 'Asia/Ho_Chi_Minh' },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true } },
    ).catch((err: Error) => this.logger.warn(`Could not register notification-digest scheduler: ${err.message}`));
  }
}
