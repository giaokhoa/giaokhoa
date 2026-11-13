import { Injectable } from '@nestjs/common';
import { sql, type CentreDB, type CentreDb, type CentreTx } from '@giaokhoa/db';

type CentreJson = NonNullable<CentreDB['payments']['data']>;

function jsonbValue(value: unknown) {
  return sql<CentreJson>`${JSON.stringify(value)}::jsonb`;
}

export interface OutboxEventInput {
  aggregate: string;
  type: string;
  payload: Record<string, unknown>;
  tenantId?: string | null;
}

@Injectable()
export class OutboxWriterService {
  constructor(private readonly db: CentreDb) {}

  async enqueue(tx: CentreTx, input: OutboxEventInput): Promise<void> {
    const tenantId = input.tenantId ?? null;
    const payload = tenantId && input.payload['tenantId'] === undefined
      ? { ...input.payload, tenantId }
      : input.payload;
    await tx.insertInto('outbox_events').values({
      aggregate: input.aggregate,
      type: input.type,
      payload: jsonbValue(payload),
      tenant_id: tenantId,
    }).execute();
  }

  async enqueueStandalone(input: OutboxEventInput): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await this.enqueue(tx, input);
    });
  }
}
