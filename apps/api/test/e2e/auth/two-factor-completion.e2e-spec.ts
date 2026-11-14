import { INestApplication, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BetterAuthService } from '../../../src/modules/auth/better-auth/better-auth.service';

process.env.BETTER_AUTH_ENABLED = 'true';
process.env.BETTER_AUTH_SECRET = 'two-factor-completion-e2e-secret-1234567890';
process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'http://localhost:3100';

function http(app: INestApplication) {
  return request(app.getHttpServer());
}

async function createMountedTestApp(): Promise<INestApplication> {
  const { AppModule } = await import('../../../src/app.module');
  const { enableTrustedProxy } = await import('../../../src/common/client-ip');
  const { ProblemDetailsFilter } = await import('../../../src/common/problem-details.filter');
  const { mountBetterAuth } = await import('../../../src/modules/auth/better-auth/better-auth.mount');
  const { BetterAuthService: BetterAuthServiceClass } = await import(
    '../../../src/modules/auth/better-auth/better-auth.service'
  );
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  enableTrustedProxy(app as NestExpressApplication);
  const betterAuth: BetterAuthService = app.get(BetterAuthServiceClass);
  mountBetterAuth(app as NestExpressApplication, betterAuth.requireAuth());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  return app;
}

describe('Hoàn tất 2FA: lỗi trả theo khuôn ProblemDetails và bản địa hoá (issue #59 N9)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createMountedTestApp();
  });
  afterAll(async () => { await app.close(); });

  it('thiếu mã TOTP trả 400 theo khuôn ProblemDetails, thông báo kiểm chứng tiếng Việt mặc định', async () => {
    const res = await http(app).post('/api/v1/auth/two-factor/verify-totp').send({});
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      code: 'http.validation_failed',
      instance: '/api/v1/auth/two-factor/verify-totp',
    });
    const messages = (res.body.errors as { field: string; message: string }[])
      .map((e) => e.message).join(' ');
    expect(res.body.errors[0].field).toBe('code');
    expect(messages).toContain('là trường bắt buộc');
  });

  it('thiếu mã TOTP trả thông báo kiểm chứng tiếng Anh khi gửi Accept-Language: en', async () => {
    const res = await http(app).post('/api/v1/auth/two-factor/verify-totp')
      .set('Accept-Language', 'en').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('http.validation_failed');
    const messages = (res.body.errors as { field: string; message: string }[])
      .map((e) => e.message).join(' ');
    expect(messages).toContain('is required');
  });

  it('mã TOTP đúng dạng nhưng không có cookie thử thách trả 401 ProblemDetails với mã INVALID_TWO_FACTOR_COOKIE', async () => {
    const res = await http(app).post('/api/v1/auth/two-factor/verify-totp').send({ code: '123456' });
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      code: 'INVALID_TWO_FACTOR_COOKIE',
      instance: '/api/v1/auth/two-factor/verify-totp',
    });
    expect(typeof res.body.detail).toBe('string');
  });

  it('mã dự phòng không có cookie thử thách trả 401 ProblemDetails với mã INVALID_TWO_FACTOR_COOKIE', async () => {
    const res = await http(app).post('/api/v1/auth/two-factor/verify-backup-code').send({});
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      title: 'Unauthorized',
      status: 401,
      code: 'INVALID_TWO_FACTOR_COOKIE',
      instance: '/api/v1/auth/two-factor/verify-backup-code',
    });
  });
});
