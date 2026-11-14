import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { redisConnectionFromUrl } from './config/env';
import { tenantAls } from './db/tenant-als';
import { SpaceDatabaseService } from './db/routing/space-database.service';
import { outboxRelayJobId } from './outbox-relay.scheduler';
import { COHORT_SYNC_EVENT_TYPES } from './processors/cohort-sync-events.processor';
import type { OutboxEventJobData } from './outbox-event-routes';

const LEGACY_WATERMARK_KEY_PREFIX = 'giaokhoa:cohort-sync:';
const DRAIN_BATCH_SIZE = 200;
const DRAIN_RETRY_BASE_DELAY_MS = 1_000;
const DRAIN_RETRY_MAX_DELAY_MS = 30_000;

@Injectable()
export class CohortSyncCatchupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CohortSyncCatchupService.name);
  private readonly redis: Redis;
  private readonly legacyWatermarkKey: string;
  private destroying = false;

  constructor(
    private readonly spaceDb: SpaceDatabaseService,
    @InjectQueue('cohort-sync-events') private readonly queue: Queue<OutboxEventJobData>,
    config: ConfigService,
  ) {
    this.redis = new Redis({
      ...redisConnectionFromUrl(config.getOrThrow<string>('REDIS_URL')),
    });
    let databaseName = 'default';
    try {
      databaseName = new URL(config.getOrThrow<string>('DATABASE_URL')).pathname.replace(/^\//, '') || 'default';
    } catch {
    }
    this.legacyWatermarkKey = `${LEGACY_WATERMARK_KEY_PREFIX}${databaseName}:seq`;
  }

  async onModuleInit(): Promise<void> {
    await this.drainLegacyBacklog();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroying = true;
    await this.redis.quit().catch(() => undefined);
  }

  async drainLegacyBacklog(): Promise<number> {
    return tenantAls.run({ platform: true }, () => this.drainWithRetry());
  }

  private async drainWithRetry(): Promise<number> {
    let attempt = 0;
    for (;;) {
      if (this.destroying) return 0;
      attempt += 1;
      let enqueuedThisAttempt = 0;
      try {
        const enqueued = await this.drainAttempt((count) => {
          enqueuedThisAttempt = count;
        });
        if (attempt > 1) {
          this.logger.log(
            `Phát bù tồn đọng cohort theo watermark cũ hoàn tất ở lần thử ${attempt} (${enqueued} job).`,
          );
        }
        return enqueued;
      } catch (error) {
        const delayMs = Math.min(
          DRAIN_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
          DRAIN_RETRY_MAX_DELAY_MS,
        );
        this.logger.error(
          `Phát bù tồn đọng cohort theo watermark cũ dừng giữa chừng ở lần thử ${attempt} sau ${enqueuedThisAttempt} job (khoá ${this.legacyWatermarkKey} được giữ nguyên): ${error instanceof Error ? error.message : String(error)}. Thử lại sau ${delayMs} ms.`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private async drainAttempt(onProgress: (enqueued: number) => void): Promise<number> {
    const storedRaw = await this.redis.get(this.legacyWatermarkKey);
    if (storedRaw === null) return 0;
    const watermark = Number(storedRaw);
    if (!Number.isFinite(watermark)) {
      this.logger.warn(
        `Khoá watermark cũ ${this.legacyWatermarkKey} mang giá trị không phải số ("${storedRaw}") — bỏ qua lượt phát bù, giữ nguyên khoá.`,
      );
      return 0;
    }

    return this.drainFromWatermark(watermark, onProgress);
  }

  private async drainFromWatermark(
    watermark: number,
    onProgress: (enqueued: number) => void,
  ): Promise<number> {

    const maxRow = await this.spaceDb.routedKysely
      .selectFrom('outbox_events')
      .select((eb) => eb.fn.max('seq').as('value'))
      .executeTakeFirst();
    const dbMax = maxRow?.value === null || maxRow?.value === undefined ? 0 : Number(maxRow.value);

    let enqueued = 0;
    if (watermark < dbMax) {
      let cursor = watermark;
      for (;;) {
        const rows = await this.spaceDb.routedKysely
          .selectFrom('outbox_events')
          .select([
            'id', 'seq', 'aggregate', 'type', 'payload',
            'tenant_id as tenantId', 'occurred_at as occurredAt',
          ])
          .where('seq', '>', String(cursor))
          .where('type', 'in', [...COHORT_SYNC_EVENT_TYPES])
          .orderBy('seq', 'asc')
          .limit(DRAIN_BATCH_SIZE)
          .execute();
        if (rows.length === 0) break;
        for (const row of rows) {
          cursor = Number(row.seq);
          const data: OutboxEventJobData = {
            outboxId: row.id,
            seq: Number(row.seq),
            aggregate: row.aggregate,
            type: row.type,
            payload: row.payload as Record<string, unknown> | null,
            tenantId: row.tenantId,
            spaceSlug: null,
            spaceId: null,
            occurredAt: row.occurredAt.toISOString(),
          };
          await this.queue.add(row.type, data, { jobId: outboxRelayJobId(null, row.id), removeOnFail: true });
          enqueued += 1;
          onProgress(enqueued);
        }
        if (rows.length < DRAIN_BATCH_SIZE) break;
      }
    }

    await this.redis.del(this.legacyWatermarkKey);
    if (enqueued > 0) {
      this.logger.log(
        `Đã phát bù ${enqueued} sự kiện cohort tồn đọng theo watermark cũ (seq > ${watermark}) và xoá khoá watermark của consumer cũ.`,
      );
    }
    return enqueued;
  }
}
