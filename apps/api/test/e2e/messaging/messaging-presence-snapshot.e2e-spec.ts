import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, createTestApp, createUserViaApi, http, login, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';


interface Person { id: string; username: string; token: string }

const PRESENCE_KEY_PREFIX = 'giaokhoa:messaging:presence:';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Messaging — ảnh chụp presence lúc nối socket (PR #610)', () => {
  let app: INestApplication;
  let base: string;
  let redis: Redis;
  let a: Person;
  let b: Person;
  let c: Person;
  let d: Person;
  let e: Person;

  async function person(firstName: string, lastName: string): Promise<Person> {
    const admin = await adminToken(app);
    const u = await createUserViaApi(app, admin, { firstName, lastName });
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, username: u.username, token: session.accessToken };
  }

  function connectSocket(token: string): { socket: Socket; snapshots: { onlineUserIds: string[] }[]; connected: Promise<Socket> } {
    const snapshots: { onlineUserIds: string[] }[] = [];
    const socket: Socket = io(`${base}/messaging`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    socket.on('presence.snapshot', (payload: { onlineUserIds: string[] }) => {
      snapshots.push(payload);
    });
    const connected = new Promise<Socket>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
      socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
      socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });
    return { socket, snapshots, connected };
  }

  async function waitForPresenceKey(userId: string): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const keys = await redis.keys(`${PRESENCE_KEY_PREFIX}*:${userId}`);
      if (keys.length > 0) return;
      if (Date.now() > deadline) throw new Error(`presence key did not appear for ${userId}`);
      await sleep(100);
    }
  }

  async function waitForSnapshot(snapshots: { onlineUserIds: string[] }[]): Promise<{ onlineUserIds: string[] }> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const first = snapshots[0];
      if (first) return first;
      if (Date.now() > deadline) throw new Error('presence.snapshot was not received');
      await sleep(50);
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    a = await person('An', 'Viewer');
    b = await person('Binh', 'EarlyOnline');
    c = await person('Chi', 'Stranger');
    d = await person('Dung', 'BlockedPeer');
    e = await person('Em', 'OfflineMember');

    const admin = await adminToken(app);
    const group = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${admin}`).send({ type: 2, memberIds: [a.id, b.id, e.id], name: 'Nhóm ảnh chụp presence' });
    expect(group.status).toBe(201);

    const req = await http(app).post(`/api/v1/messages/contacts/${d.id}`)
      .set('Authorization', `Bearer ${a.token}`).send({});
    expect(req.status).toBe(201);
    const acc = await http(app).post(`/api/v1/messages/contacts/requests/${a.id}/accept`)
      .set('Authorization', `Bearer ${d.token}`).send({});
    expect(acc.status).toBe(201);
    const dm = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${a.token}`).send({ memberIds: [d.id], type: 1 });
    expect(dm.status).toBe(201);
    const block = await http(app).post(`/api/v1/messages/contacts/${d.id}/block`)
      .set('Authorization', `Bearer ${a.token}`).send({});
    expect(block.status).toBe(201);
  });

  afterAll(async () => {
    redis.disconnect();
    await app.close();
  });

  it('người xem nối sau vẫn học được người đã trực tuyến từ trước qua ảnh chụp lúc nối, đúng phạm vi quan hệ hội thoại chung', async () => {
    const bConn = connectSocket(b.token);
    const cConn = connectSocket(c.token);
    const dConn = connectSocket(d.token);
    try {
      await Promise.all([bConn.connected, cConn.connected, dConn.connected]);
      await waitForPresenceKey(b.id);
      await waitForPresenceKey(c.id);
      await waitForPresenceKey(d.id);

      const cSnapshot = await waitForSnapshot(cConn.snapshots);
      expect(cSnapshot.onlineUserIds).not.toContain(b.id);

      const aConn = connectSocket(a.token);
      try {
        await aConn.connected;
        const aSnapshot = await waitForSnapshot(aConn.snapshots);
        expect(aSnapshot.onlineUserIds).toContain(b.id);
        expect(aSnapshot.onlineUserIds).not.toContain(c.id);
        expect(aSnapshot.onlineUserIds).not.toContain(d.id);
        expect(aSnapshot.onlineUserIds).not.toContain(e.id);
        expect(aSnapshot.onlineUserIds).not.toContain(a.id);
      } finally {
        aConn.socket.disconnect();
      }
    } finally {
      bConn.socket.disconnect();
      cConn.socket.disconnect();
      dConn.socket.disconnect();
    }
  });
});
