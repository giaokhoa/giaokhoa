import { describe, expect, it } from 'vitest';
import { TenantAwarePool } from './tenant-pool';

describe('Vòng đời pool PostgreSQL khi Nest và chủ gọi cùng shutdown', () => {
  it('đóng pool hai lần vẫn thành công, không tạo đóng lặp qua pg-pool', async () => {
    const pool = new TenantAwarePool({ max: 1 });
    const closing = pool.end();
    expect(pool.end()).toBe(closing);
    await expect(closing).resolves.toBeUndefined();
    await expect(pool.end()).resolves.toBeUndefined();
  });
});
