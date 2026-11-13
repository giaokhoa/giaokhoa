import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server, type Namespace } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MessagingRedisIoAdapter } from '../../../src/modules/messaging/messaging-redis-io.adapter';

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
      const timer = setTimeout(() => reject(new Error('Không nhận được message xuyên API')), 5_000);
      client.once('worker-event', (value: string) => { clearTimeout(timer); resolve(value); });
    });
    const fromA = received(clientA);
    const fromB = received(clientB);
    emitterServer.of('/messaging').to(ROOM).emit('worker-event', 'redis-to-both-replicas');
    expect(await fromA).toBe('redis-to-both-replicas');
    expect(await fromB).toBe('redis-to-both-replicas');
  });
});
