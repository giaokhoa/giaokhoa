










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
    // Lỗi vĩnh viễn không bao giờ retry: cần ghi sổ ngay ở lần
    // failed đầu tiên. Các lỗi thoáng qua chỉ ghi sau khi hết
    // attempts, tránh trùng một dòng terminal trên mỗi lượt thử.
    if (!(error instanceof UnrecoverableError) && (job.attemptsMade ?? 1) < attempts) return;
    void this.recordTerminalFailure(job, error.name).catch((cause: unknown) =>
      this.eventLogger.warn(`Không ghi được sổ lỗi BullMQ: ${cause instanceof Error ? cause.message : 'unknown'}`));
  }

  /** Redis stream lưu metadata nhỏ, không chứa payload/OTP/token. Job gốc
   * vẫn ở trạng thái failed của BullMQ để operator quyết định replay.
   * MAXLEN ~10000 chặn stream tăng vô hạn trên máy tự host.
   */
  private async recordTerminalFailure(job: Job, errorType: string): Promise<void> {
    const redis = await this.worker.getBackend().client;
    if (!('xadd' in redis) || typeof redis.xadd !== 'function') {
      throw new Error('BullMQ không dùng Redis stream backend');
    }
    // BullMQ 6 công khai IRedisClient.xadd(key, id, fields, options)
    // thay cho chữ ký variadic của ioredis gốc: tương thích cả Redis
    // backend mặc định lẫn mock transport đã được kiểu hoá.
    await redis.xadd('giaokhoa:bullmq:terminal-failures', '*', {
      queue: this.worker.name,
      jobId: job.id ?? 'unknown',
      attempts: String(job.attemptsMade ?? 1),
      kind: errorType,
      at: new Date().toISOString(),
    }, { MAXLEN: 10_000, approximate: true });
  }

  /** Lỗi kết nối/runtime của Worker (không nhất thiết gắn với job). */
  @OnWorkerEvent('error')
  onBullWorkerError(error: Error): void {
    this.eventLogger.error(`BullMQ worker ${this.worker.name} lỗi: ${error.message}`);
  }

  /** Job bị mất lock; BullMQ sẽ tự xử lý theo maxStalledCount. */
  @OnWorkerEvent('stalled')
  onBullJobStalled(jobId: string): void {
    this.eventLogger.warn(`BullMQ job mất lock: queue=${this.worker.name}, jobId=${jobId}`);
  }
}
