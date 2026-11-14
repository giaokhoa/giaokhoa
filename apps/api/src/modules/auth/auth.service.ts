import { Injectable, Logger } from '@nestjs/common';
import { badRequest, forbidden, notFound, unauthorized } from '../../common/http-errors';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { ContextsService } from '../access/contexts.service';
import { PasswordService } from '../users/password.service';
import { UsersService } from '../users/users.service';
import type { UserRow } from '@giaokhoa/db/repositories/users';
import { AuthRepository } from '@giaokhoa/db/repositories/auth';
import {
  AUTH_LOCKED_OUT_CODE,
  AUTH_LOCKED_OUT_MESSAGE,
  LoginLockoutService,
} from './login-lockout.service';
import { BetterAuthService } from './better-auth/better-auth.service';
import { CredentialBridgeService } from './better-auth/credential-bridge.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';
import { tenantAls } from '../tenants/tenant-als';
import { TenantsService } from '../tenants/tenants.service';

export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }

export interface SessionClientInfo { ip?: string; userAgent?: string }

export type PasswordLoginOutcome =
  | { mfaRequired: false; user: UserRow; tokens: TokenPair }
  | { mfaRequired: true; user: UserRow; challengeToken: string };

export type SessionLoginOutcome =
  | { mfaRequired: false; user: UserRow; sessionId: string }
  | { mfaRequired: true; user: UserRow; challengeToken: string };

export type MfaChallengeFlow = 'token' | 'session' | 'oauth' | 'platform' | 'support';

export type PlatformLoginOutcome =
  | { mfaRequired: false; user: UserRow; accessToken: string; expiresIn: number }
  | { mfaRequired: true; user: UserRow; challengeToken: string };

export type LoginAsOutcome =
  | { mode: 'legacy'; user: UserRow; tokens: TokenPair; tenantId: string }
  | { mode: 'better-auth'; user: UserRow; tenantId: string; baSession: { signedCookieValue: string; expiresAt: Date } };

export interface CurrentSessionRefs { familyId?: string; webSessionId?: string; betterAuthSessionId?: string }

export interface MySessionView {
  id: string;
  kind: 'web' | 'api' | 'better-auth';
  createdAt: string;
  lastActivityAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
    private readonly totp: TotpService,
    private readonly outbox: OutboxService,
    private readonly tenants: TenantsService,
    private readonly lockout: LoginLockoutService,
    private readonly betterAuth: BetterAuthService,
    private readonly credentialBridge: CredentialBridgeService,
    private readonly spaceDb: SpaceDatabaseService,
  ) {}

  private readonly logger = new Logger(AuthService.name);

  private async recordAuthEvent(type: 'user_logged_in' | 'user_logged_out', payload: Record<string, unknown>): Promise<void> {
    await this.outbox
      .enqueueStandalone({ aggregate: 'auth', type, payload })
      .catch((err) => this.logger.warn(`auth event ${type} not recorded: ${String(err)}`));
  }

  async recordLoginEvent(user: UserRow, method: string, client?: SessionClientInfo): Promise<void> {
    await this.recordAuthEvent('user_logged_in', { userId: user.id, actorId: user.id, method, ip: client?.ip ?? null });
  }


  async validateCredentials(username: string, password: string, ip?: string): Promise<UserRow> {
    const user = await this.users.getByUsername(username);
    if (!user || user.deleted) {
      unauthorized('Invalid username or password', 'auth.invalid_credentials');
    }
    if (await this.lockout.isLockedOut(user.id)) {
      unauthorized(AUTH_LOCKED_OUT_MESSAGE, AUTH_LOCKED_OUT_CODE);
    }
    const ok = await this.users.verifyPassword(user, password);
    await this.lockout.recordAttempt({ userId: user.id, username: user.username, success: ok, ip });
    if (!ok) unauthorized('Invalid username or password', 'auth.invalid_credentials');
    if (user.suspended) forbidden('Account is suspended', 'auth.account_suspended');
    if (user.isGuest) forbidden('The guest account cannot log in with a password', 'auth.guest_login_denied');
    return user;
  }

  async login(username: string, password: string, ip?: string, userAgent?: string): Promise<PasswordLoginOutcome> {
    const user = await this.validateCredentials(username, password, ip);
    return this.completePasswordLogin(user, { ip, userAgent });
  }

  async completePasswordLogin(user: UserRow, client?: SessionClientInfo): Promise<PasswordLoginOutcome> {
    if (await this.totp.isEnabled(user.id)) {
      const challengeToken = await this.signMfaChallenge(user, 'token');
      return { mfaRequired: true, user, challengeToken };
    }
    await this.users.recordLogin(user.id);
    const tokens = await this.issueTokens(user, client);
    await this.recordAuthEvent('user_logged_in', { userId: user.id, actorId: user.id, method: 'password', ip: client?.ip ?? null });
    return { mfaRequired: false, user, tokens };
  }

  private async signMfaChallenge(user: UserRow, flow: MfaChallengeFlow): Promise<string> {
    const ttl = this.config.get<number>('MFA_CHALLENGE_TTL_SECONDS') ?? 300;
    const spaceSlug = tenantAls.getStore()?.spaceSlug;
    return this.jwt.signAsync(
      { sub: user.id, username: user.username, scope: 'mfa_challenge', flow, ...(spaceSlug ? { space: spaceSlug } : {}) },
      { expiresIn: ttl },
    );
  }

  async isMfaEnabled(userId: string): Promise<boolean> { return this.totp.isEnabled(userId); }

  async setupTotp(user: UserRow, currentCode?: string): Promise<{ secret: string; otpauthUrl: string }> {
    return this.totp.setup(user.id, user.username, currentCode);
  }

  async confirmTotp(userId: string, code: string): Promise<void> { await this.totp.confirm(userId, code); }

  async disableTotp(userId: string, code: string): Promise<void> { await this.totp.disable(userId, code); }

  async resetTotp(userId: string): Promise<void> { await this.totp.resetForUser(userId); }

  async verifyMfa(challengeToken: string, code: string, ip?: string, userAgent?: string): Promise<{ user: UserRow; tokens: TokenPair }> {
    const user = await this.passMfaChallenge(challengeToken, code, ip, 'token');
    await this.users.recordLogin(user.id);
    const tokens = await this.issueTokens(user, { ip, userAgent });
    await this.recordAuthEvent('user_logged_in', { userId: user.id, actorId: user.id, method: 'totp', ip: ip ?? null });
    return { user, tokens };
  }

  async platformLogin(username: string, password: string, ip?: string, _userAgent?: string): Promise<PlatformLoginOutcome> {
    const user = await this.validateCredentials(username, password, ip);
    if (!(await this.evaluator.isPlatformSiteAdmin(user.id))) {
      forbidden('Only platform administrators may use this login surface', 'auth.platform_admin_required');
    }
    if (await this.totp.isEnabled(user.id)) {
      const challengeToken = await this.signMfaChallenge(user, 'platform');
      return { mfaRequired: true, user, challengeToken };
    }
    await this.users.recordLogin(user.id);
    const issued = await this.issuePlatformToken(user);
    await this.recordAuthEvent('user_logged_in', { userId: user.id, actorId: user.id, method: 'platform-password', ip: ip ?? null });
    return { mfaRequired: false, user, accessToken: issued.accessToken, expiresIn: issued.expiresIn };
  }

  async verifyPlatformMfa(challengeToken: string, code: string, ip?: string, _userAgent?: string): Promise<{ user: UserRow; accessToken: string; expiresIn: number }> {
    const user = await this.passMfaChallenge(challengeToken, code, ip, 'platform');
    if (!(await this.evaluator.isPlatformSiteAdmin(user.id))) {
      forbidden('Only platform administrators may use this login surface', 'auth.platform_admin_required');
    }
    await this.users.recordLogin(user.id);
    const issued = await this.issuePlatformToken(user);
    await this.recordAuthEvent('user_logged_in', { userId: user.id, actorId: user.id, method: 'platform-totp', ip: ip ?? null });
    return { user, accessToken: issued.accessToken, expiresIn: issued.expiresIn };
  }

  async supportLogin(username: string, password: string, ip?: string): Promise<PlatformLoginOutcome> {
    const user = await this.validateCredentials(username, password, ip);
    if (!(await this.tenants.isPlatformSupportMember(user.id))) {
      forbidden('Active platform membership required for support', 'auth.support_staff_required');
    }
    if (await this.totp.isEnabled(user.id)) {
      return { mfaRequired: true, user, challengeToken: await this.signMfaChallenge(user, 'support') };
    }
    await this.users.recordLogin(user.id);
    const issued = await this.issueSupportToken(user);
    await this.recordAuthEvent('user_logged_in', { userId: user.id, actorId: user.id, method: 'support-password', ip: ip ?? null });
    return { mfaRequired: false, user, ...issued };
  }

  async verifySupportMfa(challengeToken: string, code: string, ip?: string): Promise<{ user: UserRow; accessToken: string; expiresIn: number }> {
    const user = await this.passMfaChallenge(challengeToken, code, ip, 'support');
    if (!(await this.tenants.isPlatformSupportMember(user.id))) {
      forbidden('Active platform membership required for support', 'auth.support_staff_required');
    }
    await this.users.recordLogin(user.id);
    const issued = await this.issueSupportToken(user);
    await this.recordAuthEvent('user_logged_in', { userId: user.id, actorId: user.id, method: 'support-totp', ip: ip ?? null });
    return { user, ...issued };
  }

  private async issueSupportToken(user: UserRow): Promise<{ accessToken: string; expiresIn: number }> {
    const platformTenant = await this.tenants.platformTenant();
    const expiresIn = this.config.get<number>('ACCESS_TOKEN_TTL_SECONDS') ?? 900;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, sid: randomUUID(), tid: platformTenant.id, aud: 'support' },
      { expiresIn },
    );
    return { accessToken, expiresIn };
  }

  private async issuePlatformToken(user: UserRow): Promise<{ accessToken: string; expiresIn: number }> {
    const platformTenant = await this.tenants.platformTenant();
    const accessTtl = this.config.get<number>('ACCESS_TOKEN_TTL_SECONDS') ?? 900;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, sid: randomUUID(), tid: platformTenant.id, aud: 'platform' },
      { expiresIn: accessTtl },
    );
    return { accessToken, expiresIn: accessTtl };
  }

  async createOAuthMfaChallenge(user: UserRow): Promise<string> {
    return this.signMfaChallenge(user, 'oauth');
  }

  async verifyOAuthMfa(challengeToken: string, code: string, ip?: string): Promise<UserRow> {
    return this.passMfaChallenge(challengeToken, code, ip, 'oauth');
  }

  private async passMfaChallenge(challengeToken: string, code: string, ip: string | undefined, flow: MfaChallengeFlow): Promise<UserRow> {
    let payload: { sub?: string; scope?: string; flow?: string; space?: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: string; scope?: string; flow?: string; space?: string }>(challengeToken);
    } catch {
      unauthorized('MFA challenge is invalid or expired', 'auth.mfa_challenge_invalid');
    }
    const challengeFlow = payload.flow ?? 'token';
    if (payload.scope !== 'mfa_challenge' || !payload.sub || challengeFlow !== flow) {
      unauthorized('MFA challenge is invalid or expired', 'auth.mfa_challenge_invalid');
    }
    if (payload.space !== tenantAls.getStore()?.spaceSlug) {
      unauthorized('MFA challenge is invalid or expired', 'auth.mfa_challenge_invalid');
    }
    const user = await this.users.getByIdOrUndefined(payload.sub);
    if (!user || user.deleted || user.suspended) {
      unauthorized('Account is not active', 'auth.account_inactive');
    }
    if (await this.lockout.isLockedOut(user.id)) {
      unauthorized(AUTH_LOCKED_OUT_MESSAGE, AUTH_LOCKED_OUT_CODE);
    }
    const ok = await this.totp.verifyForUser(user.id, code);
    await this.lockout.recordAttempt({ userId: user.id, username: user.username, success: ok, ip });
    if (!ok) {
      unauthorized('Invalid two-factor authentication code', 'auth.mfa_invalid_code');
    }
    return user;
  }

  async issueTokensFor(user: UserRow, client?: SessionClientInfo): Promise<TokenPair> { return this.issueTokens(user, client); }

  private async requestDedicatedSpace(): Promise<{ slug: string; spaceId: string } | null> {
    const slug = tenantAls.getStore()?.spaceSlug;
    if (!slug) return null;
    try {
      const target = await this.spaceDb.resolveTarget(slug);
      return target.mode === 'dedicated' ? { slug, spaceId: target.spaceId } : null;
    } catch {
      return null;
    }
  }

  private async issueTokens(user: UserRow, client?: SessionClientInfo, tenantId?: string): Promise<TokenPair> {
    const familyId = randomUUID();
    const refreshToken = randomBytes(48).toString('base64url');
    const ttlDays = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS') ?? 30;
    const space = await this.requestDedicatedSpace();
    let tid: string;
    let centreId: string | undefined;
    if (space) {
      const spaceTenant = await this.tenants.getTenantInSpace(space.slug);
      if (!spaceTenant) {
        unauthorized('Space tenant is not ready in its own store', 'space.tenant_missing');
      }
      tid = spaceTenant.id;
      centreId = space.spaceId;
    } else {
      tid = tenantId ?? (await this.tenants.resolveDefaultTenant(user.id)).id;
      centreId = await this.centreClaimForTenant(tid);
    }
    await this.repo.createFamily({
      familyId, userId: user.id, currentTokenHash: hashToken(refreshToken),
      ip: client?.ip ?? null, userAgent: client?.userAgent ?? null,
      tenantId: tid,
      expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
    });
    const accessTtl = this.config.get<number>('ACCESS_TOKEN_TTL_SECONDS') ?? 900;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, sid: familyId, tid, ...(centreId ? { centre_id: centreId } : {}) },
      { expiresIn: accessTtl },
    );
    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  private async centreClaimForTenant(tenantId: string): Promise<string | undefined> {
    try {
      const spaceSlug = tenantAls.getStore()?.spaceSlug;
      const tenant = await tenantAls.run(
        { platform: true, ...(spaceSlug ? { spaceSlug, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle } : {}) },
        () => this.tenants.getTenant(tenantId),
      );
      const target = await this.spaceDb.resolveTarget(tenant.slug);
      return target.mode === 'dedicated' ? target.spaceId : undefined;
    } catch {
      return undefined;
    }
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = hashToken(refreshToken);
    const family = await this.repo.getFamilyByHash(tokenHash);
    if (!family || family.revoked || family.expiresAt < new Date()) {
      unauthorized('Refresh token is invalid or expired', 'auth.refresh_invalid');
    }
    if (family.previousTokenHash === tokenHash) {
      await this.repo.revokeFamily(family.id);
      unauthorized('Refresh token reuse detected; token family revoked', 'auth.refresh_reuse_detected');
    }
    if (family.currentTokenHash !== tokenHash) {
      unauthorized('Refresh token is invalid', 'auth.refresh_invalid');
    }
    const user = await this.users.getUser(family.userId);
    if (user.deleted || user.suspended) {
      await this.repo.revokeFamily(family.id);
      unauthorized('Account is not active', 'auth.account_inactive');
    }
    const space = await this.requestDedicatedSpace();
    const spaceTenant = space ? await this.tenants.getTenantInSpace(space.slug) : undefined;
    if (space) {
      if (!spaceTenant) {
        unauthorized('Space tenant is not ready in its own store', 'space.tenant_missing');
      }
      if (spaceTenant.status !== 'active') {
        unauthorized(`Tenant ${spaceTenant.slug} is ${spaceTenant.status}`, 'tenant.not_active');
      }
      if (spaceTenant.kind !== 'platform') {
        const membership = await this.tenants.getMembershipInSpace(space.slug, spaceTenant.id, user.id);
        if (!membership || membership.status !== 'active') {
          unauthorized('User is not an active member of this tenant', 'tenant.not_member');
        }
      }
    }
    const newRefresh = randomBytes(48).toString('base64url');
    await this.repo.rotateFamily(family.id, hashToken(newRefresh), family.currentTokenHash);
    let tid: string | undefined;
    let centreId: string | undefined;
    if (space && spaceTenant) {
      tid = spaceTenant.id;
      centreId = space.spaceId;
      if (tid !== family.tenantId) await this.repo.setFamilyTenant(family.id, tid);
    } else {
      tid = family.tenantId ?? undefined;
      if (tid) {
        try {
          await this.tenants.resolveSwitchTarget(user.id, tid);
        } catch {
          tid = undefined;
        }
      }
      if (!tid) {
        tid = (await this.tenants.resolveDefaultTenant(user.id)).id;
        if (tid !== family.tenantId) await this.repo.setFamilyTenant(family.id, tid);
      }
      centreId = await this.centreClaimForTenant(tid);
    }
    const accessTtl = this.config.get<number>('ACCESS_TOKEN_TTL_SECONDS') ?? 900;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, sid: family.familyId, tid, ...(centreId ? { centre_id: centreId } : {}) },
      { expiresIn: accessTtl },
    );
    return { accessToken, refreshToken: newRefresh, expiresIn: accessTtl };
  }

  async myTenants(user: UserRow, currentTenantId?: string) {
    return this.tenants.listMyTenants(user.id, currentTenantId);
  }

  async switchTenant(user: UserRow, tenantId: string, currentFamilyId?: string, client?: SessionClientInfo): Promise<TokenPair> {
    if (await this.requestDedicatedSpace()) {
      forbidden('Tenant switching does not apply to dedicated-store centres', 'auth.switch_tenant_not_in_space');
    }
    const target = await this.tenants.resolveSwitchTarget(user.id, tenantId);
    if (currentFamilyId) {
      const family = await this.repo.getFamilyById(currentFamilyId);
      if (family && !family.revoked && family.userId === user.id) {
        await this.repo.revokeFamily(family.id);
      }
    }
    const tokens = await this.issueTokens(user, client, target.id);
    await this.recordAuthEvent('user_logged_in', {
      userId: user.id,
      actorId: user.id,
      method: 'switch-tenant',
      tenantId: target.id,
      ip: client?.ip ?? null,
    });
    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    const family = await this.repo.getFamilyByHash(hashToken(refreshToken));
    if (family) {
      await this.repo.revokeFamily(family.id);
      await this.recordAuthEvent('user_logged_out', { userId: family.userId, actorId: family.userId, method: 'token' });
    }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.users.getUser(userId);
    if (!(await this.users.verifyPassword(user, currentPassword))) {
      unauthorized('Current password is incorrect', 'auth.invalid_credentials');
    }
    const errors = this.passwords.validatePolicy(newPassword);
    if (errors.length) badRequest(errors.join('; '), 'user.password_policy');
    await this.users.updateUser(userId, { password: newPassword });
    await this.repo.revokeAllForUser(userId);
  }

  async loginAs(adminId: string, targetUserId: string, reason: string, client?: SessionClientInfo): Promise<LoginAsOutcome> {
    const trimmedReason = reason?.trim() ?? '';
    if (!trimmedReason) {
      badRequest('Login-as requires a reason (platform access into a tenant is audited)', 'auth.loginas_reason_required');
    }
    const system = await this.contexts.ensureSystemContext();
    await this.evaluator.requireCapability(adminId, 'user:loginas', system.id);
    const target = await this.users.getUser(targetUserId);
    if (target.deleted || target.suspended) forbidden('Target account is not active', 'auth.account_inactive');
    if (await this.evaluator.isSiteAdmin(target.id)) forbidden('Cannot log in as a site administrator', 'auth.loginas_admin_denied');
    const tenant = await this.tenants.resolveDefaultTenant(target.id);
    const baSession = this.betterAuth.cutoverStage === 'bake'
      ? await this.credentialBridge.createProgrammaticSession(target.id)
      : null;
    const tokens = baSession ? null : await this.issueTokens(target, client);
    await this.recordAuthEvent('user_logged_in', { userId: target.id, actorId: adminId, relatedUserId: target.id, method: 'login-as', ip: client?.ip ?? null });
    await this.outbox
      .enqueueStandalone({
        aggregate: 'auth',
        type: 'user_loginas',
        tenantId: tenant.id,
        payload: {
          actorId: adminId,
          targetUserId: target.id,
          targetUsername: target.username,
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          reason: trimmedReason,
          ip: client?.ip ?? null,
          userAgent: client?.userAgent ?? null,
          at: new Date().toISOString(),
        },
      })
      .catch((err) => this.logger.warn(`login-as audit not recorded: ${String(err)}`));
    if (baSession) {
      return {
        mode: 'better-auth',
        user: target,
        tenantId: tenant.id,
        baSession: { signedCookieValue: baSession.signedCookieValue, expiresAt: baSession.expiresAt },
      };
    }
    return { mode: 'legacy', user: target, tokens: tokens as TokenPair, tenantId: tenant.id };
  }

  async sessionLogin(username: string, password: string, oldSessionId?: string, ip?: string, userAgent?: string): Promise<SessionLoginOutcome> {
    const user = await this.validateCredentials(username, password, ip);
    if (await this.totp.isEnabled(user.id)) {
      const challengeToken = await this.signMfaChallenge(user, 'session');
      return { mfaRequired: true, user, challengeToken };
    }
    await this.users.recordLogin(user.id);
    const sessionId = await this.sessions.rotate(oldSessionId, { userId: user.id, username: user.username, ip, userAgent, spaceSlug: tenantAls.getStore()?.spaceSlug });
    await this.recordAuthEvent('user_logged_in', { userId: user.id, actorId: user.id, method: 'session', ip: ip ?? null });
    return { mfaRequired: false, sessionId, user };
  }
  async verifyMfaSession(challengeToken: string, code: string, oldSessionId?: string, ip?: string, userAgent?: string): Promise<{ sessionId: string; user: UserRow }> {
    const user = await this.passMfaChallenge(challengeToken, code, ip, 'session');
    await this.users.recordLogin(user.id);
    const sessionId = await this.sessions.rotate(oldSessionId, { userId: user.id, username: user.username, ip, userAgent, spaceSlug: tenantAls.getStore()?.spaceSlug });
    await this.recordAuthEvent('user_logged_in', { userId: user.id, actorId: user.id, method: 'session-totp', ip: ip ?? null });
    return { sessionId, user };
  }
  async sessionUser(sessionId: string | undefined): Promise<UserRow> {
    if (!sessionId) unauthorized('No session', 'auth.unauthenticated');
    const session = await this.sessions.get(sessionId);
    if (!session) unauthorized('Session expired', 'auth.session_expired');
    if (session.spaceSlug !== undefined && session.spaceSlug !== tenantAls.getStore()?.spaceSlug) {
      await this.sessions.destroy(sessionId);
      unauthorized('Session belongs to another space', 'auth.session_space_mismatch');
    }
    const user = await this.users.getByIdOrUndefined(session.userId);
    if (!user || user.deleted || user.suspended) {
      await this.sessions.destroy(sessionId);
      unauthorized('Account is not active; session invalidated', 'auth.account_inactive');
    }
    await this.sessions.touch(sessionId);
    return user;
  }
  async sessionLogout(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    const session = await this.sessions.get(sessionId);
    await this.sessions.destroy(sessionId);
    if (session) {
      await this.recordAuthEvent('user_logged_out', { userId: session.userId, actorId: session.userId, method: 'session' });
    }
  }

  async listMySessions(userId: string, current: CurrentSessionRefs = {}): Promise<MySessionView[]> {
    const web = await this.sessions.listForUser(userId);
    const families = await this.repo.listActiveFamiliesByUser(userId);
    const betterAuthSessions = this.betterAuth.auth
      ? await this.spaceDb.routedKysely.selectFrom('session')
        .select(['id', 'created_at', 'updated_at', 'ip_address', 'user_agent'])
        .where('user_id', '=', userId)
        .where('expires_at', '>', new Date())
        .execute()
      : [];
    const views: MySessionView[] = [
      ...betterAuthSessions.map((session): MySessionView => ({
        id: session.id, kind: 'better-auth',
        createdAt: session.created_at.toISOString(), lastActivityAt: session.updated_at.toISOString(),
        ip: session.ip_address ?? null, userAgent: session.user_agent ?? null,
        current: current.betterAuthSessionId === session.id,
      })),
      ...web.map(({ id, session }): MySessionView => ({
        id, kind: 'web',
        createdAt: session.createdAt, lastActivityAt: session.lastActivityAt,
        ip: session.ip ?? null, userAgent: session.userAgent ?? null,
        current: current.webSessionId !== undefined && id === current.webSessionId,
      })),
      ...families.map((family): MySessionView => ({
        id: family.familyId, kind: 'api',
        createdAt: family.createdAt.toISOString(), lastActivityAt: family.rotatedAt.toISOString(),
        ip: family.ip ?? null, userAgent: family.userAgent ?? null,
        current: current.familyId !== undefined && family.familyId === current.familyId,
      })),
    ];
    return views.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }
  async revokeMySession(userId: string, sessionId: string, current: CurrentSessionRefs = {}): Promise<{ revoked: number }> {
    if (sessionId === current.webSessionId || sessionId === current.familyId || sessionId === current.betterAuthSessionId) {
      badRequest('The current session cannot be revoked here; use logout instead', 'auth.cannot_revoke_current_session');
    }
    if (this.betterAuth.auth) {
      const betterAuthSession = await this.spaceDb.routedKysely.selectFrom('session')
        .select(['id', 'user_id'])
        .where('id', '=', sessionId)
        .executeTakeFirst();
      if (betterAuthSession) {
        if (betterAuthSession.user_id !== userId) {
          notFound('Session not found', 'auth.session_not_found');
        }
        await this.spaceDb.routedKysely.deleteFrom('session')
          .where('id', '=', sessionId).where('user_id', '=', userId).execute();
        return { revoked: 1 };
      }
    }
    const web = await this.sessions.get(sessionId);
    if (web) {
      if (web.userId !== userId) notFound('Session not found', 'auth.session_not_found');
      await this.sessions.destroy(sessionId);
      return { revoked: 1 };
    }
    const family = await this.repo.getFamilyByFamilyId(sessionId);
    if (!family || family.userId !== userId || family.revoked) {
      notFound('Session not found', 'auth.session_not_found');
    }
    await this.repo.revokeFamily(family.id);
    return { revoked: 1 };
  }
  async revokeMyOtherSessions(userId: string, current: CurrentSessionRefs = {}): Promise<{ revoked: number }> {
    const webRevoked = await this.sessions.destroyOthersForUser(userId, current.webSessionId);
    const apiRevoked = await this.repo.revokeOthersForUser(userId, current.familyId);
    const baDeleted = this.betterAuth.auth
      ? await this.spaceDb.routedKysely.deleteFrom('session')
        .where('user_id', '=', userId)
        .$if(Boolean(current.betterAuthSessionId), (qb) => qb.where('id', '!=', current.betterAuthSessionId!))
        .returning('id')
        .execute()
      : [];
    return { revoked: webRevoked + apiRevoked + baDeleted.length };
  }
}
