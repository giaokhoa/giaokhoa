import { validateWorkerJobPayload, workerPayloadSchemas } from './job-payload-validation';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import { DelayedError, type Job } from 'bullmq';
import Redis from 'ioredis';
import { authMailPayloadSchema, renderAuthMail } from '@giaokhoa/contracts';
import { redisConnectionFromUrl } from '../config/env';
import { SpaceJobRunner } from '../db/routing/space-job-runner';
import { scopedOutboxId } from '../db/routing/outbox-redis-scope';
import type { OutboxEventJobData } from '../outbox-event-routes';
import { ResendMailService } from '../resend-mail.service';


export interface AuthMailSentMarker {
  hasSent(outboxId: string): Promise<boolean>;
  claimProcessing(outboxId: string): Promise<string | null>;
  markSent(outboxId: string): Promise<void>;
  releaseProcessing(outboxId: string, ownerToken: string): Promise<void>;
}

export const AUTH_MAIL_SENT_MARKER = 'AUTH_MAIL_SENT_MARKER';

const SENT_MARKER_KEY_PREFIX = 'giaokhoa:auth-mail:sent:';

const PROCESSING_LEASE_KEY_PREFIX = 'giaokhoa:auth-mail:processing:';

const SENT_MARKER_TTL_SECONDS = 7 * 24 * 3600;

const PROCESSING_LEASE_TTL_SECONDS = 60;

const PROCESSING_RETRY_DELAY_MS = 5000;

const RELEASE_PROCESSING_IF_OWNER_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

@Injectable()
export class RedisAuthMailSentMarker implements AuthMailSentMarker, OnModuleDestroy {
  private readonly logger = new Logger(RedisAuthMailSentMarker.name);
  private client: Redis | null = null;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
      this.client = null;
    }
  }

  private redis(): Redis {
    if (!this.client) {
      this.client = new Redis({
        ...redisConnectionFromUrl(this.config.getOrThrow<string>('REDIS_URL')),
      });
      this.client.on('error', (error: Error) => {
        this.logger.warn(`Redis của dấu mail auth lỗi: ${error.message}`);
      });
    }
    return this.client;
  }

  async hasSent(outboxId: string): Promise<boolean> {
    return (await this.redis().get(`${SENT_MARKER_KEY_PREFIX}${scopedOutboxId(outboxId)}`)) !== null;
  }

  async claimProcessing(outboxId: string): Promise<string | null> {
    const ownerToken = randomUUID();
    const result = await this.redis().set(
      `${PROCESSING_LEASE_KEY_PREFIX}${scopedOutboxId(outboxId)}`,
      ownerToken,
      'EX',
      PROCESSING_LEASE_TTL_SECONDS,
      'NX',
    );
    return result === 'OK' ? ownerToken : null;
  }

  async markSent(outboxId: string): Promise<void> {
    await this.redis().set(`${SENT_MARKER_KEY_PREFIX}${scopedOutboxId(outboxId)}`, '1', 'EX', SENT_MARKER_TTL_SECONDS);
  }

  async releaseProcessing(outboxId: string, ownerToken: string): Promise<void> {
    await this.redis().eval(
      RELEASE_PROCESSING_IF_OWNER_SCRIPT,
      1,
      `${PROCESSING_LEASE_KEY_PREFIX}${scopedOutboxId(outboxId)}`,
      ownerToken,
    );
  }
}

export interface AuthMailProcessResult {
  status:
    | 'sent'
    | 'skipped'
    | 'duplicate'
    | 'invalid';
}

@Processor('auth-mail')
export class AuthMailProcessor extends ObservedWorkerHost {
  private readonly logger = new Logger(AuthMailProcessor.name);

  constructor(
    private readonly mailer: ResendMailService,
    @Inject(AUTH_MAIL_SENT_MARKER) private readonly sentMarker: AuthMailSentMarker,
    private readonly jobRunner: SpaceJobRunner,
  ) {
    super();
  }

  async process(job: Job<OutboxEventJobData>, token?: string): Promise<AuthMailProcessResult> {
    // Job chạy trong phiên đúng với trung tâm mà sự kiện thuộc về
    // qua `SpaceJobRunner` (issue #582) — cùng một đường như mọi
    // consumer của relay: trung tâm ở kho riêng thì phiên theo
    // trung tâm được mở trước khi thân xử lý chạy; trung tâm ở
    // kho chung thì là ngữ cảnh platform như hiện tại. Thân xử
    // lý ở `processInContext` không đổi.
    validateWorkerJobPayload(workerPayloadSchemas['outbox-event'], job.data, 'auth-mail');
    return this.jobRunner.runForJob(job.data, () => this.processInContext(job, token));
  }

  private async processInContext(job: Job<OutboxEventJobData>, token?: string): Promise<AuthMailProcessResult> {
    const data = job.data;
    const result = authMailPayloadSchema.safeParse(data?.payload ?? null);
    if (!result.success) {
      // Không đưa payload thô vào log: reset URL mang token bí mật,
      // OTP cũng là mã đăng nhập còn hiệu lực.
      this.logger.error(
        `Payload mail auth không hợp lệ, bỏ qua job ${data?.outboxId ?? 'unknown'}; trường lỗi: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
      );
      return { status: 'invalid' };
    }
    const parsed = result.data;

    if (await this.sentMarker.hasSent(data.outboxId)) {
      this.logger.log(
        `Mail auth của dòng outbox ${data.outboxId} đã được gửi ở lần xử lý trước — bỏ qua lần phát lại.`,
      );
      return { status: 'duplicate' };
    }

    const leaseToken = await this.sentMarker.claimProcessing(data.outboxId);
    if (!leaseToken) {
      this.logger.log(
        `Mail auth của dòng outbox ${data.outboxId} đang được một lượt xử lý khác giữ lease — hẹn hàng đợi phát lại sau ${PROCESSING_RETRY_DELAY_MS}ms.`,
      );
      if (token) {
        await job.moveToDelayed(Date.now() + PROCESSING_RETRY_DELAY_MS, token);
      }
      throw new DelayedError();
    }

    try {
      if (await this.sentMarker.hasSent(data.outboxId)) {
        this.logger.log(
          `Mail auth của dòng outbox ${data.outboxId} đã được gửi bởi lượt xử lý vừa nhả lease — bỏ qua, không gửi lần hai.`,
        );
        await this.sentMarker.releaseProcessing(data.outboxId, leaseToken).catch(() => undefined);
        return { status: 'duplicate' };
      }

      const message = renderAuthMail(parsed);
      const result = await this.mailer.send(message);
      if (result.status === 'skipped') {
        this.logger.warn(
          `Mail auth tới ${parsed.to} (loại ${parsed.kind}) không được gửi: ${result.reason} — môi trường chưa cấu hình Resend.`,
        );
      }
      await this.sentMarker.markSent(data.outboxId);
      await this.sentMarker.releaseProcessing(data.outboxId, leaseToken).catch(() => undefined);
      return { status: result.status };
    } catch (error) {
      await this.sentMarker.releaseProcessing(data.outboxId, leaseToken).catch(() => undefined);
      throw error;
    }
  }
}
