import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createControlPlaneKysely, type ControlPlaneDb } from '@giaokhoa/db/control-plane';
import { Pool } from 'pg';
import { databaseConnectionFromEnv } from '../config/env';

/**
 * Kết nối tới database CONTROL PLANE (issue #580) — database riêng trên cùng cụm Postgres với kho nghiệp vụ, role kết nối riêng, biến môi trường riêng (`CONTROL_PLANE_DATABASE_URL`).
 *
 * Từ pilot chuyển đổi Kysely (issue #640), lớp này là ADAPTER mỏng:
 * nó chỉ còn làm hai việc của tầng ứng dụng — đọc cấu hình môi trường và sở hữu vòng đời của `pg.Pool` — rồi cấp pool cho factory `createControlPlaneKysely` của `@giaokhoa/db`; mọi truy cập dữ liệu đi qua handle Kysely (`kysely`) và repository của package. Pool KHÔNG bị đóng qua `destroy()` của instance Kysely (hàm đó cũng đóng pool): điểm đóng duy nhất là `onModuleDestroy` của adapter này, như đường kết nối trước đây.
 *
 * Khác hẳn kết nối nghiệp vụ ở hai điểm có chủ đích:
 * - Pool THƯỜNG của `pg`, không qua `TenantAwarePool`: dữ liệu control
 *   plane là dữ liệu của platform, không thuộc tenant nào, không có RLS theo tenant để áp; gác quyền nằm ở tầng service.
 * - Trần kết nối lấy từ `CONTROL_PLANE_POOL_MAX` khi được cấu hình
 *   (issue #586 — ngân sách kết nối của cụm, xem `DATABASE_POOL_MAX`
 *   trong `config/env.ts`); chưa cấu hình thì giữ mặc định của thư viện `pg` như trước.
 * - Kết nối có thể VẮNG: hệ chưa cấu hình biến môi trường thì
 *   `kysely` bằng null và ứng dụng vẫn khởi động như cũ (môi trường triển khai bằng compose luôn cấu hình). Mọi điểm dùng phải hỏi `isConfigured` trước — service của module ném lỗi `control_plane.not_configured` khi bị gọi trong trạng thái chưa cấu hình.
 */
@Injectable()
export class ControlPlaneConnection implements OnModuleDestroy {
  /** Handle Kysely của control plane; null khi chưa cấu hình biến môi trường. */
  readonly kysely: ControlPlaneDb | null;
  private readonly pool: Pool | null;
  // Control plane có thể bị tắt chủ động trước app.close() trong
  // quy trình kiểm thử hỏng sổ; pool không được end() hai lần.
  private closed = false;

  constructor(config: ConfigService) {
    const url = config.get<string>('CONTROL_PLANE_DATABASE_URL');
    if (!url) {
      this.kysely = null;
      this.pool = null;
      return;
    }
    const connection = databaseConnectionFromEnv(url, config.get<boolean>('DATABASE_SSL') ?? false);
    const poolConfig = typeof connection === 'string' ? { connectionString: connection } : connection;
    const poolMax = config.get<number>('CONTROL_PLANE_POOL_MAX');
    this.pool = new Pool(poolMax ? { ...poolConfig, max: poolMax } : poolConfig);
    this.pool.on('error', (error: Error) => new Logger(ControlPlaneConnection.name).error(`Kết nối control plane nhàn rỗi bị lỗi: ${error.message}`));
    this.kysely = createControlPlaneKysely(this.pool);
  }

  /** Control plane đã được cấu hình kết nối hay chưa. */
  get isConfigured(): boolean {
    return this.kysely !== null;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool?.end();
  }
}
