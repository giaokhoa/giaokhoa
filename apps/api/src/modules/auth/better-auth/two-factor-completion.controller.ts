import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../../common/public.decorator';
import { mfaTotpCodeSchema, type MfaTotpCodeDto } from '../dto/auth.dto';
import {
  TwoFactorCompletionService,
  type TwoFactorCompletionResult,
} from './two-factor-completion.service';

@ApiTags('auth')
@Controller({ path: 'auth/two-factor', version: '1' })
export class TwoFactorCompletionController {
  constructor(private readonly completion: TwoFactorCompletionService) {}

  @Public()
  @Post('verify-totp')
  @HttpCode(200)
  async verifyTotp(@Req() req: Request, @Body({ schema: mfaTotpCodeSchema }) dto: MfaTotpCodeDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.completion.verifyTotp(req, dto.code);
    this.writeCookies(res, result);
    return result.body;
  }

  @Public()
  @Post('verify-backup-code')
  async verifyBackupCode(@Req() req: Request): Promise<never> {
    return this.completion.verifyBackupCode(req);
  }

  private writeCookies(res: Response, result: TwoFactorCompletionResult): void {
    res.cookie(result.sessionCookieName, result.sessionCookieValue, {
      ...(result.sessionCookieAttributes as object),
      expires: result.sessionExpiresAt,
    });
    res.cookie(result.twoFactorCookieName, '', {
      ...(result.twoFactorCookieAttributes as object),
      maxAge: 0,
    });
  }
}
