import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';

const TWO_FACTOR_COOKIE_NAME = 'two_factor';
const TRUST_DEVICE_COOKIE_NAME = 'trust_device';
const TWO_FACTOR_CHALLENGE_MAX_AGE_SECONDS = 600;
const TRUST_DEVICE_MAX_AGE_SECONDS = 720 * 60 * 60;

const SIGN_IN_GATE_PATHS: ReadonlySet<string> = new Set(['/sign-in/username', '/sign-in/email', '/sign-in/email-otp']);

function randomIdentifier(length: number): string {
  return randomBytes(Math.ceil((length * 3) / 4))
    .toString('base64url')
    .slice(0, length);
}

function hmacSha256Base64Url(key: string, data: string): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

interface ReturnedRedirect {
  headers?: Headers | Record<string, string | undefined>;
}

function locationOf(returned: unknown): string | null {
  const headers = (returned as ReturnedRedirect | null)?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get('location');
  return headers.location ?? headers.Location ?? null;
}

type GateContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

async function consumeTrustDevice(ctx: GateContext, userId: string): Promise<boolean> {
  const cookieAttrs = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME, {
    maxAge: TRUST_DEVICE_MAX_AGE_SECONDS,
  });
  const cookie = await ctx.getSignedCookie(cookieAttrs.name, ctx.context.secret);
  if (!cookie) return false;
  const [token, trustIdentifier] = cookie.split('!');
  if (!token || !trustIdentifier) return false;
  const expected = hmacSha256Base64Url(ctx.context.secret, `${userId}!${trustIdentifier}`);
  if (!safeEqual(token, expected)) return false;
  const record = await ctx.context.internalAdapter.findVerificationValue(trustIdentifier);
  if (!record || record.value !== userId || record.expiresAt <= new Date()) return false;

  await ctx.context.internalAdapter.deleteVerificationByIdentifier(trustIdentifier);
  const newIdentifier = `trust-device-${randomIdentifier(32)}`;
  const newToken = hmacSha256Base64Url(ctx.context.secret, `${userId}!${newIdentifier}`);
  await ctx.context.internalAdapter.createVerificationValue({
    value: userId,
    identifier: newIdentifier,
    expiresAt: new Date(Date.now() + TRUST_DEVICE_MAX_AGE_SECONDS * 1000),
  });
  await ctx.setSignedCookie(cookieAttrs.name, `${newToken}!${newIdentifier}`, ctx.context.secret, cookieAttrs.attributes);
  return true;
}

export interface MfaGateDeps {
  isMfaEnabled?: (userId: string) => Promise<boolean>;
}

function twoFactorRedirectTarget(ctx: GateContext): string {
  const location = locationOf(ctx.context.returned);
  const fallback = `${ctx.context.baseURL}/login`;
  let url: URL;
  try {
    url = new URL(location ?? fallback, ctx.context.baseURL);
  } catch {
    url = new URL(fallback);
  }
  url.searchParams.set('twoFactorRedirect', 'true');
  return url.toString();
}

export function createMfaGateHook(deps: MfaGateDeps = {}) {
  return createAuthMiddleware(async (ctx) => {
    const isCallback = ctx.path.startsWith('/callback/');
    if (!isCallback && !SIGN_IN_GATE_PATHS.has(ctx.path)) return;
    const data = ctx.context.newSession;
    if (!data) return;
    if (!deps.isMfaEnabled) return;
    const { session, user } = data;
    let mfaEnabled: boolean;
    try {
      mfaEnabled = await deps.isMfaEnabled(user.id);
    } catch (err) {
      ctx.context.logger?.error(
        `MFA gate could not verify MFA status for user ${user.id}: ${String(err)}`,
      );
      deleteSessionCookie(ctx, true);
      await ctx.context.internalAdapter.deleteSession(session.token);
      ctx.context.setNewSession(null);
      throw new APIError('INTERNAL_SERVER_ERROR', {
        message: 'Could not verify multi-factor authentication status',
        code: 'mfa_status_unavailable',
      });
    }
    if (!mfaEnabled) return;
    if (await consumeTrustDevice(ctx, user.id)) return;

    deleteSessionCookie(ctx, true);
    await ctx.context.internalAdapter.deleteSession(session.token);
    ctx.context.setNewSession(null);

    const identifier = `2fa-${randomIdentifier(20)}`;
    const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_MAX_AGE_SECONDS * 1000);
    await ctx.context.internalAdapter.createVerificationValue({
      value: user.id,
      identifier,
      expiresAt,
    });
    await ctx.context.internalAdapter.createVerificationValue({
      value: '0',
      identifier: `2fa-attempts-${identifier}`,
      expiresAt,
    });
    const twoFactorCookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME, {
      maxAge: TWO_FACTOR_CHALLENGE_MAX_AGE_SECONDS,
    });
    await ctx.setSignedCookie(twoFactorCookie.name, identifier, ctx.context.secret, twoFactorCookie.attributes);

    if (isCallback) {
      throw ctx.redirect(twoFactorRedirectTarget(ctx));
    }
    return ctx.json({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
  });
}
