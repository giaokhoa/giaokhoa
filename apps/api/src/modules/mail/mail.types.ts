export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type MailSendResult =
  | { status: 'sent'; providerId: string | null }
  | { status: 'skipped'; reason: 'resend_not_configured' | 'mail_from_not_configured' };
