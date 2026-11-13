import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSystemBankKysely, type SystemBankDb } from '@giaokhoa/db/system-bank';
import { Pool } from 'pg';
import { databaseConnectionFromEnv } from '../../config/env';

@Injectable()
export class SystemBankConnection implements OnModuleDestroy {
  readonly kysely: SystemBankDb | null;
  private readonly pool: Pool | null;

  constructor(config: ConfigService) {
    const url = config.get<string>('SYSTEM_BANK_DATABASE_URL');
    if (!url) {
      this.kysely = null;
      this.pool = null;
      return;
    }
    const connection = databaseConnectionFromEnv(url, config.get<boolean>('DATABASE_SSL') ?? false);
    const poolConfig = typeof connection === 'string' ? { connectionString: connection } : connection;
    this.pool = new Pool(poolConfig);
    this.kysely = createSystemBankKysely(this.pool);
  }

  get isConfigured(): boolean {
    return this.kysely !== null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
