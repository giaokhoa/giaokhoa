import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetryingSchedulerRegistration } from './retrying-scheduler-registration';

afterEach(() => vi.useRealTimers());

describe('Đăng ký BullMQ scheduler có tự phục hồi', () => {
  it('Redis down lúc boot thì đăng ký lại sau giãn cách mà không duplicate', async () => {
    vi.useFakeTimers();
    const upsert = vi.fn()
      .mockRejectedValueOnce(new Error('Redis connection refused'))
      .mockResolvedValueOnce(undefined);
    const warn = vi.fn();
    const registration = new RetryingSchedulerRegistration(upsert, { warn }, 'test-scheduler');
    await registration.start();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(upsert).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(upsert).toHaveBeenCalledTimes(2);
    registration.stop();
  });

  it('khi shutdown không retry scheduler đã lỗi', async () => {
    vi.useFakeTimers();
    const upsert = vi.fn().mockRejectedValue(new Error('Redis down'));
    const registration = new RetryingSchedulerRegistration(upsert, { warn: vi.fn() }, 'test-scheduler');
    await registration.start();
    registration.stop();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
