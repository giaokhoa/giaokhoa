import { APIError, createAuthMiddleware } from 'better-auth/api';
import { normalizeIpAddress } from '../../../common/client-ip';
import {
  AUTH_LOCKED_OUT_CODE,
  AUTH_LOCKED_OUT_MESSAGE,
  type LockoutGuardPort,
  type LoginIdentifier,
} from '../login-lockout.service';

const CREDENTIAL_SIGN_IN_PATHS: ReadonlySet<string> = new Set(['/sign-in/username', '/sign-in/email']);

function identifierOf(path: string, body: unknown): LoginIdentifier | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (path === '/sign-in/username') {
    return typeof record.username === 'string' && record.username.length > 0
      ? { username: record.username }
      : null;
  }
  return typeof record.email === 'string' && record.email.length > 0
    ? { email: record.email }
    : null;
}

function clientIpOf(headers: Headers | undefined): string | undefined {
  const forwarded = headers?.get('x-forwarded-for');
  if (!forwarded) return undefined;
  const parts = forwarded
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return normalizeIpAddress(parts[parts.length - 1]);
}

function isCredentialFailure(returned: unknown): boolean {
  if (!(returned instanceof APIError)) return false;
  if (returned.body?.code === AUTH_LOCKED_OUT_CODE) return false;
  return returned.statusCode === 401;
}

export function lockoutHooks(lockout: LockoutGuardPort) {
  const before = createAuthMiddleware(async (ctx) => {
    if (!CREDENTIAL_SIGN_IN_PATHS.has(ctx.path)) return;
    const identifier = identifierOf(ctx.path, ctx.body);
    if (!identifier) return;
    if (await lockout.isLoginLocked(identifier)) {
      throw new APIError('UNAUTHORIZED', {
        message: AUTH_LOCKED_OUT_MESSAGE,
        code: AUTH_LOCKED_OUT_CODE,
      });
    }
  });

  const after = createAuthMiddleware(async (ctx) => {
    if (!CREDENTIAL_SIGN_IN_PATHS.has(ctx.path)) return;
    const identifier = identifierOf(ctx.path, ctx.body);
    if (!identifier) return;
    const returned = ctx.context.returned;
    const success = !(returned instanceof APIError);
    if (!success && !isCredentialFailure(returned)) return;
    try {
      await lockout.recordLoginAttempt(identifier, success, clientIpOf(ctx.headers));
    } catch (err) {
      ctx.context.logger?.error(
        `login attempt not recorded for sign-in (path ${ctx.path}): ${String(err)}`,
      );
    }
  });

  return { before, after };
}
