import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpaceDatabaseService } from '../../../db/routing/space-database.service';
import { AuthRepository } from '@giaokhoa/db/repositories/auth';
import { SessionService } from '../session.service';
import { PasswordService } from '../../users/password.service';
import { AuthMailService } from '../../mail/auth-mail.service';
import { LoginLockoutService } from '../login-lockout.service';
import { TotpService } from '../totp.service';
import {
  BETTER_AUTH_SESSION_COOKIE,
  createBetterAuth,
  type BetterAuthInstance,
  type BetterAuthMcpAsConfig,
  type BetterAuthSocialConfig,
} from './better-auth.instance';

export type AuthCutoverStage = 'off' | 'bake';

@Injectable()
export class BetterAuthService {
  private readonly logger = new Logger(BetterAuthService.name);

  readonly enabled: boolean;
  readonly mcpAsEnabled: boolean;
  readonly auth: BetterAuthInstance | null;
  readonly mcpAs: BetterAuthMcpAsConfig | null;
  readonly socialProvidersEnabled: readonly ('google' | 'facebook')[];
  readonly cutoverStage: AuthCutoverStage;
  readonly sessionCookieName: string;
  readonly sessionCookieSecure: boolean;

  constructor(
    config: ConfigService,
    spaceDb: SpaceDatabaseService,
    passwordService: PasswordService,
    @Optional() authMail?: AuthMailService,
    @Optional()
    @Inject(forwardRef(() => LoginLockoutService))
    lockout?: LoginLockoutService,
    @Optional()
    @Inject(forwardRef(() => TotpService))
    totp?: TotpService,
    @Optional()
    @Inject(forwardRef(() => AuthRepository))
    authRepository?: AuthRepository,
    @Optional()
    @Inject(forwardRef(() => SessionService))
    sessionService?: SessionService,
  ) {
    this.enabled = config.get<boolean>('BETTER_AUTH_ENABLED') ?? false;
    this.mcpAsEnabled = config.get<boolean>('MCP_AS_ENABLED') ?? false;
    const socialProviders = readSocialConfig(config);
    this.socialProvidersEnabled = [
      ...(socialProviders.google ? (['google'] as const) : []),
      ...(socialProviders.facebook ? (['facebook'] as const) : []),
    ];
    this.cutoverStage = config.get<AuthCutoverStage>('AUTH_CUTOVER_STAGE') ?? 'off';
    if (this.cutoverStage === 'bake' && !this.enabled) {
      throw new Error(
        'AUTH_CUTOVER_STAGE=bake requires BETTER_AUTH_ENABLED=true (the bake window runs on Better Auth sessions)',
      );
    }
    if (!this.enabled && !this.mcpAsEnabled) {
      this.auth = null;
      this.mcpAs = null;
      this.sessionCookieName = BETTER_AUTH_SESSION_COOKIE;
      this.sessionCookieSecure = false;
      return;
    }
    const secret = config.get<string>('BETTER_AUTH_SECRET');
    if (!secret) {
      throw new Error(
        'BETTER_AUTH_SECRET is required when BETTER_AUTH_ENABLED or MCP_AS_ENABLED is true',
      );
    }
    const baseURL =
      config.get<string>('BETTER_AUTH_URL') ?? `http://localhost:${config.get<number>('PORT') ?? 3000}`;
    this.sessionCookieSecure = baseURL.startsWith('https://');
    this.sessionCookieName = this.sessionCookieSecure
      ? `__Secure-${BETTER_AUTH_SESSION_COOKIE}`
      : BETTER_AUTH_SESSION_COOKIE;
    const extraOrigins = (config.get<string>('BETTER_AUTH_TRUSTED_ORIGINS') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    const mcpPublicBase = (
      config.get<string>('MCP_PUBLIC_BASE_URL') ??
      config.get<string>('BETTER_AUTH_URL') ??
      baseURL
    ).replace(/\/+$/, '');
    this.mcpAs = this.mcpAsEnabled
      ? {
          resource: `${mcpPublicBase}/mcp`,
          loginPage: '/mcp-login',
          consentPage: '/mcp-consent',
        }
      : null;

    this.auth = createBetterAuth({
      db: spaceDb.routedKysely,
      secret,
      baseURL,
      trustedOrigins: [...new Set([baseURL, ...extraOrigins])],
      passwordService,
      authMail: authMail ?? null,
      mcpAs: this.mcpAs,
      socialProviders,
      lockout: lockout ?? null,
      mfa: totp ? { isMfaEnabled: (userId: string) => totp.isEnabled(userId) } : null,
      sessionRevocation: authRepository && sessionService
        ? {
            revokeLegacySessions: async (userId: string): Promise<void> => {
              await Promise.all([
                authRepository.revokeAllForUser(userId),
                sessionService.destroyAllForUser(userId),
              ]);
            },
          }
        : null,
      legacyPasswordSync:
        this.cutoverStage === 'bake'
          ? {
              syncFromCredentialAccount: async (userId: string): Promise<void> => {
                try {
                  const row = await spaceDb.routedKysely
                    .selectFrom('account')
                    .select('password')
                    .where('user_id', '=', userId)
                    .where('provider_id', '=', 'credential')
                    .limit(1)
                    .executeTakeFirst();
                  if (!row?.password) return;
                  await spaceDb.routedKysely
                    .updateTable('users')
                    .set({ password_hash: row.password })
                    .where('id', '=', userId)
                    .execute();
                } catch (err) {
                  this.logger.warn(`legacy password sync failed for user ${userId}: ${String(err)}`);
                }
              },
            }
          : null,
    });
  }

  requireAuth(): BetterAuthInstance {
    if (!this.auth) {
      throw new Error(
        'Better Auth is not enabled (BETTER_AUTH_ENABLED and MCP_AS_ENABLED are both off)',
      );
    }
    return this.auth;
  }
}

function readSocialConfig(config: ConfigService): BetterAuthSocialConfig {
  const googleId = config.get<string>('GOOGLE_CLIENT_ID');
  const googleCred = config.get<string>('GOOGLE_CLIENT_SECRET');
  const facebookId = config.get<string>('FACEBOOK_APP_ID');
  const facebookCred = config.get<string>('FACEBOOK_APP_SECRET');
  return {
    ...(googleId && googleCred ? { google: { clientId: googleId, clientSecret: googleCred } } : {}),
    ...(facebookId && facebookCred
      ? { facebook: { clientId: facebookId, clientSecret: facebookCred } }
      : {}),
  };
}
