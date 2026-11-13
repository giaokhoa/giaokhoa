import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import Redis from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, createTestApp, createUserViaApi, http, login, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';


interface Person { id: string; username: string; token: string }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Messaging — ẩn hội thoại/liên hệ khi có quan hệ chặn (issue #33)', () => {
  let app: INestApplication;
  let base: string;
  let a: Person;
  let b: Person;
  let conversationId: string;
  let pg: Client;
  let redis: Redis;

  async function person(firstName: string, lastName: string): Promise<Person> {
    const admin = await adminToken(app);
    const u = await createUserViaApi(app, admin, { firstName, lastName });
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, username: u.username, token: session.accessToken };
  }

  async function conversationIds(token: string): Promise<string[]> {
    const res = await http(app).get('/api/v1/messages/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { id: string }[]).map((c) => c.id);
  }

  async function contactIds(token: string): Promise<string[]> {
    const res = await http(app).get('/api/v1/messages/contacts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { contacts: string[] }).contacts;
  }

  async function send(token: string, text: string) {
    return http(app).post(`/api/v1/messages/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token}`).send({ text });
  }

  function connectSocket(token: string): Promise<Socket> {
    const socket: Socket = io(`${base}/messaging`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
      socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
      socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    a = await person('An', 'Blocker');
    b = await person('Binh', 'Blocked');
    const req = await http(app).post(`/api/v1/messages/contacts/${b.id}`)
      .set('Authorization', `Bearer ${a.token}`).send({});
    expect(req.status).toBe(201);
    const acc = await http(app).post(`/api/v1/messages/contacts/requests/${a.id}/accept`)
      .set('Authorization', `Bearer ${b.token}`).send({});
    expect(acc.status).toBe(201);
    const created = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${a.token}`).send({ memberIds: [b.id], type: 1 });
    expect(created.status).toBe(201);
    conversationId = (created.body as { id: string }).id;
    expect((await send(a.token, 'tin trước khi chặn')).status).toBe(201);
    expect((await send(b.token, 'tin trả lời')).status).toBe(201);
    const read = await http(app).post(`/api/v1/messages/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${a.token}`).send({});
    expect(read.status).toBe(201);
  });
  afterAll(async () => {
    redis.disconnect();
    await pg.end();
    await app.close();
  });

  it('chặn ẩn cuộc trò chuyện 1-1 và liên hệ khỏi CẢ hai phía; bỏ chặn khôi phục chúng', async () => {
    expect(await conversationIds(a.token)).toContain(conversationId);
    expect(await conversationIds(b.token)).toContain(conversationId);
    expect(await contactIds(a.token)).toContain(b.id);
    expect(await contactIds(b.token)).toContain(a.id);
    const unreadBefore = await http(app).get('/api/v1/messages/unread-count').set('Authorization', `Bearer ${b.token}`);
    expect((unreadBefore.body as { conversations: number }).conversations).toBe(1);
    const detailBefore = await http(app).get(`/api/v1/messages/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${b.token}`);
    expect((detailBefore.body as { memberReadMarkers: { userId: string }[] }).memberReadMarkers
      .some((m) => m.userId === a.id)).toBe(true);

    const block = await http(app).post(`/api/v1/messages/contacts/${b.id}/block`)
      .set('Authorization', `Bearer ${a.token}`).send({});
    expect(block.status).toBe(201);

    expect(await conversationIds(a.token)).not.toContain(conversationId);
    expect(await conversationIds(b.token)).not.toContain(conversationId);
    expect(await contactIds(a.token)).not.toContain(b.id);
    expect(await contactIds(b.token)).not.toContain(a.id);
    const unreadAfter = await http(app).get('/api/v1/messages/unread-count').set('Authorization', `Bearer ${b.token}`);
    expect((unreadAfter.body as { conversations: number }).conversations).toBe(0);

    const sendByBlocked = await send(b.token, 'gửi khi bị chặn');
    expect(sendByBlocked.status).toBe(403);
    expect(sendByBlocked.body.code).toBe('messaging.contact_blocked');
    const sendByBlocker = await send(a.token, 'gửi khi đang chặn');
    expect(sendByBlocker.status).toBe(403);
    expect(sendByBlocker.body.code).toBe('messaging.contact_blocked');

    for (const token of [a.token, b.token]) {
      const detail = await http(app).get(`/api/v1/messages/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detail.status).toBe(404);
      expect(detail.body.code).toBe('messaging.conversation_not_found');
      const windowRes = await http(app).get(`/api/v1/messages/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`);
      expect(windowRes.status).toBe(404);
      const read = await http(app).post(`/api/v1/messages/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${token}`).send({});
      expect(read.status).toBe(404);
    }

    const unblock = await http(app).delete(`/api/v1/messages/contacts/${b.id}/block`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(unblock.status).toBe(200);
    expect(await conversationIds(a.token)).toContain(conversationId);
    expect(await conversationIds(b.token)).toContain(conversationId);
    expect(await contactIds(a.token)).toContain(b.id);
    expect(await contactIds(b.token)).toContain(a.id);
    const detailAfter = await http(app).get(`/api/v1/messages/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(detailAfter.status).toBe(200);
    expect((detailAfter.body as { messages: { fullMessage: string }[] }).messages
      .some((m) => m.fullMessage === 'tin trước khi chặn')).toBe(true);
    expect((detailAfter.body as { memberReadMarkers: { userId: string }[] }).memberReadMarkers
      .some((m) => m.userId === a.id)).toBe(true);
    expect((await send(b.token, 'gửi lại sau bỏ chặn')).status).toBe(201);
  });

  it('cổng đọc trực tiếp để nguyên nhóm chung và đồng bộ realtime giữ lại lịch sử 1-1 bị chặn', async () => {
    const c = await person('Chi', 'GroupPeer');
    const d = await person('Dung', 'GroupPeer');
    const admin = await adminToken(app);
    const group = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${admin}`).send({ type: 2, memberIds: [c.id, d.id], name: 'Nhóm chung C-D' });
    expect(group.status).toBe(201);
    const groupId = (group.body as { id: string }).id;
    const groupMsg = await http(app).post(`/api/v1/messages/conversations/${groupId}/messages`)
      .set('Authorization', `Bearer ${c.token}`).send({ text: 'tin trong nhóm chung' });
    expect(groupMsg.status).toBe(201);

    const blockCD = await http(app).post(`/api/v1/messages/contacts/${d.id}/block`)
      .set('Authorization', `Bearer ${c.token}`).send({});
    expect(blockCD.status).toBe(201);
    try {
      for (const token of [c.token, d.token]) {
        const detail = await http(app).get(`/api/v1/messages/conversations/${groupId}`)
          .set('Authorization', `Bearer ${token}`);
        expect(detail.status).toBe(200);
        const windowRes = await http(app).get(`/api/v1/messages/conversations/${groupId}/messages`)
          .set('Authorization', `Bearer ${token}`);
        expect(windowRes.status).toBe(200);
      }
      const dSocket = await connectSocket(d.token);
      try {
        const syncGroup = await dSocket.emitWithAck('sync', { [groupId]: 0 }) as Record<string, { fullMessage: string }[]>;
        expect(syncGroup[groupId]?.some((m) => m.fullMessage === 'tin trong nhóm chung')).toBe(true);
      } finally {
        dSocket.disconnect();
      }
    } finally {
      const unblockCD = await http(app).delete(`/api/v1/messages/contacts/${d.id}/block`)
        .set('Authorization', `Bearer ${c.token}`);
      expect(unblockCD.status).toBe(200);
    }

    const block = await http(app).post(`/api/v1/messages/contacts/${b.id}/block`)
      .set('Authorization', `Bearer ${a.token}`).send({});
    expect(block.status).toBe(201);
    try {
      const bSocket = await connectSocket(b.token);
      try {
        const syncBlocked = await bSocket.emitWithAck('sync', { [conversationId]: 0 }) as Record<string, unknown[]>;
        expect(syncBlocked[conversationId]).toBeUndefined();
      } finally {
        bSocket.disconnect();
      }
    } finally {
      const unblock = await http(app).delete(`/api/v1/messages/contacts/${b.id}/block`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(unblock.status).toBe(200);
    }
    const bSocket2 = await connectSocket(b.token);
    try {
      const syncAfter = await bSocket2.emitWithAck('sync', { [conversationId]: 0 }) as Record<string, { fullMessage: string }[]>;
      expect(syncAfter[conversationId]?.some((m) => m.fullMessage === 'tin trước khi chặn')).toBe(true);
    } finally {
      bSocket2.disconnect();
    }
  });

  it('xoá tin nhắn của cuộc trò chuyện 1-1 bị chặn trả 404 và không phát gì sang phía kia', async () => {
    const createdMsg = await send(a.token, 'tin sẽ xoá khi đang chặn');
    expect(createdMsg.status).toBe(201);
    const messageId = (createdMsg.body as { id: string }).id;
    const block = await http(app).post(`/api/v1/messages/contacts/${b.id}/block`)
      .set('Authorization', `Bearer ${a.token}`).send({});
    expect(block.status).toBe(201);
    try {
      const del = await http(app).delete(`/api/v1/messages/${messageId}`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(del.status).toBe(404);
      expect(del.body.code).toBe('messaging.conversation_not_found');
      const delByBlocked = await http(app).delete(`/api/v1/messages/${messageId}`)
        .set('Authorization', `Bearer ${b.token}`);
      expect(delByBlocked.status).toBe(404);
      expect(delByBlocked.body.code).toBe('messaging.conversation_not_found');
      const outboxRows = await pg.query(
        `select count(*)::int as n from outbox_events where type = 'message_deleted' and payload->>'messageId' = $1`,
        [messageId],
      );
      expect((outboxRows.rows[0] as { n: number }).n).toBe(0);
    } finally {
      const unblock = await http(app).delete(`/api/v1/messages/contacts/${b.id}/block`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(unblock.status).toBe(200);
    }
    const detailAfter = await http(app).get(`/api/v1/messages/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(detailAfter.status).toBe(200);
    expect((detailAfter.body as { messages: { id: string }[] }).messages
      .some((m) => m.id === messageId)).toBe(true);
    const delAfter = await http(app).delete(`/api/v1/messages/${messageId}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(delAfter.status).toBe(200);
  });


  it('presence của người chặn không tới được phía bị chặn trong lúc bị chặn, và chảy lại sau khi bỏ chặn', async () => {
    const bSocket = await connectSocket(b.token);
    const presenceEvents: { userId: string; online: boolean }[] = [];
    bSocket.on('presence.changed', (payload: { userId: string; online: boolean }) => {
      presenceEvents.push(payload);
    });
    try {
      const block = await http(app).post(`/api/v1/messages/contacts/${b.id}/block`)
        .set('Authorization', `Bearer ${a.token}`).send({});
      expect(block.status).toBe(201);
      presenceEvents.length = 0;
      const aSocket1 = await connectSocket(a.token);
      const presenceDeadline = Date.now() + 1500;
      let presenceKeySeen = false;
      while (Date.now() < presenceDeadline) {
        if (presenceEvents.some((e) => e.userId === a.id)) break;
        if (!presenceKeySeen) {
          presenceKeySeen = (await redis.keys(`giaokhoa:messaging:presence:*:${a.id}`)).length > 0;
        }
        await sleep(50);
      }
      if (!presenceKeySeen) throw new Error('presence key of A never appeared in Redis — markConnected did not run');
      expect(presenceEvents.some((e) => e.userId === a.id)).toBe(false);
      aSocket1.disconnect();

      const unblock = await http(app).delete(`/api/v1/messages/contacts/${b.id}/block`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(unblock.status).toBe(200);
      presenceEvents.length = 0;
      const aSocket2 = await connectSocket(a.token);
      const deadline = Date.now() + 5000;
      while (!presenceEvents.some((e) => e.userId === a.id && e.online) && Date.now() < deadline) {
        await sleep(100);
      }
      expect(presenceEvents.some((e) => e.userId === a.id && e.online)).toBe(true);
      aSocket2.disconnect();
    } finally {
      bSocket.disconnect();
    }
  });

});
