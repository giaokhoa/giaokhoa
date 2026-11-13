import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../../common/public.decorator';
import {
  TwoFactorCompletionError,
  TwoFactorCompletionService,
  type TwoFactorCompletionResult,
} from './two-factor-completion.service';

@ApiTags('auth')
@Controller({ path: 'auth/two-factor', version: '1' })
export class TwoFactorCompletionController {
  constructor(private readonly completion: TwoFactorCompletionService) {}

  @Public()
  @Post('verify-totp')
  async verifyTotp(@Req() req: Request, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const code = codeFromBody(body);
    if (code === null) {
      res.status(400).json({ code: 'INVALID_BODY', message: 'Code is required' });
      return;
    }
    try {
      const result = await this.completion.verifyTotp(req, code);
      this.writeSuccess(res, result);
    } catch (err) {
      this.writeError(res, err);
    }
  }

  @Public()
  @Post('verify-backup-code')
  async verifyBackupCode(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      await this.completion.verifyBackupCode(req);
    } catch (err) {
      this.writeError(res, err);
    }
  }

  private writeSuccess(res: Response, result: TwoFactorCompletionResult): void {
    res.cookie(result.sessionCookieName, result.sessionCookieValue, {
      ...(result.sessionCookieAttributes as object),
      expires: result.sessionExpiresAt,
    });
    res.cookie(result.twoFactorCookieName, '', {
      ...(result.twoFactorCookieAttributes as object),
      maxAge: 0,
    });
    res.status(200).json(result.body);
  }

  private writeError(res: Response, err: unknown): void {
    if (err instanceof TwoFactorCompletionError) {
      res.status(err.status).json({ code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
  }
}

function codeFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const code = (body as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  return trimmed.length > 0 ? trimmed : null;
}
