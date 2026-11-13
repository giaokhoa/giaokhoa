import { Injectable } from '@nestjs/common';
import { OutboxService } from '../../infra/events/outbox.service';
import type { AuthMailPort } from './email-otp.plugin';

export const AUTH_MAIL_OUTBOX_TYPE = 'auth_mail_requested';
const AUTH_MAIL_AGGREGATE = 'auth';

@Injectable()
export class AuthMailService implements AuthMailPort {
  constructor(private readonly outbox: OutboxService) {}

  async sendPasswordResetEmail(input: { userId: string; email: string; url: string }): Promise<void> {
    await this.outbox.enqueueStandalone({
      aggregate: AUTH_MAIL_AGGREGATE,
      type: AUTH_MAIL_OUTBOX_TYPE,
      payload: { kind: 'password_reset', to: input.email, url: input.url, userId: input.userId },
    });
  }

  async sendEmailOtp(input: {
    email: string;
    otp: string;
    type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';
  }): Promise<void> {
    await this.outbox.enqueueStandalone({
      aggregate: AUTH_MAIL_AGGREGATE,
      type: AUTH_MAIL_OUTBOX_TYPE,
      payload: { kind: 'email_otp', to: input.email, otp: input.otp, otpType: input.type },
    });
  }
}
