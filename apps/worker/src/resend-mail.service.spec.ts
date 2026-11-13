import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendMailService } from './resend-mail.service';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Transport mail giới hạn quota toàn cụm qua Redis', () => {
  const config = {
    get: (key: string) => ({
      RESEND_API_KEY: 'example-test-key',
      MAIL_FROM: 'notifications@example.org',
      RESEND_RATE_LIMIT_PER_SECOND: 1,
    } as Record<string, unknown>)[key],
  } as unknown as ConfigService;

  it('chỉ gọi Resend sau khi Redis cấp slot, tuyệt đối không bỏ qua rate limiter lỗi', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('Redis down'));
    const queue = { getBackend: () => ({ client: Promise.resolve({ eval: evalMock }) }) } as unknown as Queue;
    const mailer = new ResendMailService(config, queue);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(mailer.send({ to: 'user@example.org', subject: 'Kiểm thử', text: 'Nội dung' }))
      .rejects.toThrow('Redis down');
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gửi email một lần khi Redis cấp slot', async () => {
    const queue = { getBackend: () => ({ client: Promise.resolve({ eval: vi.fn().mockResolvedValue(0) }) }) } as unknown as Queue;
    const mailer = new ResendMailService(config, queue);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ id: 'sent-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await mailer.send({ to: 'user@example.org', subject: 'Kiểm thử', text: 'Nội dung' }))
      .toEqual({ status: 'sent', providerId: 'sent-1' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
