import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';
import Keyv from 'keyv';
import { cacheRedisConfigFromUrl } from '../../config/env';
import { SessionCacheService } from './session-cache.service';

const APP_CACHE_DEFAULT_TTL_MS = 300_000;

@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        stores: [
          new Keyv({
            store: new KeyvRedis(cacheRedisConfigFromUrl(config.getOrThrow<string>('REDIS_URL'))),
            namespace: 'giaokhoa:app',
            ttl: APP_CACHE_DEFAULT_TTL_MS,
          }),
        ],
      }),
    }),
  ],
  providers: [SessionCacheService],
  exports: [CacheModule, SessionCacheService],
})
export class CacheInfraModule {}
