import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisConnectionFromUrl } from '../../../../worker/src/config/env';
import { outboxRelayJobId } from '../../../../worker/src/outbox-relay.scheduler';
import {
  OUTBOX_EVENT_QUEUE_ROUTES,
  allQueueNamesOfRoutes,
  queueNamesOfRoute,
} from '../../../../worker/src/outbox-event-routes';
import { closeWorkerRelayDriver, flushWorkerRelay } from '../../support/worker-relay-driver';

describe('Worker relay driver: đóng cầu dẫn dọn đúng job của lượt chạy', () => {
  const queueNames = allQueueNamesOfRoutes(OUTBOX_EVENT_QUEUE_ROUTES);
  let pg: Client;
  let adminRedis: Redis;
  let measureQueues: Queue[] = [];

  function queueByName(name: string): Queue {
    return measureQueues.find((q) => q.name === name)!;
  }

  async function waitingCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const queue of measureQueues) {
      const jobCounts = await queue.getJobCounts('waiting', 'delayed');
      counts[queue.name] = (jobCounts.waiting ?? 0) + (jobCounts.delayed ?? 0);
    }
    return counts;
  }

  async function insertOutboxRows(): Promise<Array<{ id: string; type: string }>> {
    const rows = [
      { aggregate: 'auth', type: 'auth_mail_requested' },
      { aggregate: 'guardian', type: 'guardian_digest_due' },
      { aggregate: 'grades', type: 'grade_updated' },
      { aggregate: 'cohort', type: 'cohort_member_added' },
      { aggregate: 'messaging', type: 'message_sent' },
    ];
    const inserted: Array<{ id: string; type: string }> = [];
    for (const row of rows) {
      const res = await pg.query(
        `INSERT INTO outbox_events (aggregate, type, payload) VALUES ($1, $2, $3) RETURNING id, type`,
        [row.aggregate, row.type, {}],
      );
      inserted.push(res.rows[0] as { id: string; type: string });
    }
    return inserted;
  }

  async function insertRow(aggregate: string, type: string): Promise<string> {
    const res = await pg.query(
      `INSERT INTO outbox_events (aggregate, type, payload) VALUES ($1, $2, $3) RETURNING id`,
      [aggregate, type, {}],
    );
    return (res.rows[0] as { id: string }).id;
  }

  async function isUnpublished(id: string): Promise<boolean> {
    const res = await pg.query(
      `SELECT published_at IS NULL AS unpub FROM outbox_events WHERE id = $1`,
      [id],
    );
    return (res.rows[0] as { unpub: boolean }).unpub;
  }

  function errorText(error: unknown): string {
    const parts: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 6 && current; depth += 1) {
      if (current instanceof Error) {
        parts.push(current.message);
        current = (current as { cause?: unknown }).cause;
      } else {
        parts.push(String(current));
        break;
      }
    }
    return parts.join(' | ');
  }

  async function runFlushAndClose(): Promise<Array<{ id: string; type: string }>> {
    const baseline = await waitingCounts();
    const rows = await insertOutboxRows();
    const published = await flushWorkerRelay();
    expect(published).toBe(rows.length);
    await closeWorkerRelayDriver();
    const after = await waitingCounts();
    for (const name of queueNames) {
      expect(after[name]).toBe(baseline[name]);
    }
    for (const row of rows) {
      const route = OUTBOX_EVENT_QUEUE_ROUTES[row.type];
      expect(route).toBeDefined();
      for (const queueName of queueNamesOfRoute(route!)) {
        const queue = measureQueues.find((q) => q.name === queueName)!;
        expect(await queue.getJob(outboxRelayJobId(null, row.id))).toBeUndefined();
      }
    }
    return rows;
  }

  beforeAll(async () => {
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query('DELETE FROM outbox_events WHERE published_at IS NULL');
    const connection = redisConnectionFromUrl(process.env.REDIS_URL ?? '');
    measureQueues = queueNames.map((name) => new Queue(name, { connection }));
    adminRedis = new Redis(process.env.REDIS_URL ?? '');
  });

  afterAll(async () => {
    await adminRedis.acl('SETUSER', 'default', 'resetkeys', '~*').catch(() => undefined);
    await pg
      .query('DROP TRIGGER IF EXISTS fail_stamp_after_enqueue_trg ON outbox_events')
      .catch(() => undefined);
    await pg.query('DROP FUNCTION IF EXISTS fail_stamp_after_enqueue()').catch(() => undefined);
    await closeWorkerRelayDriver();
    await Promise.all(measureQueues.map((queue) => queue.close()));
    adminRedis.disconnect();
    await pg.end();
  });

  it('lượt 1: sau khi xả và đóng cầu dẫn, số job chờ trên cả 5 hàng đợi trở về đúng số đo trước lượt và không còn job nào của lượt', async () => {
    const rows = await runFlushAndClose();
    expect(rows).toHaveLength(5);
  });

  it('lượt 2: lặp lại lượt xả và đóng không cộng thêm job sót của lượt 1', async () => {
    const rows = await runFlushAndClose();
    expect(rows).toHaveLength(5);
  });

  it('nhánh lỗi đóng dấu: job đã vào Redis nhưng lệnh đóng dấu publishedAt thất bại, đóng cầu dẫn vẫn dọn job của dòng lỗi', async () => {
    const baseline = await waitingCounts();
    const rowId = await insertRow('grades', 'grade_updated');
    await pg.query(`
      CREATE OR REPLACE FUNCTION fail_stamp_after_enqueue() RETURNS trigger AS $fn$
      BEGIN
        IF NEW.published_at IS NOT NULL AND OLD.published_at IS NULL THEN
          RAISE EXCEPTION 'injected stamp failure after enqueue';
        END IF;
        RETURN NEW;
      END $fn$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS fail_stamp_after_enqueue_trg ON outbox_events;
      CREATE TRIGGER fail_stamp_after_enqueue_trg BEFORE UPDATE ON outbox_events
        FOR EACH ROW EXECUTE FUNCTION fail_stamp_after_enqueue();
    `);
    let flushError: unknown = null;
    try {
      await flushWorkerRelay();
    } catch (error) {
      flushError = error;
    } finally {
      await pg.query('DROP TRIGGER IF EXISTS fail_stamp_after_enqueue_trg ON outbox_events');
      await pg.query('DROP FUNCTION IF EXISTS fail_stamp_after_enqueue()');
    }
    expect(flushError).not.toBeNull();
    expect(errorText(flushError)).toContain('injected stamp failure after enqueue');
    expect(await isUnpublished(rowId)).toBe(true);
    const notificationQueue = queueByName('notification-events');
    expect(await notificationQueue.getJob(outboxRelayJobId(null, rowId))).toBeDefined();

    await closeWorkerRelayDriver();

    expect(await notificationQueue.getJob(outboxRelayJobId(null, rowId))).toBeUndefined();
    const after = await waitingCounts();
    for (const name of queueNames) {
      expect(after[name]).toBe(baseline[name]);
    }
    await pg.query('DELETE FROM outbox_events WHERE id = $1', [rowId]);
  });

  it('nhánh lỗi fan-out: message_sent lỗi ở đích thứ hai sau khi đích thứ nhất đã nhận job, đóng cầu dẫn vẫn dọn job ở đích thứ nhất', async () => {
    const baseline = await waitingCounts();
    await flushWorkerRelay();
    const rowId = await insertRow('messaging', 'message_sent');
    await adminRedis.acl('SETUSER', 'default', 'resetkeys', '~bull:messaging-realtime:*');
    let flushError: unknown = null;
    try {
      await flushWorkerRelay();
    } catch (error) {
      flushError = error;
    } finally {
      await adminRedis.acl('SETUSER', 'default', 'resetkeys', '~*');
    }
    expect(flushError).not.toBeNull();
    expect(errorText(flushError)).toMatch(/NOPERM|no permissions/i);
    expect(await isUnpublished(rowId)).toBe(true);
    const realtimeQueue = queueByName('messaging-realtime');
    const notificationQueue = queueByName('notification-events');
    expect(await realtimeQueue.getJob(outboxRelayJobId(null, rowId))).toBeDefined();
    expect(await notificationQueue.getJob(outboxRelayJobId(null, rowId))).toBeUndefined();

    await closeWorkerRelayDriver();

    expect(await realtimeQueue.getJob(outboxRelayJobId(null, rowId))).toBeUndefined();
    const after = await waitingCounts();
    for (const name of queueNames) {
      expect(after[name]).toBe(baseline[name]);
    }
    await pg.query('DELETE FROM outbox_events WHERE id = $1', [rowId]);
  });

  it('đóng cầu dẫn lần hai không lỗi (đường afterAll gọi sau khi đã đóng tay)', async () => {
    await expect(closeWorkerRelayDriver()).resolves.toBeUndefined();
  });
});
