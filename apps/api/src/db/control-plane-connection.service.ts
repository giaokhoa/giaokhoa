import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createControlPlaneKysely, type ControlPlaneDb } from '@giaokhoa/db/control-plane';
import { Pool } from 'pg';
import { databaseConnectionFromEnv } from '../config/env';

@Injectable()
export class ControlPlaneConnection implements OnModuleDestroy {
  readonly kysely: ControlPlaneDb | null;
  private readonly pool: Pool | null;
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

  get isConfigured(): boolean {
    return this.kysely !== null;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool?.end();
  }
}
