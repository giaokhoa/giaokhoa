import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DelayedError } from 'bullmq';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import {
  conversationRoom,
  createMessagingDistributionService,
  userRoom,
  type MessagingDistributionStore,
} from '@giaokhoa/messaging';
import {
  createMessagingRealtimeEmitter,
  type MessagingRealtimeEmitterHandle,
} from './messaging-realtime-emitter';
import { SpaceJobRunner } from './db/routing/space-job-runner';
import type { SpaceDatabaseService } from './db/routing/space-database.service';
import {
  MESSAGING_DISTRIBUTED_KEY_PREFIX,
  MessagingRealtimeProcessor,
} from './processors/messaging-realtime.processor';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const ACL_USER = 'giaokhoa-test-nopublish';
const ACL_PASS = 'giaokhoa-test-nopublish-pass';

const tenantId = 'emitter-spec-tenant';
const convId = randomUUID();
const userA = randomUUID();
const userB = randomUUID();

interface ReceivedEvent { event: string; payload: { message?: { id?: string } } }
const received: ReceivedEvent[] = [];
const usedOutboxIds: string[] = [];

function makeRow(id: string, seq: number): Record<string, unknown> {
  return {
    id,
    conversationId: convId,
    userIdFrom: userA,
    subject: '',
    fullMessage: `tin kiểm cổng phát ${seq}`,
    smallMessage: `tin kiểm cổng phát ${seq}`,
    seq,
    clientMessageId: null,
    deletedAt: null,
    deletedBy: null,
    recalledAt: null,
    recalledBy: null,
    replyToMessageId: null,
    createdAt: new Date(),
  };
}

const rows = new Map<string, Record<string, unknown>>();
const store: MessagingDistributionStore = {
  getMessage: async (id: string) => rows.get(id) as never,
  listMembers: async () => [userA, userB],
  getConversation: async () => ({ id: convId, type: 2, tenantId }) as never,
  getConversationTenantId: async () => tenantId,
  listBlockedCounterpartIds: async () => [],
  attachQuotes: async (input: never[]) => input.map((row) => ({ ...(row as object), replyTo: null })) as never,
  countUnreadForConversation: async () => 0,
  listMessages: async () => [],
};

function makeProcessor(emitterHandle: MessagingRealtimeEmitterHandle, markRedis: Redis): MessagingRealtimeProcessor {
  const distribution = createMessagingDistributionService({
    store,
    emitter: emitterHandle.emitter,
    logger: { warn: () => undefined, error: () => undefined },
  });
  const runner = new SpaceJobRunner({
    resolveTarget: async () => {
      throw new Error('spec không cấu hình sổ đăng ký');
    },
  } as unknown as SpaceDatabaseService);
  return new MessagingRealtimeProcessor(distribution, markRedis, runner);
}

function jobOf(outboxId: string, messageId: string, seq: number): never {
  usedOutboxIds.push(outboxId);
  return {
    data: {
      outboxId,
      seq,
      aggregate: 'messaging',
      type: 'message_sent',
      payload: { messageId },
      tenantId,
      spaceSlug: null,
      spaceId: null,
      occurredAt: new Date().toISOString(),
    },
  } as never;
}

async function waitUntil(check: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 60); });
  }
  throw new Error(`hết hạn chờ ${label} sau ${timeoutMs}ms`);
}

describe('Cổng phát realtime messaging ở worker — publish Redis phải được xác nhận trước khi ghi dấu', () => {
  let httpServer: HttpServer;
  let ioServer: Server;
  let client: ClientSocket;
  let markRedis: Redis;
  let adminRedis: Redis;
  let healthyEmitter: MessagingRealtimeEmitterHandle;
  let port = 0;

  beforeAll(async () => {
    markRedis = new Redis(REDIS_URL);
    adminRedis = new Redis(REDIS_URL);

    const pub = new Redis(REDIS_URL);
    const sub = pub.duplicate();
    httpServer = createServer();
    ioServer = new Server(httpServer);
    ioServer.adapter(createAdapter(pub, sub) as never);
    ioServer.of('/messaging').on('connection', (socket) => {
      const auth = socket.handshake.auth as { userId: string; tenantId: string | null; conversationIds?: string[] };
      socket.data.userId = auth.userId;
      void socket.join(userRoom(auth.tenantId, auth.userId));
      for (const conversationId of auth.conversationIds ?? []) {
        void socket.join(conversationRoom(auth.tenantId, conversationId));
      }
    });
    await new Promise<void>((resolve) => { httpServer.listen(0, '127.0.0.1', () => resolve()); });
    port = (httpServer.address() as AddressInfo).port;

    client = clientIo(`http://127.0.0.1:${port}/messaging`, {
      auth: { userId: userB, tenantId, conversationIds: [convId] },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    for (const event of ['message.new', 'conversation.updated', 'message.read', 'message.deleted', 'conversation.invalidate']) {
      client.on(event, (payload: ReceivedEvent['payload']) => { received.push({ event, payload }); });
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
      client.once('connect', () => { clearTimeout(timer); resolve(); });
      client.once('connect_error', (err: Error) => { clearTimeout(timer); reject(err); });
    });

    healthyEmitter = createMessagingRealtimeEmitter(REDIS_URL);
  }, 60000);

  afterAll(async () => {
    client?.disconnect();
    ioServer?.close();
    httpServer?.close();
    await healthyEmitter?.close().catch(() => undefined);
    if (usedOutboxIds.length > 0) {
      await adminRedis?.del(...usedOutboxIds.map((id) => `${MESSAGING_DISTRIBUTED_KEY_PREFIX}${id}`)).catch(() => undefined);
    }
    await adminRedis?.call('ACL', 'DELUSER', ACL_USER).catch(() => undefined);
    adminRedis?.disconnect();
    markRedis?.disconnect();
  }, 60000);

  it('publish lành mạnh: process() hoàn thành, client phía API nhận đủ sự kiện và dấu đã-phân-phối được ghi', async () => {
    const messageId = randomUUID();
    const outboxId = randomUUID();
    rows.set(messageId, makeRow(messageId, 1));
    const processor = makeProcessor(healthyEmitter, markRedis);

    await processor.process(jobOf(outboxId, messageId, 1));

    await waitUntil(
      () => received.some((e) => e.event === 'message.new' && e.payload.message?.id === messageId),
      8000,
      'client nhận message.new khi publish lành mạnh',
    );
    await waitUntil(
      () => received.some((e) => e.event === 'conversation.updated' && e.payload.message?.id === messageId),
      8000,
      'client nhận conversation.updated khi publish lành mạnh',
    );
    expect(await markRedis.exists(`${MESSAGING_DISTRIBUTED_KEY_PREFIX}${outboxId}`)).toBe(1);
  }, 60000);

  it('publish bị Redis từ chối trong khi đường ghi dấu lành mạnh: process() ném DelayedError hẹn thử lại, dấu không được ghi, phía API không nhận sự kiện; lượt chạy lại bằng cổng phát lành mạnh phân phối được và ghi dấu', async () => {
    await adminRedis.call(
      'ACL', 'SETUSER', ACL_USER, 'reset', 'on', `>${ACL_PASS}`, 'allchannels',
      '+subscribe', '+psubscribe', '+unsubscribe', '+punsubscribe',
      '+ping', '+quit', '+client', '+select', '-publish',
    );
    const aclPub = new Redis(REDIS_URL, { username: ACL_USER, password: ACL_PASS, enableReadyCheck: false });
    await expect(aclPub.publish('emitter-spec-channel', 'x')).rejects.toThrow(/NOPERM/);
    aclPub.disconnect();

    const badEmitter = createMessagingRealtimeEmitter(REDIS_URL, { username: ACL_USER, password: ACL_PASS });
    const messageId = randomUUID();
    const outboxId = randomUUID();
    rows.set(messageId, makeRow(messageId, 2));
    try {
      const badProcessor = makeProcessor(badEmitter, markRedis);

      await expect(badProcessor.process(jobOf(outboxId, messageId, 2))).rejects.toThrow(DelayedError);

      await new Promise((resolve) => { setTimeout(resolve, 2000); });
      expect(await markRedis.exists(`${MESSAGING_DISTRIBUTED_KEY_PREFIX}${outboxId}`)).toBe(0);
      expect(received.filter(
        (e) => (e.event === 'message.new' || e.event === 'conversation.updated') && e.payload.message?.id === messageId,
      )).toHaveLength(0);
    } finally {
      await badEmitter.close().catch(() => undefined);
    }

    const retryProcessor = makeProcessor(healthyEmitter, markRedis);
    await retryProcessor.process(jobOf(outboxId, messageId, 2));
    await waitUntil(
      () => received.some((e) => e.event === 'message.new' && e.payload.message?.id === messageId),
      8000,
      'client nhận message.new ở lượt thử lại',
    );
    expect(await markRedis.exists(`${MESSAGING_DISTRIBUTED_KEY_PREFIX}${outboxId}`)).toBe(1);
  }, 90000);
});
