import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { redisConnectionFromUrl } from './config/env';
import { scopedOutboxId } from './db/routing/outbox-redis-scope';

const PROCESSING_KEY_PREFIX = 'giaokhoa:notification-events:processing:';
const PROCESSED_KEY_PREFIX = 'giaokhoa:notification-events:processed:';
const PROCESSING_TTL_SECONDS = 600;
const PROCESSED_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class NotificationEventsMarker implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis({
      ...redisConnectionFromUrl(config.getOrThrow<string>('REDIS_URL')),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  async hasProcessed(outboxId: string): Promise<boolean> {
    return (await this.redis.get(`${PROCESSED_KEY_PREFIX}${scopedOutboxId(outboxId)}`)) !== null;
  }

  async claimProcessing(outboxId: string): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(
      `${PROCESSING_KEY_PREFIX}${scopedOutboxId(outboxId)}`,
      token,
      'EX',
      PROCESSING_TTL_SECONDS,
      'NX',
    );
    return result === 'OK' ? token : null;
  }

  async markProcessed(outboxId: string): Promise<void> {
    await this.redis.set(`${PROCESSED_KEY_PREFIX}${scopedOutboxId(outboxId)}`, '1', 'EX', PROCESSED_TTL_SECONDS);
  }

  async releaseProcessing(outboxId: string, token: string): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      `${PROCESSING_KEY_PREFIX}${scopedOutboxId(outboxId)}`,
      token,
    );
  }
}
