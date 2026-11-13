import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CentreDb } from '@giaokhoa/db';
import Redis from 'ioredis';
import { COURSE_COMPLETION_REAGGREGATION_REQUESTED } from '@giaokhoa/enrol';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { redisTlsFromUrl } from '../../config/env';
import { CompletionService } from './completion.service';

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 200;
const REAGGREGATION_TYPES = [COURSE_COMPLETION_REAGGREGATION_REQUESTED] as const;

@Injectable()
export class CompletionReaggregationOutboxConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CompletionReaggregationOutboxConsumer.name);
  private readonly redis: Redis;
  private readonly watermarkKey: string;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private watermark: number | null = null;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    private readonly spaceDb: SpaceDatabaseService,
    private readonly completion: CompletionService,
  ) {
    const redisUrl = config.getOrThrow<string>('REDIS_URL');
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null, ...redisTlsFromUrl(redisUrl) });
    this.redis.on('error', (error: Error) => {
      this.logger.warn(`Redis của consumer tái tổng hợp hoàn thành lỗi: ${error.message}`);
    });
    let databaseName = 'default';
    try {
      databaseName = new URL(config.getOrThrow<string>('DATABASE_URL')).pathname.replace(/^\//, '') || 'default';
    } catch {
    }
    this.watermarkKey = `giaokhoa:completion-reaggregation:${databaseName}:seq`;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.tick(); }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.redis.quit().catch(() => undefined);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (this.watermark === null) this.watermark = await this.initialWatermark();
      let rows = await this.fetchPending();
      if (rows.length === 0 && (await this.reanchorIfDbReset())) {
        rows = await this.fetchPending();
      }
      for (const row of rows) {
        try {
          await this.dispatch(row.payload as Record<string, unknown>);
        } catch (error) {
          this.logger.warn(`Tái tổng hợp hoàn thành cho sự kiện seq=${row.seq} lỗi, bỏ qua: ${(error as Error).message}`);
        }
        this.watermark = row.seq;
        await this.redis.set(this.watermarkKey, String(row.seq)).catch(() => undefined);
      }
    } catch (error) {
      this.logger.warn(`Nhịp tái tổng hợp hoàn thành từ outbox lỗi: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private get db(): CentreDb {
    return this.spaceDb.routedKysely;
  }

  private async fetchPending() {
    const rows = await this.db
      .selectFrom('outbox_events')
      .select(['seq', 'type', 'payload'])
      .where('seq', '>', String(this.watermark!))
      .where('type', 'in', [...REAGGREGATION_TYPES])
      .orderBy('seq', 'asc')
      .limit(BATCH_SIZE)
      .execute();
    return rows.map((row) => ({ seq: Number(row.seq), type: row.type, payload: row.payload }));
  }

  private async maxSeq(): Promise<number> {
    const row = await this.db
      .selectFrom('outbox_events')
      .select((eb) => eb.fn.max('seq').as('value'))
      .executeTakeFirst();
    return row?.value != null ? Number(row.value) : 0;
  }

  private async reanchorIfDbReset(): Promise<boolean> {
    const dbMax = await this.maxSeq();
    if (this.watermark === null || dbMax >= this.watermark) return false;
    this.logger.warn(
      `Phát hiện DB đã bị dựng lại trong lúc tiến trình chạy (seq lớn nhất hiện có ${dbMax} < watermark ${this.watermark}) — neo lại watermark về 0 để tiêu thụ các sự kiện của đời DB mới.`,
    );
    this.watermark = 0;
    await this.redis.set(this.watermarkKey, '0').catch(() => undefined);
    return true;
  }

  private async initialWatermark(): Promise<number> {
    const dbMax = await this.maxSeq();
    const storedRaw = await this.redis.get(this.watermarkKey).catch(() => null);
    const stored = storedRaw === null ? null : Number(storedRaw);
    const start = stored !== null && Number.isFinite(stored) && stored <= dbMax ? stored : 0;
    await this.redis.set(this.watermarkKey, String(start)).catch(() => undefined);
    return start;
  }

  private async dispatch(payload: Record<string, unknown>): Promise<void> {
    const courseId = typeof payload.courseId === 'string' ? payload.courseId : null;
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    if (!courseId || !userId) return;
    await this.completion.reaggregateCourseCompletion(userId, courseId);
  }
}
