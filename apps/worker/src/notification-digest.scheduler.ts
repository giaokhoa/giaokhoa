import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { RetryingSchedulerRegistration } from './retrying-scheduler-registration';

/**
 * Lập lịch tổng hợp email theo ngày (NB-5, issue #174): mỗi ngày lúc 07:15 giờ Việt Nam (múi giờ chuẩn IANA `Asia/Ho_Chi_Minh`) đưa một job `sweep` vào queue `notification-digests`. Bản thân lượt quét idempotent (mục đã rời trạng thái `digest-queued` thì không được quét lại) nên đăng ký trùng hoặc quét thừa vô hại.
 */
@Injectable()
export class NotificationDigestScheduler implements OnModuleInit, OnModuleDestroy {
  private registration: RetryingSchedulerRegistration | null = null;
  private readonly logger = new Logger(NotificationDigestScheduler.name);
  constructor(@InjectQueue('notification-digests') private readonly queue: Queue) {}

  /**
   * Khởi tạo: đăng ký job lặp hằng ngày cho queue tổng hợp email.
   */
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
