import { BullModule, Processor, WorkerHost, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const NAME = 'audit-shutdown';
let jobStarted: (() => void) | undefined;
let releaseJob: (() => void) | undefined;
let jobCompleted = false;

@Processor(NAME)
class SlowProcessor extends WorkerHost {
  override async process(_job: Job): Promise<void> {
    jobStarted?.();
    await new Promise<void>((resolve) => { releaseJob = resolve; });
    jobCompleted = true;
  }
}

@Module({
  imports: [
    BullModule.forRoot({
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379', maxRetriesPerRequest: null },
      prefix: `audit:shutdown:${randomUUID()}`,
    }),
    BullModule.registerQueue({ name: NAME }),
  ],
  providers: [SlowProcessor],
})
class ShutdownTestModule {}

describe('Graceful shutdown BullMQ của vòng đời Nest (được gọi từ SIGTERM)', () => {
  it('app.close() chờ job đang active chạy hết thay vì huỷ mất việc', async () => {
    const started = new Promise<void>((resolve) => { jobStarted = resolve; });
    jobCompleted = false;
    const app = await Test.createTestingModule({ imports: [ShutdownTestModule] }).compile();
    app.enableShutdownHooks();
    await app.init();
    const queue = app.get<Queue>(getQueueToken(NAME));
    let closing: Promise<void> | undefined;
    try {
      await queue.add('hold-until-close', {});
      let startTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          started,
          new Promise<never>((_, reject) => {
            startTimeout = setTimeout(() => reject(new Error('job không chuyển active')), 10_000);
          }),
        ]);
      } finally {
        if (startTimeout) clearTimeout(startTimeout);
      }
      closing = app.close();
      let closed = false;
      void closing.then(() => { closed = true; });


      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(closed).toBe(false);
      expect(jobCompleted).toBe(false);
      releaseJob?.();
      await closing;
      expect(jobCompleted).toBe(true);
    } finally {
      releaseJob?.();
      if (!closing) await app.close();
      else await closing.catch(() => undefined);
      jobStarted = undefined;
      releaseJob = undefined;
    }
  }, 30_000);
});
