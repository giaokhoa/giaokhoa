import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

@Injectable()
export class GuardianDigestScheduler implements OnModuleInit {
  private readonly logger = new Logger(GuardianDigestScheduler.name);
  constructor(@InjectQueue('guardian-digests') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'guardian-digest-scheduler',
      { every: 60 * 60 * 1000 },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true } },
    ).catch((err: Error) => this.logger.warn(`Could not register guardian-digest scheduler: ${err.message}`));
  }
}
