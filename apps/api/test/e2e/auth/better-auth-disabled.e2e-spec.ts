import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, http, login } from '../../support/identity-access-helpers';

describe('Better Auth tắt mặc định (issue #7 giai đoạn 1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('không mount handler Better Auth', async () => {
    const res = await http(app).get('/api/v1/auth/get-session');
    expect(res.status).toBe(404);
  });

  it('luồng xác thực sẵn có không bị động tới', async () => {
    const session = await login(app, 'admin', 'Admin123!');
    expect(session.accessToken).toBeTruthy();
    const me = await http(app).get('/api/v1/users/me').set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('admin');
  });
});
