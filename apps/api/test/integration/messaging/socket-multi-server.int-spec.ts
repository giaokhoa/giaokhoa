import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Server, type Namespace } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MessagingRedisIoAdapter } from '../../../src/modules/messaging/messaging-redis-io.adapter';
import { adminToken, createTestApp, createUserViaApi, login, STRONG_PASSWORD } from '../../support/identity-access-helpers';

const ALLOWED = 'http://localhost:5173';
const DISALLOWED = 'https://untrusted.example';
const ROOM = 'audit:room:replica';

interface ApiReplica {
  http: HttpServer;
  server: Server;
  namespace: Namespace;
  adapter: MessagingRedisIoAdapter;
  url: string;
}

const connected: Socket[] = [];


async function createReplica(redisUrl: string): Promise<ApiReplica> {
  const http = createServer();
  const adapter = new MessagingRedisIoAdapter(http as never, redisUrl, [ALLOWED]);
  await adapter.connectToRedis();
  const server = adapter.createIOServer(0);
  const namespace = server.of('/messaging');
  namespace.on('connection', (socket) => {
    void Promise.resolve(socket.join(ROOM)).then(() => socket.emit('joined'));
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  return {
    http, server, namespace, adapter,
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
  };
}


function connectTo(replica: ApiReplica, transport: 'polling' | 'websocket', origin = ALLOWED): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = io(`${replica.url}/messaging`, {
      transports: [transport],
      extraHeaders: { Origin: origin },
      autoConnect: false,
      reconnection: false,
      timeout: 3000,
    });
    connected.push(socket);
    const timer = setTimeout(() => reject(new Error(`Socket ${transport} timeout`)), 5_000);
    socket.once('joined', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
    socket.connect();
  });
}

describe('Redis Socket.IO adapter: origin, hai API replica và emitter của worker', () => {
  let replicaA: ApiReplica;
  let replicaB: ApiReplica;
  let emitterServer: Server;
  let emitterPub: Redis;
  let emitterSub: Redis;

  beforeAll(async () => {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    replicaA = await createReplica(redisUrl);
    replicaB = await createReplica(redisUrl);
    emitterPub = new Redis(redisUrl);
    emitterSub = emitterPub.duplicate();
    emitterServer = new Server();
    emitterServer.adapter(createAdapter(emitterPub, emitterSub));
    emitterServer.of('/messaging');
  });

  afterAll(async () => {
    connected.forEach((socket) => socket.disconnect());
    if (replicaA) await replicaA.adapter.close(replicaA.server);
    if (replicaB) await replicaB.adapter.close(replicaB.server);


    if (emitterServer) emitterServer.removeAllListeners();
    await Promise.all([
      emitterPub?.quit().catch(() => emitterPub.disconnect()),
      emitterSub?.quit().catch(() => emitterSub.disconnect()),
    ]);
  });

  it('không cho kết nối Origin ngoài allowlist qua cả polling và WebSocket', async () => {
    for (const transport of ['polling', 'websocket'] as const) {
      await expect(connectTo(replicaA, transport, DISALLOWED)).rejects.toThrow();
    }
  });

  it('mỗi API replica nhận được client bằng polling/WebSocket trong allowlist', async () => {
    const clientA = await connectTo(replicaA, 'polling');
    const clientB = await connectTo(replicaB, 'websocket');
    expect(clientA.connected).toBe(true);
    expect(clientB.connected).toBe(true);
  });

  it('worker headless phân phối qua Redis đến room ở hai server khác nhau', async () => {
    const clientA = await connectTo(replicaA, 'websocket');
    const clientB = await connectTo(replicaB, 'polling');
    const received = (client: Socket) => new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Did not receive the cross-API message')), 5_000);
      client.once('worker-event', (value: string) => { clearTimeout(timer); resolve(value); });
    });
    const fromA = received(clientA);
    const fromB = received(clientB);
    emitterServer.of('/messaging').to(ROOM).emit('worker-event', 'redis-to-both-replicas');
    expect(await fromA).toBe('redis-to-both-replicas');
    expect(await fromB).toBe('redis-to-both-replicas');
  });

  it('client qua gateway Nest nhận broadcast Redis từ server socket.io ngoài', async () => {
    const app: INestApplication = await createTestApp();
    try {
      const server = app.getHttpServer();
      await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const admin = await adminToken(app);
      const user = await createUserViaApi(app, admin);
      const token = (await login(app, user.username, STRONG_PASSWORD)).accessToken;
      const socket = io(`${base}/messaging`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000,
      });
      connected.push(socket);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
          socket.once('connect', () => { clearTimeout(timer); resolve(); });
          socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
        });
        expect(socket.connected).toBe(true);
        const broadcast = new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Did not receive the Redis broadcast from the other replica')), 5000);
          socket.once('nest-wiring-probe', (value: string) => { clearTimeout(timer); resolve(value); });
        });
        replicaB.namespace.emit('nest-wiring-probe', 'qua-redis-tu-replica-khac');
        expect(await broadcast).toBe('qua-redis-tu-replica-khac');
      } finally {
        socket.disconnect();
      }
    } finally {
      await app.close();
    }
  });
});
