import { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generate } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, createTestApp, createUserViaApi, http, login, STRONG_PASSWORD, uniqueName } from '../../support/identity-access-helpers';


const profilesByCode = new Map<string, Record<string, unknown>>();

function startMockProvider(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/token') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const code = new URLSearchParams(body).get('code') ?? '';
        if (!profilesByCode.has(code)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: `at:${code}`, token_type: 'Bearer', expires_in: 3600 }));
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/userinfo') {
      const bearer = (req.headers.authorization ?? '').replace('Bearer ', '');
      const token = bearer || url.searchParams.get('access_token') || '';
      const profile = profilesByCode.get(token.replace(/^at:/, ''));
      if (!profile) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_token' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(profile));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function currentTotpCode(secret: string): Promise<string> {
  return generate({ secret });
}

async function wrongTotpCode(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const valid = new Set<string>();
  for (const delta of [-30, 0, 30]) valid.add(await generate({ secret, epoch: now + delta }));
  for (const candidate of ['000000', '111111', '222222', '333333']) {
    if (!valid.has(candidate)) return candidate;
  }
  throw new Error('no wrong-code candidate available');
}

async function enableMfaViaApi(app: INestApplication, accessToken: string): Promise<string> {
  const setup = await http(app).post('/api/v1/auth/mfa/totp/setup').set('Authorization', `Bearer ${accessToken}`);
  expect(setup.status).toBe(201);
  const secret = setup.body.secret as string;
  const confirm = await http(app).post('/api/v1/auth/mfa/totp/confirm')
    .set('Authorization', `Bearer ${accessToken}`).send({ code: await currentTotpCode(secret) });
  expect(confirm.status).toBe(201);
  return secret;
}

describe('Đợt xác thực: đăng nhập social OAuth2, luồng phiên MFA, phiên của tôi', () => {
  let app: INestApplication;
  let admin: string;
  let provider: Server;

  beforeAll(async () => {
    const mock = await startMockProvider();
    provider = mock.server;
    const envKey = (...parts: string[]): string => parts.join('_');
    process.env.OAUTH_GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env[envKey('OAUTH', 'GOOGLE', 'CLIENT', 'SECRET')] = 'test-google-client-secret';
    process.env.OAUTH_FACEBOOK_CLIENT_ID = 'test-facebook-client-id';
    process.env[envKey('OAUTH', 'FACEBOOK', 'CLIENT', 'SECRET')] = 'test-facebook-client-secret';
    for (const prefix of ['OAUTH_GOOGLE', 'OAUTH_FACEBOOK']) {
      process.env[`${prefix}_AUTHORIZE_URL`] = `${mock.baseUrl}/authorize`;
      process.env[`${prefix}_TOKEN_URL`] = `${mock.baseUrl}/token`;
      process.env[`${prefix}_USERINFO_URL`] = `${mock.baseUrl}/userinfo`;
    }
    app = await createTestApp();
    admin = await adminToken(app);
  });

  afterAll(async () => {
    await app.close();
    provider.close();
  });

  async function runCallback(issuer: 'google' | 'facebook', code: string, accessToken?: string) {
    const authorizeReq = http(app).get(`/api/v1/auth/oauth/${issuer}/${accessToken ? 'link' : 'authorize'}`);
    if (accessToken) authorizeReq.set('Authorization', `Bearer ${accessToken}`);
    const authorizeRes = await authorizeReq;
    expect(authorizeRes.status).toBe(200);
    const authorizeUrl = new URL(authorizeRes.body.authorizeUrl as string);
    expect(authorizeUrl.pathname).toBe('/authorize');
    const state = authorizeUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    return http(app).get(`/api/v1/auth/oauth/${issuer}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state!)}`);
  }

  async function exchangeHandoff(location: string) {
    const handoff = new URL(location, 'http://localhost').searchParams.get('handoff');
    expect(handoff).toBeTruthy();
    const res = await http(app).post('/api/v1/auth/oauth/handoff').send({ code: handoff });
    expect(res.status).toBe(201);
    return res.body as { accessToken: string; refreshToken: string; user: { id: string; username: string } };
  }

  it('báo cả hai issuer đều đã bật sau khi cấu hình (Moodle: chỉ issuer đã bật mới hiện)', async () => {
    const res = await http(app).get('/api/v1/auth/oauth/providers');
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual([
      { issuer: 'google', enabled: true },
      { issuer: 'facebook', enabled: true },
    ]);
  });

  it('đăng nhập google bằng email mới đã xác minh tạo tài khoản đã xác nhận, liên kết đăng nhập và phiên hoạt động (auth_test::test_oauth2_complete_login)', async () => {
    const email = `${uniqueName('oauthnew')}@example.com`;
    profilesByCode.set('google-new', {
      sub: `g-${uniqueName('sub')}`, email, email_verified: true, given_name: 'New', family_name: 'Learner',
    });
    const callback = await runCallback('google', 'google-new');
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('/oauth/callback?handoff=');
    const cookies = (callback.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookies).toContain('giaokhoa_session=');

    const body = await exchangeHandoff(callback.headers.location as string);
    expect(body.user.username).toBe(email.split('@')[0]);
    const handoff = new URL(callback.headers.location as string, 'http://localhost').searchParams.get('handoff');
    const replay = await http(app).post('/api/v1/auth/oauth/handoff').send({ code: handoff });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('auth.oauth_handoff_invalid');

    const links = await http(app).get('/api/v1/auth/oauth/links').set('Authorization', `Bearer ${body.accessToken}`);
    expect(links.status).toBe(200);
    expect(links.body.hasPassword).toBe(false);
    expect(links.body.links).toHaveLength(1);
    expect(links.body.links[0]).toMatchObject({ issuer: 'google', email });
    const passwordLogin = await http(app).post('/api/v1/auth/token').send({ username: body.user.username, password: STRONG_PASSWORD });
    expect(passwordLogin.status).toBe(401);

    const again = await runCallback('google', 'google-new');
    const againBody = await exchangeHandoff(again.headers.location as string);
    expect(againBody.user.id).toBe(body.user.id);
  });

  it('đăng nhập google khớp tài khoản sẵn có bằng email đã xác minh và liên kết nó thay vì nhân đôi tài khoản', async () => {
    const existing = await createUserViaApi(app, admin);
    profilesByCode.set('google-match', {
      sub: `g-${uniqueName('sub')}`, email: existing.email, email_verified: true, given_name: 'Exist', family_name: 'Ing',
    });
    const callback = await runCallback('google', 'google-match');
    const body = await exchangeHandoff(callback.headers.location as string);
    expect(body.user.id).toBe(existing.id);
    const links = await http(app).get('/api/v1/auth/oauth/links').set('Authorization', `Bearer ${body.accessToken}`);
    expect(links.body.hasPassword).toBe(true);
    expect(links.body.links).toHaveLength(1);
    expect(links.body.links[0].issuer).toBe('google');
  });

  it('từ chối hồ sơ google có email chưa xác minh và không tạo gì', async () => {
    const email = `${uniqueName('unverified')}@example.com`;
    profilesByCode.set('google-unverified', {
      sub: `g-${uniqueName('sub')}`, email, email_verified: false, given_name: 'Un', family_name: 'Verified',
    });
    const callback = await runCallback('google', 'google-unverified');
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('/login?oauthError=auth.oauth_email_unverified');
    const search = await http(app).get(`/api/v1/users?search=${encodeURIComponent(email)}`).set('Authorization', `Bearer ${admin}`);
    expect(search.body.total).toBe(0);
  });

  it('từ chối callback có state bị sửa và mã lạ', async () => {
    const authorizeRes = await http(app).get('/api/v1/auth/oauth/google/authorize');
    const state = new URL(authorizeRes.body.authorizeUrl as string).searchParams.get('state')!;
    const tampered = await http(app).get(`/api/v1/auth/oauth/google/callback?code=google-new&state=${state}x`);
    expect(tampered.status).toBe(302);
    expect(tampered.headers.location).toContain('/login?oauthError=auth.oauth_state_invalid');
    const badCode = await http(app).get(`/api/v1/auth/oauth/google/callback?code=no-such-code&state=${encodeURIComponent(state)}`);
    expect(badCode.status).toBe(302);
    expect(badCode.headers.location).toContain('/login?oauthError=auth.oauth_token_exchange_failed');
  });

  it('người đã đăng nhập có thể liên kết tài khoản facebook, và huỷ liên kết tôn trọng quy tắc phương thức đăng nhập cuối', async () => {
    const user = await createUserViaApi(app, admin);
    const session = await login(app, user.username, STRONG_PASSWORD);
    profilesByCode.set('facebook-link', {
      id: `f-${uniqueName('sub')}`, email: `${uniqueName('fb')}@example.com`, first_name: 'Face', last_name: 'Book',
    });
    const callback = await runCallback('facebook', 'facebook-link', session.accessToken);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('/oauth/callback?handoff=');
    const links = await http(app).get('/api/v1/auth/oauth/links').set('Authorization', `Bearer ${session.accessToken}`);
    expect(links.body.links).toHaveLength(1);
    expect(links.body.links[0].issuer).toBe('facebook');
    const unlink = await http(app).delete(`/api/v1/auth/oauth/links/${links.body.links[0].id}`).set('Authorization', `Bearer ${session.accessToken}`);
    expect(unlink.status).toBe(200);
    const after = await http(app).get('/api/v1/auth/oauth/links').set('Authorization', `Bearer ${session.accessToken}`);
    expect(after.body.links).toHaveLength(0);

    const email = `${uniqueName('oauthonly')}@example.com`;
    profilesByCode.set('google-only', {
      sub: `g-${uniqueName('sub')}`, email, email_verified: true, given_name: 'Only', family_name: 'Oauth',
    });
    const oauthCallback = await runCallback('google', 'google-only');
    const oauthBody = await exchangeHandoff(oauthCallback.headers.location as string);
    const oauthLinks = await http(app).get('/api/v1/auth/oauth/links').set('Authorization', `Bearer ${oauthBody.accessToken}`);
    const blocked = await http(app).delete(`/api/v1/auth/oauth/links/${oauthLinks.body.links[0].id}`)
      .set('Authorization', `Bearer ${oauthBody.accessToken}`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe('auth.last_login_method');
    const foreign = await http(app).delete(`/api/v1/auth/oauth/links/${oauthLinks.body.links[0].id}`)
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(foreign.status).toBe(404);
  });

  it('MFA: đăng nhập bằng session-cookie dừng ở thử thách và chỉ bước verify phiên mới tạo phiên (tool_mfa)', async () => {
    const user = await createUserViaApi(app, admin);
    const plain = await login(app, user.username, STRONG_PASSWORD);
    const secret = await enableMfaViaApi(app, plain.accessToken);

    const blocked = await http(app).post('/api/v1/auth/session/login').send({ username: user.username, password: STRONG_PASSWORD });
    expect(blocked.status).toBe(201);
    expect(blocked.body.mfaRequired).toBe(true);
    expect(blocked.body.sessionId).toBeUndefined();
    expect(blocked.headers['set-cookie']).toBeUndefined();
    const challenge = blocked.body.challengeToken as string;

    const crossToken = await http(app).post('/api/v1/auth/mfa/verify').send({ challengeToken: challenge, code: await currentTotpCode(secret) });
    expect(crossToken.status).toBe(401);
    expect(crossToken.body.code).toBe('auth.mfa_challenge_invalid');

    const wrong = await http(app).post('/api/v1/auth/session/mfa/verify')
      .send({ challengeToken: challenge, code: await wrongTotpCode(secret) });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('auth.mfa_invalid_code');

    const verified = await http(app).post('/api/v1/auth/session/mfa/verify')
      .send({ challengeToken: challenge, code: await currentTotpCode(secret) });
    expect(verified.status).toBe(201);
    expect(verified.body.sessionId).toBeTruthy();
    expect((verified.headers['set-cookie'] as unknown as string[]).join(';')).toContain('giaokhoa_session=');
    const me = await http(app).get('/api/v1/auth/session/me').set('x-session-id', verified.body.sessionId as string);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);

    const tokenBlocked = await http(app).post('/api/v1/auth/token').send({ username: user.username, password: STRONG_PASSWORD });
    expect(tokenBlocked.body.mfaRequired).toBe(true);
    const crossSession = await http(app).post('/api/v1/auth/session/mfa/verify')
      .send({ challengeToken: tokenBlocked.body.challengeToken, code: await currentTotpCode(secret) });
    expect(crossSession.status).toBe(401);
    expect(crossSession.body.code).toBe('auth.mfa_challenge_invalid');
  });

  it('phiên của tôi: danh sách đánh dấu phiên hiện tại, phiên khác thu hồi được từng cái và hàng loạt (report_usersessions)', async () => {
    const user = await createUserViaApi(app, admin);
    const firstRes = await http(app).post('/api/v1/auth/token')
      .set('User-Agent', 'Mozilla/5.0 (Token Browser)')
      .send({ username: user.username, password: STRONG_PASSWORD });
    expect(firstRes.status).toBe(201);
    const first = { accessToken: firstRes.body.accessToken as string, refreshToken: firstRes.body.refreshToken as string, userId: firstRes.body.user.id as string };
    const secondRes = await http(app).post('/api/v1/auth/login')
      .set('User-Agent', 'Mozilla/5.0 (Passport Browser)')
      .send({ username: user.username, password: STRONG_PASSWORD });
    expect(secondRes.status).toBe(201);
    const second = { accessToken: secondRes.body.accessToken as string, refreshToken: secondRes.body.refreshToken as string, userId: secondRes.body.user.id as string };
    const web = await http(app).post('/api/v1/auth/session/login')
      .set('User-Agent', 'Mozilla/5.0 (Test Browser)')
      .send({ username: user.username, password: STRONG_PASSWORD });
    const webSessionId = web.body.sessionId as string;

    const list = await http(app).get('/api/v1/auth/sessions').set('Authorization', `Bearer ${first.accessToken}`);
    expect(list.status).toBe(200);
    const sessions = list.body.sessions as { id: string; kind: string; current: boolean; userAgent: string | null; ip: string | null }[];
    const apiSessions = sessions.filter((s) => s.kind === 'api');
    const webSessions = sessions.filter((s) => s.kind === 'web');
    expect(apiSessions).toHaveLength(2);
    expect(apiSessions.some((s) => s.userAgent?.includes('Token Browser'))).toBe(true);
    expect(apiSessions.some((s) => s.userAgent?.includes('Passport Browser'))).toBe(true);
    for (const s of apiSessions) {
      expect(s.ip).toBeTruthy();
      expect(s.ip).toContain('127.0.0.1');
    }
    expect(apiSessions.filter((s) => s.current)).toHaveLength(1);
    expect(webSessions).toHaveLength(1);
    expect(webSessions[0]!.id).toBe(webSessionId);
    expect(webSessions[0]!.current).toBe(false);
    expect(webSessions[0]!.userAgent).toContain('Test Browser');
    expect(webSessions[0]!.ip).toBeTruthy();
    const listWithCookie = await http(app).get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${first.accessToken}`).set('Cookie', `giaokhoa_session=${webSessionId}`);
    const webNow = (listWithCookie.body.sessions as { id: string; current: boolean }[]).find((s) => s.id === webSessionId);
    expect(webNow!.current).toBe(true);

    const currentApi = apiSessions.find((s) => s.current)!;
    const revokeCurrent = await http(app).delete(`/api/v1/auth/sessions/${currentApi.id}`).set('Authorization', `Bearer ${first.accessToken}`);
    expect(revokeCurrent.status).toBe(400);
    expect(revokeCurrent.body.code).toBe('auth.cannot_revoke_current_session');

    const revokeWeb = await http(app).delete(`/api/v1/auth/sessions/${webSessionId}`).set('Authorization', `Bearer ${first.accessToken}`);
    expect(revokeWeb.status).toBe(200);
    expect(revokeWeb.body.revoked).toBe(1);
    const deadMe = await http(app).get('/api/v1/auth/session/me').set('x-session-id', webSessionId);
    expect(deadMe.status).toBe(401);

    const otherApi = apiSessions.find((s) => !s.current)!;
    const revokeApi = await http(app).delete(`/api/v1/auth/sessions/${otherApi.id}`).set('Authorization', `Bearer ${first.accessToken}`);
    expect(revokeApi.status).toBe(200);
    const deadRefresh = await http(app).post('/api/v1/auth/refresh').send({ refreshToken: second.refreshToken });
    expect(deadRefresh.status).toBe(401);

    const stranger = await createUserViaApi(app, admin);
    const strangerSession = await login(app, stranger.username, STRONG_PASSWORD);
    void strangerSession;
    const strangerList = await http(app).get('/api/v1/auth/sessions').set('Authorization', `Bearer ${strangerSession.accessToken}`);
    const strangerApiId = (strangerList.body.sessions as { id: string }[])[0]!.id;
    const foreign = await http(app).delete(`/api/v1/auth/sessions/${strangerApiId}`).set('Authorization', `Bearer ${first.accessToken}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('auth.session_not_found');

    const third = await login(app, user.username, STRONG_PASSWORD);
    void third;
    const bulk = await http(app).delete('/api/v1/auth/sessions/others').set('Authorization', `Bearer ${first.accessToken}`);
    expect(bulk.status).toBe(200);
    expect(bulk.body.revoked).toBeGreaterThanOrEqual(1);
    const afterList = await http(app).get('/api/v1/auth/sessions').set('Authorization', `Bearer ${first.accessToken}`);
    expect(afterList.body.sessions).toHaveLength(1);
    expect(afterList.body.sessions[0].current).toBe(true);
    const thirdDead = await http(app).post('/api/v1/auth/refresh').send({ refreshToken: third.refreshToken });
    expect(thirdDead.status).toBe(401);
  });

  it('khi không cấu hình env OAuth, provider báo đã tắt và authorize bị từ chối', async () => {
    const saved = [
      'OAUTH_GOOGLE_CLIENT_ID', 'OAUTH_GOOGLE_CLIENT_SECRET', 'OAUTH_FACEBOOK_CLIENT_ID', 'OAUTH_FACEBOOK_CLIENT_SECRET',
    ].map((key) => [key, process.env[key]] as const);
    for (const [key] of saved) delete process.env[key];
    let bareApp: INestApplication | undefined;
    try {
      bareApp = await createTestApp();
      const res = await http(bareApp).get('/api/v1/auth/oauth/providers');
      expect(res.body.providers).toEqual([
        { issuer: 'google', enabled: false },
        { issuer: 'facebook', enabled: false },
      ]);
      const authorize = await http(bareApp).get('/api/v1/auth/oauth/google/authorize');
      expect(authorize.status).toBe(404);
      expect(authorize.body.code).toBe('auth.oauth_issuer_not_configured');
    } finally {
      for (const [key, value] of saved) process.env[key] = value;
      if (bareApp) await bareApp.close();
    }
  });
});
