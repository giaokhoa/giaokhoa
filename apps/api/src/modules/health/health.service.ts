import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { healthStatusSchema, type HealthStatus } from '@giaokhoa/contracts';
import { sql } from '@giaokhoa/db';
import Redis from 'ioredis';
import { redisTlsFromUrl } from '../../config/env';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    private readonly spaceDb: SpaceDatabaseService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    const redisUrl = config.getOrThrow<string>('REDIS_URL');
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      ...redisTlsFromUrl(redisUrl),
    });
  }

  private async probe(check: () => Promise<boolean>): Promise<'up' | 'down'> {
    try {
      return (await check()) ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  async check(): Promise<HealthStatus> {
    const database = await this.probe(async () => {
      await sql`select 1`.execute(this.spaceDb.routedKysely);
      return true;
    });
    const redis = await this.probe(async () => (await this.redis.ping()) === 'PONG');
    return healthStatusSchema.parse({
      status: database === 'up' && redis === 'up' ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      checks: { database, redis },
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
