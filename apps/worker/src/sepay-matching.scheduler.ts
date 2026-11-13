import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SepayMatchingService } from '@giaokhoa/payments';
import { tenantAls } from './db/tenant-als';

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 20;

@Injectable()
export class SepayMatchingScheduler {
  private readonly logger = new Logger(SepayMatchingScheduler.name);
  private ticking = false;

  constructor(private readonly matching: SepayMatchingService) {}

  @Interval(POLL_INTERVAL_MS)
  async sweepTick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await tenantAls.run({ platform: true }, () => this.matching.sweep(BATCH_SIZE));
    } catch (error) {
      this.logger.warn(`Nhịp matching IPN SePay lỗi: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }
}
