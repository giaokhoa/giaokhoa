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
