import { validateWorkerJobPayload, workerPayloadSchemas } from './job-payload-validation';
import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import { Inject, Logger } from '@nestjs/common';
import { DelayedError, type Job } from 'bullmq';
import type Redis from 'ioredis';
import type { MessagingDistributionService } from '@giaokhoa/messaging';
import { SpaceJobRunner } from '../db/routing/space-job-runner';
import { scopedOutboxId } from '../db/routing/outbox-redis-scope';
import type { OutboxEventJobData } from '../outbox-event-routes';

export const MESSAGING_REALTIME_QUEUE = 'messaging-realtime';

export const MESSAGING_DISTRIBUTION_SERVICE = 'MESSAGING_DISTRIBUTION_SERVICE';

export const MESSAGING_DISTRIBUTED_REDIS = 'MESSAGING_DISTRIBUTED_REDIS';

export const MESSAGING_DISTRIBUTED_KEY_PREFIX = 'giaokhoa:messaging:distributed:';

const DISTRIBUTED_MARK_TTL_SECONDS = 7 * 24 * 60 * 60;

const DISTRIBUTION_RETRY_DELAY_MS = 5_000;

@Processor(MESSAGING_REALTIME_QUEUE)
export class MessagingRealtimeProcessor extends ObservedWorkerHost {
  private readonly logger = new Logger(MessagingRealtimeProcessor.name);

  constructor(
    @Inject(MESSAGING_DISTRIBUTION_SERVICE) private readonly distribution: MessagingDistributionService,
    @Inject(MESSAGING_DISTRIBUTED_REDIS) private readonly redis: Redis,
    private readonly jobRunner: SpaceJobRunner,
  ) {
    super();
  }

  async process(job: Job<OutboxEventJobData>, token?: string): Promise<void> {
    const data = job.data;
    if (!data || typeof data.outboxId !== 'string' || data.outboxId.length === 0 || typeof data.type !== 'string') {
      throw new Error('Messaging realtime job is missing its outboxId or event type');
    }
    validateWorkerJobPayload(workerPayloadSchemas['outbox-event'], job.data, 'messaging-realtime');
    await this.jobRunner.runForJob(data, async () => {
      const markKey = `${MESSAGING_DISTRIBUTED_KEY_PREFIX}${scopedOutboxId(data.outboxId)}`;
      try {
        if ((await this.redis.exists(markKey)) === 1) {
          this.logger.debug(`Bỏ qua job phát lại của sự kiện outbox ${data.outboxId} (đã phân phối)`);
          return;
        }
        await this.distribution.distributeEvent(data.type, data.payload ?? {});
        await this.redis.set(markKey, '1', 'EX', DISTRIBUTED_MARK_TTL_SECONDS);
      } catch (error) {
        this.logger.error(
          `Phân phối sự kiện outbox ${data.outboxId} (loại ${data.type}) lỗi, hẹn thử lại sau ${DISTRIBUTION_RETRY_DELAY_MS}ms: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (token) {
          await job.moveToDelayed(Date.now() + DISTRIBUTION_RETRY_DELAY_MS, token);
        }
        throw new DelayedError();
      }
    });
  }
}
