import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

@Injectable()
export class ClassEnrolReconcileScheduler implements OnModuleInit {
  private readonly logger = new Logger(ClassEnrolReconcileScheduler.name);
  constructor(@InjectQueue('class-enrol-reconcile') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'class-enrol-reconcile-scheduler',
      { every: 15 * 60 * 1000 },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true } },
    ).catch((err: Error) => this.logger.warn(`Could not register class-enrol-reconcile scheduler: ${err.message}`));
  }
}
