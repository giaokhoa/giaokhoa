import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { redisConnectionFromUrl } from '../config/env';

export const REDIS_THROTTLER_KEY_PREFIX = 'giaokhoa:throttle:';

const INCREMENT_SCRIPT = `
local blockedTtl = redis.call('PTTL', KEYS[2])
if blockedTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return {hits, redis.call('PTTL', KEYS[1]), 1, blockedTtl}
end
local totalHits = redis.call('INCR', KEYS[1])
if totalHits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
if totalHits > tonumber(ARGV[3]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[2])
  return {totalHits, redis.call('PTTL', KEYS[1]), 1, tonumber(ARGV[2])}
end
return {totalHits, redis.call('PTTL', KEYS[1]), 0, 0}
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(redisConnectionFromUrl(config.getOrThrow<string>('REDIS_URL')));
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): ReturnType<ThrottlerStorage['increment']> {
    const result = await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      `${REDIS_THROTTLER_KEY_PREFIX}${throttlerName}:${key}`,
      `${REDIS_THROTTLER_KEY_PREFIX}${throttlerName}:${key}:blocked`,
      ttl,
      blockDuration,
      limit,
    );
    const parts = result as unknown[];
    if (parts.length !== 4) throw new Error('Redis throttler storage returned an unexpected result');
    const [totalHits, timeToExpireMs, isBlocked, timeToBlockExpireMs] = parts.map((part) => Number(part));
    return {
      totalHits,
      timeToExpire: Math.max(0, Math.ceil(timeToExpireMs / 1000)),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(timeToBlockExpireMs / 1000)),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
