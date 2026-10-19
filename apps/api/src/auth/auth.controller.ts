import { authContract, type CompleteOnboardingResponse } from '@giaokhoa/shared/http/auth';
import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import { AuthService, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { createAuth } from './auth.js';

type AppAuth = ReturnType<typeof createAuth>;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService<AppAuth>) {}

  @Post('onboarding')
  async completeOnboarding(
    @Body() body: unknown,
    @Req() request: Request,
    @Session() session: UserSession<AppAuth>,
  ): Promise<CompleteOnboardingResponse> {
    const parsed = authContract.completeOnboarding.body.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ.');
    }

    const headers = fromNodeHeaders(request.headers);

    if (!session.user.name.trim()) {
      try {
        await this.auth.api.setPassword({
          body: { newPassword: parsed.data.password },
          headers,
        });
      } catch (error) {
        if (!isAPIError(error) || error.body?.code !== 'PASSWORD_ALREADY_SET') throw error;
      }

      await this.auth.api.updateUser({
        body: {
          name: `${parsed.data.lastName} ${parsed.data.firstName}`.trim(),
        },
        headers,
      });
    }

    return authContract.completeOnboarding.responses[201].parse({ status: true });
  }
}
