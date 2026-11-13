import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { RetryingSchedulerRegistration } from './retrying-scheduler-registration';

/**
 * Lập lịch quét digest phụ huynh (PH-2, issue #159): mỗi giờ đưa một job sweep vào queue guardian-digests. Bản thân job idempotent tuyệt đối (chốt chống trùng bền ở INSERT guardian_digests phía processor) nên quét thừa vô hại; chu kỳ giờ đủ mịn cho cửa sổ ngày/tuần và mốc quá hạn 7 ngày.
 */
@Injectable()
export class GuardianDigestScheduler implements OnModuleInit, OnModuleDestroy {
  private registration: RetryingSchedulerRegistration | null = null;
  private readonly logger = new Logger(GuardianDigestScheduler.name);
  constructor(@InjectQueue('guardian-digests') private readonly queue: Queue) {}

  /**
   * Khởi tạo: đăng ký job lặp cho queue digest phụ huynh.
   */
  async onModuleInit(): Promise<void> {
    this.registration = new RetryingSchedulerRegistration(
      () => this.queue.upsertJobScheduler(
      'guardian-digest-scheduler',
      { every: 60 * 60 * 1000 },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true } },
    ),
      this.logger,
      'guardian-digest',
    );
    await this.registration.start();
  }
  onModuleDestroy(): void {
    this.registration?.stop();
  }

}
