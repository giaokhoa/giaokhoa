import { validateWorkerJobPayload, workerPayloadSchemas } from './job-payload-validation';
import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import { DelayedError, type Job } from 'bullmq';
import { SpaceJobRunner } from '../db/routing/space-job-runner';
import type { OutboxEventJobData } from '../outbox-event-routes';
import { NotificationEventsMarker } from '../notification-events-marker.service';
import {
  NOTIFICATION_EVENT_TYPES,
  NotificationEventsHandlerService,
} from '../notification-events-handler.service';

const PROCESSING_LEASE_RETRY_DELAY_MS = 5_000;

@Processor('notification-events')
export class NotificationEventsProcessor extends ObservedWorkerHost {
  constructor(
    private readonly handler: NotificationEventsHandlerService,
    private readonly marker: NotificationEventsMarker,
    private readonly jobRunner: SpaceJobRunner,
  ) {
    super();
  }

  async process(
    job: Job<OutboxEventJobData>,
    token?: string,
  ): Promise<{ handled: boolean; duplicate?: boolean }> {
    validateWorkerJobPayload(workerPayloadSchemas['outbox-event'], job.data, 'notification-events');
    return this.jobRunner.runForJob(job.data, async () => {
      const { outboxId, type, payload } = job.data;
      if (!(NOTIFICATION_EVENT_TYPES as readonly string[]).includes(type)) {
        return { handled: false };
      }

      if (await this.marker.hasProcessed(outboxId)) {
        return { handled: true, duplicate: true };
      }

      const leaseToken = await this.marker.claimProcessing(outboxId);
      if (leaseToken === null) {
        await job.moveToDelayed(Date.now() + PROCESSING_LEASE_RETRY_DELAY_MS, token);
        throw new DelayedError();
      }

      try {
        if (await this.marker.hasProcessed(outboxId)) {
          await this.marker.releaseProcessing(outboxId, leaseToken);
          return { handled: true, duplicate: true };
        }

        await this.handler.handle(type, payload ?? {});
        await this.marker.markProcessed(outboxId);
        await this.marker.releaseProcessing(outboxId, leaseToken);
        return { handled: true };
      } catch (error) {
        await this.marker.releaseProcessing(outboxId, leaseToken).catch(() => undefined);
        throw error;
      }
    });
  }
}
