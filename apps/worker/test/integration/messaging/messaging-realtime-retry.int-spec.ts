import { SpaceJobRunner } from '../../../src/db/routing/space-job-runner';
import type { SpaceDatabaseService } from '../../../src/db/routing/space-database.service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import {
  MESSAGING_DISTRIBUTED_KEY_PREFIX,
  MessagingRealtimeProcessor,
} from '../../../src/processors/messaging-realtime.processor';
import type { OutboxEventJobData } from '../../../src/outbox-event-routes';

const RETRY_TEST_QUEUE = 'messaging-realtime-retry-test';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const FAILURES_BEFORE_SUCCESS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(`Hết thời gian chờ: ${label}`);
}

const jobRunner = new SpaceJobRunner({
  resolveTarget: async () => {
    throw new Error('spec không cấu hình sổ đăng ký');
  },
} as unknown as SpaceDatabaseService);

describe('Worker — job phân phối realtime lỗi bền không chết theo attempts (issue #521)', () => {
  const outboxId = uuidv7();
  const markKey = `${MESSAGING_DISTRIBUTED_KEY_PREFIX}${outboxId}`;

  let queue: Queue<OutboxEventJobData>;
  let worker: Worker<OutboxEventJobData>;
  let markRedis: Redis;
  let distributeCalls = 0;
  const delivered: string[] = [];

  beforeAll(async () => {
    markRedis = new Redis(REDIS_URL);
    await markRedis.del(markKey);

    const distribution = {
      distributeEvent: async (type: string) => {
        distributeCalls += 1;
        if (distributeCalls <= FAILURES_BEFORE_SUCCESS) {
          throw new Error('publish NOPERM (lỗi bền giả lập)');
        }
        delivered.push(type);
      },
    };
    const processor = new MessagingRealtimeProcessor(distribution as never, markRedis as never, jobRunner);

    queue = new Queue<OutboxEventJobData>(RETRY_TEST_QUEUE, {
      connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
    await queue.obliterate({ force: true });
    worker = new Worker<OutboxEventJobData>(
      RETRY_TEST_QUEUE,
      async (job, token) => processor.process(job, token),
      { connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }) },
    );
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await markRedis.del(markKey);
    markRedis.disconnect();
  });

  it(
    'job lỗi phân phối liên tục quá số attempts mặc định vẫn không chết: được hoãn thử lại mà không đốt attempts, lỗi hết thì sự kiện tới và dấu ghi đúng một lần',
    async () => {
      const jobData: OutboxEventJobData = {
        outboxId,
        seq: 1,
        aggregate: 'messaging',
        type: 'message_sent',
        payload: { conversationId: 'conv-retry', messageId: 'msg-retry' },
        spaceSlug: null,
        spaceId: null,
        tenantId: 'tenant-retry',
        occurredAt: '2026-10-29T00:00:00.000Z',
      };
      const job = await queue.add('message_sent', jobData, { jobId: outboxId });

      await waitUntil(
        async () => distributeCalls >= 2 && (await job.getState()) === 'delayed',
        30_000,
        'job vào trạng thái delayed sau các lần phân phối lỗi đầu',
      );
      expect(await job.getState()).not.toBe('failed');
      const freshDuringFault = await queue.getJob(outboxId);
      expect(freshDuringFault?.attemptsMade).toBe(0);

      await waitUntil(async () => (await job.getState()) === 'completed', 60_000, 'job hoàn thành sau khi lỗi hết');
      expect(delivered).toEqual(['message_sent']);
      expect(distributeCalls).toBe(FAILURES_BEFORE_SUCCESS + 1);
      expect(await markRedis.exists(markKey)).toBe(1);
      const freshAfterSuccess = await queue.getJob(outboxId);
      expect(freshAfterSuccess?.attemptsMade).toBe(1);
    },
    120_000,
  );
});

const EXISTS_RETRY_TEST_QUEUE = 'messaging-realtime-exists-retry-test';

const EXISTS_FAILURES_BEFORE_SUCCESS = 4;

describe('Worker — job phân phối realtime khi đọc dấu lỗi bền vẫn không chết theo attempts (issue #521)', () => {
  const outboxId = uuidv7();
  const markKey = `${MESSAGING_DISTRIBUTED_KEY_PREFIX}${outboxId}`;

  let queue: Queue<OutboxEventJobData>;
  let worker: Worker<OutboxEventJobData>;
  let markRedis: Redis;
  let existsCalls = 0;
  const delivered: string[] = [];

  beforeAll(async () => {
    markRedis = new Redis(REDIS_URL);
    await markRedis.del(markKey);

    const markClient = {
      exists: async (key: string): Promise<number> => {
        existsCalls += 1;
        if (existsCalls <= EXISTS_FAILURES_BEFORE_SUCCESS) {
          throw new Error('EXISTS timeout (lỗi bền giả lập)');
        }
        return markRedis.exists(key);
      },
      set: async (key: string, value: string, mode: 'EX', seconds: number): Promise<string | null> => {
        return markRedis.set(key, value, mode, seconds);
      },
    };
    const distribution = {
      distributeEvent: async (type: string) => {
        delivered.push(type);
      },
    };
    const processor = new MessagingRealtimeProcessor(distribution as never, markClient as never, jobRunner);

    queue = new Queue<OutboxEventJobData>(EXISTS_RETRY_TEST_QUEUE, {
      connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
    await queue.obliterate({ force: true });
    worker = new Worker<OutboxEventJobData>(
      EXISTS_RETRY_TEST_QUEUE,
      async (job, token) => processor.process(job, token),
      { connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }) },
    );
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await markRedis.del(markKey);
    markRedis.disconnect();
  });

  it(
    'đọc dấu lỗi liên tục quá số attempts mặc định vẫn không chết: được hoãn thử lại mà không đốt attempts, lỗi hết thì sự kiện tới và dấu ghi đúng một lần',
    async () => {
      const jobData: OutboxEventJobData = {
        outboxId,
        seq: 1,
        aggregate: 'messaging',
        type: 'message_sent',
        payload: { conversationId: 'conv-exists-retry', messageId: 'msg-exists-retry' },
        spaceSlug: null,
        spaceId: null,
        tenantId: 'tenant-exists-retry',
        occurredAt: '2026-10-29T00:00:00.000Z',
      };
      const job = await queue.add('message_sent', jobData, { jobId: outboxId });

      await waitUntil(
        async () => existsCalls >= 2 && (await job.getState()) === 'delayed',
        30_000,
        'job vào trạng thái delayed sau các lần đọc dấu lỗi đầu',
      );
      expect(await job.getState()).not.toBe('failed');
      const freshDuringFault = await queue.getJob(outboxId);
      expect(freshDuringFault?.attemptsMade).toBe(0);

      await waitUntil(async () => (await job.getState()) === 'completed', 60_000, 'job hoàn thành sau khi lỗi hết');
      expect(delivered).toEqual(['message_sent']);
      expect(existsCalls).toBe(EXISTS_FAILURES_BEFORE_SUCCESS + 1);
      expect(await markRedis.exists(markKey)).toBe(1);
      const freshAfterSuccess = await queue.getJob(outboxId);
      expect(freshAfterSuccess?.attemptsMade).toBe(1);
    },
    120_000,
  );
});
