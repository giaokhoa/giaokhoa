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
      `BullMQ job thất bại: queue=${this.worker.name}, jobId=${job?.id ?? 'unknown'}, lý do=${error.message}`,
    );
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
