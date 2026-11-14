import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('Storage throttler Redis khi Redis chưa sẵn sàng', () => {
  it('Redis không trả lời thì increment lỗi sau thời gian chờ giới hạn thay vì treo vô hạn', async () => {
    const config = {
      getOrThrow: () => 'redis://localhost:6399',
    } as unknown as ConfigService;
    const storage = new RedisThrottlerStorage(config);
    try {
      await expect(storage.increment('khoa', 5000, 3, 5000, 'unit-test')).rejects.toThrow(
        'Redis throttler storage did not become ready in time',
      );
    } finally {
      await storage.onModuleDestroy();
    }
  });
});
