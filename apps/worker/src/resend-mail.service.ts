import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';


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






const RESEND_RATE_LUA = `
  local used = redis.call('INCR', KEYS[1])
  if used == 1 then redis.call('PEXPIRE', KEYS[1], 1000) end
  if used <= tonumber(ARGV[1]) then return 0 end
  return redis.call('PTTL', KEYS[1])
`;


@Injectable()
export class ResendMailService {
  private readonly logger = new Logger(ResendMailService.name);
  private readonly apiKey: string | null;
  private readonly from: string | null;
  private readonly maxPerSecond: number;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @InjectQueue('notification-dispatch') private readonly queue: Queue,
  ) {
    this.maxPerSecond = config.get<number>('RESEND_RATE_LIMIT_PER_SECOND') ?? 1;
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


  private async waitForRateSlot(): Promise<void> {
    const backendClient = await this.queue.getBackend().client;


    if (!('eval' in backendClient) || typeof backendClient.eval !== 'function') {
      throw new Error('Bộ hạn mức mail yêu cầu Redis EVAL backend');
    }
    const client = backendClient as { eval(script: string, keys: number, key: string, rate: number): Promise<unknown> };
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {


        const waitMs = await Promise.race([
          client.eval(RESEND_RATE_LUA, 1, 'giaokhoa:resend:send:rate', this.maxPerSecond),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Redis rate limiter timeout')), 5_000);
          }),
        ]);
        if (Number(waitMs) === 0) return;
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(1_000, Math.max(20, Number(waitMs)))));
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    throw new Error('Hết trần chờ quota gửi Resend; BullMQ sẽ retry');
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
    await this.waitForRateSlot();
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
