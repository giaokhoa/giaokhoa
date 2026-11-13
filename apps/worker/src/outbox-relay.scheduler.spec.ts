import { describe, expect, it } from 'vitest';
import { MESSAGING_DISTRIBUTED_EVENT_TYPES } from '@giaokhoa/messaging';
import type { SpaceRegistryEntry } from './db/routing/space-connection-resolver';
import { OutboxRelayScheduler } from './outbox-relay.scheduler';
import {
  OUTBOX_EVENT_QUEUE_ROUTES,
  allQueueNamesOfRoutes,
  queueNamesOfRoute,
  type OutboxEventJobData,
  type OutboxEventQueueRoutes,
} from './outbox-event-routes';


interface FakeRow {
  id: string;
  seq: number;
  aggregate: string;
  type: string;
  payload: Record<string, unknown> | null;
  tenantId: string | null;
  occurredAt: Date;
  publishedAt: Date | null;
}

let rowCounter = 0;

function makeRow(partial: Partial<FakeRow>): FakeRow {
  rowCounter += 1;
  return {
    id: `0191e8f2-7c3a-7b21-9f00-${String(rowCounter).padStart(12, '0')}`,
    seq: rowCounter,
    aggregate: 'test',
    type: 'unrouted_type',
    payload: { n: rowCounter },
    tenantId: null,
    occurredAt: new Date('2026-10-29T00:00:00.000Z'),
    publishedAt: null,
    ...partial,
  };
}

class FakeQueue {
  readonly jobs = new Map<string, { name: string; data: OutboxEventJobData }>();
  readonly stampedAtDispatch: boolean[] = [];
  failNextAdd = false;

  constructor(private readonly rows: FakeRow[]) {}

  async add(name: string, data: OutboxEventJobData, opts?: { jobId?: string }) {
    if (this.failNextAdd) {
      this.failNextAdd = false;
      throw new Error('redis unavailable');
    }
    const row = this.rows.find((r) => r.id === data.outboxId);
    this.stampedAtDispatch.push(row ? row.publishedAt !== null : true);
    const jobId = opts?.jobId ?? data.outboxId;
    const existing = this.jobs.get(jobId);
    if (existing) return existing;
    const job = { name, data };
    this.jobs.set(jobId, job);
    return job;
  }
}

function makeFakeDb(rows: FakeRow[], tenantSlugs: Record<string, string> = {}) {
  const control = { failNextStamp: false };
  const db = {
    selectFrom: (table: string) => {
      let inIds: string[] | null = null;
      let limitValue: number | undefined;
      const builder = {
        select: () => builder,
        where: (column: string, op: string, value: unknown) => {
          if (table === 'tenants' && column === 'id' && op === 'in') {
            inIds = value as string[];
          }
          return builder;
        },
        orderBy: () => builder,
        limit: (n: number) => {
          limitValue = n;
          return builder;
        },
        execute: async () => {
          if (table === 'tenants') {
            return Object.entries(tenantSlugs)
              .filter(([id]) => inIds === null || inIds.includes(id))
              .map(([id, slug]) => ({ id, slug }));
          }
          const pending = rows
            .filter((r) => r.publishedAt === null)
            .slice(0, limitValue ?? rows.length);
          return pending.map((r) => ({
            id: r.id,
            seq: r.seq,
            aggregate: r.aggregate,
            type: r.type,
            payload: r.payload,
            occurredAt: r.occurredAt,
            tenantId: r.tenantId,
          }));
        },
      };
      return builder;
    },
    updateTable: () => {
      let targetId: string | null = null;
      let stamp: Date | null = null;
      const builder = {
        set: (values: { published_at: Date }) => {
          stamp = values.published_at;
          return builder;
        },
        where: (_column: string, _op: string, value: unknown) => {
          targetId = value as string;
          return builder;
        },
        execute: async () => {
          if (control.failNextStamp) {
            control.failNextStamp = false;
            throw new Error('database write failed');
          }
          const row = rows.find((r) => r.id === targetId);
          if (row && stamp) row.publishedAt = stamp;
        },
      };
      return builder;
    },
  };
  return { db, control };
}

interface Harness {
  relay: OutboxRelayScheduler;
  queues: Map<string, FakeQueue>;
  mirrored: Array<Record<string, unknown>>;
  taskRuns: Array<{ status: string }>;
}

function makeFakeSpaceDb(
  spaces: SpaceRegistryEntry[],
  centreDbs: Map<string, unknown>,
  failingSlugs: ReadonlySet<string> = new Set(),
) {
  return {
    listRegisteredSpaces: async () => spaces,
    withSpaceKysely: async (slug: string, fn: (db: unknown) => Promise<unknown>) => {
      if (failingSlugs.has(slug)) throw new Error(`kho của ${slug} không mở được`);
      const db = centreDbs.get(slug);
      if (!db) throw new Error(`không có DB giả cho ${slug}`);
      return fn(db);
    },
  };
}

const NO_SPACES = makeFakeSpaceDb([], new Map());

function makeRelay(
  rows: FakeRow[],
  routes: OutboxEventQueueRoutes,
  options?: { tenantSlugs?: Record<string, string>; spaceDb?: unknown },
): Harness {
  const queues = new Map<string, FakeQueue>();
  for (const queueName of allQueueNamesOfRoutes(routes)) {
    queues.set(queueName, new FakeQueue(rows));
  }
  const { db } = makeFakeDb(rows, options?.tenantSlugs ?? {});
  const mirrored: Array<Record<string, unknown>> = [];
  const eventLog = {
    record: async (row: Record<string, unknown>) => {
      mirrored.push(row);
    },
  };
  const taskRuns: Array<{ status: string }> = [];
  const taskLog = {
    recordRun: async (_task: string, _startedAt: Date, status: string) => {
      taskRuns.push({ status });
    },
  };
  const relay = new OutboxRelayScheduler(
    eventLog as never,
    taskLog as never,
    routes,
    queues as never,
    { routedKysely: db, ...(options?.spaceDb ?? NO_SPACES) } as never,
    { get: () => undefined } as never,
  );
  return { relay, queues, mirrored, taskRuns };
}

const ROUTES: OutboxEventQueueRoutes = {
  auth_mail_requested: ['outbox-auth-mail'],
  message_sent: ['outbox-messaging'],
};

describe('Relay outbox duy nhất — ngữ nghĩa đóng dấu publishedAt', () => {
  it('chỉ đóng dấu publishedAt sau khi job đã được đẩy vào hàng đợi thành công', async () => {
    const row = makeRow({ aggregate: 'auth', type: 'auth_mail_requested', tenantId: 'tenant-1' });
    const { relay, queues } = makeRelay([row], ROUTES, { tenantSlugs: { 'tenant-1': 'trung-tam-a' } });
    const queue = queues.get('outbox-auth-mail')!;

    const published = await relay.publishPending();

    expect(published).toBe(1);
    expect(queue.stampedAtDispatch).toEqual([false]);
    expect(row.publishedAt).not.toBeNull();
    const job = queue.jobs.get(`shared-${row.id}`);
    expect(job?.name).toBe('auth_mail_requested');
    expect(job?.data).toEqual({
      outboxId: row.id,
      seq: row.seq,
      aggregate: 'auth',
      type: 'auth_mail_requested',
      payload: { n: row.seq },
      tenantId: 'tenant-1',
      spaceSlug: null,
      spaceId: null,
      occurredAt: '2026-10-29T00:00:00.000Z',
    });
  });

  it('không đóng dấu khi đẩy job thất bại và phát lại thành công ở lượt relay sau', async () => {
    const row = makeRow({ aggregate: 'auth', type: 'auth_mail_requested' });
    const { relay, queues, mirrored } = makeRelay([row], ROUTES);
    const queue = queues.get('outbox-auth-mail')!;
    queue.failNextAdd = true;

    await expect(relay.publishPending()).rejects.toThrow('redis unavailable');
    expect(row.publishedAt).toBeNull();
    expect(queue.jobs.size).toBe(0);
    expect(mirrored).toHaveLength(0);

    const published = await relay.publishPending();
    expect(published).toBe(1);
    expect(row.publishedAt).not.toBeNull();
    expect(queue.jobs.size).toBe(1);
    expect(mirrored).toHaveLength(1);
  });

  it('phát mỗi loại sự kiện vào đúng hàng đợi của nó và không phát job cho loại chưa định tuyến', async () => {
    const mailRow = makeRow({ aggregate: 'auth', type: 'auth_mail_requested' });
    const messageRow = makeRow({ aggregate: 'messaging', type: 'message_sent' });
    const unroutedRow = makeRow({ aggregate: 'course', type: 'course_created' });
    const { relay, queues, mirrored } = makeRelay([mailRow, messageRow, unroutedRow], ROUTES);

    const published = await relay.publishPending();

    expect(published).toBe(3);
    expect([...queues.get('outbox-auth-mail')!.jobs.keys()]).toEqual([`shared-${mailRow.id}`]);
    expect([...queues.get('outbox-messaging')!.jobs.keys()]).toEqual([`shared-${messageRow.id}`]);
    expect(unroutedRow.publishedAt).not.toBeNull();
    expect(mirrored.map((r) => r['id'])).toEqual([mailRow.id, messageRow.id, unroutedRow.id]);
  });

  it('đóng dấu ngay khi phát xong dù job chưa được xử lý — publishedAt không phải dấu hoàn thành xử lý', async () => {
    const row = makeRow({ aggregate: 'messaging', type: 'message_sent' });
    const { relay, queues } = makeRelay([row], ROUTES);
    const queue = queues.get('outbox-messaging')!;

    const published = await relay.publishPending();

    expect(published).toBe(1);
    expect(row.publishedAt).not.toBeNull();
    expect(queue.jobs.get(`shared-${row.id}`)?.name).toBe('message_sent');
  });

  it('phản chiếu dòng đã phát vào event_log qua EventLogWriter với đầy đủ định danh của dòng', async () => {
    const row = makeRow({ aggregate: 'auth', type: 'auth_mail_requested', tenantId: 'tenant-9' });
    const { relay, mirrored } = makeRelay([row], ROUTES, { tenantSlugs: { 'tenant-9': 'trung-tam-9' } });

    await relay.publishPending();

    expect(mirrored).toEqual([
      {
        id: row.id,
        seq: row.seq,
        aggregate: 'auth',
        type: 'auth_mail_requested',
        payload: { n: row.seq },
        occurredAt: row.occurredAt,
        tenantId: 'tenant-9',
      },
    ]);
  });

  it('phát lại cùng một dòng sau sự cố giữa bước đẩy job và bước đóng dấu không tạo job trùng', async () => {
    const row = makeRow({ aggregate: 'auth', type: 'auth_mail_requested' });
    const rows = [row];
    const queues = new Map<string, FakeQueue>([['outbox-auth-mail', new FakeQueue(rows)]]);
    const { db, control } = makeFakeDb(rows);
    const relay = new OutboxRelayScheduler(
      { record: async () => undefined } as never,
      { recordRun: async () => undefined } as never,
      ROUTES,
      queues as never,
      { routedKysely: db, ...NO_SPACES } as never,
      { get: () => undefined } as never,
    );
    const queue = queues.get('outbox-auth-mail')!;
    control.failNextStamp = true;

    await expect(relay.publishPending()).rejects.toThrow('database write failed');
    expect(row.publishedAt).toBeNull();
    expect(queue.jobs.size).toBe(1);

    const published = await relay.publishPending();
    expect(published).toBe(1);
    expect(row.publishedAt).not.toBeNull();
    expect(queue.jobs.size).toBe(1);
  });

  it('dừng cả lô tại dòng phát thất bại — các dòng sau giữ nguyên chưa đóng dấu để lượt sau xử lý theo thứ tự', async () => {
    const failingRow = makeRow({ aggregate: 'auth', type: 'auth_mail_requested' });
    const laterRow = makeRow({ aggregate: 'course', type: 'course_created' });
    const { relay, queues, mirrored } = makeRelay([failingRow, laterRow], ROUTES);
    queues.get('outbox-auth-mail')!.failNextAdd = true;

    await expect(relay.publishPending()).rejects.toThrow('redis unavailable');

    expect(failingRow.publishedAt).toBeNull();
    expect(laterRow.publishedAt).toBeNull();
    expect(mirrored).toHaveLength(0);
  });

  it('ghi task_log trạng thái failed cho nhịp relay có lỗi phát và success khi nhịp phát được dòng', async () => {
    const row = makeRow({ aggregate: 'auth', type: 'auth_mail_requested' });
    const { relay, queues, taskRuns } = makeRelay([row], ROUTES);
    queues.get('outbox-auth-mail')!.failNextAdd = true;

    await expect(relay.relayTick()).rejects.toThrow('redis unavailable');
    expect(taskRuns).toEqual([{ status: 'failed' }]);

    await relay.relayTick();
    expect(taskRuns).toEqual([{ status: 'failed' }, { status: 'success' }]);
  });
});

describe('Relay outbox duy nhất — fan-out một sự kiện nhiều consumer (issue #520)', () => {
  const FANOUT_ROUTES: OutboxEventQueueRoutes = {
    message_sent: ['notification-events', 'messaging-realtime'],
  };

  it('một dòng message_sent sinh job ở CẢ hai hàng đợi đích với jobId là id dòng và chỉ đóng dấu sau khi cả hai đích đã nhận', async () => {
    const row = makeRow({ aggregate: 'messaging', type: 'message_sent' });
    const { relay, queues } = makeRelay([row], FANOUT_ROUTES);
    const notificationsQueue = queues.get('notification-events')!;
    const realtimeQueue = queues.get('messaging-realtime')!;

    const published = await relay.publishPending();

    expect(published).toBe(1);
    expect(notificationsQueue.jobs.get(`shared-${row.id}`)?.name).toBe('message_sent');
    expect(realtimeQueue.jobs.get(`shared-${row.id}`)?.name).toBe('message_sent');
    for (const queue of [notificationsQueue, realtimeQueue]) {
      expect(queue.jobs.get(`shared-${row.id}`)?.data).toEqual({
        outboxId: row.id,
        seq: row.seq,
        aggregate: 'messaging',
        type: 'message_sent',
        payload: { n: row.seq },
        tenantId: row.tenantId,
        spaceSlug: null,
        spaceId: null,
        occurredAt: '2026-10-29T00:00:00.000Z',
      });
    }
    expect(notificationsQueue.stampedAtDispatch).toEqual([false]);
    expect(realtimeQueue.stampedAtDispatch).toEqual([false]);
    expect(row.publishedAt).not.toBeNull();
  });

  it('đích thứ hai lỗi thì dòng không được đóng dấu; phát lại không sinh job trùng ở đích đầu và hoàn tất ở đích thứ hai', async () => {
    const row = makeRow({ aggregate: 'messaging', type: 'message_sent' });
    const { relay, queues, mirrored } = makeRelay([row], FANOUT_ROUTES);
    const notificationsQueue = queues.get('notification-events')!;
    const realtimeQueue = queues.get('messaging-realtime')!;
    realtimeQueue.failNextAdd = true;

    await expect(relay.publishPending()).rejects.toThrow('redis unavailable');
    expect(row.publishedAt).toBeNull();
    expect(notificationsQueue.jobs.size).toBe(1);
    expect(realtimeQueue.jobs.size).toBe(0);
    expect(mirrored).toHaveLength(0);

    const published = await relay.publishPending();
    expect(published).toBe(1);
    expect(row.publishedAt).not.toBeNull();
    expect(notificationsQueue.jobs.size).toBe(1);
    expect(realtimeQueue.jobs.size).toBe(1);
    expect(mirrored).toHaveLength(1);
  });

  it('bảng định tuyến production: mười loại của consumer thông báo trỏ về hàng đợi notification-events, message_sent có đúng hai đích, hai route digest phụ huynh giữ nguyên', () => {
    const notificationTypes = [
      'grade_updated', 'course_completed', 'enrol_expiry_warning', 'message_sent',
      'activity_due_reminder', 'assignment_created', 'assignment_submitted',
      'assignment_returned', 'exam_pinned', 'quiz_attempt_finished',
    ];
    for (const type of notificationTypes) {
      expect(queueNamesOfRoute(OUTBOX_EVENT_QUEUE_ROUTES[type]!)).toContain('notification-events');
    }
    expect(queueNamesOfRoute(OUTBOX_EVENT_QUEUE_ROUTES['message_sent']!)).toEqual(['messaging-realtime', 'notification-events']);
    expect(OUTBOX_EVENT_QUEUE_ROUTES['guardian_digest_due']).toBe('guardian-digest-events');
    expect(OUTBOX_EVENT_QUEUE_ROUTES['guardian_overdue_alert']).toBe('guardian-digest-events');
  });

  it('bảng định tuyến production đưa mọi loại sự kiện phân phối messaging về hàng đợi messaging-realtime', () => {
    for (const type of MESSAGING_DISTRIBUTED_EVENT_TYPES) {
      expect(queueNamesOfRoute(OUTBOX_EVENT_QUEUE_ROUTES[type]!)).toContain('messaging-realtime');
    }
  });
});

describe('Relay outbox — định tuyến theo trung tâm (issue #582)', () => {
  const DEDICATED_SPACE: SpaceRegistryEntry = {
    id: 'id-dang-ky-a',
    slug: 'trung-tam-a',
    status: 'active',
    databaseName: 'giaokhoa_centre_a',
    storageMode: 'dedicated',
    connectionRoleRef: 'centre_a_app',
    secretRef: 'env:CENTRE_A_URL',
    schemaVersion: 'v3',
  };

  it('tenant bị xoá không được phát job vô chủ lên platform, dòng giữ nguyên để kiểm tra', async () => {
    const orphanRow = makeRow({ aggregate: 'auth', type: 'auth_mail_requested', tenantId: 'tenant-da-xoa' });
    const { relay, queues } = makeRelay([orphanRow], ROUTES, {
      tenantSlugs: { 'tenant-khac': 'trung-tam-b' },
    });
    await expect(relay.publishPending()).rejects.toThrow('has no owning tenant');
    expect(orphanRow.publishedAt).toBeNull();
    expect(queues.get('outbox-auth-mail')?.jobs.size).toBe(0);
  });

  it('sự kiện thực sự không gắn tenant giữ ngữ cảnh platform và không mang spaceId', async () => {
    const row = makeRow({ aggregate: 'auth', type: 'auth_mail_requested', tenantId: null });
    const { relay, queues } = makeRelay([row], ROUTES);
    await relay.publishPending();
    expect(queues.get('outbox-auth-mail')?.jobs.get(`shared-${row.id}`)?.data).toMatchObject({
      tenantId: null, spaceSlug: null, spaceId: null,
    });
  });

  it('nhịp relay quét outbox của trung tâm ở kho riêng trong phiên của trung tâm đó: dòng của trung tâm được phát với slug của nó và được đóng dấu ở kho của nó', async () => {
    const centreRow = makeRow({ aggregate: 'auth', type: 'auth_mail_requested', tenantId: 'tenant-a' });
    const centreFake = makeFakeDb([centreRow], { 'tenant-a': 'trung-tam-a' });
    const spaceDb = makeFakeSpaceDb([DEDICATED_SPACE], new Map([['trung-tam-a', centreFake.db]]));
    const { relay, queues } = makeRelay([], ROUTES, { spaceDb });
    const queue = queues.get('outbox-auth-mail')!;

    const result = await relay.publishPendingForCentres();

    expect(result).toEqual({ published: 1, failedSlugs: [] });
    expect(centreRow.publishedAt).not.toBeNull();
    expect(queue.jobs.get(`${DEDICATED_SPACE.id}-${centreRow.id}`)?.data.spaceSlug).toBe('trung-tam-a');
    expect(queue.jobs.get(`${DEDICATED_SPACE.id}-${centreRow.id}`)?.data.spaceId).toBe(DEDICATED_SPACE.id);
    expect(queue.jobs.get(`${DEDICATED_SPACE.id}-${centreRow.id}`)?.data.tenantId).toBe('tenant-a');
  });

  it('hai database trùng outbox UUID và tenant UUID phát hai job độc lập vào cùng Redis queue', async () => {
    const id = '0191e8f2-7c3a-7b21-9f00-000000000011';
    const aRow = makeRow({ id, aggregate: 'auth', type: 'auth_mail_requested', tenantId: 'tenant-trung' });
    const bRow = makeRow({ id, aggregate: 'auth', type: 'auth_mail_requested', tenantId: 'tenant-trung' });
    const spaceB = { ...DEDICATED_SPACE, id: 'id-dang-ky-b', slug: 'trung-tam-b' };
    const dbA = makeFakeDb([aRow], { 'tenant-trung': 'trung-tam-a' }).db;
    const dbB = makeFakeDb([bRow], { 'tenant-trung': 'trung-tam-b' }).db;
    const spaceDb = makeFakeSpaceDb([DEDICATED_SPACE, spaceB], new Map([
      ['trung-tam-a', dbA], ['trung-tam-b', dbB],
    ]));
    const { relay, queues } = makeRelay([], ROUTES, { spaceDb });
    const outcome = await relay.publishPendingForCentres();
    expect(outcome).toEqual({ published: 2, failedSlugs: [] });
    const jobs = queues.get('outbox-auth-mail')!.jobs;
    expect(jobs.size).toBe(2);
    expect(jobs.get(`${DEDICATED_SPACE.id}-${id}`)?.data).toMatchObject({ spaceId: DEDICATED_SPACE.id, spaceSlug: DEDICATED_SPACE.slug });
    expect(jobs.get(`${spaceB.id}-${id}`)?.data).toMatchObject({ spaceId: spaceB.id, spaceSlug: spaceB.slug });
    expect(aRow.publishedAt).not.toBeNull();
    expect(bRow.publishedAt).not.toBeNull();
    aRow.publishedAt = null;
    bRow.publishedAt = null;
    await relay.publishPendingForCentres();
    expect(jobs.size).toBe(2);
  });

  it('trung tâm đã đóng (closed) và trung tâm ở kho chung không thuộc lượt quét theo trung tâm', async () => {
    const closedSpace: SpaceRegistryEntry = { ...DEDICATED_SPACE, slug: 'trung-tam-dong', status: 'closed' };
    const sharedSpace: SpaceRegistryEntry = {
      ...DEDICATED_SPACE,
      slug: 'truong-mac-dinh',
      storageMode: 'shared',
      status: 'active',
    };
    const spaceDb = makeFakeSpaceDb([closedSpace, sharedSpace], new Map());
    const { relay } = makeRelay([], ROUTES, { spaceDb });

    const result = await relay.publishPendingForCentres();

    expect(result).toEqual({ published: 0, failedSlugs: [] });
  });

  it('lượt quét của một trung tâm lỗi thì trung tâm còn lại vẫn được quét xong, và nhịp relay ghi task_log failed mà không ném', async () => {
    const okRow = makeRow({ aggregate: 'auth', type: 'auth_mail_requested', tenantId: 'tenant-a' });
    const okFake = makeFakeDb([okRow], { 'tenant-a': 'trung-tam-a' });
    const badSpace: SpaceRegistryEntry = { ...DEDICATED_SPACE, slug: 'trung-tam-hong' };
    const spaceDb = makeFakeSpaceDb(
      [badSpace, DEDICATED_SPACE],
      new Map([['trung-tam-a', okFake.db]]),
      new Set(['trung-tam-hong']),
    );
    const { relay, taskRuns } = makeRelay([], ROUTES, { spaceDb });

    const result = await relay.publishPendingForCentres();
    expect(result.published).toBe(1);
    expect(result.failedSlugs).toEqual(['trung-tam-hong']);
    expect(okRow.publishedAt).not.toBeNull();

    await expect(relay.relayTick()).resolves.toBeUndefined();
    expect(taskRuns).toEqual([{ status: 'failed' }]);
  });

  it('không đọc được sổ đăng ký thì lượt theo trung tâm trả tín hiệu lỗi riêng và nhịp relay ghi task_log failed phân biệt được', async () => {
    const spaceDb = {
      listRegisteredSpaces: async () => {
        throw new Error('control plane unreachable');
      },
      withSpaceKysely: async () => {
        throw new Error('không được gọi khi đọc sổ lỗi');
      },
    };
    const { relay, taskRuns } = makeRelay([], ROUTES, { spaceDb });

    const result = await relay.publishPendingForCentres();
    expect(result).toEqual({
      published: 0,
      failedSlugs: [],
      registryError: 'control plane unreachable',
    });

    await expect(relay.relayTick()).resolves.toBeUndefined();
    expect(taskRuns).toEqual([{ status: 'failed' }]);
  });
});
