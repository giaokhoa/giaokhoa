import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCentreKysely, type CentreDb } from '@giaokhoa/db';
import { OutboxService } from './outbox.service';

describe('Outbox giao dịch (DB thật, giaokhoa_test_api)', () => {
  let pool: Pool;
  let kysely: CentreDb;
  let outbox: OutboxService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    kysely = createCentreKysely(pool);
    outbox = new OutboxService(kysely);
  });

  beforeEach(async () => {
    await kysely.deleteFrom('outbox_events').execute();
  });

  afterAll(async () => {
    await kysely.destroy();
  });

  it('ghi sự kiện vào outbox khi transaction commit (chưa phát: publishedAt null cho tới khi relay worker chạy)', async () => {
    await kysely.transaction().execute(async (tx) => {
      await outbox.enqueueKysely(tx, {
        aggregate: 'test', type: 'Test.Committed', payload: { n: 1 },
      });
    });

    const rows = await kysely.selectFrom('outbox_events').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('Test.Committed');
    expect(rows[0]?.payload).toEqual({ n: 1 });
    expect(rows[0]?.published_at).toBeNull();
  });

  it('không ghi sự kiện nào khi transaction rollback', async () => {
    await expect(
      kysely.transaction().execute(async (tx) => {
        await outbox.enqueueKysely(tx, {
          aggregate: 'test', type: 'Test.RolledBack', payload: { n: 2 },
        });
        throw new Error('business failure — roll back');
      }),
    ).rejects.toThrow('business failure');

    const rows = await kysely
      .selectFrom('outbox_events')
      .selectAll()
      .where('type', '=', 'Test.RolledBack')
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('ghi sự kiện kèm payload có mảng cấp cao nhất trong cùng transaction khi commit', async () => {
    await kysely.transaction().execute(async (tx) => {
      await outbox.enqueueKysely(tx, {
        aggregate: 'test', type: 'Test.KyselyCommitted', payload: { n: 3, tags: ['a', 'b'] },
      });
    });

    const rows = await kysely
      .selectFrom('outbox_events')
      .selectAll()
      .where('type', '=', 'Test.KyselyCommitted')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ n: 3, tags: ['a', 'b'] });
    expect(rows[0]?.published_at).toBeNull();
  });

  it('enqueueStandalone tự mở transaction Kysely riêng và dòng sự kiện tồn tại ngay sau khi hàm trả về', async () => {
    await outbox.enqueueStandalone({
      aggregate: 'test', type: 'Test.Standalone', payload: { n: 5 },
    });

    const rows = await kysely
      .selectFrom('outbox_events')
      .selectAll()
      .where('type', '=', 'Test.Standalone')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ n: 5 });
  });

  it('enqueueStandalone ghi qua handle do hàm phân giải cấp khi tầng wiring có cấp hàm phân giải', async () => {
    const deadKysely = createCentreKysely(
      new Pool({ connectionString: 'postgres://postgres:postgres@localhost:1/khong_ton_tai' }),
    );
    const resolved = new OutboxService(deadKysely, async () => kysely);
    try {
      await resolved.enqueueStandalone({
        aggregate: 'test', type: 'Test.StandaloneResolved', payload: { n: 6 },
      });
    } finally {
      await deadKysely.destroy().catch(() => undefined);
    }

    const rows = await kysely
      .selectFrom('outbox_events')
      .selectAll()
      .where('type', '=', 'Test.StandaloneResolved')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ n: 6 });
  });
});
