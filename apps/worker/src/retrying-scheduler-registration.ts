





import type { Logger } from '@nestjs/common';

export class RetryingSchedulerRegistration {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private failures = 0;

  constructor(
    private readonly upsert: () => Promise<unknown>,
    private readonly logger: Pick<Logger, 'warn'>,
    private readonly name: string,
  ) {}

  async start(): Promise<void> {
    if (this.stopped) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.upsert(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Redis timeout trong 5 giây')), 5_000);
          timeout.unref?.();
        }),
      ]);
      this.failures = 0;
    } catch (error) {
      if (this.stopped) return;
      const delay = Math.min(60_000, 1_000 * 2 ** Math.min(this.failures++, 6));
      this.logger.warn(`Đăng ký BullMQ scheduler ${this.name} lỗi, thử lại sau ${delay}ms: ${error instanceof Error ? error.message : 'unknown'}`);
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.start();
      }, delay);
      this.timer.unref?.();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
