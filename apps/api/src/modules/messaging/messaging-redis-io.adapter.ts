





import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { redisTlsFromUrl } from '../../config/env';






export function isMessagingOriginAllowed(origin: string | undefined, origins: readonly string[]): boolean {
  return origin === undefined || origins.includes(origin);
}

export class MessagingRedisIoAdapter extends IoAdapter {
  private adapterFactory: ReturnType<typeof createAdapter> | null = null;
  private readonly clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
    private readonly allowedOrigins: readonly string[],
  ) {
    super(app);
  }






  async connectToRedis(): Promise<void> {
    const options = { maxRetriesPerRequest: null, lazyConnect: true, ...redisTlsFromUrl(this.redisUrl) };
    const pub = new Redis(this.redisUrl, options);
    const sub = pub.duplicate();
    this.clients.push(pub, sub);
    pub.on('error', (error: Error) => this.logger.error(`Redis Socket.IO pub: ${error.message}`));
    sub.on('error', (error: Error) => this.logger.error(`Redis Socket.IO sub: ${error.message}`));
    try {
      await Promise.all([pub.connect(), sub.connect()]);
      this.adapterFactory = createAdapter(pub, sub);
    } catch (error) {
      pub.disconnect();
      sub.disconnect();
      throw error;
    }
  }


  override createIOServer(port: number, options?: ServerOptions): Server {
    if (!this.adapterFactory) throw new Error('Redis Socket.IO adapter chưa được khởi tạo');
    const server = super.createIOServer(port, {
      ...options,
      path: options?.path ?? '/socket.io',
      cors: { origin: [...this.allowedOrigins], credentials: true },
      allowRequest: (request, callback) =>
        callback(null, isMessagingOriginAllowed(request.headers.origin, this.allowedOrigins)),
    } as ServerOptions);
    server.adapter(this.adapterFactory);
    return server;
  }


  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(this.clients.map(async (client) => client.quit().catch(() => client.disconnect())));
    this.clients.length = 0;
  }
}
