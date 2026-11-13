import { validateWorkerJobPayload, workerPayloadSchemas } from './job-payload-validation';
import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SpaceJobRunner } from '../db/routing/space-job-runner';
import { CohortSyncService } from '../cohort-sync.service';
import type { OutboxEventJobData } from '../outbox-event-routes';

export const COHORT_SYNC_EVENT_TYPES = ['cohort_member_added', 'cohort_member_removed'] as const;

function isCohortMemberPayload(payload: unknown): payload is { cohortId: string; userId: string } {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.cohortId === 'string' && p.cohortId.length > 0
    && typeof p.userId === 'string' && p.userId.length > 0;
}

@Processor('cohort-sync-events')
export class CohortSyncEventsProcessor extends ObservedWorkerHost {
  private readonly logger = new Logger(CohortSyncEventsProcessor.name);

  constructor(
    private readonly cohortSync: CohortSyncService,
    private readonly jobRunner: SpaceJobRunner,
  ) {
    super();
  }

  async process(job: Job<OutboxEventJobData>): Promise<{ handled: boolean }> {
    validateWorkerJobPayload(workerPayloadSchemas['outbox-event'], job.data, 'cohort-sync-events');
    return this.jobRunner.runForJob(job.data, async () => {
      const { type, payload } = job.data;
      if (type === 'cohort_member_added' || type === 'cohort_member_removed') {
        if (!isCohortMemberPayload(payload)) {
          this.logger.warn(`Bỏ qua sự kiện cohort ${type}: payload thiếu cohortId/userId dạng chuỗi.`);
          return { handled: false };
        }
        if (type === 'cohort_member_added') {
          await this.cohortSync.materializeMemberAdded(payload);
        } else {
          await this.cohortSync.materializeMemberRemoved(payload);
        }
        return { handled: true };
      }
      return { handled: false };
    });
  }
}
