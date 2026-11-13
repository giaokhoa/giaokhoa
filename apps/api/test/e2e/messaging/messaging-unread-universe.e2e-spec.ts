import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, createTestApp, createUserViaApi, http, login, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';

interface Person { id: string; username: string; token: string }
interface SummaryRow { id: string; unread: number; type: number; muted?: boolean }

describe('Messaging — vũ trụ đếm chưa đọc chuẩn duy nhất (issue #592)', () => {
  let app: INestApplication;
  let viewer: Person;
  let normalDmId: string;
  let mutedGroupId: string;

  async function person(firstName: string, lastName: string): Promise<Person> {
    const admin = await adminToken(app);
    const u = await createUserViaApi(app, admin, { firstName, lastName });
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, username: u.username, token: session.accessToken };
  }

  async function unreadBadge(token: string): Promise<number> {
    const res = await http(app).get('/api/v1/messages/unread-count')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { conversations: number }).conversations;
  }

  async function listRows(token: string): Promise<SummaryRow[]> {
    const res = await http(app).get('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as SummaryRow[];
  }

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await adminToken(app);
    viewer = await person('Bao', 'XemChuaDoc');
    const sender = await person('An', 'GuiTin');
    const blockedPeer = await person('Cuong', 'BiChan');

    const req = await http(app).post(`/api/v1/messages/contacts/${viewer.id}`)
      .set('Authorization', `Bearer ${sender.token}`).send({});
    expect(req.status).toBe(201);
    const acc = await http(app).post(`/api/v1/messages/contacts/requests/${sender.id}/accept`)
      .set('Authorization', `Bearer ${viewer.token}`).send({});
    expect(acc.status).toBe(201);
    const dm = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${sender.token}`).send({ memberIds: [viewer.id], type: 1 });
    expect(dm.status).toBe(201);
    normalDmId = (dm.body as { id: string }).id;
    expect((await http(app).post(`/api/v1/messages/conversations/${normalDmId}/messages`)
      .set('Authorization', `Bearer ${sender.token}`).send({ text: 'tin chưa đọc ở hội thoại bình thường' })).status).toBe(201);

    const group = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${admin}`).send({ memberIds: [sender.id, viewer.id], type: 2 });
    expect(group.status).toBe(201);
    mutedGroupId = (group.body as { id: string }).id;
    expect((await http(app).post(`/api/v1/messages/conversations/${mutedGroupId}/messages`)
      .set('Authorization', `Bearer ${sender.token}`).send({ text: 'tin chưa đọc ở nhóm đã tắt' })).status).toBe(201);
    const mute = await http(app).patch(`/api/v1/messages/conversations/${mutedGroupId}/state`)
      .set('Authorization', `Bearer ${viewer.token}`).send({ muted: true });
    expect(mute.status).toBe(200);

    const req2 = await http(app).post(`/api/v1/messages/contacts/${viewer.id}`)
      .set('Authorization', `Bearer ${blockedPeer.token}`).send({});
    expect(req2.status).toBe(201);
    const acc2 = await http(app).post(`/api/v1/messages/contacts/requests/${blockedPeer.id}/accept`)
      .set('Authorization', `Bearer ${viewer.token}`).send({});
    expect(acc2.status).toBe(201);
    const dm2 = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${blockedPeer.token}`).send({ memberIds: [viewer.id], type: 1 });
    expect(dm2.status).toBe(201);
    expect((await http(app).post(`/api/v1/messages/conversations/${(dm2.body as { id: string }).id}/messages`)
      .set('Authorization', `Bearer ${blockedPeer.token}`).send({ text: 'tin chưa đọc ở hội thoại đang chặn' })).status).toBe(201);
    const block = await http(app).post(`/api/v1/messages/contacts/${blockedPeer.id}/block`)
      .set('Authorization', `Bearer ${viewer.token}`).send({});
    expect(block.status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('badge sidebar, danh sách và cây nhóm cùng đếm đúng vũ trụ chuẩn: chỉ hội thoại bình thường', async () => {
    expect(await unreadBadge(viewer.token)).toBe(1);

    const rows = await listRows(viewer.token);
    const withUnread = rows.filter((row) => row.unread > 0);
    expect(withUnread.map((row) => row.id)).toEqual([normalDmId]);
    const mutedRow = rows.find((row) => row.id === mutedGroupId);
    expect(mutedRow).toBeDefined();
    expect(mutedRow!.unread).toBe(0);

    const tree = await http(app).get('/api/v1/messages/group-tree')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(tree.status).toBe(200);
    const freeGroups = (tree.body as { freeGroups?: { conversationId: string; unread: number }[] }).freeGroups ?? [];
    const mutedTreeItem = freeGroups.find((item) => item.conversationId === mutedGroupId);
    expect(mutedTreeItem).toBeDefined();
    expect(mutedTreeItem!.unread).toBe(0);
  });

  it('sau khi đọc hội thoại bình thường, badge và danh sách cùng về 0 trong cùng một chu kỳ đọc', async () => {
    const read = await http(app).post(`/api/v1/messages/conversations/${normalDmId}/read`)
      .set('Authorization', `Bearer ${viewer.token}`).send({});
    expect(read.status).toBe(201);

    expect(await unreadBadge(viewer.token)).toBe(0);
    const rows = await listRows(viewer.token);
    expect(rows.filter((row) => row.unread > 0)).toEqual([]);
  });
});
