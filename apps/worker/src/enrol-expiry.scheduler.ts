import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { RetryingSchedulerRegistration } from './retrying-scheduler-registration';

@Injectable()



export class EnrolExpiryScheduler implements OnModuleInit, OnModuleDestroy {
  private registration: RetryingSchedulerRegistration | null = null;
  private readonly logger = new Logger(EnrolExpiryScheduler.name);
  constructor(@InjectQueue('enrol-expiry') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    this.registration = new RetryingSchedulerRegistration(
      () => this.queue.upsertJobScheduler(
      'enrol-expiry-scheduler',
      { every: 5 * 60 * 1000 },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true } },
    ),
      this.logger,
      'enrol-expiry',
    );
    await this.registration.start();
  }
  onModuleDestroy(): void {
    this.registration?.stop();
  }

}
