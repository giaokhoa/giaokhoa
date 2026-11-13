import { Logger } from '@nestjs/common';
import { MetadataScanner } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ObservedWorkerHost } from './observed-worker-host';

/** Fake processor dùng để kiểm tra tính kế thừa metadata trên prototype. */
class ProbeWorker extends ObservedWorkerHost {
  async process(): Promise<void> {}
}

describe('Giám sát lỗi của mọi BullMQ processor', () => {
  it('Nest scanner tìm thấy ba listener kế thừa từ lớp nền', () => {
    const instance = new ProbeWorker();
    const names = new MetadataScanner().getAllMethodNames(Object.getPrototypeOf(instance));
    for (const name of ['onBullJobFailed', 'onBullWorkerError', 'onBullJobStalled']) {
      expect(names).toContain(name);
      const metadata = Reflect.getMetadataKeys((instance as unknown as Record<string, unknown>)[name] as object)
        .map((key) => Reflect.getMetadata(key, (instance as unknown as Record<string, unknown>)[name] as object));
      expect(metadata.some((item) => item && typeof item === 'object' && 'eventName' in item)).toBe(true);
    }
  });

  it('job hết retries được ghi vào Redis stream chỉ gồm metadata, không rò dữ liệu mật', async () => {
    const xadd = vi.fn(async () => '1-0');
    const instance = new ProbeWorker();
    const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    Object.defineProperty(instance, '_worker', {
      value: { name: 'test-queue', getBackend: () => ({ client: Promise.resolve({ xadd }) }) },
    });
    const job = { id: 'job-verified', data: { otp: 'secrets-here' }, attemptsMade: 3, opts: { attempts: 3 } };
    instance.onBullJobFailed(job as never, new Error('Validation failed for secrets-here'));
    await vi.waitFor(() => expect(xadd).toHaveBeenCalledTimes(1));
    const args = JSON.stringify(xadd.mock.calls);
    expect(args).toContain('job-verified');
    expect(args).not.toContain('secrets-here');
    logger.mockRestore();
  });

  it('job còn lượt retry chưa được đưa vào sổ terminal', async () => {
    const xadd = vi.fn();
    const instance = new ProbeWorker();
    const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    Object.defineProperty(instance, '_worker', {
      value: { name: 'test-queue', getBackend: () => ({ client: Promise.resolve({ xadd }) }) },
    });
    instance.onBullJobFailed({ id: 'job-retrying', attemptsMade: 1, opts: { attempts: 3 } } as never, new Error('temporary'));
    expect(xadd).not.toHaveBeenCalled();
    logger.mockRestore();
  });

  it('chỉ ghi ID và lỗi, tuyệt đối không lấy dữ liệu payload ra log', () => {
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      const instance = new ProbeWorker();
      Object.defineProperty(instance, '_worker', { value: { name: 'probe-queue' } });
      instance.onBullJobFailed({ id: 'job-1', data: { otp: 'secret-123' } } as never, new Error('failed'));
      expect(spy).toHaveBeenCalled();
      expect(JSON.stringify(spy.mock.calls)).toContain('job-1');
      expect(JSON.stringify(spy.mock.calls)).not.toContain('secret-123');
    } finally {
      spy.mockRestore();
    }
  });
});
