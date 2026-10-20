import {
  authContract,
  type CompleteOnboardingBody,
  type CompleteOnboardingResponse,
} from '@giaokhoa/shared/http/auth';
import { Body, Controller, Post, Req } from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';
import type { createAuth } from './auth.js';
import { OnboardingService } from './onboarding.service.js';

type AppAuth = ReturnType<typeof createAuth>;

@Controller('auth')
export class AuthController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('onboarding')
  async completeOnboarding(
    @Body({ schema: authContract.completeOnboarding.body }) body: CompleteOnboardingBody,
    @Req() request: Request,
    @Session() session: UserSession<AppAuth>,
  ): Promise<CompleteOnboardingResponse> {
    await this.onboarding.complete(body, session, request.headers);
    return { status: true };
  }
}
