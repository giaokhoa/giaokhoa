import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { RetryingSchedulerRegistration } from './retrying-scheduler-registration';

@Injectable()
export class NotificationDigestScheduler implements OnModuleInit, OnModuleDestroy {
  private registration: RetryingSchedulerRegistration | null = null;
  private readonly logger = new Logger(NotificationDigestScheduler.name);
  constructor(@InjectQueue('notification-digests') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    this.registration = new RetryingSchedulerRegistration(
      () => this.queue.upsertJobScheduler(
      'notification-digest-scheduler',
      { pattern: '15 7 * * *', tz: 'Asia/Ho_Chi_Minh' },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true } },
    ),
      this.logger,
      'notification-digest',
    );
    await this.registration.start();
  }
  onModuleDestroy(): void {
    this.registration?.stop();
  }

}
