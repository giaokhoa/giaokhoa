import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, createTestApp, createUserViaApi, http, STRONG_PASSWORD } from '../../support/identity-access-helpers';

describe('Phân giải IP client sau proxy tin cậy', () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function loginAndReadSessionIp(username: string, forwardedFor?: string): Promise<string | null> {
    let loginReq = http(app).post('/api/v1/auth/token');
    if (forwardedFor !== undefined) loginReq = loginReq.set('X-Forwarded-For', forwardedFor);
    const loginRes = await loginReq.send({ username, password: STRONG_PASSWORD });
    expect(loginRes.status).toBe(201);
    const accessToken = loginRes.body.accessToken as string;

    const list = await http(app).get('/api/v1/auth/sessions').set('Authorization', `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    const sessions = list.body.sessions as { kind: string; current: boolean; ip: string | null }[];
    const current = sessions.find((s) => s.kind === 'api' && s.current);
    expect(current).toBeDefined();
    return current!.ip;
  }

  it('ghi IP client được chuyển tiếp khi request qua proxy tin cậy', async () => {
    const user = await createUserViaApi(app, admin);
    const ip = await loginAndReadSessionIp(user.username, '203.0.113.55');
    expect(ip).toBe('203.0.113.55');
  });

  it('bỏ qua mục X-Forwarded-For giả mạo phía trái và ghi hop phải nhất', async () => {
    const user = await createUserViaApi(app, admin);
    const ip = await loginAndReadSessionIp(user.username, '1.1.1.1, 2.2.2.2, 198.51.100.23');
    expect(ip).toBe('198.51.100.23');
  });

  it('ghi địa chỉ socket trực tiếp đã chuẩn hoá khi không có X-Forwarded-For', async () => {
    const user = await createUserViaApi(app, admin);
    const ip = await loginAndReadSessionIp(user.username);
    expect(ip).toBe('127.0.0.1');
  });
});
