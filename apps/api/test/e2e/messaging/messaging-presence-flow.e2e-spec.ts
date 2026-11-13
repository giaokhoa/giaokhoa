import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import Redis from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';



const PRESENCE_KEY_PREFIX = 'giaokhoa:messaging:presence:';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Làm mới TTL presence nhắn tin (issue #33, F2)', () => {
  let app: INestApplication;
  let base: string;
  let redis: Redis;
  let user: { id: string; username: string };
  let token: string;

  beforeAll(async () => {
    process.env.MESSAGING_PRESENCE_TTL_SECONDS = '3';
    process.env.MESSAGING_PRESENCE_REFRESH_MS = '300';
    const helpers = await import('../../support/identity-access-helpers');
    app = await helpers.createTestApp();
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const admin = await helpers.adminToken(app);
    user = await helpers.createUserViaApi(app, admin);
    token = (await helpers.login(app, user.username, helpers.STRONG_PASSWORD)).accessToken;
  });

  afterAll(async () => {
    redis.disconnect();
    await app.close();
  });

  it('người vẫn đang kết nối vẫn hiện diện sau khi TTL ban đầu lẽ ra đã hết', async () => {
    const socket: Socket = io(`${base}/messaging`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });

    const keyPattern = `${PRESENCE_KEY_PREFIX}*:${user.id}`;
    const findKey = async (): Promise<string | null> => (await redis.keys(keyPattern))[0] ?? null;
    const deadline = Date.now() + 5000;
    let key = await findKey();
    while (key === null && Date.now() < deadline) {
      await sleep(100);
      key = await findKey();
    }
    expect(key).not.toBeNull();
    const presenceKey = key!;

    await redis.pexpire(presenceKey, 1200);
    await sleep(2600);
    expect(await redis.exists(presenceKey)).toBe(1);
    expect(await redis.pttl(presenceKey)).toBeGreaterThan(0);

    socket.disconnect();
    await sleep(700);
    expect(await redis.exists(presenceKey)).toBe(0);
  });
});
