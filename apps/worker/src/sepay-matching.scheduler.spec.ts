import { describe, expect, it, vi } from 'vitest';
import type { SepayMatchingService } from '@giaokhoa/payments';
import type { SpaceDatabaseService } from './db/routing/space-database.service';
import { tenantAls } from './db/tenant-als';
import { SepayMatchingScheduler } from './sepay-matching.scheduler';

describe('Điểm quét matching IPN SePay ở worker', () => {
  function makeScheduler(sweep: (limit: number) => Promise<number>): SepayMatchingScheduler {
    const matching = { sweep: vi.fn(sweep) } as unknown as SepayMatchingService;
    const spaces = {
      sweepDedicatedSpaces: vi.fn(async (fn: () => Promise<number>) =>
        tenantAls.run({ spaceSlug: 'centre-a' }, fn)),
    } as unknown as SpaceDatabaseService;
    return new SepayMatchingScheduler(matching, spaces);
  }

  it('quét riêng platform và centre đã ghim cùng batch 20, không lẫn identity', async () => {
    const scopes: string[] = [];
    const sweep = vi.fn(async () => {
      const scope = tenantAls.getStore();
      scopes.push(scope?.spaceSlug ?? (scope?.platform ? 'trang-chinh' : 'unknown'));
      return 3;
    });
    const scheduler = makeScheduler(sweep);
    await scheduler.sweepTick();
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(sweep).toHaveBeenCalledWith(20);
    expect(scopes).toEqual(['trang-chinh', 'centre-a']);
  });

  it('nhịp đang chạy thì nhịp khác bỏ qua, nhịp sau chạy lại được', async () => {
    let release!: () => void;
    const gate = new Promise<number>((resolve) => { release = () => resolve(1); });
    const sweep = vi.fn(() => gate);
    const scheduler = makeScheduler(sweep);
    const first = scheduler.sweepTick();
    await scheduler.sweepTick();
    expect(sweep).toHaveBeenCalledTimes(1);
    release();
    await first;
    await scheduler.sweepTick();
    expect(sweep).toHaveBeenCalledTimes(4);
  });

  it('nhịp lỗi được nuốt, cờ được nhả để nhịp sau chạy lại được', async () => {
    const sweep = vi.fn(async () => 0)
      .mockRejectedValueOnce(new Error('DB chập chờn'));
    const scheduler = makeScheduler(sweep);
    await expect(scheduler.sweepTick()).resolves.toBeUndefined();
    await scheduler.sweepTick();
    expect(sweep).toHaveBeenCalledTimes(4);
  });
});
