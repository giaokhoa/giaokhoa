import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { RetryingSchedulerRegistration } from './retrying-scheduler-registration';

/** Đăng ký lượt quét nhắc sắp đến hạn nộp lặp lại (mỗi 5 phút, BullMQ job scheduler). Bản thân job có tính idempotent (dedupe tại phía phát trên outbox). */
@Injectable()
/**
 * Lập lịch quét nhắc hạn nộp theo chu kỳ (đưa job activity-due-reminders vào queue).
 */
export class ActivityDueReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private registration: RetryingSchedulerRegistration | null = null;
  private readonly logger = new Logger(ActivityDueReminderScheduler.name);
  constructor(@InjectQueue('activity-due-reminders') private readonly queue: Queue) {}

  /**
   * Khởi tạo: đăng ký job lặp cho queue nhắc hạn nộp.
   */
  async onModuleInit(): Promise<void> {
    this.registration = new RetryingSchedulerRegistration(
      () => this.queue.upsertJobScheduler(
      'activity-due-reminder-scheduler',
      { every: 5 * 60 * 1000 },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true } },
    ),
      this.logger,
      'activity-due-reminder',
    );
    await this.registration.start();
  }
  onModuleDestroy(): void {
    this.registration?.stop();
  }

}
