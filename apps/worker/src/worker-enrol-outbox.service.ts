import { Injectable } from '@nestjs/common';
import {
  type SharedOutboxEventInput,
  type SharedOutboxPort,
} from '@giaokhoa/enrol';
import { sql, type CentreDB, type CentreTx } from '@giaokhoa/db';
import { SpaceDatabaseService } from './db/routing/space-database.service';

@Injectable()
export class WorkerEnrolOutboxService implements SharedOutboxPort {
  constructor(private readonly spaceDb: SpaceDatabaseService) {}

  async enqueue(tx: CentreTx, input: SharedOutboxEventInput): Promise<void> {
    const tenantId = input.tenantId ?? null;
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
