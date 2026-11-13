import { validateWorkerJobPayload, workerPayloadSchemas } from './job-payload-validation';
import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SpaceJobRunner } from '../db/routing/space-job-runner';
import type { OutboxEventJobData } from '../outbox-event-routes';
import {
  GuardianDigestHandlerService,
  type GuardianDigestDuePayload,
  type GuardianOverdueAlertPayload,
} from '../guardian-digest-handler.service';

function isDigestDuePayload(payload: unknown): payload is GuardianDigestDuePayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.guardianUserId === 'string'
    && typeof p.studentUserId === 'string'
    && typeof p.digestId === 'string'
    && typeof p.windowStart === 'string'
    && typeof p.windowEnd === 'string'
    && (p.kind === 'weekly' || p.kind === 'daily');
}

function isOverdueAlertPayload(payload: unknown): payload is GuardianOverdueAlertPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.guardianUserId === 'string'
    && typeof p.studentUserId === 'string'
    && typeof p.digestId === 'string'
    && typeof p.cmId === 'string';
}

@Processor('guardian-digest-events')
export class GuardianDigestEventsProcessor extends ObservedWorkerHost {
  private readonly logger = new Logger(GuardianDigestEventsProcessor.name);

  constructor(
    private readonly handler: GuardianDigestHandlerService,
    private readonly jobRunner: SpaceJobRunner,
  ) {
    super();
  }

  async process(job: Job<OutboxEventJobData>): Promise<{ handled: boolean }> {
    validateWorkerJobPayload(workerPayloadSchemas['outbox-event'], job.data, 'guardian-digest-events');
    return this.jobRunner.runForJob(job.data, async () => {
      const { type, payload } = job.data;
      try {
        if (type === 'guardian_digest_due') {
          if (!isDigestDuePayload(payload)) return { handled: false };
          await this.handler.processDigestDue(payload);
          return { handled: true };
        }
        if (type === 'guardian_overdue_alert') {
          if (!isOverdueAlertPayload(payload)) return { handled: false };
          await this.handler.processOverdueAlert(payload);
          return { handled: true };
        }
        return { handled: false };
      } catch (error) {
        this.logger.warn(`Xử lý sự kiện digest ${type} lỗi: ${(error as Error).message}`);
        return { handled: false };
      }
    });
  }
}
