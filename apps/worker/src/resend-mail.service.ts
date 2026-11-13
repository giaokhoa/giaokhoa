import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';


export interface WorkerMailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type WorkerMailSendResult =
  | { status: 'sent'; providerId: string | null }
  | { status: 'skipped'; reason: 'resend_not_configured' | 'mail_from_not_configured' };

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

@Injectable()
export class ResendMailService {
  private readonly logger = new Logger(ResendMailService.name);
  private readonly apiKey: string | null;
  private readonly from: string | null;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.apiKey = config.get<string>('RESEND_API_KEY') ?? null;
    this.from = config.get<string>('MAIL_FROM') ?? null;
    if (!this.apiKey) {
      this.logger.warn(
        'RESEND_API_KEY chưa được đặt: mailer ở chế độ ghi log, mail thông báo sẽ KHÔNG được gửi.',
      );
    } else if (!this.from) {
      this.logger.warn(
        'MAIL_FROM chưa được đặt: mailer không có địa chỉ gửi, mail thông báo sẽ KHÔNG được gửi.',
      );
    }
  }

  get configured(): boolean {
    return this.apiKey !== null && this.from !== null;
  }

  async send(message: WorkerMailMessage): Promise<WorkerMailSendResult> {
    if (!this.apiKey) {
      this.logger.log(
        `[chế độ ghi log] Bỏ qua gửi mail tới ${message.to} — tiêu đề "${message.subject}" (thiếu RESEND_API_KEY).`,
      );
      return { status: 'skipped', reason: 'resend_not_configured' };
    }
    if (!this.from) {
      this.logger.log(
        `[chế độ ghi log] Bỏ qua gửi mail tới ${message.to} — tiêu đề "${message.subject}" (thiếu MAIL_FROM).`,
      );
      return { status: 'skipped', reason: 'mail_from_not_configured' };
    }
    const response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Resend API trả ${response.status}: ${detail.slice(0, 300)}`);
    }
    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { status: 'sent', providerId: body?.id ?? null };
  }
}
