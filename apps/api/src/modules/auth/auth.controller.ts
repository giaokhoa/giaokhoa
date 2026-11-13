import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { clientIpOf } from '../../common/client-ip';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { SkipSpaceContext } from '../tenants/skip-space-context.decorator';
import { PlatformRoute } from '../../common/platform-route.decorator';
import { SupportRoute } from '../../common/support-route.decorator';
import { spaceSlugForHost } from '../tenants/space-resolution';
import { isPublicLearningHost } from '../tenants/public-learning';
import { resolveDedicatedSpace } from '../tenants/space-resolution';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { RequireCapability } from '../../common/require-capability.decorator';
import { UsersService } from '../users/users.service';
import { changePasswordSchema, loginAsSchema, loginSchema, mfaTotpCodeSchema, mfaTotpSetupSchema, mfaVerifySchema, refreshTokenSchema, type ChangePasswordDto, type LoginAsDto, type LoginDto, type MfaTotpCodeDto, type MfaTotpSetupDto, type MfaVerifyDto, type RefreshDto } from './dto/auth.dto';
import { AuthService, type PasswordLoginOutcome, type CurrentSessionRefs } from './auth.service';
import { AUTHENTICATED_VIA_BETTER_AUTH } from '../../common/better-auth-session.guard';
import { BetterAuthService } from './better-auth/better-auth.service';


export const SESSION_COOKIE = 'giaokhoa_session';

function sessionCookieOf(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function loginResponse(outcome: PasswordLoginOutcome) {
  const { user } = outcome;
  if (outcome.mfaRequired) {
    return { mfaRequired: true as const, challengeToken: outcome.challengeToken, user: { id: user.id, username: user.username } };
  }
  return { user: { id: user.id, username: user.username, forcePasswordChange: user.forcePasswordChange }, ...outcome.tokens };
}

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly betterAuth: BetterAuthService,
    private readonly spaceDb: SpaceDatabaseService,
  ) {}

  @Public()
  @UseGuards(AuthGuard('local'))
  @Post('login')
  async login(@Req() req: Request & { user: { id: string; username: string } }, @Body({ schema: loginSchema }) _dto: LoginDto) {
    const user = await this.users.getUser(req.user.id);
    return loginResponse(await this.auth.completePasswordLogin(user, { ip: clientIpOf(req), userAgent: req.headers['user-agent'] }));
  }

  @Public()
  @Post('token')
  async tokenLogin(@Body({ schema: loginSchema }) dto: LoginDto, @Req() req: Request) {
    return loginResponse(await this.auth.login(dto.username, dto.password, clientIpOf(req), req.headers['user-agent']));
  }

  @Get('mfa/status')
  async mfaStatus(@CurrentUser() actor: AuthenticatedUser) {
    return { enabled: await this.auth.isMfaEnabled(actor.id) };
  }

  @Post('mfa/totp/setup')
  async mfaTotpSetup(@Body({ schema: mfaTotpSetupSchema }) dto: MfaTotpSetupDto, @CurrentUser() actor: AuthenticatedUser) {
    const user = await this.users.getUser(actor.id);
    return this.auth.setupTotp(user, dto?.currentCode);
  }

  @Post('mfa/totp/confirm')
  async mfaTotpConfirm(@Body({ schema: mfaTotpCodeSchema }) dto: MfaTotpCodeDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.auth.confirmTotp(actor.id, dto.code);
    return { mfaEnabled: true };
  }

  @Post('mfa/totp/disable')
  async mfaTotpDisable(@Body({ schema: mfaTotpCodeSchema }) dto: MfaTotpCodeDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.auth.disableTotp(actor.id, dto.code);
    return { mfaEnabled: false };
  }

  @Public()
  @Post('mfa/verify')
  async mfaVerify(@Body({ schema: mfaVerifySchema }) dto: MfaVerifyDto, @Req() req: Request) {
    const { user, tokens } = await this.auth.verifyMfa(dto.challengeToken, dto.code, clientIpOf(req), req.headers['user-agent']);
    return { user: { id: user.id, username: user.username, forcePasswordChange: user.forcePasswordChange }, ...tokens };
  }

  private async inPlatformLoginContext<T>(req: Request, fn: () => Promise<T>): Promise<T> {
    if (process.env.PUBLIC_LEARNING_ENABLED === 'true') {
      if (!isPublicLearningHost(req.headers.host)) {
        throw new ForbiddenException({
          message: 'Platform login is only available on the root host',
          code: 'auth.platform_root_only',
        });
      }
      return fn();
    }
    const space = await resolveDedicatedSpace(this.spaceDb, req.headers.host);
    return space ? this.spaceDb.withSpaceKysely(space.slug, fn) : fn();
  }

  @Public()
  @SkipSpaceContext()
  @PlatformRoute()
  @Post('platform/login')
  async platformLogin(@Body({ schema: loginSchema }) dto: LoginDto, @Req() req: Request) {
    const outcome = await this.inPlatformLoginContext(req, () =>
      this.auth.platformLogin(dto.username, dto.password, clientIpOf(req), req.headers['user-agent']),
    );
    if (outcome.mfaRequired) {
      return { mfaRequired: true as const, challengeToken: outcome.challengeToken, user: { id: outcome.user.id, username: outcome.user.username } };
    }
    return { user: { id: outcome.user.id, username: outcome.user.username, forcePasswordChange: outcome.user.forcePasswordChange }, accessToken: outcome.accessToken, expiresIn: outcome.expiresIn };
  }

  @Public()
  @SkipSpaceContext()
  @PlatformRoute()
  @Post('platform/mfa/verify')
  async platformMfaVerify(@Body({ schema: mfaVerifySchema }) dto: MfaVerifyDto, @Req() req: Request) {
    const { user, accessToken, expiresIn } = await this.inPlatformLoginContext(req, () =>
      this.auth.verifyPlatformMfa(dto.challengeToken, dto.code, clientIpOf(req), req.headers['user-agent']),
    );
    return { user: { id: user.id, username: user.username, forcePasswordChange: user.forcePasswordChange }, accessToken, expiresIn };
  }

  private assertRootSupportHost(req: Request): void {
    if (spaceSlugForHost(req.headers.host)) {
      throw new ForbiddenException({ message: 'Support login requires platform root host', code: 'auth.support_root_only' });
    }
  }

  @Public()
  @SkipSpaceContext()
  @SupportRoute()
  @Post('support/login')
  async supportLogin(@Body({ schema: loginSchema }) dto: LoginDto, @Req() req: Request) {
    this.assertRootSupportHost(req);
    const outcome = await this.auth.supportLogin(dto.username, dto.password, clientIpOf(req));
    if (outcome.mfaRequired) {
      return { mfaRequired: true as const, challengeToken: outcome.challengeToken, user: { id: outcome.user.id, username: outcome.user.username } };
    }
    return { user: { id: outcome.user.id, username: outcome.user.username }, accessToken: outcome.accessToken, expiresIn: outcome.expiresIn };
  }

  @Public()
  @SkipSpaceContext()
  @SupportRoute()
  @Post('support/mfa/verify')
  async supportMfaVerify(@Body({ schema: mfaVerifySchema }) dto: MfaVerifyDto, @Req() req: Request) {
    this.assertRootSupportHost(req);
    const { user, accessToken, expiresIn } = await this.auth.verifySupportMfa(dto.challengeToken, dto.code, clientIpOf(req));
    return { user: { id: user.id, username: user.username }, accessToken, expiresIn };
  }

  @Post('mfa/users/:userId/reset')
  @RequireCapability('user:update')
  async mfaReset(@Param('userId', { schema: uuidIdSchema }) userId: string) {
    await this.auth.resetTotp(userId);
    return { reset: true, userId: userId };
  }

  @Public()
  @Post('refresh')
  async refresh(@Body({ schema: refreshTokenSchema }) dto: RefreshDto) { return this.auth.refresh(dto.refreshToken); }

  @Post('logout')
  async logout(@Body({ schema: refreshTokenSchema }) dto: RefreshDto) { await this.auth.logout(dto.refreshToken); return { loggedOut: true }; }

  @Get('tenants')
  async myTenants(@CurrentUser() actor: AuthenticatedUser) {
    const user = await this.users.getUser(actor.id);
    return this.auth.myTenants(user, actor.tenantId);
  }

  @Post('switch-tenant/:tenantId')
  async switchTenant(
    @Param('tenantId', { schema: uuidIdSchema }) tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const user = await this.users.getUser(actor.id);
    const tokens = await this.auth.switchTenant(user, tenantId, actor.sessionId, { ip: clientIpOf(req), userAgent: req.headers['user-agent'] });
    return { user: { id: user.id, username: user.username }, tenantId, ...tokens };
  }

  @Post('change-password')
  async changePassword(@Body({ schema: changePasswordSchema }) dto: ChangePasswordDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.auth.changePassword(actor.id, dto.currentPassword, dto.newPassword);
    return { changed: true };
  }

  @Post('login-as')
  async loginAs(@Body({ schema: loginAsSchema }) dto: LoginAsDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const outcome = await this.auth.loginAs(actor.id, dto.userId, dto.reason, { ip: clientIpOf(req), userAgent: req.headers['user-agent'] });
    const { user, tenantId } = outcome;
    if (outcome.mode === 'better-auth') {
      res.cookie(this.betterAuth.sessionCookieName, outcome.baSession.signedCookieValue, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: this.betterAuth.sessionCookieSecure,
        expires: outcome.baSession.expiresAt,
      });
      return {
        user: { id: user.id, username: user.username },
        session: { expiresAt: outcome.baSession.expiresAt.toISOString() },
        loginAs: { byUserId: actor.id, tenantId },
      };
    }
    return { user: { id: user.id, username: user.username }, ...outcome.tokens, loginAs: { byUserId: actor.id, tenantId } };
  }

  @Public()
  @Post('session/login')
  async sessionLogin(@Body({ schema: loginSchema }) dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const outcome = await this.auth.sessionLogin(dto.username, dto.password, sessionCookieOf(req), clientIpOf(req), req.headers['user-agent']);
    if (outcome.mfaRequired) {
      return { mfaRequired: true as const, challengeToken: outcome.challengeToken, user: { id: outcome.user.id, username: outcome.user.username } };
    }
    res.cookie(SESSION_COOKIE, outcome.sessionId, { httpOnly: true, sameSite: 'lax', path: '/' });
    return { user: { id: outcome.user.id, username: outcome.user.username, forcePasswordChange: outcome.user.forcePasswordChange }, sessionId: outcome.sessionId };
  }
  @Public()
  @Post('session/mfa/verify')
  async sessionMfaVerify(@Body({ schema: mfaVerifySchema }) dto: MfaVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { sessionId, user } = await this.auth.verifyMfaSession(dto.challengeToken, dto.code, sessionCookieOf(req), clientIpOf(req), req.headers['user-agent']);
    res.cookie(SESSION_COOKIE, sessionId, { httpOnly: true, sameSite: 'lax', path: '/' });
    return { user: { id: user.id, username: user.username, forcePasswordChange: user.forcePasswordChange }, sessionId };
  }
  @Public()
  @Get('session/me')
  async sessionMe(@Req() req: Request) {
    const user = await this.auth.sessionUser(sessionCookieOf(req) ?? (req.headers['x-session-id'] as string | undefined));
    return this.users.getProfileView(user.id, user.id);
  }
  @Public()
  @Post('session/logout')
  async sessionLogout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.sessionLogout(sessionCookieOf(req) ?? (req.headers['x-session-id'] as string | undefined));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { loggedOut: true };
  }

  private currentSessionRefs(actor: AuthenticatedUser, req: Request): CurrentSessionRefs {
    const viaBA = Boolean((req as Request & { [AUTHENTICATED_VIA_BETTER_AUTH]?: boolean })[AUTHENTICATED_VIA_BETTER_AUTH]);
    return {
      ...(viaBA ? { betterAuthSessionId: actor.sessionId } : { familyId: actor.sessionId }),
      webSessionId: sessionCookieOf(req),
    };
  }

  @Get('sessions')
  async mySessions(@CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    const sessions = await this.auth.listMySessions(actor.id, this.currentSessionRefs(actor, req));
    return { sessions };
  }
  @Delete('sessions/others')
  async revokeMyOtherSessions(@CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.auth.revokeMyOtherSessions(actor.id, this.currentSessionRefs(actor, req));
  }
  @Delete('sessions/:sessionId')
  async revokeMySession(@Param('sessionId', { schema: uuidIdSchema }) sessionId: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.auth.revokeMySession(actor.id, sessionId, this.currentSessionRefs(actor, req));
  }
}
