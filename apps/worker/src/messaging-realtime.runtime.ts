import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createMessagingDistributionService,
  createMessagingDistributionStore,
  type MessagingDistributionService,
} from '@giaokhoa/messaging';
import Redis from 'ioredis';
import { SpaceDatabaseService } from './db/routing/space-database.service';
import { tenantAls } from './db/tenant-als';
import { createMessagingRealtimeEmitter, type MessagingRealtimeEmitterHandle } from './messaging-realtime-emitter';
import { redisTlsFromUrl } from './config/env';

@Injectable()
export class MessagingRealtimeRuntime implements OnModuleDestroy {
  readonly distribution: MessagingDistributionService;
  readonly redis: Redis;
  private readonly emitterHandle: MessagingRealtimeEmitterHandle;

  constructor(
    spaceDb: SpaceDatabaseService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    const logger = new Logger('MessagingDistribution');
    const redisUrl = config.getOrThrow<string>('REDIS_URL');

    const redisOptions = redisTlsFromUrl(redisUrl);
    this.emitterHandle = createMessagingRealtimeEmitter(redisUrl, redisOptions);
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null, ...redisOptions });
    this.redis.on('error', (error: Error) => {
      logger.warn(`Redis của consumer phân phối messaging lỗi: ${error.message}`);
    });
    this.distribution = createMessagingDistributionService({
      store: createMessagingDistributionStore(spaceDb.routedKysely),
      emitter: this.emitterHandle.emitter,
      spaceId: () => tenantAls.getStore()?.spaceId,
      logger: {
        warn: (message) => logger.warn(message),
        error: (message) => logger.error(message),
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.emitterHandle.close();
    await this.redis.quit().catch(() => undefined);
  }
}
