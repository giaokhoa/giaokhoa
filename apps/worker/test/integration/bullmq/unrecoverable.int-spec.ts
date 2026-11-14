import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateWorkerJobPayload, workerPayloadSchemas } from '../../../src/processors/job-payload-validation';

describe('Lỗi job vĩnh viễn trên BullMQ với Redis thật', () => {
  it('payload sai hợp đồng vào failed ngay lần đầu, không đi qua backoff/retry', async () => {
    const queueName = `audit-invalid-${randomUUID()}`;
    const connection = {
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      maxRetriesPerRequest: null,
    };
    const queue = new Queue(queueName, { connection });
    let processed = 0;
    const worker = new Worker(queueName, async (job) => {
      processed += 1;
      validateWorkerJobPayload(workerPayloadSchemas['calendar-import'], job.data, queueName);
    }, { connection });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const failed = new Promise<{ job: Job; error: Error }>((resolve, reject) => {
      const handler = (job: Job | undefined, error: Error) => {
        if (job) resolve({ job, error });
        else reject(new Error('Sự kiện failed thiếu định danh job'));
      };
      worker.once('failed', handler);
    });

    try {
      const queued = await queue.add('invalid', { subscriptionId: 42 }, {
        attempts: 5,
        backoff: { type: 'fixed', delay: 500 },
        removeOnFail: false,
      });
      const event = await Promise.race([
        failed,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('BullMQ không phát failed')), 10_000);
        }),
      ]);
      expect(event.job.id).toBe(queued.id);
      expect(event.error).toBeInstanceOf(UnrecoverableError);
      const stored = await queue.getJob(queued.id!);
      expect(stored?.attemptsMade).toBe(1);
      expect(await stored?.getState()).toBe('failed');
      expect(processed).toBe(1);
    } finally {
      if (timeout) clearTimeout(timeout);
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }, 30_000);
});
