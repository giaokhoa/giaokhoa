import type { IncomingHttpHeaders } from 'node:http';
import type { CompleteOnboardingBody } from '@giaokhoa/shared/http/auth';
import { Injectable } from '@nestjs/common';
import { AuthService, type UserSession } from '@thallesp/nestjs-better-auth';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { createAuth } from './auth.js';

type AppAuth = ReturnType<typeof createAuth>;

@Injectable()
export class OnboardingService {
  constructor(private readonly auth: AuthService<AppAuth>) {}

  async complete(
    body: CompleteOnboardingBody,
    session: UserSession<AppAuth>,
    requestHeaders: IncomingHttpHeaders,
  ) {
    if (session.user.name.trim()) return;

    const headers = fromNodeHeaders(requestHeaders);
    try {
      await this.auth.api.setPassword({
        body: { newPassword: body.password },
        headers,
      });
    } catch (error) {
      if (!isAPIError(error) || error.body?.code !== 'PASSWORD_ALREADY_SET') throw error;
    }

    await this.auth.api.updateUser({
      body: { name: `${body.lastName} ${body.firstName}`.trim() },
      headers,
    });
  }
}
