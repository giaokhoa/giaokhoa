import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../support/identity-access-helpers';

process.env.BETTER_AUTH_ENABLED = 'true';
process.env.BETTER_AUTH_SECRET = 'csrf-protection-e2e-secret-1234567890';
process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'http://localhost:5173';

describe('Bảo vệ CSRF built-in của Nest', () => {
  let app: INestApplication;
  let trustedOrigin: string;

  beforeAll(async () => {
    app = await createTestApp();
    const config = app.get(ConfigService);
    const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    trustedOrigin = corsOrigins[0] ?? 'http://localhost:5173';
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST đăng nhập Better Auth từ origin lạ với Sec-Fetch-Site cross-site bị chặn 403 dạng Problem Details', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/username')
      .set('Origin', 'https://evil.example')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ username: 'ghost-csrf', password: 'WrongPass1!' });
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.status).toBe(403);
    expect(res.body.code).toBe('http.forbidden');
  });

  it('POST đăng nhập Better Auth từ origin tin cậy kèm cookie phiên đi qua lớp CSRF tới handler', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/username')
      .set('Origin', trustedOrigin)
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Cookie', 'better-auth.session_token=csrf-probe-stale-token')
      .send({ username: 'ghost-csrf', password: 'WrongPass1!' });
    expect(res.status).toBe(401);
  });

  it('POST tới /mcp từ origin lạ với Sec-Fetch-Site cross-site đi qua lớp CSRF nhờ exclude, bị từ chối 401 vì thiếu Bearer token', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Origin', 'https://evil.example')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'csrf-probe', version: '1' } } });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(-32001);
  });

  it('POST webhook từ origin trong CORS allowlist với Sec-Fetch-Site cross-site đi qua lớp CSRF tới handler', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('Origin', trustedOrigin)
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ gateway: 'unknown-gateway', externalTransactionId: 'csrf-probe-2', paymentId: randomUUID(), status: 'succeeded' });
    expect(res.status).toBe(400);
  });

  it('POST webhook không có Sec-Fetch-Site hay Origin (server-to-server) đi qua lớp CSRF tới handler', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .send({ gateway: 'unknown-gateway', externalTransactionId: 'csrf-probe-3', paymentId: randomUUID(), status: 'succeeded' });
    expect(res.status).toBe(400);
  });

  it('POST webhook từ origin lạ với Sec-Fetch-Site cross-site vẫn tới handler nhờ exclude', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('Origin', 'https://evil.example')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ gateway: 'unknown-gateway', externalTransactionId: 'csrf-probe-1', paymentId: randomUUID(), status: 'succeeded' });
    expect(res.status).toBe(400);
  });

  it('POST webhook SePay từ origin lạ với Sec-Fetch-Site cross-site vẫn tới handler nhờ exclude', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/ipn/sepay')
      .set('Origin', 'https://evil.example')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({});
    expect(res.status).toBe(400);
  });

  it('GET callback OAuth từ trang lạ vẫn hoạt động vì GET không bị kiểm tra CSRF', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/oauth/google/callback')
      .set('Sec-Fetch-Site', 'cross-site')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauthError');
  });
});
