import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { constantTimeEqual, makeSignature } from 'better-auth/crypto';
import { createHash } from 'node:crypto';
import { sql, type CentreTx } from '@giaokhoa/db';
import { clientIpOf } from '../../../common/client-ip';
import type { Request } from 'express';
import type { CentreDb } from '@giaokhoa/db';
import { SpaceDatabaseService } from '../../../db/routing/space-database.service';
import { TotpService } from '../totp.service';
import { BetterAuthService } from './better-auth.service';
import { CredentialBridgeService } from './credential-bridge.service';

const MAX_CHALLENGE_ATTEMPTS = 5;
const MFA_WINDOW_MS = 20 * 60_000;
const MAX_USER_MFA_FAILURES = 10;
const MAX_IP_MFA_FAILURES = 500;
const TWO_FACTOR_COOKIE_NAME = 'two_factor';

export class TwoFactorCompletionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TwoFactorCompletionError';
  }
}

type AttemptResult = 'valid' | 'invalid' | 'exhausted' | 'invalid-cookie' | 'unavailable';

export interface TwoFactorCompletionResult {
  sessionCookieName: string;
  sessionCookieValue: string;
  sessionCookieAttributes: Record<string, unknown>;
  sessionExpiresAt: Date;
  twoFactorCookieName: string;
  twoFactorCookieAttributes: Record<string, unknown>;
  body: { token: string; user: Record<string, unknown> };
}

interface ResolvedChallenge {
  identifier: string;
  userId: string;
  expiresAt: Date;
  twoFactorCookieName: string;
  twoFactorCookieAttributes: Record<string, unknown>;
}

@Injectable()
export class TwoFactorCompletionService {
  private readonly db: CentreDb;

  constructor(
    spaceDb: SpaceDatabaseService,
    private readonly betterAuth: BetterAuthService,
    private readonly bridge: CredentialBridgeService,
    @Optional()
    @Inject(forwardRef(() => TotpService))
    private readonly totp?: TotpService,
  ) {
    this.db = spaceDb.routedKysely;
  }

  async verifyTotp(req: Request, code: string): Promise<TwoFactorCompletionResult> {
    const challenge = await this.resolveChallenge(req);
    const result = await this.runChallengeAttempt(
      challenge,
      clientIpOf(req),
      async () => {
        if (!this.totp) throw new Error('TOTP service unavailable');
        return this.totp.verifyForUser(challenge.userId, code);
      },
    );
    if (result === 'valid') return this.issueSession(challenge);
    this.throwForAttempt(result, 'INVALID_CODE');
  }

  async verifyBackupCode(req: Request): Promise<never> {
    const challenge = await this.resolveChallenge(req);
    const result = await this.runChallengeAttempt(
      challenge,
      clientIpOf(req),
      async () => false,
    );
    this.throwForAttempt(result, 'INVALID_BACKUP_CODE');
  }

  private throwForAttempt(result: AttemptResult, invalidCode: 'INVALID_CODE' | 'INVALID_BACKUP_CODE'): never {
    if (result === 'invalid') {
      throw new TwoFactorCompletionError(invalidCode === 'INVALID_CODE' ? 401 : 400, invalidCode, 'Invalid code');
    }
    if (result === 'exhausted') {
      throw new TwoFactorCompletionError(400, 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', 'Too many attempts. Please request a new code.');
    }
    if (result === 'unavailable') {
      throw new TwoFactorCompletionError(500, 'mfa_status_unavailable', 'Could not verify multi-factor authentication status');
    }
    throw new TwoFactorCompletionError(401, 'INVALID_TWO_FACTOR_COOKIE', 'Invalid two factor cookie');
  }

  private async resolveChallenge(req: Request): Promise<ResolvedChallenge> {
    let auth: ReturnType<BetterAuthService['requireAuth']>;
    try {
      auth = this.betterAuth.requireAuth();
    } catch {
      throw new TwoFactorCompletionError(404, 'NOT_FOUND', 'Not found');
    }
    const ctx = await auth.$context;
    const cookieAttrs = ctx.createAuthCookie(TWO_FACTOR_COOKIE_NAME, { maxAge: 600 });
    const origin = req.headers.origin;
    if (origin) {
      const trustedOrigins = ctx.options.trustedOrigins ?? [];
      let baseOrigin: string | null;
      try {
        baseOrigin = new URL(ctx.baseURL).origin;
      } catch {
        baseOrigin = null;
      }
      if (origin !== baseOrigin && !trustedOrigins.includes(origin)) {
        throw new TwoFactorCompletionError(403, 'FORBIDDEN', 'Forbidden');
      }
    }
    const invalid = () =>
      new TwoFactorCompletionError(401, 'INVALID_TWO_FACTOR_COOKIE', 'Invalid two factor cookie');
    const rawCookie = cookieValueOf(req, cookieAttrs.name);
    if (!rawCookie) throw invalid();
    const dot = rawCookie.lastIndexOf('.');
    if (dot <= 0) throw invalid();
    const identifier = rawCookie.slice(0, dot);
    const signature = rawCookie.slice(dot + 1);
    const expected = await makeSignature(identifier, ctx.secret);
    if (!constantTimeEqual(Buffer.from(signature), Buffer.from(expected))) throw invalid();
    if (!identifier.startsWith('2fa-')) throw invalid();
    const pending = await this.db
      .selectFrom('verification')
      .selectAll()
      .where('identifier', '=', identifier)
      .limit(1)
      .executeTakeFirst();
    if (!pending || pending.expires_at <= new Date()) throw invalid();
    return {
      identifier,
      userId: pending.value,
      expiresAt: pending.expires_at,
      twoFactorCookieName: cookieAttrs.name,
      twoFactorCookieAttributes: cookieAttrs.attributes as Record<string, unknown>,
    };
  }

  private async runChallengeAttempt(
    challenge: ResolvedChallenge,
    ip: string | undefined,
    verifyFactor: () => Promise<boolean>,
  ): Promise<AttemptResult> {
    return this.db.transaction().execute(async (trx) => {
      const budgets = this.budgetKeys(challenge.userId, ip);
      for (const budget of budgets) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${budget.identifier}))`.execute(trx);
      }
      for (const budget of budgets) {
        const current = await trx.selectFrom('verification')
          .select(['value', 'expires_at'])
          .where('identifier', '=', budget.identifier)
          .executeTakeFirst();
        if (current && current.expires_at > new Date() && Number(current.value) >= budget.limit) {
          throw new TwoFactorCompletionError(429, 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', 'Too many attempts. Please try again later.');
        }
      }

      const pending = await trx.selectFrom('verification')
        .select(['id', 'value', 'expires_at'])
        .where('identifier', '=', challenge.identifier)
        .forUpdate()
        .executeTakeFirst();
      if (!pending || pending.value !== challenge.userId || pending.expires_at <= new Date()) {
        return 'invalid-cookie';
      }
      const attemptsRow = await trx.selectFrom('verification')
        .select(['id', 'value'])
        .where('identifier', '=', '2fa-attempts-' + challenge.identifier)
        .forUpdate()
        .executeTakeFirst();
      const parsed = attemptsRow ? Number(attemptsRow.value) : Number.NaN;
      const attempts = Number.isInteger(parsed) && parsed >= 0 ? parsed : MAX_CHALLENGE_ATTEMPTS;
      if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
        await trx.deleteFrom('verification').where('id', '=', pending.id).execute();
        if (attemptsRow) await trx.deleteFrom('verification').where('id', '=', attemptsRow.id).execute();
        return 'exhausted';
      }

      let valid: boolean;
      try {
        valid = await verifyFactor();
      } catch {
        return 'unavailable';
      }
      if (!valid) {
        await this.recordMfaFailure(trx, budgets);
        await trx.updateTable('verification')
          .set({ value: String(attempts + 1) })
          .where('id', '=', attemptsRow!.id)
          .execute();
        return 'invalid';
      }
      await trx.deleteFrom('verification').where('id', '=', pending.id).execute();
      await trx.deleteFrom('verification').where('id', '=', attemptsRow!.id).execute();
      return 'valid';
    });
  }

  private budgetKeys(userId: string, ip?: string): Array<{ identifier: string; limit: number }> {
    return [
      { identifier: 'mfa-fail-user-' + userId, limit: MAX_USER_MFA_FAILURES },
      ...(ip ? [{ identifier: 'mfa-fail-ip-' + createHash('sha256').update(ip).digest('hex'), limit: MAX_IP_MFA_FAILURES }] : []),
    ];
  }

  private async recordMfaFailure(trx: CentreTx, budgets: Array<{ identifier: string; limit: number }>): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MFA_WINDOW_MS);
    for (const { identifier } of budgets) {
      const row = await trx.selectFrom('verification')
        .select(['id', 'value', 'expires_at'])
        .where('identifier', '=', identifier)
        .executeTakeFirst();
      if (!row) {
        await trx.insertInto('verification')
          .values({ identifier, value: '1', expires_at: expiresAt })
          .execute();
        continue;
      }
      const expired = row.expires_at <= now;
      await trx.updateTable('verification')
        .set({
          value: String(expired ? 1 : Number(row.value) + 1),
          expires_at: expired ? expiresAt : row.expires_at,
        })
        .where('id', '=', row.id)
        .execute();
    }
  }

  private async issueSession(challenge: ResolvedChallenge): Promise<TwoFactorCompletionResult> {
    const ctx = await this.betterAuth.requireAuth().$context;
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'username', 'first_name', 'last_name', 'email_verified', 'created_at', 'updated_at'])
      .where('id', '=', challenge.userId)
      .limit(1)
      .executeTakeFirst();
    if (!user) {
      throw new TwoFactorCompletionError(401, 'INVALID_TWO_FACTOR_COOKIE', 'Invalid two factor cookie');
    }
    const session = await this.bridge.createProgrammaticSession(user.id);
    return {
      sessionCookieName: ctx.authCookies.sessionToken.name,
      sessionCookieValue: session.signedCookieValue,
      sessionCookieAttributes: ctx.authCookies.sessionToken.attributes as Record<string, unknown>,
      sessionExpiresAt: session.expiresAt,
      twoFactorCookieName: challenge.twoFactorCookieName,
      twoFactorCookieAttributes: challenge.twoFactorCookieAttributes,
      body: {
        token: session.token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: `${user.first_name} ${user.last_name}`.trim(),
          emailVerified: user.email_verified,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        },
      },
    };
  }
}

function cookieValueOf(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
