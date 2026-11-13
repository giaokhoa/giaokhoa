import { HttpException, HttpStatus, Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { redisTlsFromUrl } from '../../config/env';
import { SiteConfigService } from '../site-config/site-config.service';

const BURST_KEY_PREFIX = 'giaokhoa:messaging:send-burst:';
const MINUTE_KEY_PREFIX = 'giaokhoa:messaging:send-minute:';
const MINUTE_WINDOW_SECONDS = 60;

const CONSUME_SCRIPT = `
local burstCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local minuteCount = tonumber(redis.call('GET', KEYS[2]) or '0')
local burstLimit = tonumber(ARGV[1])
local minuteLimit = tonumber(ARGV[2])
if burstLimit > 0 and burstCount >= burstLimit then return {0, 'burst'} end
if minuteLimit > 0 and minuteCount >= minuteLimit then return {0, 'minute'} end
if burstLimit > 0 then
  local n = redis.call('INCR', KEYS[1])
  if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
end
if minuteLimit > 0 then
  local n = redis.call('INCR', KEYS[2])
  if n == 1 then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
end
return {1, ''}
`;

@Injectable()
export class MessagingSendThrottleService implements OnModuleDestroy {
  private readonly logger = new Logger(MessagingSendThrottleService.name);
  private readonly redisUrl: string;
  private client: Redis | null = null;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    private readonly siteConfig: SiteConfigService,
  ) {
    this.redisUrl = config.getOrThrow<string>('REDIS_URL');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit().catch(() => undefined);
    this.client = null;
  }

  private redis(): Redis {
    if (!this.client) {
      this.client = new Redis(this.redisUrl, {
        maxRetriesPerRequest: null,
        ...redisTlsFromUrl(this.redisUrl),
      });
      this.client.on('error', (error: Error) => {
        this.logger.warn(`Redis của throttle gửi tin lỗi: ${error.message}`);
      });
    }
    return this.client;
  }

  async consume(userId: string): Promise<void> {
    const [burstLimit, burstWindowSeconds, perMinuteLimit] = await Promise.all([
      this.siteConfig.getValue<number>('core', 'messagingsendburstlimit'),
      this.siteConfig.getValue<number>('core', 'messagingsendburstwindowseconds'),
      this.siteConfig.getValue<number>('core', 'messagingsendperminutelimit'),
    ]);
    const burst = Math.floor(burstLimit ?? 0);
    const windowSeconds = Math.max(1, Math.floor(burstWindowSeconds ?? 0));
    const perMinute = Math.floor(perMinuteLimit ?? 0);
    if (burst <= 0 && perMinute <= 0) return;
    let result: unknown;
    try {
      result = await this.redis().eval(
        CONSUME_SCRIPT,
        2,
        `${BURST_KEY_PREFIX}${userId}`,
        `${MINUTE_KEY_PREFIX}${userId}`,
        String(burst),
        String(perMinute),
        String(windowSeconds),
        String(MINUTE_WINDOW_SECONDS),
      );
    } catch (error) {
      this.logger.warn(`Throttle gửi tin không kiểm tra được cho user ${userId} (fail-open): ${(error as Error).message}`);
      return;
    }
    const [allowed, window] = result as [number, string];
    if (allowed !== 1) {
      throw new HttpException(
        {
          message: window === 'burst'
            ? 'You are sending messages too quickly; wait a few seconds and try again'
            : 'You have reached the message sending limit for now; wait a moment and try again',
          code: 'messaging.rate_limited',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
