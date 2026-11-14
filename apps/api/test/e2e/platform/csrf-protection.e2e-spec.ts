import { randomUUID } from 'node:crypto';
import { INestApplication, RequestMethod, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../src/app.module';
import { enableTrustedProxy } from '../../../src/common/client-ip';
import { ProblemDetailsFilter } from '../../../src/common/problem-details.filter';

describe('Bảo vệ CSRF built-in của Nest', () => {
  let app: INestApplication;
  let trustedOrigin: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useSecurityHeaders();
    const config = app.get(ConfigService);
    const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    trustedOrigin = corsOrigins[0] ?? 'http://localhost:5173';
    app.enableCsrfProtection({
      trustedOrigins: corsOrigins,
      exclude: [{ path: 'payments/ipn/sepay', method: RequestMethod.POST, version: '1' }],
    });
    enableTrustedProxy(app as NestExpressApplication);
    app.enableCors({ origin: corsOrigins, credentials: true });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST webhook từ origin lạ với Sec-Fetch-Site cross-site bị chặn 403 dạng Problem Details', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('Origin', 'https://evil.example')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ gateway: 'unknown-gateway', externalTransactionId: 'csrf-probe-1', paymentId: randomUUID(), status: 'succeeded' });
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.status).toBe(403);
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
