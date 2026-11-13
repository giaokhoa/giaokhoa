import { describe, expect, it, vi } from 'vitest';
import { createMfaGateHook, type MfaGateDeps } from './mfa-gate';

describe('MfaGate — cổng MFA theo user_totp cho mọi đường đăng nhập', () => {
  const SESSION_TOKEN = 'session-token-1';
  const USER_ID = 'user-1';

  function buildCtx(opts: { path?: string; user?: Record<string, unknown> } = {}) {
    const calls = {
      deleteSession: vi.fn(async (_token: string) => {}),
      setNewSession: vi.fn((_value: unknown) => {}),
      createVerificationValue: vi.fn(async (_value: unknown) => ({})),
      logError: vi.fn((_message: string) => {}),
    };
    const ctx = {
      path: opts.path ?? '/callback/google',
      headers: new Headers(),
      responseHeaders: new Headers(),
      setCookie: vi.fn(),
      getSignedCookie: vi.fn(async () => undefined),
      setSignedCookie: vi.fn(async () => {}),
      redirect: (url: string) => ({ name: 'GateRedirect', url }),
      json: (body: unknown) => ({ name: 'GateJson', body }),
      context: {
        newSession: {
          session: { token: SESSION_TOKEN },
          user: { id: USER_ID, ...(opts.user ?? {}) },
        },
        secret: 's'.repeat(32),
        baseURL: 'http://localhost:3100',
        returned: undefined,
        logger: { error: calls.logError },
        options: { account: {} },
        oauthConfig: { storeStateStrategy: 'database' },
        authCookies: {
          sessionToken: { name: 'better-auth.session_token', attributes: {} },
          sessionData: { name: 'better-auth.session_data', attributes: {} },
          accountData: { name: 'better-auth.account_data', attributes: {} },
          dontRememberToken: { name: 'better-auth.dont_remember', attributes: {} },
        },
        createAuthCookie: (name: string, cookieOpts?: { maxAge?: number }) => ({
          name: `better-auth.${name}`,
          attributes: cookieOpts?.maxAge ? { maxAge: cookieOpts.maxAge } : {},
        }),
        setNewSession: calls.setNewSession,
        internalAdapter: {
          deleteSession: calls.deleteSession,
          createVerificationValue: calls.createVerificationValue,
          findVerificationValue: vi.fn(async () => null),
          deleteVerificationByIdentifier: vi.fn(async () => {}),
        },
        adapter: { findOne: vi.fn(async () => null) },
      },
    };
    return { ctx, calls };
  }

  const enabledDeps = (): MfaGateDeps => ({
    isMfaEnabled: vi.fn(async () => true),
  });

  it('tra cứu trạng thái lỗi ở đường callback: phiên bị huỷ ở cả hai tầng, có log, đăng nhập bị dừng bằng lỗi mfa_status_unavailable', async () => {
    const { ctx, calls } = buildCtx();
    const deps: MfaGateDeps = {
      isMfaEnabled: vi.fn(async () => {
        throw new Error('database connection lost');
      }),
    };
    const hook = createMfaGateHook(deps);

    const failure = await hook(ctx as never).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeTruthy();
    expect((failure as { body?: { code?: string } }).body?.code).toBe('mfa_status_unavailable');
    expect(calls.deleteSession).toHaveBeenCalledTimes(1);
    expect(calls.deleteSession).toHaveBeenCalledWith(SESSION_TOKEN);
    expect(calls.setNewSession).toHaveBeenCalledTimes(1);
    expect(calls.setNewSession).toHaveBeenCalledWith(null);
    expect(calls.logError).toHaveBeenCalledTimes(1);
    expect(calls.createVerificationValue).not.toHaveBeenCalled();
  });

  it('chưa bật MFA: đi qua ở cả đường callback và đường sign-in, không đụng phiên', async () => {
    for (const path of ['/callback/google', '/sign-in/username', '/sign-in/email-otp']) {
      const { ctx, calls } = buildCtx({ path });
      const hook = createMfaGateHook({ isMfaEnabled: vi.fn(async () => false) });

      await expect(hook(ctx as never)).resolves.toBeUndefined();

      expect(calls.deleteSession).not.toHaveBeenCalled();
      expect(calls.setNewSession).not.toHaveBeenCalled();
      expect(calls.logError).not.toHaveBeenCalled();
    }
  });

  it('đã bật MFA ở đường callback: huỷ phiên, phát dấu chờ bước hai, ném redirect', async () => {
    const { ctx, calls } = buildCtx();
    const hook = createMfaGateHook(enabledDeps());

    const thrown = await hook(ctx as never).then(
      () => null,
      (error: unknown) => error,
    );

    const redirectError = thrown as { status?: string; headers?: Headers };
    expect(redirectError.status).toBe('FOUND');
    expect(redirectError.headers?.get('location')).toContain('twoFactorRedirect=true');
    expect(calls.deleteSession).toHaveBeenCalledWith(SESSION_TOKEN);
    expect(calls.setNewSession).toHaveBeenCalledWith(null);
    expect(calls.createVerificationValue).toHaveBeenCalledTimes(2);
  });

  it.each(['/sign-in/username', '/sign-in/email', '/sign-in/email-otp'])(
    'đã bật MFA ở đường %s: huỷ phiên, phát dấu chờ, trả JSON twoFactorRedirect thay cho đáp ứng đăng nhập',
    async (path) => {
      const { ctx, calls } = buildCtx({ path });
      const hook = createMfaGateHook(enabledDeps());

      const returned = (await hook(ctx as never)) as { twoFactorRedirect?: boolean; twoFactorMethods?: string[] } | undefined;

      expect(returned?.twoFactorRedirect).toBe(true);
      expect(returned?.twoFactorMethods).toEqual(['totp']);
      expect(calls.deleteSession).toHaveBeenCalledWith(SESSION_TOKEN);
      expect(calls.setNewSession).toHaveBeenCalledWith(null);
      expect(calls.createVerificationValue).toHaveBeenCalledTimes(2);
    },
  );

  it('đường ngoài phạm vi đăng nhập: hook đi qua dù có phiên mới, không tra cứu', async () => {
    const { ctx, calls } = buildCtx({ path: '/change-password' });
    const isMfaEnabled = vi.fn(async () => true);
    const hook = createMfaGateHook({ isMfaEnabled });

    await expect(hook(ctx as never)).resolves.toBeUndefined();

    expect(isMfaEnabled).not.toHaveBeenCalled();
    expect(calls.deleteSession).not.toHaveBeenCalled();
  });

  it('không có phụ thuộc MFA (instance kiểm chứng tối thiểu): hook đi qua, không tra cứu, không đụng phiên', async () => {
    const { ctx, calls } = buildCtx({ path: '/sign-in/username' });
    const hook = createMfaGateHook({});

    await expect(hook(ctx as never)).resolves.toBeUndefined();

    expect(calls.deleteSession).not.toHaveBeenCalled();
    expect(calls.setNewSession).not.toHaveBeenCalled();
  });
});
