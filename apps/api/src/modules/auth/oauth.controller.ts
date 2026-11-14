import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { clientIpOf } from '../../common/client-ip';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { SESSION_COOKIE } from './auth.controller';
import { mfaVerifySchema, oauthHandoffSchema, oauthIssuerSchema, type MfaVerifyDto, type OAuthHandoffDto, type OAuthIssuerParam } from './dto/auth.dto';
import { OAuthFlowException, OAuthService } from './oauth.service';

@ApiTags('auth')
@Controller({ path: 'auth/oauth', version: '1' })
export class OAuthController {
  constructor(private readonly oauth: OAuthService, private readonly config: ConfigService) {}

  private callbackUrl(req: Request, issuer: string): string {
    return `${req.protocol}://${req.get('host')}/api/v1/auth/oauth/${issuer}/callback`;
  }

  private webUrl(path: string): string {
    const base = this.config.get<string>('WEB_APP_URL') ?? '';
    return `${base}${path}`;
  }

  @Public()
  @Get('providers')
  async providers() {
    return { providers: this.oauth.listProviders() };
  }

  @Public()
  @Get(':issuer/authorize')
  async authorize(@Param('issuer', { schema: oauthIssuerSchema }) issuer: OAuthIssuerParam, @Req() req: Request) {
    return { authorizeUrl: await this.oauth.buildAuthorizeUrl(issuer, this.callbackUrl(req, issuer)) };
  }

  @Get(':issuer/link')
  async link(@Param('issuer', { schema: oauthIssuerSchema }) issuer: OAuthIssuerParam, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return { authorizeUrl: await this.oauth.buildAuthorizeUrl(issuer, this.callbackUrl(req, issuer), actor.id) };
  }

  @Public()
  @Get(':issuer/callback')
  async callback(
    @Param('issuer', { schema: oauthIssuerSchema }) issuer: OAuthIssuerParam,
    @Query('code', { schema: z.string().trim().min(1).optional() }) code: string | undefined,
    @Query('state', { schema: z.string().trim().min(1).optional() }) state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      return res.redirect(this.webUrl('/login?oauthError=auth.oauth_callback_invalid'));
    }
    try {
      const outcome = await this.oauth.handleCallback(issuer, code, state, {
        ip: clientIpOf(req), userAgent: req.headers['user-agent'],
      });
      if (outcome.mfaRequired) {
        return res.redirect(this.webUrl(`/login?mfaChallenge=${encodeURIComponent(outcome.challengeToken)}`));
      }
      res.cookie(SESSION_COOKIE, outcome.sessionId, { httpOnly: true, sameSite: 'lax', path: '/' });
      return res.redirect(this.webUrl(`/oauth/callback?handoff=${encodeURIComponent(outcome.handoffCode)}`));
    } catch (err) {
      const errorCode = err instanceof OAuthFlowException ? err.code : 'auth.oauth_failed';
      return res.redirect(this.webUrl(`/login?oauthError=${encodeURIComponent(errorCode)}`));
    }
  }

  @Public()
  @Post('mfa/verify')
  async mfaVerify(@Body({ schema: mfaVerifySchema }) dto: MfaVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, sessionId, handoffCode } = await this.oauth.completeOAuthMfa(dto.challengeToken, dto.code, {
      ip: clientIpOf(req), userAgent: req.headers['user-agent'],
    });
    res.cookie(SESSION_COOKIE, sessionId, { httpOnly: true, sameSite: 'lax', path: '/' });
    return { user: { id: user.id, username: user.username, forcePasswordChange: user.forcePasswordChange }, handoffCode };
  }

  @Public()
  @Post('handoff')
  async handoff(@Body({ schema: oauthHandoffSchema }) dto: OAuthHandoffDto, @Req() req: Request) {
    const { user, tokens } = await this.oauth.exchangeHandoff(dto.code, { ip: clientIpOf(req), userAgent: req.headers['user-agent'] });
    return { user: { id: user.id, username: user.username, forcePasswordChange: user.forcePasswordChange }, ...tokens };
  }

  @Get('links')
  async links(@CurrentUser() actor: AuthenticatedUser) {
    const { links, hasPassword } = await this.oauth.listLinks(actor.id);
    return {
      links: links.map((link) => ({
        id: link.id, issuer: link.issuer, email: link.email, createdAt: link.createdAt.toISOString(),
      })),
      hasPassword,
    };
  }

  @Delete('links/:linkId')
  async unlink(@Param('linkId', { schema: uuidIdSchema }) linkId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.oauth.unlink(actor.id, linkId);
    return { unlinked: true };
  }
}
