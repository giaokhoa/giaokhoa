/**
 * Lớp nền cho mọi consumer BullMQ của worker.
 *
 * @remarks
 * BullExplorer của @nestjs/bullmq quét cả prototype cha bằng
 * MetadataScanner; @OnWorkerEvent khai ở đây được gắn vào Worker của
 * từng @Processor. Ghi lỗi theo tên class và id job, không ghi payload:
 * job auth/mail, tin nhắn hay điểm số có thể chứa dữ liệu nhạy cảm.
 * Event failed không phải DLQ và không tự hồi phục job đã hết retries;
 * cảnh báo này là cổng quan sát tối thiểu để hệ thống cảnh báo vận hành.
 */
import { Logger } from '@nestjs/common';
import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

export abstract class ObservedWorkerHost extends WorkerHost {
  private readonly eventLogger = new Logger(this.constructor.name);

  /** Sau một lượt chạy job thất bại; lỗi được BullMQ retry theo chính sách hàng đợi. */
  @OnWorkerEvent('failed')
  onBullJobFailed(job: Job | undefined, error: Error): void {
    this.eventLogger.error(
      `BullMQ job thất bại: queue=${this.worker.name}, jobId=${job?.id ?? 'unknown'}, loại=${error.name}`,
    );
    if (!job?.id) return;
    const attempts = job.opts?.attempts ?? 1;
    // Đừng ghi 1 event mỗi lần retry tạm thời. Tới lần cuối mới
    // đưa vào sổ lỗi để người vận hành triage và retry job gốc.
    if ((job.attemptsMade ?? 1) < attempts) return;
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
