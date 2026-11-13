import { Injectable } from '@nestjs/common';
import { sql, type CentreDb, type CentreDB, type CentreTx } from '@giaokhoa/db';
import { tenantAls } from '../../db/tenant-als';

export interface OutboxEventInput {
  aggregate: string;
  type: string;
  payload: Record<string, unknown>;
  tenantId?: string | null;
}

@Injectable()
export class OutboxService {
  constructor(
    private readonly db: CentreDb,
    private readonly resolveStandaloneDb?: () => Promise<CentreDb>,
  ) {}

  private resolveTenantPayload(input: OutboxEventInput): { tenantId: string | null; payload: Record<string, unknown> } {
    const tenantId = input.tenantId ?? tenantAls.getStore()?.tenantId ?? null;
    const payload = tenantId && input.payload['tenantId'] === undefined
      ? { ...input.payload, tenantId }
      : input.payload;
    return { tenantId, payload };
  }

  async enqueueKysely(tx: CentreTx, input: OutboxEventInput): Promise<void> {
    const { tenantId, payload } = this.resolveTenantPayload(input);
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

  async enqueueStandalone(input: OutboxEventInput): Promise<void> {
    const db = this.resolveStandaloneDb ? await this.resolveStandaloneDb() : this.db;
    await db.transaction().execute(async (tx) => {
      await this.enqueueKysely(tx, input);
    });
  }
}
