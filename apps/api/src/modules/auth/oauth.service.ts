import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { OAuthIssuer } from '@giaokhoa/contracts';
import { SessionCacheService } from '../../infra/cache/session-cache.service';
import { UsersService } from '../users/users.service';
import type { UserRow } from '@giaokhoa/db/repositories/users';
import { AuthRepository, type UserOauthLinkRow } from '@giaokhoa/db/repositories/auth';
import { AuthService, type SessionClientInfo } from './auth.service';
import { SessionService } from './session.service';

export class OAuthFlowException extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

interface ProviderProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
}

interface ProviderDefinition {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
  envPrefix: 'OAUTH_GOOGLE' | 'OAUTH_FACEBOOK';
}

const PROVIDER_DEFINITIONS: Record<OAuthIssuer, ProviderDefinition> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    envPrefix: 'OAUTH_GOOGLE',
  },
  facebook: {
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    userinfoUrl: 'https://graph.facebook.com/v21.0/me?fields=id,email,first_name,last_name',
    scope: 'email public_profile',
    envPrefix: 'OAUTH_FACEBOOK',
  },
};

interface OAuthState {
  scope: 'oauth_state';
  issuer: OAuthIssuer;
  redirectUri: string;
  linkUserId?: string;
  nonce: string;
}

interface OAuthHandoffRecord {
  userId: string;
  mfaSatisfied: boolean;
}

export type OAuthCallbackOutcome =
  | { mfaRequired: false; user: UserRow; sessionId: string; handoffCode: string }
  | { mfaRequired: true; user: UserRow; challengeToken: string };

@Injectable()
export class OAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly repo: AuthRepository,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly store: SessionCacheService,
  ) {}

  private clientId(issuer: OAuthIssuer): string | undefined {
    return this.config.get<string>(`${PROVIDER_DEFINITIONS[issuer].envPrefix}_CLIENT_ID`);
  }

  private clientSecret(issuer: OAuthIssuer): string | undefined {
    return this.config.get<string>(`${PROVIDER_DEFINITIONS[issuer].envPrefix}_CLIENT_SECRET`);
  }

  isEnabled(issuer: OAuthIssuer): boolean {
    return Boolean(this.clientId(issuer) && this.clientSecret(issuer));
  }

  listProviders(): { issuer: OAuthIssuer; enabled: boolean }[] {
    return (Object.keys(PROVIDER_DEFINITIONS) as OAuthIssuer[]).map((issuer) => ({ issuer, enabled: this.isEnabled(issuer) }));
  }

  private endpoint(issuer: OAuthIssuer, kind: 'AUTHORIZE_URL' | 'TOKEN_URL' | 'USERINFO_URL'): string {
    const def = PROVIDER_DEFINITIONS[issuer];
    const override = this.config.get<string>(`${def.envPrefix}_${kind}`);
    if (override) return override;
    return kind === 'AUTHORIZE_URL' ? def.authorizeUrl : kind === 'TOKEN_URL' ? def.tokenUrl : def.userinfoUrl;
  }

  async buildAuthorizeUrl(issuer: OAuthIssuer, redirectUri: string, linkUserId?: string): Promise<string> {
    if (!this.isEnabled(issuer)) {
      throw new NotFoundException({ message: 'OAuth issuer is not configured', code: 'auth.oauth_issuer_not_configured' });
    }
    const ttl = this.config.get<number>('OAUTH_STATE_TTL_SECONDS') ?? 600;
    const state = await this.jwt.signAsync(
      { scope: 'oauth_state', issuer, redirectUri, linkUserId, nonce: randomUUID() } satisfies OAuthState,
      { expiresIn: ttl },
    );
    const url = new URL(this.endpoint(issuer, 'AUTHORIZE_URL'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId(issuer)!);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', PROVIDER_DEFINITIONS[issuer].scope);
    url.searchParams.set('state', state);
    return url.toString();
  }

  private async verifyState(issuer: OAuthIssuer, stateToken: string): Promise<OAuthState> {
    let payload: OAuthState;
    try {
      payload = await this.jwt.verifyAsync<OAuthState>(stateToken);
    } catch {
      throw new OAuthFlowException('auth.oauth_state_invalid');
    }
    if (payload.scope !== 'oauth_state' || payload.issuer !== issuer || !payload.redirectUri) {
      throw new OAuthFlowException('auth.oauth_state_invalid');
    }
    return payload;
  }

  private async exchangeCode(issuer: OAuthIssuer, code: string, redirectUri: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId(issuer)!,
      client_secret:
        this.clientSecret(issuer)!,
    });
    const res = await fetch(this.endpoint(issuer, 'TOKEN_URL'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    if (!res.ok) throw new OAuthFlowException('auth.oauth_token_exchange_failed');
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new OAuthFlowException('auth.oauth_token_exchange_failed');
    return data.access_token;
  }

  private async fetchProfile(issuer: OAuthIssuer, accessToken: string): Promise<ProviderProfile> {
    let url = this.endpoint(issuer, 'USERINFO_URL');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (issuer === 'facebook') {
      url += `${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(accessToken)}`;
    } else {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) throw new OAuthFlowException('auth.oauth_userinfo_failed');
    const raw = (await res.json()) as Record<string, unknown>;
    const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
    if (!email) throw new OAuthFlowException('auth.oauth_email_missing');
    if (issuer === 'google') {
      return {
        subject: String(raw.sub ?? ''),
        email,
        emailVerified: raw.email_verified === true,
        firstName: typeof raw.given_name === 'string' ? raw.given_name : '',
        lastName: typeof raw.family_name === 'string' ? raw.family_name : '',
      };
    }
    return {
      subject: String(raw.id ?? ''),
      email,
      emailVerified: true,
      firstName: typeof raw.first_name === 'string' ? raw.first_name : '',
      lastName: typeof raw.last_name === 'string' ? raw.last_name : '',
    };
  }

  private async ensureLink(user: UserRow, issuer: OAuthIssuer, profile: ProviderProfile): Promise<UserOauthLinkRow> {
    const existing = await this.repo.getOauthLinkBySubject(issuer, profile.subject);
    if (existing) {
      if (existing.userId !== user.id) throw new OAuthFlowException('auth.oauth_link_conflict');
      return existing;
    }
    try {
      return await this.repo.createOauthLink({ userId: user.id, issuer, issuerUserId: profile.subject, email: profile.email });
    } catch {
      const raced = await this.repo.getOauthLinkBySubject(issuer, profile.subject);
      if (raced && raced.userId === user.id) return raced;
      throw new OAuthFlowException('auth.oauth_link_conflict');
    }
  }

  async handleCallback(
    issuer: OAuthIssuer,
    code: string,
    stateToken: string,
    client: { ip?: string; userAgent?: string },
  ): Promise<OAuthCallbackOutcome> {
    if (!this.isEnabled(issuer)) throw new OAuthFlowException('auth.oauth_issuer_not_configured');
    const state = await this.verifyState(issuer, stateToken);
    const accessToken = await this.exchangeCode(issuer, code, state.redirectUri);
    const profile = await this.fetchProfile(issuer, accessToken);
    if (!profile.subject) throw new OAuthFlowException('auth.oauth_userinfo_failed');
    if (!profile.emailVerified) throw new OAuthFlowException('auth.oauth_email_unverified');

    let user: UserRow;
    const linked = await this.repo.getOauthLinkBySubject(issuer, profile.subject);
    if (linked) {
      user = await this.users.getUser(linked.userId);
    } else if (state.linkUserId) {
      user = await this.users.getUser(state.linkUserId);
      await this.ensureLink(user, issuer, profile);
    } else {
      const byEmail = await this.users.getByEmail(profile.email);
      if (byEmail) {
        user = byEmail;
        await this.ensureLink(user, issuer, profile);
      } else {
        user = await this.users.createExternalUser({
          email: profile.email, firstName: profile.firstName, lastName: profile.lastName,
        });
        await this.ensureLink(user, issuer, profile);
      }
    }
    if (user.deleted || user.suspended) throw new OAuthFlowException('auth.account_inactive');

    if (await this.auth.isMfaEnabled(user.id)) {
      const challengeToken = await this.auth.createOAuthMfaChallenge(user);
      return { mfaRequired: true, user, challengeToken };
    }

    const { sessionId, handoffCode } = await this.finishSignIn(user, client);
    return { mfaRequired: false, user, sessionId, handoffCode };
  }

  private async finishSignIn(
    user: UserRow,
    client: { ip?: string; userAgent?: string },
  ): Promise<{ sessionId: string; handoffCode: string }> {
    await this.users.recordLogin(user.id);
    const sessionId = await this.sessions.create({ userId: user.id, username: user.username, ip: client.ip, userAgent: client.userAgent });
    const handoffCode = randomUUID();
    const handoffTtlMs = (this.config.get<number>('OAUTH_HANDOFF_TTL_SECONDS') ?? 120) * 1000;
    await this.store.set(`oauthhandoff:${handoffCode}`, { userId: user.id, mfaSatisfied: true }, handoffTtlMs);
    return { sessionId, handoffCode };
  }

  async completeOAuthMfa(
    challengeToken: string,
    code: string,
    client: { ip?: string; userAgent?: string },
  ): Promise<{ user: UserRow; sessionId: string; handoffCode: string }> {
    const user = await this.auth.verifyOAuthMfa(challengeToken, code, client.ip);
    const { sessionId, handoffCode } = await this.finishSignIn(user, client);
    return { user, sessionId, handoffCode };
  }

  async exchangeHandoff(code: string, client?: SessionClientInfo): Promise<{ user: UserRow; tokens: Awaited<ReturnType<AuthService['issueTokensFor']>> }> {
    const key = `oauthhandoff:${code}`;
    const stored = await this.store.get<string | OAuthHandoffRecord>(key);
    if (!stored) {
      throw new UnauthorizedException({ message: 'OAuth handoff code is invalid or expired', code: 'auth.oauth_handoff_invalid' });
    }
    await this.store.delete(key);
    const userId = typeof stored === 'string' ? stored : stored.userId;
    const mfaSatisfied = typeof stored === 'string' ? false : stored.mfaSatisfied === true;
    const user = await this.users.getByIdOrUndefined(userId);
    if (!user || user.deleted || user.suspended) {
      throw new UnauthorizedException({ message: 'Account is not active', code: 'auth.account_inactive' });
    }
    if (!mfaSatisfied && (await this.auth.isMfaEnabled(user.id))) {
      throw new UnauthorizedException({
        message: 'Two-factor authentication must be completed before this sign-in can be completed',
        code: 'auth.oauth_mfa_required',
      });
    }
    const tokens = await this.auth.issueTokensFor(user, client);
    await this.auth.recordLoginEvent(user, 'oauth', client);
    return { user, tokens };
  }

  async listLinks(userId: string): Promise<{ links: UserOauthLinkRow[]; hasPassword: boolean }> {
    const user = await this.users.getUser(userId);
    const links = await this.repo.listOauthLinksByUser(userId);
    return { links, hasPassword: Boolean(user.passwordHash) };
  }

  async unlink(userId: string, linkId: string): Promise<void> {
    const link = await this.repo.getOauthLinkById(linkId);
    if (!link || link.userId !== userId) {
      throw new NotFoundException({ message: 'Linked login not found', code: 'auth.oauth_link_not_found' });
    }
    const user = await this.users.getUser(userId);
    if (!user.passwordHash) {
      const links = await this.repo.listOauthLinksByUser(userId);
      if (links.length <= 1) {
        throw new BadRequestException({
          message: 'Cannot remove the only remaining sign-in method of an account without a password; set a password first',
          code: 'auth.last_login_method',
        });
      }
    }
    await this.repo.deleteOauthLink(linkId);
  }
}
