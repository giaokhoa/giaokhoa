import { Injectable } from '@nestjs/common';
import {
  CohortMaterializationSurface,
  type SharedOutboxEventInput,
  type SharedOutboxPort,
} from '@giaokhoa/enrol';
import { sql, type CentreDB, type CentreTx } from '@giaokhoa/db';
import { tenantAls } from './db/tenant-als';
import { SpaceDatabaseService } from './db/routing/space-database.service';

class WorkerOutboxPort implements SharedOutboxPort {
  constructor(private readonly spaceDb: SpaceDatabaseService) {}

  async enqueue(tx: CentreTx, input: SharedOutboxEventInput): Promise<void> {
    const tenantId = input.tenantId ?? tenantAls.getStore()?.tenantId ?? null;
    const payload = tenantId && input.payload['tenantId'] === undefined
      ? { ...input.payload, tenantId }
      : input.payload;
    await tx
      .insertInto('outbox_events')
      .values({
        aggregate: input.aggregate,
        type: input.type,
        payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify(payload)}::jsonb`,
        tenant_id: tenantId,
      })
      .execute();
  }

  async enqueueStandalone(input: SharedOutboxEventInput): Promise<void> {
    await this.spaceDb.routedKysely.transaction().execute((trx) => this.enqueue(trx, input));
  }
}

@Injectable()
export class CohortSyncService {
  private readonly materialization: CohortMaterializationSurface;

  constructor(spaceDb: SpaceDatabaseService) {
    this.materialization = new CohortMaterializationSurface({
      db: spaceDb.routedKysely,
      outbox: new WorkerOutboxPort(spaceDb),
      runInPlatformScope: (fn) =>
        tenantAls.run({ platform: true, spaceSlug: tenantAls.getStore()?.spaceSlug, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle }, fn),
    });
  }

  async materializeMemberAdded(payload: { cohortId: string; userId: string }): Promise<void> {
    await this.materialization.materializeCohortMemberAdded(payload);
  }

  async materializeMemberRemoved(payload: { cohortId: string; userId: string }): Promise<void> {
    await this.materialization.materializeCohortMemberRemoved(payload);
  }
}
