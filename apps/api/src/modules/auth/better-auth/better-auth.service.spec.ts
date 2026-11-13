import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { SpaceDatabaseService } from '../../../db/routing/space-database.service';
import type { AuthRepository } from '@giaokhoa/db/repositories/auth';
import type { SessionService } from '../session.service';
import type { AuthMailService } from '../../mail/auth-mail.service';
import { PasswordService } from '../../users/password.service';
import type { LoginLockoutService } from '../login-lockout.service';
import { BetterAuthService } from './better-auth.service';

const SECRET = 'unit-test-secret-for-better-auth-0123456789';

function configStub(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const lockoutStub = {
  isLoginLocked: async () => false,
  recordLoginAttempt: async () => undefined,
} as unknown as LoginLockoutService;

function buildService(values: Record<string, unknown>): BetterAuthService {
  const config = configStub(values);
  const spaceDb = { routedKysely: {} } as unknown as SpaceDatabaseService;
  return new BetterAuthService(config, spaceDb, new PasswordService(config), undefined, lockoutStub);
}

describe('Khối BetterAuthService', () => {
  it('hoàn toàn trơ khi cờ đang tắt (mặc định)', () => {
    const service = buildService({});
    expect(service.enabled).toBe(false);
    expect(service.auth).toBeNull();
    expect(() => service.requireAuth()).toThrow(/not enabled/);
  });

  it('từ chối khởi tạo khi bật mà thiếu BETTER_AUTH_SECRET', () => {
    expect(() => buildService({ BETTER_AUTH_ENABLED: true, PORT: 3000 })).toThrow(
      /BETTER_AUTH_SECRET is required/,
    );
  });

  it('ghim các tuỳ chọn đã chốt trong issue #7 khi bật', () => {
    const service = buildService({ BETTER_AUTH_ENABLED: true, BETTER_AUTH_SECRET: SECRET, PORT: 3000 });
    expect(service.enabled).toBe(true);
    const auth = service.requireAuth();
    expect(auth.options.basePath).toBe('/api/v1/auth');
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
    expect(auth.options.advanced?.disableOriginCheck).toBe(false);
    expect(auth.options.advanced?.database?.generateId).toBe('uuid');
    expect(auth.options.session?.cookieCache?.enabled).toBe(false);
    expect(auth.options.plugins?.some((plugin) => plugin.id === 'username')).toBe(true);
    expect(auth.options.plugins?.some((plugin) => (plugin.id as string) === 'two-factor')).toBe(false);
    expect(auth.options.hooks?.before).toBeDefined();
    expect(auth.options.hooks?.after).toBeDefined();
  });

  it('mặc định giai đoạn cutover là tắt: không nối hook đồng bộ cũ nào', () => {
    const service = buildService({ BETTER_AUTH_ENABLED: true, BETTER_AUTH_SECRET: SECRET, PORT: 3000 });
    expect(service.cutoverStage).toBe('off');
    const auth = service.requireAuth();
    expect(auth.options.databaseHooks).toBeUndefined();
    expect(auth.options.emailAndPassword?.onPasswordReset).toBeUndefined();
  });

  it('từ chối khởi tạo khi AUTH_CUTOVER_STAGE=bake mà thiếu BETTER_AUTH_ENABLED', () => {
    expect(() => buildService({ AUTH_CUTOVER_STAGE: 'bake', PORT: 3000 })).toThrow(
      /AUTH_CUTOVER_STAGE=bake requires BETTER_AUTH_ENABLED/,
    );
  });

  it('nối đồng bộ cũ trong cửa sổ bake khi giai đoạn là bake và BA đang bật', () => {
    const service = buildService({
      BETTER_AUTH_ENABLED: true,
      BETTER_AUTH_SECRET: SECRET,
      AUTH_CUTOVER_STAGE: 'bake',
      PORT: 3000,
    });
    expect(service.cutoverStage).toBe('bake');
    const auth = service.requireAuth();
    expect(typeof auth.options.databaseHooks?.account?.create?.after).toBe('function');
    expect(Object.keys(auth.options.databaseHooks?.account ?? {})).toEqual(['create']);
    expect(typeof auth.options.emailAndPassword?.onPasswordReset).toBe('function');
  });

  it('reset mật khẩu Better Auth thu hồi refresh JWT và phiên Redis dù cutover đang off', async () => {
    const values = { BETTER_AUTH_ENABLED: true, BETTER_AUTH_SECRET: SECRET, PORT: 3000 };
    const config = configStub(values);
    const revokeJwt = vi.fn(async (_userId: string) => undefined);
    const revokeRedis = vi.fn(async (_userId: string) => 2);
    const service = new BetterAuthService(
      config,
      { routedKysely: {} } as unknown as SpaceDatabaseService,
      new PasswordService(config),
      undefined,
      lockoutStub,
      undefined,
      { revokeAllForUser: revokeJwt } as unknown as AuthRepository,
      { destroyAllForUser: revokeRedis } as unknown as SessionService,
    );
    expect(service.cutoverStage).toBe('off');
    const onReset = service.requireAuth().options.emailAndPassword?.onPasswordReset;
    expect(onReset).toBeDefined();
    await (onReset as unknown as (input: { user: { id: string } }) => Promise<void>)({ user: { id: 'reset-user-id' } });
    expect(revokeJwt).toHaveBeenCalledExactlyOnceWith('reset-user-id');
    expect(revokeRedis).toHaveBeenCalledExactlyOnceWith('reset-user-id');
  });

  it('không có bề mặt mail khi cổng mail chưa nối (giai đoạn 2.5 chưa kết nối)', () => {
    const service = buildService({ BETTER_AUTH_ENABLED: true, BETTER_AUTH_SECRET: SECRET, PORT: 3000 });
    const auth = service.requireAuth();
    expect(auth.options.emailAndPassword?.sendResetPassword).toBeUndefined();
    expect(auth.options.plugins?.some((plugin) => plugin.id === 'email-otp')).toBe(false);
  });

  it('nối cổng mail khi được cấp: reset callback, plugin email-otp, ghim thu hồi', async () => {
    const resetCalls: Array<{ userId: string; email: string; url: string }> = [];
    const mailPort = {
      sendPasswordResetEmail: async (input: { userId: string; email: string; url: string }) => {
        resetCalls.push(input);
      },
      sendEmailOtp: async () => undefined,
    } as unknown as AuthMailService;
    const config = configStub({ BETTER_AUTH_ENABLED: true, BETTER_AUTH_SECRET: SECRET, PORT: 3000 });
    const service = new BetterAuthService(
      config,
      { routedKysely: {} } as unknown as SpaceDatabaseService,
      new PasswordService(config),
      mailPort,
    );
    const auth = service.requireAuth();
    expect(auth.options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
    expect(auth.options.plugins?.some((plugin) => plugin.id === 'email-otp')).toBe(true);
    const sendReset = auth.options.emailAndPassword?.sendResetPassword;
    expect(typeof sendReset).toBe('function');
    await sendReset!({
      user: { id: 'user-1', email: 'u@example.com' } as never,
      url: 'https://app/reset-password/tok',
      token: 'tok',
    });
    expect(resetCalls).toEqual([{ userId: 'user-1', email: 'u@example.com', url: 'https://app/reset-password/tok' }]);
  });

  it('trơ với OAuth AS khi chỉ có MCP_AS_ENABLED đang tắt (mặc định)', () => {
    const service = buildService({});
    expect(service.mcpAsEnabled).toBe(false);
    expect(service.mcpAs).toBeNull();
  });

  it('từ chối khởi tạo khi MCP_AS_ENABLED mà thiếu BETTER_AUTH_SECRET', () => {
    expect(() => buildService({ MCP_AS_ENABLED: true, PORT: 3000 })).toThrow(/BETTER_AUTH_SECRET is required/);
  });

  it('ghép OAuth AS (jwt + oauth-provider + cimd) chỉ với MCP_AS_ENABLED (issue #163)', () => {
    const service = buildService({ MCP_AS_ENABLED: true, BETTER_AUTH_SECRET: SECRET, PORT: 3000 });
    expect(service.enabled).toBe(false);
    expect(service.mcpAsEnabled).toBe(true);
    expect(service.mcpAs?.resource).toBe('http://localhost:3000/mcp');
    expect(service.mcpAs?.loginPage).toBe('/mcp-login');
    expect(service.mcpAs?.consentPage).toBe('/mcp-consent');
    const auth = service.requireAuth();
    const pluginIds = (auth.options.plugins ?? []).map((plugin) => plugin.id);
    expect(pluginIds).toContain('jwt');
    expect(pluginIds).toContain('oauth-provider');
    expect(pluginIds).toContain('cimd');
    expect(auth.options.disabledPaths).toContain('/token');
    const pluginsJson = JSON.stringify(auth.options.plugins);
    expect(pluginsJson).toContain('"refreshTokenReuseInterval":0');
    expect(pluginsJson).toContain('"accessTokenTtl":3600');
  });
});
