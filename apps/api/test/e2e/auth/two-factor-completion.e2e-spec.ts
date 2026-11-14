import type { INestApplication } from '@nestjs/common';
import { generate } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CredentialBridgeService } from '../../../src/modules/auth/better-auth/credential-bridge.service';
import { TotpService } from '../../../src/modules/auth/totp.service';
import { createTestApp, http, uniqueName } from '../../support/identity-access-helpers';

process.env.BETTER_AUTH_ENABLED = 'true';
process.env.BETTER_AUTH_SECRET = 'two-factor-completion-e2e-secret-1234567890';
process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'http://localhost:3100';

const FLOW_PASSWORD = 'TwoFactorPass123';

function cookiePairFrom(setCookie: string[] | undefined, name: string): string | null {
  const raw = (setCookie ?? []).find((value) => value.startsWith(`${name}=`));
  if (!raw) return null;
  const pair = raw.split(';')[0]!;
  return pair.length > name.length + 1 ? pair : null;
}

async function wrongTotpCode(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const valid = new Set<string>();
  for (const delta of [-30, 0, 30]) valid.add(await generate({ secret, epoch: now + delta }));
  for (const candidate of ['000000', '111111', '222222', '333333', '444444', '555555']) {
    if (!valid.has(candidate)) return candidate;
  }
  throw new Error('no wrong-code candidate available');
}

describe('Hoàn tất 2FA: lỗi trả theo khuôn ProblemDetails và bản địa hoá (issue #59 N9)', () => {
  let app: INestApplication;
  let bridge: CredentialBridgeService;
  let totp: TotpService;

  beforeAll(async () => {
    app = await createTestApp();
    bridge = app.get(CredentialBridgeService);
    totp = app.get(TotpService);
  });
  afterAll(async () => { await app.close(); });

  async function startChallenge(): Promise<{ secret: string; twoFactorCookie: string; username: string }> {
    const username = uniqueName('twofactor');
    const created = await bridge.createUserWithCredential({
      email: `${username}@example.com`,
      username,
      firstName: 'Two',
      lastName: 'Factor',
      password: FLOW_PASSWORD,
    });
    const { secret } = await totp.setup(created.id, username);
    await totp.confirm(created.id, await generate({ secret }));
    const signIn = await http(app)
      .post('/api/v1/auth/sign-in/username')
      .send({ username, password: FLOW_PASSWORD });
    expect(signIn.status).toBe(200);
    expect(signIn.body.twoFactorRedirect).toBe(true);
    const twoFactorCookie = cookiePairFrom(signIn.headers['set-cookie'] as unknown as string[], 'better-auth.two_factor');
    expect(twoFactorCookie).toBeTruthy();
    return { secret, twoFactorCookie: twoFactorCookie!, username };
  }

  function verifyTotp(twoFactorCookie: string, code: string) {
    return http(app)
      .post('/api/v1/auth/two-factor/verify-totp')
      .set('Cookie', twoFactorCookie)
      .send({ code });
  }

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

  it('mã TOTP sai định dạng trả 400 theo khuôn ProblemDetails, trường code bị báo lỗi', async () => {
    for (const code of ['abc', '12345']) {
      const res = await http(app).post('/api/v1/auth/two-factor/verify-totp').send({ code });
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body.code).toBe('http.validation_failed');
      expect(res.body.errors[0].field).toBe('code');
    }
  });

  it('mã TOTP đúng dạng nhưng sai trả 401 ProblemDetails với mã INVALID_CODE', async () => {
    const { secret, twoFactorCookie } = await startChallenge();
    const res = await verifyTotp(twoFactorCookie, await wrongTotpCode(secret));
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      title: 'Unauthorized',
      status: 401,
      code: 'INVALID_CODE',
      instance: '/api/v1/auth/two-factor/verify-totp',
    });
  });

  it('mã TOTP hợp lệ với cookie thử thách hợp lệ trả 200, cấp cookie phiên và xoá cookie 2FA', async () => {
    const { secret, twoFactorCookie, username } = await startChallenge();
    const res = await verifyTotp(twoFactorCookie, await generate({ secret }));
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.username).toBe(username);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookiePairFrom(setCookie, 'better-auth.session_token');
    expect(sessionCookie).toBeTruthy();
    const clearedTwoFactor = (setCookie ?? []).find((value) => value.startsWith('better-auth.two_factor='));
    expect(clearedTwoFactor).toContain('Max-Age=0');
    const me = await http(app).get('/api/v1/users/me').set('Cookie', sessionCookie!);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe(username);
  });

  it('mã TOTP hợp lệ có khoảng trắng hai đầu vẫn được chấp nhận', async () => {
    const { secret, twoFactorCookie } = await startChallenge();
    const res = await verifyTotp(twoFactorCookie, ` ${await generate({ secret })} `);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });
});
