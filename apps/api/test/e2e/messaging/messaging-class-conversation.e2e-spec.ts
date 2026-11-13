import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory } from '../../support/course-enrolment-helpers';
import { contextIdByLevelInstance } from '../../support/engagement-helpers';


interface Person { id: string; username: string; token: string }

interface ClassConversationBody {
  id: string; type: number; component: string | null; itemType: string | null;
  itemId: string | null; enabled: boolean; createdBy: string | null; members: string[];
}

describe('Messaging — chat cấp lớp (MSG-T2, issue #184)', () => {
  let app: INestApplication;
  let pg: Client;
  let admin: string;
  let classA: string;
  let teacher: Person;
  let coTeacher: Person;
  let s1: Person;
  let s2: Person;
  let sLate: Person;
  let outsider: Person;
  let convA: string;

  async function person(): Promise<Person> {
    const u = await createUserViaApi(app, admin);
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, username: u.username, token: session.accessToken };
  }

  async function ensure(token: string, classId: string) {
    return http(app).get(`/api/v1/messages/classes/${classId}/conversation`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function roster(token: string, classId: string) {
    return http(app).get(`/api/v1/messages/classes/${classId}/members`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function send(token: string, conversationId: string, text: string) {
    return http(app).post(`/api/v1/messages/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token}`).send({ text });
  }

  async function view(token: string, conversationId: string) {
    return http(app).get(`/api/v1/messages/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function addToRoster(classId: string, userId: string) {
    const res = await http(app).post(`/api/v1/classes/${classId}/roster`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ userId });
    expect(res.status).toBe(201);
  }

  beforeAll(async () => {
    app = await createTestApp();
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    admin = await adminToken(app);

    teacher = await person();
    coTeacher = await person();
    s1 = await person();
    s2 = await person();
    sLate = await person();
    outsider = await person();

    const current = await http(app).get('/api/v1/tenants/current').set('Authorization', `Bearer ${admin}`);
    const tenantId = (current.body as { id: string }).id;
    for (const p of [teacher, coTeacher, s1, s2, sLate, outsider]) {
      await http(app).post(`/api/v1/tenants/${tenantId}/members`)
        .set('Authorization', `Bearer ${admin}`).send({ userId: p.id });
    }

    const created = await http(app).post('/api/v1/classes')
      .set('Authorization', `Bearer ${admin}`).send({ name: 'Lớp chat MSG-T2', ownerId: teacher.id });
    expect(created.status).toBe(201);
    classA = (created.body as { id: string }).id;
    const classCtx = await contextIdByLevelInstance(app, admin, 45, classA);
    const editingTeacher = await roleIdByShortname(app, admin, 'editingteacher');
    await assignRole(app, admin, coTeacher.id, editingTeacher, classCtx);
    await addToRoster(classA, s1.id);
    await addToRoster(classA, s2.id);
  });
  afterAll(async () => { await pg.end(); await app.close(); });

  it('1. ensure cấp phát lười idempotent: HS mở lần đầu tạo đúng một conversation cấp lớp, GV mở lại nhận cùng một conversation', async () => {
    const first = await ensure(s1.token, classA);
    expect(first.status).toBe(200);
    const body = first.body as ClassConversationBody;
    expect(body.type).toBe(2);
    expect(body.component).toBe('core_class');
    expect(body.itemType).toBe('class');
    expect(body.itemId).toBe(classA);
    expect(body.enabled).toBe(true);
    expect(body.createdBy).toBe(s1.id);
    for (const p of [teacher, coTeacher, s1, s2]) expect(body.members).toContain(p.id);
    expect(body.members).not.toContain(outsider.id);
    expect(body.members).not.toContain(sLate.id);
    convA = body.id;

    const again = await ensure(teacher.token, classA);
    expect(again.status).toBe(200);
    expect((again.body as ClassConversationBody).id).toBe(convA);
    const byCoTeacher = await ensure(coTeacher.token, classA);
    expect((byCoTeacher.body as ClassConversationBody).id).toBe(convA);
  });

  it('2. mặc định hai chiều: HS và GV đều gửi được; quyền quản lý ở GV lớp (gồm đồng GV), không ở HS tạo bản ghi', async () => {
    const fromStudent = await send(s1.token, convA, 'em chào thầy cô, đây là chat lớp');
    expect(fromStudent.status).toBe(201);
    const fromTeacher = await send(teacher.token, convA, 'chào cả lớp');
    expect(fromTeacher.status).toBe(201);

    const seenByS2 = await view(s2.token, convA);
    expect(seenByS2.status).toBe(200);
    const texts = (seenByS2.body.messages as { fullMessage: string }[]).map((m) => m.fullMessage);
    expect(texts).toContain('em chào thầy cô, đây là chat lớp');
    expect(texts).toContain('chào cả lớp');
    expect(seenByS2.body.canManage).toBe(false);
    expect(seenByS2.body.canModerate).toBe(false);

    const seenByTeacher = await view(teacher.token, convA);
    expect(seenByTeacher.body.canManage).toBe(true);
    expect(seenByTeacher.body.canModerate).toBe(true);
    const seenByCoTeacher = await view(coTeacher.token, convA);
    expect(seenByCoTeacher.body.canManage).toBe(true);
    expect(seenByCoTeacher.body.canModerate).toBe(true);

    const studentToggle = await http(app).patch(`/api/v1/messages/conversations/${convA}`)
      .set('Authorization', `Bearer ${s1.token}`).send({ enabled: false });
    expect(studentToggle.status).toBe(403);
    expect(studentToggle.body.code).toBe('messaging.conversation_manage_forbidden');
  });

  it('3. GV lớp tắt chat: HS bị chặn gửi nhưng vẫn đọc được, GV vẫn gửi được; bật lại thì HS gửi lại được', async () => {
    const off = await http(app).patch(`/api/v1/messages/conversations/${convA}`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);

    const blockedSend = await send(s1.token, convA, 'em gửi khi chat lớp đã tắt');
    expect(blockedSend.status).toBe(403);
    expect(blockedSend.body.code).toBe('messaging.conversation_disabled');

    const teacherSend = await send(teacher.token, convA, 'thông báo một chiều của GV');
    expect(teacherSend.status).toBe(201);

    const stillReadable = await view(s2.token, convA);
    expect(stillReadable.status).toBe(200);
    expect(stillReadable.body.enabled).toBe(false);

    const on = await http(app).patch(`/api/v1/messages/conversations/${convA}`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ enabled: true });
    expect(on.status).toBe(200);
    const resumed = await send(s2.token, convA, 'chat lớp bật lại rồi');
    expect(resumed.status).toBe(201);
  });

  it('4. người ngoài lớp: 404 ở mọi đường, không phân biệt được lớp có tồn tại hay không', async () => {
    const ensureOut = await ensure(outsider.token, classA);
    expect(ensureOut.status).toBe(404);
    expect(ensureOut.body.code).toBe('messaging.class_not_found');

    const ensureMissing = await ensure(outsider.token, '00000000-0000-0000-0000-000000000000');
    expect(ensureMissing.status).toBe(404);
    expect(ensureMissing.body.code).toBe('messaging.class_not_found');

    const rosterOut = await roster(outsider.token, classA);
    expect(rosterOut.status).toBe(404);
    expect(rosterOut.body.code).toBe('messaging.class_not_found');

    const detail = await view(outsider.token, convA);
    expect(detail.status).toBe(404);
    expect(detail.body.code).toBe('messaging.conversation_not_found');

    const sendOut = await send(outsider.token, convA, 'người lạ gửi vào chat lớp');
    expect(sendOut.status).toBe(404);

    const readOut = await http(app).post(`/api/v1/messages/conversations/${convA}/read`)
      .set('Authorization', `Bearer ${outsider.token}`).send({});
    expect(readOut.status).toBe(404);
  });

  it('5. vòng đời roster: vào lớp muộn thì lười thành thành viên chat lớp; rời lớp thì mất quyền ở lần đọc/gửi kế', async () => {
    const before = await ensure(sLate.token, classA);
    expect(before.status).toBe(404);

    await addToRoster(classA, sLate.id);
    const joined = await view(sLate.token, convA);
    expect(joined.status).toBe(200);
    expect(joined.body.members).toContain(sLate.id);
    const canSend = await send(sLate.token, convA, 'em mới vào lớp');
    expect(canSend.status).toBe(201);

    const removed = await http(app).delete(`/api/v1/classes/${classA}/roster/${sLate.id}`)
      .set('Authorization', `Bearer ${teacher.token}`);
    expect(removed.status).toBe(200);

    const lostView = await view(sLate.token, convA);
    expect(lostView.status).toBe(404);
    const lostSend = await send(sLate.token, convA, 'em đã rời lớp');
    expect(lostSend.status).toBe(404);
    const lostEnsure = await ensure(sLate.token, classA);
    expect(lostEnsure.status).toBe(404);
    const list = await http(app).get('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${sLate.token}`);
    expect((list.body as { id: string }[]).map((c) => c.id)).not.toContain(convA);
  });

  it('6. roster lớp phía messages + cổng nhắn riêng GV–HS theo quan hệ lớp', async () => {
    const asTeacher = await roster(teacher.token, classA);
    expect(asTeacher.status).toBe(200);
    const members = (asTeacher.body as { members: { userId: string; role: string; canDirectMessage: boolean }[] }).members;
    const s2Row = members.find((m) => m.userId === s2.id);
    expect(s2Row).toBeDefined();
    expect(s2Row!.role).toBe('student');
    expect(s2Row!.canDirectMessage).toBe(true);
    const coRow = members.find((m) => m.userId === coTeacher.id);
    expect(coRow).toBeDefined();
    expect(coRow!.role).toBe('teacher');

    const asStudent = await roster(s1.token, classA);
    expect(asStudent.status).toBe(200);
    const teacherRow = (asStudent.body as { members: { userId: string; role: string; canDirectMessage: boolean }[] }).members
      .find((m) => m.userId === teacher.id);
    expect(teacherRow).toBeDefined();
    expect(teacherRow!.role).toBe('teacher');
    expect(teacherRow!.canDirectMessage).toBe(false);

    const direct = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${teacher.token}`).send({ type: 1, memberIds: [s2.id] });
    expect(direct.status).toBe(201);
    const directId = (direct.body as { id: string }).id;
    const dmSend = await send(teacher.token, directId, 'thầy nhắn riêng qua quan hệ lớp');
    expect(dmSend.status).toBe(201);
    const reply = await send(s2.token, directId, 'em trả lời thầy');
    expect(reply.status).toBe(201);

    const peer = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${s1.token}`).send({ type: 1, memberIds: [s2.id] });
    expect(peer.status).toBe(403);
    expect(peer.body.code).toBe('messaging.not_a_contact');
  });

  it('7. cây nhóm + danh sách: nút lớp nhận đúng conversation cấp lớp; chat lớp khác hẳn nhóm con "Cả lớp" của khoá trong lớp', async () => {
    const tree = await http(app).get('/api/v1/messages/group-tree')
      .set('Authorization', `Bearer ${teacher.token}`);
    expect(tree.status).toBe(200);
    const classNode = (tree.body as { classes: { classId: string; conversationId: string | null }[] }).classes
      .find((c) => c.classId === classA);
    expect(classNode).toBeDefined();
    expect(classNode!.conversationId).toBe(convA);

    const list = await http(app).get('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${s1.token}`);
    const entry = (list.body as { id: string; itemType: string | null }[]).find((c) => c.id === convA);
    expect(entry).toBeDefined();
    expect(entry!.itemType).toBe('class');

    const category = await createCategory(app, admin);
    const courseRes = await http(app).post('/api/v1/courses')
      .set('Authorization', `Bearer ${teacher.token}`)
      .send({ fullName: 'Khoá trong lớp chat', shortName: `msg-t2-${Date.now()}`, category: category.id, classId: classA });
    expect(courseRes.status).toBe(201);
    const courseId = (courseRes.body as { id: string }).id;
    const groups = await pg.query<{ id: string }>(
      `select id from course_groups where course_id = $1 and name = 'Cả lớp'`, [courseId],
    );
    expect(groups.rows[0]).toBeDefined();
    const groupConv = await http(app).post('/api/v1/messages/conversations/group')
      .set('Authorization', `Bearer ${teacher.token}`).send({ groupId: groups.rows[0]!.id });
    expect(groupConv.status).toBe(201);
    expect((groupConv.body as { id: string }).id).not.toBe(convA);
    expect((groupConv.body as { itemType: string | null }).itemType).toBe('groups');
  });

  it('8. đua ensure song song trên lớp MỚI: 6 lượt mở đồng thời chỉ tạo đúng một conversation cấp lớp (khẳng định ở DB)', async () => {
    const created = await http(app).post('/api/v1/classes')
      .set('Authorization', `Bearer ${admin}`).send({ name: 'Lớp đua ensure MSG-T2', ownerId: teacher.id });
    expect(created.status).toBe(201);
    const classB = (created.body as { id: string }).id;
    for (const p of [s1, s2, coTeacher]) {
      const res = await http(app).post(`/api/v1/classes/${classB}/roster`)
        .set('Authorization', `Bearer ${teacher.token}`).send({ userId: p.id });
      expect(res.status).toBe(201);
    }
    const classBCtx = await contextIdByLevelInstance(app, admin, 45, classB);
    const editingTeacher = await roleIdByShortname(app, admin, 'editingteacher');
    await assignRole(app, admin, coTeacher.id, editingTeacher, classBCtx);

    const racers = [s1, s2, coTeacher, teacher, s1, s2];
    const results = await Promise.all(racers.map((p) => ensure(p.token, classB)));
    for (const r of results) expect(r.status).toBe(200);
    const ids = new Set(results.map((r) => (r.body as ClassConversationBody).id));
    expect(ids.size).toBe(1);
    for (const r of results) {
      for (const p of [teacher, coTeacher, s1, s2]) {
        expect((r.body as ClassConversationBody).members).toContain(p.id);
      }
    }

    const counted = await pg.query<{ n: number }>(
      `select count(*)::int as n from message_conversations
       where component = 'core_class' and item_type = 'class' and item_id = $1`,
      [classB],
    );
    expect(counted.rows[0]!.n).toBe(1);
  });
});
