import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as connectSocket, type Socket as ClientSocket } from 'socket.io-client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { MESSAGING_SOCKET_EVENTS } from '@giaokhoa/contracts';
import {
  conversationRoom, userRoom, createMessagingDistributionService,
  type MessagingDistributionStore,
} from '@giaokhoa/messaging';
import { tenantAls } from '../../../src/db/tenant-als';
import { SpaceJobRunner } from '../../../src/db/routing/space-job-runner';
import type { SpaceDatabaseService } from '../../../src/db/routing/space-database.service';
import { createMessagingRealtimeEmitter, type MessagingRealtimeEmitterHandle } from '../../../src/messaging-realtime-emitter';
import {
  MESSAGING_DISTRIBUTED_KEY_PREFIX, MessagingRealtimeProcessor,
} from '../../../src/processors/messaging-realtime.processor';

/**
 * Luồng Redis + Socket.IO + processor thật cho hai kho khác nhau,
 * cố tình có CÙNG tenantId, userId, conversationId, messageId và
 * outboxId. Chỉ dùng store giả tại biên truy vấn dữ liệu; phát và
 * nhận sự kiện, chống trùng Redis, xác nhận retry đi qua adapter,
 * processor và client thực. Đây là phép kiểm tra đầu-cuối của miền
 * thông điệp, không thay thế kiểm thử HTTP/database của khung API.
 */
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const spaceA = { slug: 'test-queue-room-a', id: randomUUID() };
const spaceB = { slug: 'test-queue-room-b', id: randomUUID() };
const tenantId = randomUUID();
const userId = randomUUID();
const senderId = randomUUID();
const conversationId = randomUUID();
const messageId = randomUUID();
const outboxId = randomUUID();
const eventsA: string[] = [];
const eventsB: string[] = [];
const eventsPublic: string[] = [];
const signalsA: string[] = [];
const signalsB: string[] = [];
const signalsPublic: string[] = [];

function connectedClient(port: number, spaceId: string | null, events: string[], signals: string[]): ClientSocket {
  const client = connectSocket(`http://127.0.0.1:${port}/messaging`, {
    auth: { spaceId, tenantId, userId, conversationId },
    transports: ['websocket'], reconnection: false, forceNew: true,
  });
  client.on(MESSAGING_SOCKET_EVENTS.typing, () => { signals.push('typing'); });
  client.on(MESSAGING_SOCKET_EVENTS.presenceChanged, () => { signals.push('presence'); });
  client.on('message.new', (payload: { message?: { id?: string } }) => {
    if (payload.message?.id) events.push(payload.message.id);
  });
  return client;
}

async function connected(socket: ClientSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (socket.connected) return resolve();
    const timeout = setTimeout(() => reject(new Error('socket connection timeout')), 8000);
    socket.once('connect', () => { clearTimeout(timeout); resolve(); });
    socket.once('connect_error', (error: Error) => { clearTimeout(timeout); reject(error); });
  });
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Không nhận đúng sự kiện từ Socket.IO qua Redis');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('Hai kho trùng ID vẫn cách ly Redis marker và Socket.IO', () => {
  let http: HttpServer;
  let server: Server;
  let clientA: ClientSocket;
  let clientB: ClientSocket;
  let clientPublic: ClientSocket;
  let redis: Redis;
  let adapterPub: Redis;
  let adapterSub: Redis;
  let emitter: MessagingRealtimeEmitterHandle;
  let processor: MessagingRealtimeProcessor;

  beforeAll(async () => {
    redis = new Redis(redisUrl);
    adapterPub = new Redis(redisUrl);
    adapterSub = adapterPub.duplicate();
    http = createServer();
    server = new Server(http);
    server.adapter(createAdapter(adapterPub, adapterSub) as never);
    server.of('/messaging').on('connection', (socket) => {
      const auth = socket.handshake.auth as {
        userId: string; tenantId: string; conversationId: string; spaceId: string | null;
      };
      socket.data.userId = auth.userId;
      void socket.join(userRoom(auth.tenantId, auth.userId, auth.spaceId));
      void socket.join(conversationRoom(auth.tenantId, auth.conversationId, auth.spaceId));
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const port = (http.address() as AddressInfo).port;
    clientA = connectedClient(port, spaceA.id, eventsA, signalsA);
    clientB = connectedClient(port, spaceB.id, eventsB, signalsB);
    clientPublic = connectedClient(port, null, eventsPublic, signalsPublic);
    await Promise.all([connected(clientA), connected(clientB), connected(clientPublic)]);

    const store: MessagingDistributionStore = {
      getMessage: async () => ({
        id: messageId, conversationId, userIdFrom: senderId,
        subject: '', fullMessage: 'Nội dung của A hoặc B', smallMessage: 'Nội dung',
        seq: 1, clientMessageId: null, deletedAt: null, deletedBy: null,
        recalledAt: null, recalledBy: null, replyToMessageId: null, createdAt: new Date(),
      }) as never,
      listMembers: async () => [senderId, userId],
      getConversation: async () => ({ id: conversationId, type: 2, tenantId }) as never,
      getConversationTenantId: async () => tenantId,
      listBlockedCounterpartIds: async () => [],
      attachQuotes: async (items: never[]) => items.map((item) => ({ ...(item as object), replyTo: null })) as never,
      countUnreadForConversation: async () => 0,
      listMessages: async () => [],
    };
    emitter = createMessagingRealtimeEmitter(redisUrl);
    const distribution = createMessagingDistributionService({
      store, emitter: emitter.emitter,
      logger: { warn: () => undefined, error: () => undefined },
      spaceId: () => tenantAls.getStore()?.spaceId,
    });
    const runner = new SpaceJobRunner({
      resolveTarget: async (slug: string) => ({
        mode: 'dedicated', status: 'active',
        spaceId: slug === spaceA.slug ? spaceA.id : spaceB.id,
      }),
      withSpaceKysely: async (slug: string, fn: () => Promise<unknown>, ctx: { tenantId?: string }) =>
        tenantAls.run({
          spaceSlug: slug,
          spaceId: slug === spaceA.slug ? spaceA.id : spaceB.id,
          tenantId: ctx.tenantId,
        }, fn),
    } as unknown as SpaceDatabaseService);
    processor = new MessagingRealtimeProcessor(distribution, redis, runner);
  }, 60_000);

  afterAll(async () => {
    clientA?.disconnect(); clientB?.disconnect(); clientPublic?.disconnect();
    await emitter?.close().catch(() => undefined);
    server?.close(); http?.close();
    await redis?.del(
      `${MESSAGING_DISTRIBUTED_KEY_PREFIX}${spaceA.id}-${outboxId}`,
      `${MESSAGING_DISTRIBUTED_KEY_PREFIX}${spaceB.id}-${outboxId}`,
    ).catch(() => undefined);
    redis?.disconnect(); adapterPub?.disconnect(); adapterSub?.disconnect();
  }, 60_000);

  function job(space: typeof spaceA) {
    return { data: {
      outboxId, seq: 1, aggregate: 'messaging', type: 'message_sent',
      payload: { messageId }, tenantId,
      spaceSlug: space.slug, spaceId: space.id,
      occurredAt: new Date().toISOString(),
    } } as never;
  }

  it('A nhận message, B không nhận dù toàn bộ ID nội bộ trùng nhau; retry A không phát lần hai; B vẫn nhận job của chính B', async () => {
    await processor.process(job(spaceA));
    await until(() => eventsA.includes(messageId));
    expect(eventsB).toEqual([]);
    expect(eventsPublic).toEqual([]);
    expect(await redis.exists(`${MESSAGING_DISTRIBUTED_KEY_PREFIX}${spaceA.id}-${outboxId}`)).toBe(1);
    expect(await redis.exists(`${MESSAGING_DISTRIBUTED_KEY_PREFIX}${spaceB.id}-${outboxId}`)).toBe(0);

    await processor.process(job(spaceA));
    expect(eventsA).toEqual([messageId]);
    await processor.process(job(spaceB));
    await until(() => eventsB.includes(messageId));
    expect(eventsA).toEqual([messageId]);
    expect(eventsB).toEqual([messageId]);
    expect(eventsPublic).toEqual([]);
    expect(await redis.exists(`${MESSAGING_DISTRIBUTED_KEY_PREFIX}${spaceB.id}-${outboxId}`)).toBe(1);
  }, 60_000);

  it('sự kiện presence và typing nhắm room A không tới B hoặc khu công cộng dù mọi ID nội bộ trùng', async () => {
    // Bộ room của API/worker lấy cùng một hàm từ package messaging.
    // Kiểm tra trực tiếp các sự kiện on-wire tới ba socket thật,
    // thay vì chỉ so sánh chuỗi tên room.
    const aRoom = conversationRoom(tenantId, conversationId, spaceA.id);
    server.of('/messaging').to(aRoom).emit(MESSAGING_SOCKET_EVENTS.typing, { conversationId, userId });
    server.of('/messaging').to(aRoom).emit(MESSAGING_SOCKET_EVENTS.presenceChanged, { userId, online: true });
    await until(() => signalsA.includes('typing') && signalsA.includes('presence'));
    expect(signalsB).toEqual([]);
    expect(signalsPublic).toEqual([]);
    expect(signalsA).toEqual(['typing', 'presence']);
    // Chứng minh socket B và khu công cộng vẫn giữ đúng room riêng,
    // không bị đẩy khỏi các kênh sau khi nhận phát A.
    const rooms = server.of('/messaging').adapter.rooms;
    expect(rooms.get(conversationRoom(tenantId, conversationId, spaceB.id))?.size).toBe(1);
    expect(rooms.get(conversationRoom(tenantId, conversationId, null))?.size).toBe(1);
  }, 60_000);
});
