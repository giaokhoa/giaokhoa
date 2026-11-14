










import { Logger } from '@nestjs/common';
import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';

export abstract class ObservedWorkerHost extends WorkerHost {
  private readonly eventLogger = new Logger(this.constructor.name);


  @OnWorkerEvent('failed')
  onBullJobFailed(job: Job | undefined, error: Error): void {
    this.eventLogger.error(
      `BullMQ job thất bại: queue=${this.worker.name}, jobId=${job?.id ?? 'unknown'}, loại=${error.name}`,
    );
    if (!job?.id) return;
    const attempts = job.opts?.attempts ?? 1;



    if (!(error instanceof UnrecoverableError) && (job.attemptsMade ?? 1) < attempts) return;
    void this.recordTerminalFailure(job, error.name).catch((cause: unknown) =>
      this.eventLogger.warn(`Không ghi được sổ lỗi BullMQ: ${cause instanceof Error ? cause.message : 'unknown'}`));
  }





  private async recordTerminalFailure(job: Job, errorType: string): Promise<void> {
    const redis = await this.worker.getBackend().client;
    if (!('xadd' in redis) || typeof redis.xadd !== 'function') {
      throw new Error('BullMQ không dùng Redis stream backend');
    }



    await redis.xadd('giaokhoa:bullmq:terminal-failures', '*', {
      queue: this.worker.name,
      jobId: job.id ?? 'unknown',
      attempts: String(job.attemptsMade ?? 1),
      kind: errorType,
      at: new Date().toISOString(),
    }, { MAXLEN: 10_000, approximate: true });
  }


  @OnWorkerEvent('error')
  onBullWorkerError(error: Error): void {
    this.eventLogger.error(`BullMQ worker ${this.worker.name} lỗi: ${error.message}`);
  }


  @OnWorkerEvent('stalled')
  onBullJobStalled(jobId: string): void {
    this.eventLogger.warn(`BullMQ job mất lock: queue=${this.worker.name}, jobId=${jobId}`);
  }
}
