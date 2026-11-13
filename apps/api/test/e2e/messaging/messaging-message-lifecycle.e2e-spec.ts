import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';
import { addGroupMember, contextIdByLevelInstance, createGroupViaApi } from '../../support/engagement-helpers';


interface Person { id: string; username: string; token: string }

interface MessageBody {
  id: string; fullMessage: string; userIdFrom: string; seq: number;
  deletedAt: string | null; recalledAt: string | null; recalledBy: string | null;
}

interface ModeratorActionRow {
  action: string; actor_id: string; author_id: string; reason: string | null; message_seq: number | null;
}

describe('Messaging — vòng đời tin nhắn theo vai (issue #33, bổ sung PR #94)', () => {
  let app: INestApplication;
  let pg: Client;
  let admin: string;
  let teacher: Person;
  let otherTeacher: Person;
  let s1: Person;
  let s2: Person;
  let groupConvId: string;

  async function person(): Promise<Person> {
    const u = await createUserViaApi(app, admin);
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, username: u.username, token: session.accessToken };
  }

  async function send(token: string, conversationId: string, text: string) {
    return http(app).post(`/api/v1/messages/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token}`).send({ text });
  }

  async function viewMessages(token: string, conversationId: string) {
    const res = await http(app).get(`/api/v1/messages/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as { messages: MessageBody[]; canModerate: boolean };
  }

  async function listEntry(token: string, conversationId: string) {
    const res = await http(app).get('/api/v1/messages/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const entry = (res.body as { id: string; unread: number; lastMessage: MessageBody | null }[])
      .find((c) => c.id === conversationId);
    expect(entry).toBeDefined();
    return entry!;
  }

  async function actionsFor(messageId: string): Promise<ModeratorActionRow[]> {
    const res = await pg.query<ModeratorActionRow>(
      'select action, actor_id, author_id, reason, message_seq from message_moderator_actions where message_id = $1 order by created_at asc',
      [messageId],
    );
    return res.rows;
  }

  beforeAll(async () => {
    app = await createTestApp();
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    admin = await adminToken(app);

    const category = await createCategory(app, admin);
    const course = await createCourse(app, admin, category.id);
    const instance = await createEnrolInstance(app, admin, course.id);
    teacher = await person();
    s1 = await person();
    s2 = await person();
    for (const p of [teacher, s1, s2]) await enrolUser(app, admin, course.id, instance.id, p.id);
    const courseCtx = await contextIdByLevelInstance(app, admin, 50, course.id);
    const editingTeacher = await roleIdByShortname(app, admin, 'editingteacher');
    await pg.query(
      `insert into role_assignments (role_id, user_id, context_id, component) values ($1, $2, $3, '')`,
      [editingTeacher, teacher.id, courseCtx],
    );

    const category2 = await createCategory(app, admin);
    const course2 = await createCourse(app, admin, category2.id);
    otherTeacher = await person();
    const course2Ctx = await contextIdByLevelInstance(app, admin, 50, course2.id);
    await assignRole(app, admin, otherTeacher.id, editingTeacher, course2Ctx);

    const group = await createGroupViaApi(app, admin, course.id, 'Lớp vòng đời');
    for (const p of [teacher, s1, s2]) await addGroupMember(app, admin, course.id, group.id, p.id);
    const created = await http(app).post('/api/v1/messages/conversations/group')
      .set('Authorization', `Bearer ${s1.token}`).send({ groupId: group.id });
    expect(created.status).toBe(201);
    groupConvId = created.body.id as string;
  }, 180000);

  afterAll(async () => {
    await pg.end();
    await app.close();
  });

  it('1. thu hồi TRONG cửa sổ: nội dung bị vô hiệu với phía kia, truy vết còn nguyên, moderator_action recall được ghi', async () => {
    const marked = await http(app).post(`/api/v1/messages/conversations/${groupConvId}/read`)
      .set('Authorization', `Bearer ${s2.token}`).send({});
    expect(marked.status).toBe(201);
    const sent = await send(s1.token, groupConvId, 'tin sẽ thu hồi trong cửa sổ');
    expect(sent.status).toBe(201);
    const msgId = sent.body.id as string;
    expect((await listEntry(s2.token, groupConvId)).unread).toBe(1);

    const foreign = await http(app).post(`/api/v1/messages/${msgId}/recall`)
      .set('Authorization', `Bearer ${s2.token}`).send({});
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('messaging.message_recall_forbidden');

    const recalled = await http(app).post(`/api/v1/messages/${msgId}/recall`)
      .set('Authorization', `Bearer ${s1.token}`).send({});
    expect(recalled.status).toBe(201);
    expect(recalled.body.recalledAt).toBeTruthy();
    expect(recalled.body.recalledBy).toBe(s1.id);
    expect(recalled.body.fullMessage).toBe('tin sẽ thu hồi trong cửa sổ');

    const s2View = await viewMessages(s2.token, groupConvId);
    const forS2 = s2View.messages.find((m) => m.id === msgId);
    expect(forS2).toBeDefined();
    expect(forS2!.fullMessage).toBe('');
    expect(forS2!.recalledAt).toBeTruthy();
    expect(forS2!.recalledBy).toBe(s1.id);
    const s2Entry = await listEntry(s2.token, groupConvId);
    expect(s2Entry.unread).toBe(0);
    expect(s2Entry.lastMessage?.id).toBe(msgId);
    expect(s2Entry.lastMessage?.fullMessage).toBe('');

    const teacherView = await viewMessages(teacher.token, groupConvId);
    expect(teacherView.canModerate).toBe(true);
    const traced = teacherView.messages.find((m) => m.id === msgId);
    expect(traced?.fullMessage).toBe('tin sẽ thu hồi trong cửa sổ');
    expect(traced?.recalledBy).toBe(s1.id);

    const actions = await actionsFor(msgId);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe('recall');
    expect(actions[0]!.actor_id).toBe(s1.id);
    expect(actions[0]!.author_id).toBe(s1.id);
    expect(actions[0]!.reason).toBeNull();

    const again = await http(app).post(`/api/v1/messages/${msgId}/recall`)
      .set('Authorization', `Bearer ${s1.token}`).send({});
    expect(again.status).toBe(201);
    expect(again.body.recalledAt).toBe(recalled.body.recalledAt);
    expect(await actionsFor(msgId)).toHaveLength(1);
  });

  it('2. thu hồi NGOÀI cửa sổ bị từ chối — người thường chỉ còn xoá-phía-mình', async () => {
    const sent = await send(s1.token, groupConvId, 'tin cũ ngoài cửa sổ thu hồi');
    expect(sent.status).toBe(201);
    const msgId = sent.body.id as string;
    await pg.query("update message set created_at = now() - interval '16 minutes' where id = $1", [msgId]);

    const recall = await http(app).post(`/api/v1/messages/${msgId}/recall`)
      .set('Authorization', `Bearer ${s1.token}`).send({});
    expect(recall.status).toBe(403);
    expect(recall.body.code).toBe('messaging.recall_window_expired');
    expect(await actionsFor(msgId)).toHaveLength(0);

    const del = await http(app).delete(`/api/v1/messages/${msgId}`)
      .set('Authorization', `Bearer ${s1.token}`);
    expect(del.status).toBe(200);
    const s1View = await viewMessages(s1.token, groupConvId);
    expect(s1View.messages.map((m) => m.id)).not.toContain(msgId);
    const s2View = await viewMessages(s2.token, groupConvId);
    const forS2 = s2View.messages.find((m) => m.id === msgId);
    expect(forS2?.fullMessage).toBe('tin cũ ngoài cửa sổ thu hồi');
    expect(forS2?.recalledAt).toBeNull();
  });

  it('3. cửa sổ đặt 0 qua site-config thì thu hồi bị tắt hẳn, kể cả tin vừa gửi', async () => {
    const put = await http(app).put('/api/v1/site-config/core/messagingrecallwindowminutes')
      .set('Authorization', `Bearer ${admin}`).send({ value: 0 });
    expect(put.status).toBe(200);
    try {
      const sent = await send(s1.token, groupConvId, 'tin gửi lúc cửa sổ đang tắt');
      expect(sent.status).toBe(201);
      const recall = await http(app).post(`/api/v1/messages/${sent.body.id}/recall`)
        .set('Authorization', `Bearer ${s1.token}`).send({});
      expect(recall.status).toBe(403);
      expect(recall.body.code).toBe('messaging.recall_window_expired');
    } finally {
      const restore = await http(app).put('/api/v1/site-config/core/messagingrecallwindowminutes')
        .set('Authorization', `Bearer ${admin}`).send({ value: 15 });
      expect(restore.status).toBe(200);
    }
  });

  it('4. xoá cứng: chỉ moderation:manage trong phạm vi, lý do bắt buộc, dòng tin biến mất và dấu vết còn lại', async () => {
    const sent = await send(s1.token, groupConvId, 'tin vi phạm sẽ bị xoá cứng');
    expect(sent.status).toBe(201);
    const msgId = sent.body.id as string;

    const byStudent = await http(app).post(`/api/v1/messages/${msgId}/hard-delete`)
      .set('Authorization', `Bearer ${s1.token}`).send({ reason: 'em tự xoá' });
    expect(byStudent.status).toBe(403);
    expect(byStudent.body.code).toBe('messaging.message_moderation_forbidden');
    const byOther = await http(app).post(`/api/v1/messages/${msgId}/hard-delete`)
      .set('Authorization', `Bearer ${otherTeacher.token}`).send({ reason: 'ngoài phạm vi' });
    expect(byOther.status).toBe(403);
    expect(byOther.body.code).toBe('messaging.message_moderation_forbidden');
    const noReason = await http(app).post(`/api/v1/messages/${msgId}/hard-delete`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ reason: '   ' });
    expect(noReason.status).toBe(400);

    await pg.query("update message set created_at = now() - interval '30 days' where id = $1", [msgId]);
    const hard = await http(app).post(`/api/v1/messages/${msgId}/hard-delete`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ reason: 'Vi phạm nội quy lớp học' });
    expect(hard.status).toBe(201);
    expect(hard.body.deleted).toBe(true);

    const count = await pg.query<{ n: string }>('select count(*) as n from message where id = $1', [msgId]);
    expect(Number(count.rows[0]!.n)).toBe(0);
    const teacherView = await viewMessages(teacher.token, groupConvId);
    expect(teacherView.messages.map((m) => m.id)).not.toContain(msgId);
    const actions = await actionsFor(msgId);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe('hard_delete');
    expect(actions[0]!.actor_id).toBe(teacher.id);
    expect(actions[0]!.author_id).toBe(s1.id);
    expect(actions[0]!.reason).toBe('Vi phạm nội quy lớp học');
    expect(actions[0]!.message_seq).toBe(sent.body.seq);
  });

  it('5. gỡ hàng loạt: kiểm tra toàn bộ trước — một tin lạ là cả yêu cầu bị từ chối, không gỡ một phần', async () => {
    const b1 = await send(s1.token, groupConvId, 'tin gỡ loạt 1');
    const b2 = await send(s2.token, groupConvId, 'tin gỡ loạt 2');
    expect(b1.status).toBe(201);
    expect(b2.status).toBe(201);
    const ids = [b1.body.id as string, b2.body.id as string];

    const byStudent = await http(app).post('/api/v1/messages/bulk-remove')
      .set('Authorization', `Bearer ${s1.token}`).send({ messageIds: ids, reason: 'tự gỡ' });
    expect(byStudent.status).toBe(403);
    const mixed = await http(app).post('/api/v1/messages/bulk-remove')
      .set('Authorization', `Bearer ${teacher.token}`)
      .send({ messageIds: [...ids, '123e4567-e89b-72d3-a456-426614174000'], reason: 'dọn loạt' });
    expect(mixed.status).toBe(404);
    const stillThere = await pg.query<{ n: string }>('select count(*) as n from message where id = any($1)', [ids]);
    expect(Number(stillThere.rows[0]!.n)).toBe(2);

    const bulk = await http(app).post('/api/v1/messages/bulk-remove')
      .set('Authorization', `Bearer ${teacher.token}`).send({ messageIds: ids, reason: 'Dọn nội dung vi phạm hàng loạt' });
    expect(bulk.status).toBe(201);
    expect(bulk.body.removed).toBe(2);
    const gone = await pg.query<{ n: string }>('select count(*) as n from message where id = any($1)', [ids]);
    expect(Number(gone.rows[0]!.n)).toBe(0);
    for (const id of ids) {
      const actions = await actionsFor(id);
      expect(actions).toHaveLength(1);
      expect(actions[0]!.action).toBe('bulk_hard_delete');
      expect(actions[0]!.reason).toBe('Dọn nội dung vi phạm hàng loạt');
    }
    const s1View = await viewMessages(s1.token, groupConvId);
    expect(s1View.messages.map((m) => m.id)).not.toContain(ids[0]);
    expect(s1View.messages.map((m) => m.id)).not.toContain(ids[1]);
  });

  it('7. cổng chặn 1–1: đang chặn thì thu hồi và xoá-phía-mình đều 404 như hội thoại không tồn tại', async () => {
    const req = await http(app).post(`/api/v1/messages/contacts/${s2.id}`).set('Authorization', `Bearer ${s1.token}`).send({});
    expect(req.status).toBe(201);
    const acc = await http(app).post(`/api/v1/messages/contacts/requests/${s1.id}/accept`).set('Authorization', `Bearer ${s2.token}`).send({});
    expect(acc.status).toBe(201);
    const conv = await http(app).post('/api/v1/messages/conversations').set('Authorization', `Bearer ${s1.token}`)
      .send({ type: 1, memberIds: [s2.id] });
    expect(conv.status).toBe(201);
    const convId = conv.body.id as string;
    const sent = await send(s1.token, convId, 'tin riêng trước khi bị chặn');
    expect(sent.status).toBe(201);
    const msgId = sent.body.id as string;

    const block = await http(app).post(`/api/v1/messages/contacts/${s1.id}/block`).set('Authorization', `Bearer ${s2.token}`).send({});
    expect(block.status).toBe(201);
    const recallBlocked = await http(app).post(`/api/v1/messages/${msgId}/recall`)
      .set('Authorization', `Bearer ${s1.token}`).send({});
    expect(recallBlocked.status).toBe(404);
    expect(recallBlocked.body.code).toBe('messaging.conversation_not_found');
    const deleteBlocked = await http(app).delete(`/api/v1/messages/${msgId}`)
      .set('Authorization', `Bearer ${s1.token}`);
    expect(deleteBlocked.status).toBe(404);
    expect(deleteBlocked.body.code).toBe('messaging.conversation_not_found');
    expect(await actionsFor(msgId)).toHaveLength(0);

    const unblock = await http(app).delete(`/api/v1/messages/contacts/${s1.id}/block`).set('Authorization', `Bearer ${s2.token}`);
    expect(unblock.status).toBe(200);
    const recall = await http(app).post(`/api/v1/messages/${msgId}/recall`)
      .set('Authorization', `Bearer ${s1.token}`).send({});
    expect(recall.status).toBe(201);
    expect(recall.body.recalledBy).toBe(s1.id);
  });
}, 60000);
