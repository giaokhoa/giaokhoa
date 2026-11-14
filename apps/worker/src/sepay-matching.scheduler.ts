import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SepayMatchingService } from '@giaokhoa/payments';
import { tenantAls } from './db/tenant-als';
import { SpaceDatabaseService } from './db/routing/space-database.service';

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 20;

@Injectable()
export class SepayMatchingScheduler {
  private readonly logger = new Logger(SepayMatchingScheduler.name);
  private ticking = false;

  constructor(
    private readonly matching: SepayMatchingService,
    private readonly spaces: SpaceDatabaseService,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async sweepTick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // The apex platform ledger is separate from every dedicated learning database.
      try {
        await tenantAls.run({ platform: true }, () => this.matching.sweep(BATCH_SIZE));
      } catch (error) {
        this.logger.warn(`Nhịp matching platform SePay lỗi: ${(error as Error).message}`);
      }
      await this.spaces.sweepDedicatedSpaces(
        () => this.matching.sweep(BATCH_SIZE),
        (processed, next) => processed + next,
        0,
      );
    } catch (error) {
      this.logger.warn(`Nhịp matching dedicated SePay lỗi: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }
}
