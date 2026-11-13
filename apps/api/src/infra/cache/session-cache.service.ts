import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';
import Keyv from 'keyv';
import { cacheRedisConfigFromUrl } from '../../config/env';
import { tenantAls } from '../../modules/tenants/tenant-als';

/**
 * Chế độ "session" của MUC: backed bởi Redis nhưng nằm trong namespace riêng (`giaokhoa:session`), tách biệt về mặt vật lý khỏi các khoá cache của ứng dụng.
 */
@Injectable()
export class SessionCacheService implements OnModuleDestroy {
  private readonly keyv: Keyv;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.keyv = new Keyv({
      store: new KeyvRedis(cacheRedisConfigFromUrl(config.getOrThrow<string>('REDIS_URL'))),
      namespace: 'giaokhoa:session',
      ttl: 60 * 60 * 1000,
    });
  }

  /**
   * Session và OAuth handoff chỉ tồn tại trong kho nơi request đang
   * chạy. Không dùng ID người dùng hay chuỗi bí mật làm namespace:
   * định danh bất biến của kho được nạp vào ALS sau khi xác thực
   * tuyến đường, các kho chia sẻ không gian key vẫn tách biệt.
   */
  private keyForSpace(key: string): string {
    const spaceId = tenantAls.getStore()?.spaceId;
    return spaceId ? `space:${spaceId}:${key}` : key;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.keyv.get<T>(this.keyForSpace(key));
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    return this.keyv.set(this.keyForSpace(key), value, ttlMs);
  }

  async delete(key: string): Promise<boolean> {
    return this.keyv.delete(this.keyForSpace(key));
  }

  async onModuleDestroy(): Promise<void> {
    await this.keyv.disconnect();
  }
}
