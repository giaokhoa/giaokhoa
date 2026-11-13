import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { sql, type JsonValue } from '@giaokhoa/db';
import { conversationRoom, userRoom } from '@giaokhoa/messaging';
import { OutboxRelayScheduler } from '../../../src/outbox-relay.scheduler';
import {
  MESSAGING_DISTRIBUTED_KEY_PREFIX,
  MessagingRealtimeProcessor,
} from '../../../src/processors/messaging-realtime.processor';
import type { OutboxEventJobData } from '../../../src/outbox-event-routes';
import {
  bootWorkerModuleAsOrdinaryRole,
  type OrdinaryWorkerModuleHarness,
} from '../../support/ordinary-worker-module';

describe('Worker — phân phối realtime messaging qua hàng đợi (issue #521)', () => {
  let context: INestApplicationContext;
  let harness: OrdinaryWorkerModuleHarness;
  let db: OrdinaryWorkerModuleHarness['adminDb'];
  let relay: OutboxRelayScheduler;
  let processor: MessagingRealtimeProcessor;
  let queue: Queue;
  let redis: Redis;
  let httpServer: HttpServer;
  let ioServer: Server;
  let port = 0;
  const clients: ClientSocket[] = [];

  const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

  interface ReceivedEvent { event: string; payload: unknown }
  const received = new Map<string, ReceivedEvent[]>();

  function eventsOf(clientKey: string, event?: string): ReceivedEvent[] {
    const all = received.get(clientKey) ?? [];
    return event ? all.filter((e) => e.event === event) : all;
  }

  async function connectClient(clientKey: string, identity: { userId: string; tenantId: string | null; conversationIds: string[] }): Promise<ClientSocket> {
    const socket = clientIo(`http://127.0.0.1:${port}/messaging`, {
      auth: identity,
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    clients.push(socket);
    received.set(clientKey, []);
    for (const event of ['message.new', 'conversation.updated', 'message.read', 'message.deleted', 'conversation.invalidate']) {
      socket.on(event, (payload: unknown) => {
        received.get(clientKey)!.push({ event, payload });
      });
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });
    return socket;
  }

  async function waitUntil(check: () => boolean, timeoutMs = 15000, label = 'điều kiện'): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise((resolve) => { setTimeout(resolve, 60); });
    }
    throw new Error(`hết hạn chờ ${label} sau ${timeoutMs}ms`);
  }

  async function waitDistributed(outboxId: string): Promise<void> {
    const deadline = Date.now() + 15000;
    for (;;) {
      if ((await redis.exists(`${MESSAGING_DISTRIBUTED_KEY_PREFIX}${outboxId}`)) === 1) return;
      if (Date.now() > deadline) throw new Error(`hết hạn chờ dấu đã-phân-phối của ${outboxId}`);
      await new Promise((resolve) => { setTimeout(resolve, 60); });
    }
  }

  async function settle(ms = 400): Promise<void> {
    await new Promise((resolve) => { setTimeout(resolve, ms); });
  }


  async function makeUser(id: string): Promise<void> {
    await sql`insert into users (id, username, email, first_name, last_name, suspended, deleted) values (${id}, ${`u521-${id.slice(-8)}`}, ${`u521-${id.slice(-8)}@x.io`}, 'An', 'Nguyễn', false, false) on conflict (id) do nothing`.execute(db);
  }

  async function makeTenant(id: string): Promise<void> {
    await sql`insert into tenants (id, slug, name, kind) values (${id}, ${`t521-${id.slice(-8)}`}, 'Trung tâm 521', 'center') on conflict (id) do nothing`.execute(db);
  }

  async function makeConversation(opts: { type: number; tenantId: string | null; memberIds: string[] }): Promise<string> {
    const id = randomUUID();
    await db.insertInto('message_conversations').values({
      id, type: opts.type, tenant_id: opts.tenantId, last_message_seq: 0,
    }).execute();
    for (const userId of opts.memberIds) {
      await db.insertInto('message_conversation_members').values({ conversation_id: id, user_id: userId }).execute();
    }
    return id;
  }

  async function setLastReadSeq(conversationId: string, userId: string, seq: number): Promise<void> {
    await db.updateTable('message_conversation_members')
      .set({ last_read_seq: seq })
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId)
      .execute();
  }

  async function makeMessage(opts: {
    conversationId: string; userIdFrom: string; seq: number; text: string;
    recalledAt?: Date; recalledBy?: string; replyToMessageId?: string;
  }): Promise<string> {
    const id = randomUUID();
    await db.insertInto('message').values({
      id,
      conversation_id: opts.conversationId,
      user_id_from: opts.userIdFrom,
      subject: '',
      full_message: opts.text,
      small_message: opts.text,
      seq: opts.seq,
      reply_to_message_id: opts.replyToMessageId ?? null,
      recalled_at: opts.recalledAt ?? null,
      recalled_by: opts.recalledBy ?? null,
    }).execute();
    await db.updateTable('message_conversations')
      .set({ last_message_seq: opts.seq })
      .where('id', '=', opts.conversationId)
      .execute();
    return id;
  }

  async function insertOutbox(type: string, payload: Record<string, unknown>, tenantId: string | null): Promise<string> {
    const id = uuidv7();
    await db.insertInto('outbox_events').values({ id, aggregate: 'messaging', type, payload: sql<JsonValue>`${JSON.stringify(payload)}::jsonb`, tenant_id: tenantId }).execute();
    return id;
  }

  async function sendAndDistribute(opts: {
    conversationId: string; userIdFrom: string; seq: number; text: string; tenantId: string | null;
    replyToMessageId?: string;
  }): Promise<{ messageId: string; outboxId: string }> {
    const messageId = await makeMessage(opts);
    const outboxId = await insertOutbox('message_sent', {
      conversationId: opts.conversationId, messageId, seq: opts.seq, fromUserId: opts.userIdFrom,
    }, opts.tenantId);
    await relay.relayTick();
    await waitDistributed(outboxId);
    return { messageId, outboxId };
  }

  beforeAll(async () => {
    harness = await bootWorkerModuleAsOrdinaryRole();
    context = harness.context;
    db = harness.adminDb;
    relay = context.get(OutboxRelayScheduler);
    processor = context.get(MessagingRealtimeProcessor);
    queue = context.get(getQueueToken('messaging-realtime'));
    redis = new Redis(REDIS_URL);

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
  }, 120000);

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    ioServer.close();
    httpServer.close();
    redis.disconnect();
    await harness.close();
  });

  it('phân phối tin mới vào đúng room và conversation.updated mang số chưa đọc của chính từng thành viên', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    for (const u of [a, b, c]) await makeUser(u);
    const convId = await makeConversation({ type: 2, tenantId, memberIds: [a, b, c] });
    await makeMessage({ conversationId: convId, userIdFrom: a, seq: 1, text: 'tin một' });
    await makeMessage({ conversationId: convId, userIdFrom: c, seq: 2, text: 'tin hai' });
    await setLastReadSeq(convId, b, 1);
    await connectClient('a', { userId: a, tenantId, conversationIds: [convId] });
    await connectClient('b', { userId: b, tenantId, conversationIds: [convId] });
    await connectClient('c', { userId: c, tenantId, conversationIds: [convId] });

    const { messageId } = await sendAndDistribute({ conversationId: convId, userIdFrom: a, seq: 3, text: 'tin ba mới', tenantId });

    await waitUntil(() => eventsOf('b', 'message.new').length === 1, 10000, 'B nhận message.new');
    const newPayload = eventsOf('b', 'message.new')[0]!.payload as { conversationId: string; message: { id: string; seq: number; fullMessage: string } };
    expect(newPayload.conversationId).toBe(convId);
    expect(newPayload.message.id).toBe(messageId);
    expect(newPayload.message.seq).toBe(3);
    expect(newPayload.message.fullMessage).toBe('tin ba mới');
    const updatedOf = (key: string) => eventsOf(key, 'conversation.updated')
      .map((e) => e.payload as { conversationId: string; unreadCount: number; message: { id: string } })
      .find((p) => p.conversationId === convId && p.message.id === messageId);
    await waitUntil(() => updatedOf('a') !== undefined && updatedOf('b') !== undefined && updatedOf('c') !== undefined, 10000, 'đủ conversation.updated');
    expect(updatedOf('b')!.unreadCount).toBe(2);
    expect(updatedOf('a')!.unreadCount).toBe(1);
    expect(updatedOf('c')!.unreadCount).toBe(2);
  });

  it('message.new của tin trả lời mang đủ dữ kiện trích dẫn cho phía nhận', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b] = [randomUUID(), randomUUID()];
    for (const u of [a, b]) await makeUser(u);
    const convId = await makeConversation({ type: 1, tenantId, memberIds: [a, b] });
    await connectClient('b-quote', { userId: b, tenantId, conversationIds: [convId] });

    const originalId = await makeMessage({ conversationId: convId, userIdFrom: b, seq: 1, text: 'tin gốc cho realtime' });
    const { messageId } = await sendAndDistribute({
      conversationId: convId, userIdFrom: a, seq: 2, text: 'trả lời qua realtime', tenantId, replyToMessageId: originalId,
    });

    await waitUntil(() => eventsOf('b-quote', 'message.new').length === 1, 10000, 'B nhận message.new của tin trả lời');
    const payload = eventsOf('b-quote', 'message.new')[0]!.payload as {
      message: { id: string; replyTo: { id: string; userIdFrom: string; excerpt: string; unavailable: boolean } | null };
    };
    expect(payload.message.id).toBe(messageId);
    expect(payload.message.replyTo).toMatchObject({
      id: originalId,
      userIdFrom: b,
      excerpt: 'tin gốc cho realtime',
      unavailable: false,
    });
  });

  it('phân phối biên đã-đọc tới các thành viên còn lại kèm mốc của người đọc', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b] = [randomUUID(), randomUUID()];
    for (const u of [a, b]) await makeUser(u);
    const convId = await makeConversation({ type: 1, tenantId, memberIds: [a, b] });
    await makeMessage({ conversationId: convId, userIdFrom: a, seq: 1, text: 'chào' });
    await connectClient('a2', { userId: a, tenantId, conversationIds: [convId] });
    await connectClient('b2', { userId: b, tenantId, conversationIds: [convId] });

    await setLastReadSeq(convId, b, 1);
    const outboxId = await insertOutbox('message_conversation_read', { conversationId: convId, userId: b, lastReadSeq: 1 }, tenantId);
    await relay.relayTick();
    await waitDistributed(outboxId);

    await waitUntil(() => eventsOf('a2', 'message.read').length === 1, 10000, 'A nhận message.read');
    const payload = eventsOf('a2', 'message.read')[0]!.payload as { conversationId: string; userId: string; lastReadSeq: number };
    expect(payload).toEqual({ conversationId: convId, userId: b, lastReadSeq: 1 });
  });

  it('phân phối nhiều tin theo đúng thứ tự seq của các sự kiện', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b] = [randomUUID(), randomUUID()];
    for (const u of [a, b]) await makeUser(u);
    const convId = await makeConversation({ type: 2, tenantId, memberIds: [a, b] });
    await connectClient('b3', { userId: b, tenantId, conversationIds: [convId] });

    const m1 = await makeMessage({ conversationId: convId, userIdFrom: a, seq: 1, text: 'thứ nhất' });
    const e1 = await insertOutbox('message_sent', { conversationId: convId, messageId: m1, seq: 1, fromUserId: a }, tenantId);
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    const m2 = await makeMessage({ conversationId: convId, userIdFrom: a, seq: 2, text: 'thứ hai' });
    const e2 = await insertOutbox('message_sent', { conversationId: convId, messageId: m2, seq: 2, fromUserId: a }, tenantId);
    await relay.relayTick();
    await waitDistributed(e1);
    await waitDistributed(e2);

    await waitUntil(() => eventsOf('b3', 'message.new').length === 2, 10000, 'B nhận đủ hai tin');
    const seqs = eventsOf('b3', 'message.new').map((e) => (e.payload as { message: { seq: number } }).message.seq);
    expect(seqs).toEqual([1, 2]);
  });

  it('thành viên bị gỡ khỏi conversation thì không nhận tin mới nữa và socket bị đẩy khỏi room tại thời điểm phân phối', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b] = [randomUUID(), randomUUID()];
    for (const u of [a, b]) await makeUser(u);
    const convId = await makeConversation({ type: 2, tenantId, memberIds: [a, b] });
    await connectClient('a4', { userId: a, tenantId, conversationIds: [convId] });
    await connectClient('b4', { userId: b, tenantId, conversationIds: [convId] });

    await sendAndDistribute({ conversationId: convId, userIdFrom: a, seq: 1, text: 'trước khi gỡ', tenantId });
    await waitUntil(() => eventsOf('b4', 'message.new').length === 1, 10000, 'B nhận tin khi còn là thành viên');

    await db.deleteFrom('message_conversation_members')
      .where('conversation_id', '=', convId)
      .where('user_id', '=', b)
      .execute();

    await sendAndDistribute({ conversationId: convId, userIdFrom: a, seq: 2, text: 'sau khi gỡ', tenantId });
    await waitUntil(() => eventsOf('a4', 'message.new').some((e) => (e.payload as { message: { seq: number } }).message.seq === 2), 10000, 'A nhận tin sau khi gỡ');
    await settle();
    expect(eventsOf('b4', 'message.new')).toHaveLength(1);
    const sockets = await ioServer.of('/messaging').in(conversationRoom(tenantId, convId)).fetchSockets();
    expect(sockets.map((s) => (s.data as { userId?: string }).userId)).toEqual([a]);
  });

  it('thu hồi thì phía kia nhận message.deleted và conversation.invalidate, xem trước không lộ nội dung đã thu hồi', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b] = [randomUUID(), randomUUID()];
    for (const u of [a, b]) await makeUser(u);
    const convId = await makeConversation({ type: 2, tenantId, memberIds: [a, b] });
    await connectClient('b5', { userId: b, tenantId, conversationIds: [convId] });

    const messageId = await makeMessage({
      conversationId: convId, userIdFrom: a, seq: 1, text: 'nội dung bí mật sẽ thu hồi',
      recalledAt: new Date(), recalledBy: a,
    });
    const outboxId = await insertOutbox('message_recalled', { conversationId: convId, messageId }, tenantId);
    await relay.relayTick();
    await waitDistributed(outboxId);

    await waitUntil(() => eventsOf('b5', 'message.deleted').length === 1, 10000, 'B nhận message.deleted');
    const deleted = eventsOf('b5', 'message.deleted')[0]!.payload as { conversationId: string; messageId: string; deletedBy: string };
    expect(deleted).toEqual({ conversationId: convId, messageId, seq: 1, deletedBy: a });
    await waitUntil(() => eventsOf('b5', 'conversation.invalidate').some((e) => (e.payload as { conversationId: string }).conversationId === convId), 10000, 'B nhận conversation.invalidate');
    const updated = eventsOf('b5', 'conversation.updated')
      .map((e) => e.payload as { message: { id: string; fullMessage: string } })
      .find((p) => p.message.id === messageId);
    expect(updated).toBeDefined();
    expect(updated!.message.fullMessage).toBe('');
    expect(JSON.stringify(eventsOf('b5'))).not.toContain('nội dung bí mật sẽ thu hồi');
  });

  it('xoá-phía-mình chỉ phát tín hiệu cho chính người xoá, phía kia không nhận gì', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b] = [randomUUID(), randomUUID()];
    for (const u of [a, b]) await makeUser(u);
    const convId = await makeConversation({ type: 2, tenantId, memberIds: [a, b] });
    await connectClient('a6', { userId: a, tenantId, conversationIds: [convId] });
    await connectClient('b6', { userId: b, tenantId, conversationIds: [convId] });
    const messageId = await makeMessage({ conversationId: convId, userIdFrom: b, seq: 1, text: 'tin của B' });

    const outboxId = await insertOutbox('message_deleted_for_me', {
      conversationId: convId, messageId, seq: 1, actorId: a,
    }, tenantId);
    await relay.relayTick();
    await waitDistributed(outboxId);

    await waitUntil(() => eventsOf('a6', 'message.deleted').length === 1, 10000, 'A nhận message.deleted của chính mình');
    await waitUntil(() => eventsOf('a6', 'conversation.invalidate').length === 1, 10000, 'A nhận conversation.invalidate');
    await settle();
    expect(eventsOf('b6')).toEqual([]);
  });

  it('biên đã-đọc ghi trước lúc chặn bị nén ở tầng phân phối, phía bị chặn không nhận message.read', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b] = [randomUUID(), randomUUID()];
    for (const u of [a, b]) await makeUser(u);
    const convId = await makeConversation({ type: 1, tenantId, memberIds: [a, b] });
    await makeMessage({ conversationId: convId, userIdFrom: b, seq: 1, text: 'tin của B' });
    await connectClient('a7', { userId: a, tenantId, conversationIds: [convId] });
    await connectClient('b7', { userId: b, tenantId, conversationIds: [convId] });

    const outboxId = await insertOutbox('message_conversation_read', { conversationId: convId, userId: a, lastReadSeq: 1 }, tenantId);
    await db.insertInto('message_users_blocked').values({ user_id: a, blocked_user_id: b }).execute();
    await relay.relayTick();
    await waitDistributed(outboxId);

    await settle();
    expect(eventsOf('b7', 'message.read')).toEqual([]);
    expect(eventsOf('a7', 'message.read')).toEqual([]);
  });

  it('tin gửi trước lúc chặn bị nén ở tầng phân phối, phía bị chặn không nhận message.new lẫn conversation.updated', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b] = [randomUUID(), randomUUID()];
    for (const u of [a, b]) await makeUser(u);
    const convId = await makeConversation({ type: 1, tenantId, memberIds: [a, b] });
    await connectClient('b8', { userId: b, tenantId, conversationIds: [convId] });

    const messageId = await makeMessage({ conversationId: convId, userIdFrom: a, seq: 1, text: 'tin gửi trước khi bị chặn' });
    const outboxId = await insertOutbox('message_sent', {
      conversationId: convId, messageId, seq: 1, fromUserId: a,
    }, tenantId);
    await db.insertInto('message_users_blocked').values({ user_id: b, blocked_user_id: a }).execute();
    await relay.relayTick();
    await waitDistributed(outboxId);

    await settle();
    expect(eventsOf('b8')).toEqual([]);
  });

  it('phát lại cùng một sự kiện không phân phối lần hai: relay không tạo job mới và processor bỏ qua job trùng theo outboxId', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b] = [randomUUID(), randomUUID()];
    for (const u of [a, b]) await makeUser(u);
    const convId = await makeConversation({ type: 2, tenantId, memberIds: [a, b] });
    await connectClient('b9', { userId: b, tenantId, conversationIds: [convId] });

    const { outboxId } = await sendAndDistribute({ conversationId: convId, userIdFrom: a, seq: 1, text: 'chỉ một lần', tenantId });
    await waitUntil(() => eventsOf('b9', 'message.new').length === 1, 10000, 'B nhận tin lần đầu');
    const completedBefore = (await queue.getJobCounts('completed')).completed;

    await relay.relayTick();
    const row = await db.selectFrom('outbox_events').selectAll().where('id', '=', outboxId).executeTakeFirst();
    const jobData: OutboxEventJobData = {
      outboxId,
      seq: Number(row!.seq),
      aggregate: 'messaging',
      type: 'message_sent',
      payload: row!.payload as Record<string, unknown>,
      spaceSlug: null,
      spaceId: null,
      tenantId,
      occurredAt: row!.occurred_at.toISOString(),
    };
    await processor.process({ data: jobData } as never);
    await settle();
    expect((await queue.getJobCounts('completed')).completed).toBe(completedBefore);
    expect(eventsOf('b9', 'message.new')).toHaveLength(1);
  });

  it('không giữ watermark: sự kiện ghi sau khi các dòng outbox của đời trước bị xoá sạch vẫn được phân phối', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b] = [randomUUID(), randomUUID()];
    for (const u of [a, b]) await makeUser(u);
    const convId = await makeConversation({ type: 2, tenantId, memberIds: [a, b] });
    await connectClient('b10', { userId: b, tenantId, conversationIds: [convId] });

    const first = await sendAndDistribute({ conversationId: convId, userIdFrom: a, seq: 1, text: 'đời trước', tenantId });
    await waitUntil(() => eventsOf('b10', 'message.new').length === 1, 10000, 'B nhận tin đời trước');

    await db.deleteFrom('outbox_events').where(sql<boolean>`payload ->> 'conversationId' = ${convId}`).execute();

    const second = await sendAndDistribute({ conversationId: convId, userIdFrom: a, seq: 2, text: 'đời mới', tenantId });
    expect(second.outboxId).not.toBe(first.outboxId);
    await waitUntil(() => eventsOf('b10', 'message.new').length === 2, 10000, 'B nhận tin đời mới');
    const texts = eventsOf('b10', 'message.new').map((e) => (e.payload as { message: { fullMessage: string } }).message.fullMessage);
    expect(texts).toEqual(['đời trước', 'đời mới']);
  });

  it('không lọt sự kiện sang tenant khác dù trùng id conversation', async () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    await makeTenant(tenantId);
    await makeTenant(otherTenantId);
    const [a, b, x] = [randomUUID(), randomUUID(), randomUUID()];
    for (const u of [a, b, x]) await makeUser(u);
    const convId = await makeConversation({ type: 2, tenantId, memberIds: [a, b] });
    await connectClient('b11', { userId: b, tenantId, conversationIds: [convId] });
    await connectClient('x11', { userId: x, tenantId: otherTenantId, conversationIds: [convId] });

    await sendAndDistribute({ conversationId: convId, userIdFrom: a, seq: 1, text: 'chỉ tenant mình', tenantId });
    await waitUntil(() => eventsOf('b11', 'message.new').length === 1, 10000, 'B nhận tin');
    await settle();
    expect(eventsOf('x11')).toEqual([]);
  });

  it('thành viên đã tắt thông báo nhận conversation.updated với unreadCount bằng 0, thành viên còn lại nhận đúng số', async () => {
    const tenantId = randomUUID();
    await makeTenant(tenantId);
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    for (const u of [a, b, c]) await makeUser(u);
    const convId = await makeConversation({ type: 2, tenantId, memberIds: [a, b, c] });
    await connectClient('b12', { userId: b, tenantId, conversationIds: [convId] });
    await connectClient('c12', { userId: c, tenantId, conversationIds: [convId] });
    await db.updateTable('message_conversation_members')
      .set({ muted: true })
      .where('conversation_id', '=', convId)
      .where('user_id', '=', b)
      .execute();

    await sendAndDistribute({ conversationId: convId, userIdFrom: a, seq: 1, text: 'tin cho nhóm đã tắt', tenantId });
    await waitUntil(() => eventsOf('b12', 'conversation.updated').length === 1, 10000, 'B nhận conversation.updated');
    await waitUntil(() => eventsOf('c12', 'conversation.updated').length === 1, 10000, 'C nhận conversation.updated');

    const updatedB = eventsOf('b12', 'conversation.updated')[0]!.payload as { unreadCount: number };
    const updatedC = eventsOf('c12', 'conversation.updated')[0]!.payload as { unreadCount: number };
    expect(updatedB.unreadCount).toBe(0);
    expect(updatedC.unreadCount).toBe(1);
  });
});
