import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DelayedError, Queue } from 'bullmq';
import Redis from 'ioredis';
import { redisConnectionFromUrl } from '../../../src/config/env';
import { OutboxRelayScheduler, outboxRelayJobId } from '../../../src/outbox-relay.scheduler';
import { SpaceJobRunner } from '../../../src/db/routing/space-job-runner';
import type { SpaceDatabaseService } from '../../../src/db/routing/space-database.service';
import {
  AuthMailProcessor,
  RedisAuthMailSentMarker,
  type AuthMailProcessResult,
  type AuthMailSentMarker,
} from '../../../src/processors/auth-mail.processor';
import type { WorkerMailMessage, WorkerMailSendResult } from '../../../src/resend-mail.service';
import {
  bootWorkerModuleAsOrdinaryRole,
  type OrdinaryWorkerModuleHarness,
} from '../../support/ordinary-worker-module';


class FakeMailer {
  readonly sent: WorkerMailMessage[] = [];

  async send(message: WorkerMailMessage): Promise<WorkerMailSendResult> {
    this.sent.push(message);
    return { status: 'sent', providerId: 'fake-resend-id' };
  }
}

class GatedMailer {
  readonly sent: WorkerMailMessage[] = [];
  calls = 0;
  private open!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.open = resolve;
  });

  async send(message: WorkerMailMessage): Promise<WorkerMailSendResult> {
    this.calls += 1;
    await this.gate;
    this.sent.push(message);
    return { status: 'sent', providerId: 'fake-resend-id' };
  }

  openGate(): void {
    this.open();
  }
}

class FirstClaimGatedRedisMarker implements AuthMailSentMarker {
  private claimCalls = 0;
  private openClaimGate!: () => void;
  private readonly claimGate = new Promise<void>((resolve) => {
    this.openClaimGate = resolve;
  });
  private signalFirstClaimParked!: () => void;
  readonly firstClaimParked = new Promise<void>((resolve) => {
    this.signalFirstClaimParked = resolve;
  });

  constructor(private readonly inner: RedisAuthMailSentMarker) {}

  async hasSent(outboxId: string): Promise<boolean> {
    return this.inner.hasSent(outboxId);
  }

  async claimProcessing(outboxId: string): Promise<string | null> {
    this.claimCalls += 1;
    if (this.claimCalls === 1) {
      this.signalFirstClaimParked();
      await this.claimGate;
    }
    return this.inner.claimProcessing(outboxId);
  }

  async markSent(outboxId: string): Promise<void> {
    return this.inner.markSent(outboxId);
  }

  async releaseProcessing(outboxId: string, ownerToken: string): Promise<void> {
    return this.inner.releaseProcessing(outboxId, ownerToken);
  }

  releaseFirstClaim(): void {
    this.openClaimGate();
  }

  async onModuleDestroy(): Promise<void> {
    await this.inner.onModuleDestroy();
  }
}

async function waitFor(description: string, condition: () => Promise<boolean>, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(`Hết hạn chờ: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

type SettledOutcome =
  | { outcome: 'resolved'; result: AuthMailProcessResult }
  | { outcome: 'rejected'; error: unknown };

function settleProcess(promise: Promise<AuthMailProcessResult>): Promise<SettledOutcome> {
  return promise.then(
    (result) => ({ outcome: 'resolved' as const, result }),
    (error: unknown) => ({ outcome: 'rejected' as const, error }),
  );
}

describe('Worker: mail auth qua hàng đợi (issue #517)', () => {
  let context: INestApplicationContext;
  let harness: OrdinaryWorkerModuleHarness;
  let db: OrdinaryWorkerModuleHarness['adminDb'];
  let queue: Queue;

  const suffix = `${Date.now()}`;
  const recipient = `auth-mail-int-${suffix}@example.com`;
  const resetUrl = `http://localhost:5173/reset-password/token-${suffix}?callbackURL=%2Freset-password`;

  beforeAll(async () => {
    harness = await bootWorkerModuleAsOrdinaryRole();
    context = harness.context;
    db = harness.adminDb;
    queue = new Queue('auth-mail', {
      connection: redisConnectionFromUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
      prefix: 'giaokhoa',
    });
  });

  afterAll(async () => {
    await queue?.close();
    await harness?.close();
  });

  const jobRunner = new SpaceJobRunner({
    resolveTarget: async () => {
      throw new Error('spec không cấu hình sổ đăng ký');
    },
  } as unknown as SpaceDatabaseService);

  function makeMarker(): RedisAuthMailSentMarker {
    return new RedisAuthMailSentMarker({
      getOrThrow: (key: string) => process.env[key],
    } as unknown as ConfigService);
  }

  function makeJobData(outboxId: string, seq: number): Record<string, unknown> {
    return {
      outboxId,
      seq,
      aggregate: 'auth',
      type: 'auth_mail_requested',
      payload: { kind: 'email_otp', to: recipient, otp: '482916', otpType: 'sign-in' },
      tenantId: null,
      spaceSlug: null,
      spaceId: null,
      occurredAt: new Date().toISOString(),
    };
  }

  it('relay phát dòng auth_mail_requested thành job trên hàng đợi auth-mail, đóng dấu và phản chiếu event_log', async () => {
    const row = await db.insertInto('outbox_events').values({
      aggregate: 'auth',
      type: 'auth_mail_requested',
      payload: { kind: 'password_reset', to: recipient, url: resetUrl },
    }).returningAll().executeTakeFirstOrThrow();
    expect(row?.id).toBeTruthy();

    const relay = context.get(OutboxRelayScheduler);
    await relay.publishPending().catch(() => undefined);

    await waitFor('dòng outbox được đóng dấu publishedAt', async () => {
      const current = await db.selectFrom('outbox_events').selectAll().where('id', '=', row.id).executeTakeFirst();
      return current?.published_at != null;
    });

    await waitFor('job của dòng xuất hiện trên hàng đợi auth-mail', async () => {
      const job = await queue.getJob(outboxRelayJobId(null, row.id));
      return job !== undefined;
    });
    const job = await queue.getJob(outboxRelayJobId(null, row.id));
    expect(job?.name).toBe('auth_mail_requested');
    expect(job?.data?.outboxId).toBe(row.id);
    expect(job?.data?.type).toBe('auth_mail_requested');
    expect(job?.data?.payload?.to).toBe(recipient);
    expect(job?.data?.payload?.url).toBe(resetUrl);

    await waitFor('dòng được phản chiếu vào event_log', async () => {
      const logs = await db.selectFrom('event_log').selectAll().where('event_type', '=', 'auth_mail_requested').execute();
      return logs.some(
        (entry) => (entry.payload as { outboxId?: string } | null)?.outboxId === row.id,
      );
    });

    await job?.remove().catch(() => undefined);
  });

  it('processor với dấu Redis thật gửi đúng một mail và bỏ qua lần xử lý lại cùng outboxId', async () => {
    const mailer = new FakeMailer();
    const marker = makeMarker();
    const processor = new AuthMailProcessor(mailer as never, marker, jobRunner);
    const outboxId = `0191e8f2-7c3a-7b21-9f00-${suffix.slice(-12).padStart(12, '0')}`;
    const job = { data: makeJobData(outboxId, 1) };

    try {
      const first = await processor.process(job as never);
      const replay = await processor.process(job as never);

      expect(first.status).toBe('sent');
      expect(replay.status).toBe('duplicate');
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.to).toBe(recipient);
      expect(mailer.sent[0]?.subject).toBe('Mã đăng nhập Giáo khoa của bạn');
      expect(mailer.sent[0]?.text).toContain('482916');
    } finally {
      await marker.onModuleDestroy();
    }
  });

  it('hai lượt xử lý đồng thời cùng outboxId trên Redis thật chỉ gửi đúng một mail và lượt thua bị hẹn thử lại', async () => {
    const mailer = new GatedMailer();
    const markerA = makeMarker();
    const markerB = makeMarker();
    const processorA = new AuthMailProcessor(mailer as never, markerA, jobRunner);
    const processorB = new AuthMailProcessor(mailer as never, markerB, jobRunner);
    const outboxId = `0191e8f2-7c3a-7b21-9f01-${suffix.slice(-12).padStart(12, '0')}`;
    const job = { data: makeJobData(outboxId, 2) };

    try {
      let settledCount = 0;
      const track = (promise: Promise<SettledOutcome>): Promise<SettledOutcome> =>
        promise.then((settled) => {
          settledCount += 1;
          return settled;
        });
      const first = track(settleProcess(processorA.process(job as never)));
      const second = track(settleProcess(processorB.process(job as never)));

      const deadline = Date.now() + 10000;
      while (!(mailer.calls >= 2 || (mailer.calls >= 1 && settledCount >= 1))) {
        if (Date.now() > deadline) throw new Error('Hết hạn chờ hai lượt xử lý đồng thời tới điểm quyết định');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      mailer.openGate();

      const outcomes = await Promise.all([first, second]);
      expect(mailer.calls).toBe(1);
      expect(mailer.sent).toHaveLength(1);
      const resolvedResults = outcomes.flatMap((settled) =>
        settled.outcome === 'resolved' ? [settled.result] : [],
      );
      const rejectedErrors = outcomes.flatMap((settled) =>
        settled.outcome === 'rejected' ? [settled.error] : [],
      );
      expect(resolvedResults.map((result) => result.status)).toEqual(['sent']);
      expect(rejectedErrors).toHaveLength(1);
      expect(rejectedErrors[0]).toBeInstanceOf(DelayedError);
    } finally {
      await markerA.onModuleDestroy();
      await markerB.onModuleDestroy();
    }
  });

  it('lease đang bị một lượt khác giữ trên Redis thật thì processor ném tín hiệu hẹn thử lại và không gửi mail', async () => {
    const mailer = new FakeMailer();
    const marker = makeMarker();
    const processor = new AuthMailProcessor(mailer as never, marker, jobRunner);
    const outboxId = `0191e8f2-7c3a-7b21-9f02-${suffix.slice(-12).padStart(12, '0')}`;
    const job = { data: makeJobData(outboxId, 3) };

    try {
      const otherLease = await marker.claimProcessing(outboxId);
      expect(otherLease).not.toBeNull();

      await expect(processor.process(job as never)).rejects.toBeInstanceOf(DelayedError);
      expect(mailer.sent).toHaveLength(0);
      expect(await marker.hasSent(outboxId)).toBe(false);

      await marker.releaseProcessing(outboxId, otherLease as string);
    } finally {
      await marker.onModuleDestroy();
    }
  });

  it('lượt giữ lease chết trước khi gửi thì sau khi lease hết hạn, lượt xử lý lại trên Redis thật vẫn gửi được mail đúng một lần', async () => {
    const mailer = new FakeMailer();
    const marker = makeMarker();
    const processor = new AuthMailProcessor(mailer as never, marker, jobRunner);
    const outboxId = `0191e8f2-7c3a-7b21-9f03-${suffix.slice(-12).padStart(12, '0')}`;
    const job = { data: makeJobData(outboxId, 4) };
    const raw = new Redis({
      ...redisConnectionFromUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    });

    try {
      const deadLease = await marker.claimProcessing(outboxId);
      expect(deadLease).not.toBeNull();
      expect(mailer.sent).toHaveLength(0);

      await raw.pexpire(`giaokhoa:auth-mail:processing:${outboxId}`, 1);
      await new Promise((resolve) => setTimeout(resolve, 60));

      const recovered = await processor.process(job as never);
      expect(recovered.status).toBe('sent');
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.to).toBe(recipient);

      const replay = await processor.process(job as never);
      expect(replay.status).toBe('duplicate');
      expect(mailer.sent).toHaveLength(1);
    } finally {
      await raw.quit().catch(() => undefined);
      await marker.onModuleDestroy();
    }
  });

  it('lượt đọc dấu đã gửi là chưa có rồi bị giữ trước khi chiếm lease, trong lúc lượt khác gửi trọn và nhả lease trên Redis thật, thì khi chiếm lại lease phải đọc lại dấu và không gửi lần hai', async () => {
    const mailer = new FakeMailer();
    const gatedMarker = new FirstClaimGatedRedisMarker(makeMarker());
    const markerB = makeMarker();
    const processorA = new AuthMailProcessor(mailer as never, gatedMarker, jobRunner);
    const processorB = new AuthMailProcessor(mailer as never, markerB, jobRunner);
    const outboxId = `0191e8f2-7c3a-7b21-9f05-${suffix.slice(-12).padStart(12, '0')}`;
    const job = { data: makeJobData(outboxId, 5) };

    try {
      const turnA = processorA.process(job as never);
      await gatedMarker.firstClaimParked;

      const turnB = await processorB.process(job as never);
      expect(turnB.status).toBe('sent');
      expect(mailer.sent).toHaveLength(1);

      gatedMarker.releaseFirstClaim();
      const turnAResult = await turnA;
      expect(turnAResult.status).toBe('duplicate');
      expect(mailer.sent).toHaveLength(1);
    } finally {
      await gatedMarker.onModuleDestroy();
      await markerB.onModuleDestroy();
    }
  });

  it('nhả lease bằng token sai trên Redis thật không xoá được lease của lượt khác, token đúng thì xoá được', async () => {
    const markerA = makeMarker();
    const markerB = makeMarker();
    const outboxId = `0191e8f2-7c3a-7b21-9f04-${suffix.slice(-12).padStart(12, '0')}`;

    try {
      const ownerToken = await markerA.claimProcessing(outboxId);
      expect(ownerToken).not.toBeNull();

      await markerB.releaseProcessing(outboxId, 'token-khong-phai-cua-chu-lease');
      expect(await markerB.claimProcessing(outboxId)).toBeNull();

      await markerA.releaseProcessing(outboxId, ownerToken as string);
      const reclaimed = await markerB.claimProcessing(outboxId);
      expect(reclaimed).not.toBeNull();
      await markerB.releaseProcessing(outboxId, reclaimed as string);
    } finally {
      await markerA.onModuleDestroy();
      await markerB.onModuleDestroy();
    }
  });
});
