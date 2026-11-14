import { describe, expect, it, vi } from 'vitest';
import { CohortSyncCatchupService } from './cohort-sync-catchup.service';
import { NotificationEventsCatchupService } from './notification-events-catchup.service';

const redisMock = vi.hoisted(() => ({
  get: vi.fn(async (): Promise<string | null> => null),
  del: vi.fn(async (): Promise<number> => 1),
  quit: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock('ioredis', () => ({
  default: class MockRedis {
    get = redisMock.get;
    del = redisMock.del;
    quit = redisMock.quit;
  },
}));

type CatchupConstructor = new (
  spaceDb: never,
  queue: never,
  config: never,
) => { drainLegacyBacklog(): Promise<number> };

type Row = {
  id: string;
  seq: number;
  aggregate: string;
  type: string;
  payload: Record<string, unknown> | null;
  tenantId: string | null;
  occurredAt: Date;
};

function makeSpaceDb(maxSeq: number, rows: Row[]) {
  return {
    routedKysely: {
      selectFrom: () => {
        let isMaxQuery = false;
        let seqCursor: number | null = null;
        let allowedTypes: readonly string[] | null = null;
        const builder = {
          select: (arg: unknown) => {
            isMaxQuery = typeof arg === 'function';
            return builder;
          },
          where: (column: string, op: string, value: unknown) => {
            if (column === 'seq' && op === '>') seqCursor = Number(value);
            if (column === 'type' && op === 'in') allowedTypes = value as string[];
            return builder;
          },
          orderBy: () => builder,
          limit: () => builder,
          executeTakeFirst: async () => ({ value: maxSeq }),
          execute: async () =>
            isMaxQuery
              ? []
              : rows.filter(
                  (row) =>
                    (seqCursor === null || row.seq > seqCursor) &&
                    (allowedTypes === null || allowedTypes.includes(row.type)),
                ),
        };
        return builder;
      },
    },
  };
}

function makeCatchup(
  ServiceClass: CatchupConstructor,
  scenario: { watermark: string | null; maxSeq: number; rows: Row[] },
) {
  const queueAdd = vi.fn(async () => ({}));
  redisMock.get.mockClear();
  redisMock.del.mockClear();
  redisMock.get.mockResolvedValue(scenario.watermark);
  const config = {
    getOrThrow: (key: string) =>
      key === 'REDIS_URL' ? 'redis://localhost:6379' : 'postgres://localhost:5432/giaokhoa_test_worker',
  };
  const service = new ServiceClass(
    makeSpaceDb(scenario.maxSeq, scenario.rows) as never,
    { add: queueAdd } as never,
    config as never,
  );
  return { service, queueAdd, redisGet: redisMock.get, redisDel: redisMock.del };
}

function makeRow(partial: Partial<Row>): Row {
  return {
    id: '0191e8f2-7c3a-7b21-9f00-000000000001',
    seq: 6,
    aggregate: 'messaging',
    type: 'grade_updated',
    payload: { userId: 'user-1' },
    tenantId: 'tenant-1',
    occurredAt: new Date('2026-11-14T03:00:00.000Z'),
    ...partial,
  };
}

describe('NotificationEventsCatchupService — phát bù tồn đọng theo watermark cũ', () => {
  it('chỉ dòng trên watermark cũ và đúng loại sự kiện được xếp job mang tuỳ chọn removeOnFail true và khoá watermark cũ bị xoá sau khi rút cạn', async () => {
    const row = makeRow({});
    const { service, queueAdd, redisDel } = makeCatchup(NotificationEventsCatchupService, {
      watermark: '5',
      maxSeq: 6,
      rows: [row, makeRow({ seq: 5 }), makeRow({ type: 'course_created' })],
    });

    const enqueued = await service.drainLegacyBacklog();

    expect(enqueued).toBe(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [jobName, , jobOptions] = queueAdd.mock.calls[0]! as unknown as [string, unknown, Record<string, unknown>];
    expect(jobName).toBe('grade_updated');
    expect(jobOptions).toEqual({ jobId: `shared-${row.id}`, removeOnFail: true });
    expect(redisDel).toHaveBeenCalledTimes(1);
  });

  it('không có watermark cũ thì không xếp job nào và không xoá khoá watermark', async () => {
    const { service, queueAdd, redisDel } = makeCatchup(NotificationEventsCatchupService, {
      watermark: null,
      maxSeq: 6,
      rows: [makeRow({})],
    });

    const enqueued = await service.drainLegacyBacklog();

    expect(enqueued).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(redisDel).not.toHaveBeenCalled();
  });

  it('watermark cũ đã bằng seq lớn nhất trong DB thì không xếp job nào nhưng vẫn xoá khoá watermark', async () => {
    const { service, queueAdd, redisDel } = makeCatchup(NotificationEventsCatchupService, {
      watermark: '6',
      maxSeq: 6,
      rows: [makeRow({})],
    });

    const enqueued = await service.drainLegacyBacklog();

    expect(enqueued).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(redisDel).toHaveBeenCalledTimes(1);
  });

  it('watermark cũ không phải số thì không xếp job nào và giữ nguyên khoá watermark', async () => {
    const { service, queueAdd, redisDel } = makeCatchup(NotificationEventsCatchupService, {
      watermark: 'khong-phai-so',
      maxSeq: 6,
      rows: [makeRow({})],
    });

    const enqueued = await service.drainLegacyBacklog();

    expect(enqueued).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(redisDel).not.toHaveBeenCalled();
  });
});

describe('CohortSyncCatchupService — phát bù tồn đọng theo watermark cũ', () => {
  it('chỉ dòng trên watermark cũ và đúng loại sự kiện được xếp job mang tuỳ chọn removeOnFail true và khoá watermark cũ bị xoá sau khi rút cạn', async () => {
    const row = makeRow({ aggregate: 'cohort', type: 'cohort_member_added' });
    const { service, queueAdd, redisDel } = makeCatchup(CohortSyncCatchupService, {
      watermark: '5',
      maxSeq: 6,
      rows: [
        row,
        makeRow({ aggregate: 'cohort', type: 'cohort_member_added', seq: 5 }),
        makeRow({ aggregate: 'cohort', type: 'grade_updated' }),
      ],
    });

    const enqueued = await service.drainLegacyBacklog();

    expect(enqueued).toBe(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [jobName, , jobOptions] = queueAdd.mock.calls[0]! as unknown as [string, unknown, Record<string, unknown>];
    expect(jobName).toBe('cohort_member_added');
    expect(jobOptions).toEqual({ jobId: `shared-${row.id}`, removeOnFail: true });
    expect(redisDel).toHaveBeenCalledTimes(1);
  });

  it('không có watermark cũ thì không xếp job nào và không xoá khoá watermark', async () => {
    const { service, queueAdd, redisDel } = makeCatchup(CohortSyncCatchupService, {
      watermark: null,
      maxSeq: 6,
      rows: [makeRow({ aggregate: 'cohort', type: 'cohort_member_added' })],
    });

    const enqueued = await service.drainLegacyBacklog();

    expect(enqueued).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(redisDel).not.toHaveBeenCalled();
  });

  it('watermark cũ đã bằng seq lớn nhất trong DB thì không xếp job nào nhưng vẫn xoá khoá watermark', async () => {
    const { service, queueAdd, redisDel } = makeCatchup(CohortSyncCatchupService, {
      watermark: '6',
      maxSeq: 6,
      rows: [makeRow({ aggregate: 'cohort', type: 'cohort_member_added' })],
    });

    const enqueued = await service.drainLegacyBacklog();

    expect(enqueued).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(redisDel).toHaveBeenCalledTimes(1);
  });

  it('watermark cũ không phải số thì không xếp job nào và giữ nguyên khoá watermark', async () => {
    const { service, queueAdd, redisDel } = makeCatchup(CohortSyncCatchupService, {
      watermark: 'khong-phai-so',
      maxSeq: 6,
      rows: [makeRow({ aggregate: 'cohort', type: 'cohort_member_added' })],
    });

    const enqueued = await service.drainLegacyBacklog();

    expect(enqueued).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(redisDel).not.toHaveBeenCalled();
  });
});
