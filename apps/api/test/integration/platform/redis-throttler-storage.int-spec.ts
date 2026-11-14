import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisThrottlerStorage } from '../../../src/common/redis-throttler.storage';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('Storage throttler Redis dùng chung cho mọi replica', () => {
  let storage: RedisThrottlerStorage;

  beforeAll(() => {
    const config = {
      getOrThrow: () => process.env.REDIS_URL ?? 'redis://localhost:6379',
    } as unknown as ConfigService;
    storage = new RedisThrottlerStorage(config);
  });

  afterAll(async () => {
    await storage.onModuleDestroy();
  });

  it('lượt gọi trong hạn mức tăng tổng số lần trúng và chưa bị chặn', async () => {
    const key = randomUUID();
    const first = await storage.increment(key, 5000, 3, 5000, 'int-test');
    expect(first.totalHits).toBe(1);
    expect(first.isBlocked).toBe(false);
    expect(first.timeToExpire).toBeGreaterThan(0);
    const second = await storage.increment(key, 5000, 3, 5000, 'int-test');
    expect(second.totalHits).toBe(2);
    expect(second.isBlocked).toBe(false);
  });

  it('vượt hạn mức thì bị chặn trong blockDuration, hết cửa sổ thì đếm lại từ đầu', async () => {
    const key = randomUUID();
    const first = await storage.increment(key, 1000, 1, 300, 'int-test');
    expect(first.isBlocked).toBe(false);
    const blocked = await storage.increment(key, 1000, 1, 300, 'int-test');
    expect(blocked.totalHits).toBe(2);
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.timeToBlockExpire).toBeGreaterThan(0);
    await sleep(400);
    const stillWindow = await storage.increment(key, 1000, 1, 300, 'int-test');
    expect(stillWindow.isBlocked).toBe(true);
    await sleep(900);
    const fresh = await storage.increment(key, 1000, 1, 300, 'int-test');
    expect(fresh.totalHits).toBe(1);
    expect(fresh.isBlocked).toBe(false);
  });

  it('mỗi throttler name đếm riêng trên cùng một key', async () => {
    const key = randomUUID();
    const first = await storage.increment(key, 5000, 1, 5000, 'int-test-a');
    expect(first.totalHits).toBe(1);
    const other = await storage.increment(key, 5000, 1, 5000, 'int-test-b');
    expect(other.totalHits).toBe(1);
    expect(other.isBlocked).toBe(false);
    const blocked = await storage.increment(key, 5000, 1, 5000, 'int-test-a');
    expect(blocked.isBlocked).toBe(true);
  });
});
