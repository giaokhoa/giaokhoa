import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { healthStatusSchema, type HealthStatus } from '@giaokhoa/contracts';
import { sql } from '@giaokhoa/db';
import Redis from 'ioredis';
import { redisTlsFromUrl } from '../../config/env';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';

/**
 * Các kiểm tra runtime có cấu trúc theo tinh thần Check API của Moodle:
 * mỗi phụ thuộc báo up/down độc lập; payload được kiểm chứng đối chiếu với contract dùng chung trước khi rời khỏi tiến trình.
 */

/** Số lần thử lại tối đa cho một lệnh Redis của probe sức khoẻ (xem constructor). */
const HEALTH_REDIS_MAX_RETRIES = 1;

@Injectable()
/**
 * Kiểm tra sức khoẻ hệ thống: SELECT 1 tới PostgreSQL và PING Redis, trả trạng thái tổng hợp cho /health.
 */
export class HealthService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    private readonly spaceDb: SpaceDatabaseService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    const redisUrl = config.getOrThrow<string>('REDIS_URL');
    this.redis = new Redis(redisUrl, {
      // Chỉ thử lại một lần cho probe sức khoẻ: probe phải nhanh và
      // fail-closed (Redis chết thì /health báo down ngay) thay vì
      // chờ ioredis thử lại mặc định rồi mới kết luận.
      maxRetriesPerRequest: HEALTH_REDIS_MAX_RETRIES,
      lazyConnect: true,
      ...redisTlsFromUrl(redisUrl),
    });
  }

  private async probe(check: () => Promise<boolean>): Promise<'up' | 'down'> {
    try {
      return (await check()) ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  /**
   * Thực thi kiểm tra DB + Redis và dựng kết quả health — hai probe độc
   * lập nên chạy song song, không chờ nối tiếp nhau.
   */
  async check(): Promise<HealthStatus> {
    const [database, redis] = await Promise.all([
      this.probe(async () => {
        await sql`select 1`.execute(this.spaceDb.routedKysely);
        return true;
      }),
      this.probe(async () => (await this.redis.ping()) === 'PONG'),
    ]);
    return healthStatusSchema.parse({
      status: database === 'up' && redis === 'up' ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      checks: { database, redis },
    });
  }

  /**
   * Đóng kết nối Redis khi module bị huỷ.
   */
  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
