import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, http, uniqueName } from '../../support/identity-access-helpers';

vi.hoisted(() => {
  process.env.RATE_LIMIT_AUTH_PER_MINUTE = '3';
});

describe('Cứng hoá platform: header bảo mật và giới hạn tốc độ', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('response mang header bảo mật built-in của Nest (mặc định Helmet 8) và không còn X-Powered-By', async () => {
    const res = await http(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['origin-agent-cluster']).toBe('?1');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    expect(res.headers['x-download-options']).toBe('noopen');
    expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
    expect(res.headers['x-xss-protection']).toBe('0');
  });

  it('route thông tin đăng nhập bị giới hạn theo IP: lần đăng nhập thứ 4 trong một phút trả 429 Problem Details', async () => {
    const statuses: number[] = [];
    let lastBody: { status?: number; code?: string } = {};
    for (let i = 0; i < 4; i += 1) {
      const res = await http(app)
        .post('/api/v1/auth/token')
        .send({ username: uniqueName('ghost'), password: 'WrongPass1!' });
      statuses.push(res.status);
      lastBody = res.body as { status?: number; code?: string };
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
    expect(lastBody.status).toBe(429);
    const health = await http(app).get('/api/v1/health');
    expect(health.status).toBe(200);
  });

  it('route đăng nhập platform cũng chịu hạn mức xác thực chặt: lần đăng nhập thứ 4 trong một phút trả 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await http(app)
        .post('/api/v1/auth/platform/login')
        .send({ username: uniqueName('ghost-platform'), password: 'WrongPass1!' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
  });
});
