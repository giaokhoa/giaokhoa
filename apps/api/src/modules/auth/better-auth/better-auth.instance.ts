import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource as defaultCimdFetch } from '@better-auth/cimd/node';
import { kyselyAdapter } from '@better-auth/kysely-adapter';
import { mcp } from '@better-auth/mcp';
import { APIError, betterAuth } from 'better-auth';
import { createAuthMiddleware, type AuthMiddleware } from 'better-auth/api';
import { jwt, username } from 'better-auth/plugins';
import type { CentreDb } from '@giaokhoa/db';
import { PasswordService } from '../../users/password.service';
import { createEmailOtpPlugin, type AuthMailPort } from '../../mail/email-otp.plugin';
import { createMfaGateHook, type MfaGateDeps } from './mfa-gate';
import type { LockoutGuardPort } from '../login-lockout.service';
import { lockoutHooks } from './lockout.hooks';
import { MCP_OAUTH_SCOPES } from '../../mcp/mcp-scopes';
export { MCP_OAUTH_SCOPES } from '../../mcp/mcp-scopes';

export const BETTER_AUTH_BASE_PATH = '/api/v1/auth';

function withPostgresArrays<T extends {
  options?: { adapterConfig: { supportsArrays?: boolean | undefined } };
  transaction?: unknown;
}>(adapter: T): T {
  if (adapter.options) adapter.options.adapterConfig.supportsArrays = true;
  if (typeof adapter.transaction === 'function') {
    const baseTransaction = adapter.transaction as <R>(
      callback: (tx: {
        options: { adapterConfig: { supportsArrays?: boolean | undefined } };
      }) => Promise<R>,
    ) => Promise<R>;
    (adapter as {
      transaction: <R>(
        callback: (tx: {
          options: { adapterConfig: { supportsArrays?: boolean | undefined } };
        }) => Promise<R>,
      ) => Promise<R>;
    }).transaction = <R>(
      callback: (tx: {
        options: { adapterConfig: { supportsArrays?: boolean | undefined } };
      }) => Promise<R>,
    ) =>
      baseTransaction((tx) => {
        tx.options.adapterConfig.supportsArrays = true;
        return callback(tx);
      });
  }
  return adapter;
}


export const MCP_ACCESS_TOKEN_TTL_SECONDS = 3600;

export interface BetterAuthMcpAsConfig {
  resource: string;
  loginPage: string;
  consentPage: string;
  cimdFetch?: typeof defaultCimdFetch;
}

export const BETTER_AUTH_SESSION_COOKIE = 'better-auth.session_token';

export interface BetterAuthSocialConfig {
  google?: { clientId: string; clientSecret: string };
  facebook?: { clientId: string; clientSecret: string };
}

export interface BetterAuthFactoryDeps {
  db: CentreDb;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  passwordService: PasswordService;
  socialProviders?: BetterAuthSocialConfig | null;
  authMail?: AuthMailPort | null;
  legacyPasswordSync?: {
    syncFromCredentialAccount: (userId: string) => Promise<void>;
  } | null;
  sessionRevocation?: {
    revokeLegacySessions: (userId: string) => Promise<void>;
  } | null;
  mcpAs?: BetterAuthMcpAsConfig | null;
  lockout?: LockoutGuardPort | null;
  mfa?: MfaGateDeps | null;
}

function buildSocialProviders(config: BetterAuthSocialConfig | null | undefined) {
  if (!config) return undefined;
  const providers: Record<string, { clientId: string; clientSecret: string; disableImplicitSignUp: true; disableSignUp: true }> = {};
  if (config.google) providers.google = { ...config.google, disableImplicitSignUp: true, disableSignUp: true };
  if (config.facebook) providers.facebook = { ...config.facebook, disableImplicitSignUp: true, disableSignUp: true };
  return Object.keys(providers).length > 0 ? providers : undefined;
}

function composeAfterHooks(
  first: AuthMiddleware | undefined,
  second: AuthMiddleware,
) {
  if (!first) return second;
  return createAuthMiddleware(async (ctx) => {
    await invokeChainedHook(first, ctx);
    return invokeChainedHook(second, ctx);
  });
}

type ChainedHookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

async function invokeChainedHook(hook: AuthMiddleware, ctx: ChainedHookContext): Promise<unknown> {
  const result: unknown = await hook(ctx as never);
  if (
    result !== null &&
    typeof result === 'object' &&
    'response' in result &&
    'headers' in result &&
    (result as { headers: unknown }).headers instanceof Headers
  ) {
    const headers = (result as { headers: Headers }).headers;
    for (const cookie of headers.getSetCookie()) {
      ctx.responseHeaders.append('set-cookie', cookie);
    }
    for (const [key, value] of headers.entries()) {
      if (key !== 'set-cookie') ctx.responseHeaders.set(key, value);
    }
    return (result as { response: unknown }).response;
  }
  return result;
}

export function createBetterAuth(deps: BetterAuthFactoryDeps) {
  const mcpAs = deps.mcpAs ?? null;
  const lockoutHookSet = deps.lockout ? lockoutHooks(deps.lockout) : null;
  const mfaGate = createMfaGateHook({
    isMfaEnabled: deps.mfa?.isMfaEnabled,
  });
  return betterAuth({
    secret: deps.secret,
    baseURL: deps.baseURL,
    basePath: BETTER_AUTH_BASE_PATH,
    trustedOrigins: deps.trustedOrigins,
    socialProviders: buildSocialProviders(deps.socialProviders),
    user: {
      modelName: 'users',
      fields: {
        name: 'first_name',
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      accountLinking: {
        enabled: true,

        trustedProviders: [],
        requireLocalEmailVerified: true,
      },
    },
    verification: {
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    hooks: {
      ...(lockoutHookSet?.before ? { before: lockoutHookSet.before } : {}),
      after: composeAfterHooks(lockoutHookSet?.after, createAuthMiddleware(async (ctx) => {
        const gateResult = await invokeChainedHook(mfaGate, ctx);
        if (gateResult !== undefined) return gateResult;
        if (ctx.path !== '/change-password' && ctx.path !== '/set-password') return;
        if (ctx.context.returned instanceof APIError) return;
        const userId = ctx.context.session?.user?.id;
        if (!userId) return;
        if (deps.legacyPasswordSync) await deps.legacyPasswordSync.syncFromCredentialAccount(userId);
        if (ctx.path === '/change-password' && deps.sessionRevocation) {
          await deps.sessionRevocation.revokeLegacySessions(userId);
        }
      })),
    },
    ...(mcpAs ? { disabledPaths: ['/token'] } : {}),
    database: ((options) => {
      const baseAdapter = kyselyAdapter(deps.db, {
        type: 'postgres',
        transaction: true,
      });
      return withPostgresArrays(baseAdapter(options));
    }) as ReturnType<typeof kyselyAdapter>,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      revokeSessionsOnPasswordReset: true,
      ...(deps.authMail
        ? {
            sendResetPassword: async ({
              user,
              url,
            }: {
              user: { id: string; email: string };
              url: string;
              token: string;
            }): Promise<void> => {
              await deps.authMail!.sendPasswordResetEmail({ userId: user.id, email: user.email, url });
            },
          }
        : {}),
      ...(deps.legacyPasswordSync || deps.sessionRevocation
        ? {
            onPasswordReset: async ({ user }: { user: { id: string } }): Promise<void> => {
              if (deps.legacyPasswordSync) await deps.legacyPasswordSync.syncFromCredentialAccount(user.id);
              if (deps.sessionRevocation) await deps.sessionRevocation.revokeLegacySessions(user.id);
            },
          }
        : {}),
      password: {
        hash: async (password: string): Promise<string> => {
          const violations = deps.passwordService.validatePolicy(password);
          if (violations.length > 0) {
            throw new APIError('BAD_REQUEST', {
              message: `Password policy violated: ${violations.join('; ')}`,
            });
          }
          return deps.passwordService.hash(password);
        },
        verify: async ({ hash, password }: { hash: string; password: string }): Promise<boolean> =>
          deps.passwordService.verify(hash, password),
      },
    },
    plugins: [
      username({ displayUsername: false }),
      ...(deps.authMail ? [createEmailOtpPlugin(deps.authMail)] : []),
      ...(mcpAs
        ? [
            jwt({
              disableSettingJwtHeader: true,
              schema: {
                jwks: {
                  fields: {
                    publicKey: 'public_key',
                    privateKey: 'private_key',
                    createdAt: 'created_at',
                    expiresAt: 'expires_at',
                  },
                },
              },
            }),
            mcp({
              loginPage: mcpAs.loginPage,
              consentPage: mcpAs.consentPage,
              resource: mcpAs.resource,
              scopes: [...MCP_OAUTH_SCOPES, 'offline_access'],
              resources: [
                {
                  identifier: mcpAs.resource,
                  accessTokenTtl: MCP_ACCESS_TOKEN_TTL_SECONDS,
                },
              ],
              refreshTokenReuseInterval: 0,
              allowDynamicClientRegistration: true,
              allowUnauthenticatedClientRegistration: true,
              clientRegistrationDefaultApplicationType: 'infer',



              clientRegistrationDefaultScopes: ['giaokhoa.questions.read'],







              clientRegistrationAllowedScopes: [...MCP_OAUTH_SCOPES.filter((scope) => scope !== 'giaokhoa.questions.read'), 'offline_access'],









              schema: {
                oauthClient: {
                  modelName: 'oauth_client',
                  fields: {
                    clientId: 'client_id',
                    clientSecret: 'client_secret',
                    clientDiscoveryId: 'client_discovery_id',
                    skipConsent: 'skip_consent',
                    enableEndSession: 'enable_end_session',
                    subjectType: 'subject_type',
                    clientCredentialsScopes: 'client_credentials_scopes',
                    userId: 'user_id',
                    createdAt: 'created_at',
                    updatedAt: 'updated_at',
                    softwareId: 'software_id',
                    softwareVersion: 'software_version',
                    softwareStatement: 'software_statement',
                    redirectUris: 'redirect_uris',
                    postLogoutRedirectUris: 'post_logout_redirect_uris',
                    backchannelLogoutUri: 'backchannel_logout_uri',
                    backchannelLogoutSessionRequired:
                      'backchannel_logout_session_required',
                    tokenEndpointAuthMethod: 'token_endpoint_auth_method',
                    applicationType: 'application_type',
                    jwksUri: 'jwks_uri',
                    grantTypes: 'grant_types',
                    responseTypes: 'response_types',
                    requirePKCE: 'require_pkce',
                    dpopBoundAccessTokens: 'dpop_bound_access_tokens',
                    referenceId: 'reference_id',
                  },
                },
                oauthResource: {
                  modelName: 'oauth_resource',
                  fields: {
                    accessTokenTtl: 'access_token_ttl',
                    refreshTokenTtl: 'refresh_token_ttl',
                    signingAlgorithm: 'signing_algorithm',
                    signingKeyId: 'signing_key_id',
                    allowedScopes: 'allowed_scopes',
                    customClaims: 'custom_claims',
                    dpopBoundAccessTokensRequired:
                      'dpop_bound_access_tokens_required',
                    createdAt: 'created_at',
                    updatedAt: 'updated_at',
                    policyVersion: 'policy_version',
                  },
                },
                oauthClientResource: {
                  modelName: 'oauth_client_resource',
                  fields: {
                    clientId: 'client_id',
                    resourceId: 'resource_id',
                    createdAt: 'created_at',
                  },
                },
                oauthAccessToken: {
                  modelName: 'oauth_access_token',
                  fields: {
                    clientId: 'client_id',
                    sessionId: 'session_id',
                    userId: 'user_id',
                    referenceId: 'reference_id',
                    authorizationCodeId: 'authorization_code_id',
                    requestedUserInfoClaims: 'requested_user_info_claims',
                    refreshId: 'refresh_id',
                    expiresAt: 'expires_at',
                    createdAt: 'created_at',
                  },
                },
                oauthRefreshToken: {
                  modelName: 'oauth_refresh_token',
                  fields: {
                    clientId: 'client_id',
                    sessionId: 'session_id',
                    userId: 'user_id',
                    referenceId: 'reference_id',
                    authorizationCodeId: 'authorization_code_id',
                    requestedUserInfoClaims: 'requested_user_info_claims',
                    expiresAt: 'expires_at',
                    createdAt: 'created_at',
                    rotatedAt: 'rotated_at',
                    rotationReplayResponse: 'rotation_replay_response',
                    rotationReplayExpiresAt: 'rotation_replay_expires_at',
                    authTime: 'auth_time',
                  },
                },
                oauthConsent: {
                  modelName: 'oauth_consent',
                  fields: {
                    clientId: 'client_id',
                    userId: 'user_id',
                    referenceId: 'reference_id',
                    requestedUserInfoClaims: 'requested_user_info_claims',
                    createdAt: 'created_at',
                    updatedAt: 'updated_at',
                  },
                },
                oauthClientAssertion: {
                  modelName: 'oauth_client_assertion',
                  fields: {
                    expiresAt: 'expires_at',
                  },
                },
              },
            }),
            cimd({
              fetchClientMetadataResource: mcpAs.cimdFetch ?? defaultCimdFetch,
              metadataProfile: 'mcp-2026-07-28',
            }),
          ]
        : []),
    ],
    ...(deps.legacyPasswordSync
      ? {
          databaseHooks: {
            account: {
              create: {
                after: async (account: { providerId: string; userId: string }) => {
                  if (account.providerId === 'credential') {
                    await deps.legacyPasswordSync!.syncFromCredentialAccount(account.userId);
                  }
                },
              },
            },
          },
        }
      : {}),
    session: {
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        userId: 'user_id',
      },
      cookieCache: { enabled: false },
    },
    advanced: {
      disableOriginCheck: false,
      database: { generateId: 'uuid' },
    },
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
