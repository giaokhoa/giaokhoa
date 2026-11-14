import { Controller, Get, INestApplication, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Public } from '../../../src/common/public.decorator';
import { createTestApp } from '../../support/identity-access-helpers';

@Public()
@Controller({ path: 'throw-probe', version: '1' })
class ThrowProbeController {
  @Get()
  boom(): never {
    throw new NotFoundException('probe resource missing');
  }
}

describe('API e2e (supertest, DB + Redis thật)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ThrowProbeController] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health trả 200 với hình dạng hợp đồng', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toEqual({ database: 'up', redis: 'up' });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('lỗi dạng RFC 7807 application/problem+json', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/throw-probe');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'probe resource missing',
      code: 'http.not_found',
    });
  });

  it('route lạ cũng tạo Problem Details', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('http.not_found');
  });
});
