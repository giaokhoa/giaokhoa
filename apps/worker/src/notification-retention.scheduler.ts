import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { RetryingSchedulerRegistration } from './retrying-scheduler-registration';

/** Đăng ký lượt quét retention thông báo lặp lại (mỗi 24 giờ, BullMQ job scheduler). Bản thân job có tính idempotent. */
@Injectable()
/**
 * Lập lịch quét retention thông báo theo chu kỳ (đưa job notification-retention vào queue).
 */
export class NotificationRetentionScheduler implements OnModuleInit, OnModuleDestroy {
  private registration: RetryingSchedulerRegistration | null = null;
  private readonly logger = new Logger(NotificationRetentionScheduler.name);
  constructor(@InjectQueue('notification-retention') private readonly queue: Queue) {}

  /**
   * Khởi tạo: đăng ký job lặp cho queue retention thông báo.
   */
  async onModuleInit(): Promise<void> {
    this.registration = new RetryingSchedulerRegistration(
      () => this.queue.upsertJobScheduler(
      'notification-retention-scheduler',
      { every: 24 * 3600 * 1000 },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true } },
    ),
      this.logger,
      'notification-retention',
    );
    await this.registration.start();
  }
  onModuleDestroy(): void {
    this.registration?.stop();
  }

}
