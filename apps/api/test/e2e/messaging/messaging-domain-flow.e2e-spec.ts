import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorkerRelayDriver, flushWorkerRelay } from '../../support/worker-relay-driver';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';
import { addGroupMember, contextIdByLevelInstance, createGroupViaApi } from '../../support/engagement-helpers';


interface Person { id: string; username: string; token: string }

interface MessageBody {
  id: string; fullMessage: string; userIdFrom: string; seq: number;
  deletedAt: string | null; deletedBy: string | null;
  recalledAt: string | null; recalledBy: string | null;
}

async function insertAssignmentRow(roleId: string, userId: string, contextId: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `insert into role_assignments (role_id, user_id, context_id, component) values ($1, $2, $3, '')`,
      [roleId, userId, contextId],
    );
  } finally {
    await client.end();
  }
}

describe('Messaging Lớp B — chính sách nghiệp vụ (issue #33)', () => {
  let app: INestApplication;
  let admin: string;
  let adminId: string;
  let teacher: Person;
  let otherTeacher: Person;
  let owner: Person;
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
    return res.body as { messages: MessageBody[]; canModerate: boolean; canManage: boolean; enabled: boolean };
  }

  beforeAll(async () => {
    const stale = new Client({ connectionString: process.env.DATABASE_URL });
    await stale.connect();
    await stale.query('DELETE FROM outbox_events WHERE published_at IS NULL');
    await stale.end();
    app = await createTestApp();
    admin = await adminToken(app);
    adminId = (await login(app, 'admin', 'Admin123!')).userId;

    const category = await createCategory(app, admin);
    const course = await createCourse(app, admin, category.id);
    const instance = await createEnrolInstance(app, admin, course.id);
    teacher = await person();
    s1 = await person();
    s2 = await person();
    for (const p of [teacher, s1, s2]) await enrolUser(app, admin, course.id, instance.id, p.id);
    const courseCtx = await contextIdByLevelInstance(app, admin, 50, course.id);
    const editingTeacher = await roleIdByShortname(app, admin, 'editingteacher');
    await insertAssignmentRow(editingTeacher, teacher.id, courseCtx);

    const category2 = await createCategory(app, admin);
    const course2 = await createCourse(app, admin, category2.id);
    otherTeacher = await person();
    const course2Ctx = await contextIdByLevelInstance(app, admin, 50, course2.id);
    await assignRole(app, admin, otherTeacher.id, editingTeacher, course2Ctx);

    owner = await person();
    const currentTenant = await http(app).get('/api/v1/tenants/current').set('Authorization', `Bearer ${admin}`);
    const tenantId = (currentTenant.body as { id: string }).id;
    const addMember = await http(app).post(`/api/v1/tenants/${tenantId}/members`)
      .set('Authorization', `Bearer ${admin}`).send({ userId: owner.id });
    if (addMember.status !== 201) throw new Error(`add tenant member failed: ${addMember.status} ${JSON.stringify(addMember.body)}`);
    const tenantCtx = await contextIdByLevelInstance(app, admin, 20, tenantId);
    const managerRole = await roleIdByShortname(app, admin, 'manager');
    await assignRole(app, admin, owner.id, managerRole, tenantCtx);

    const group = await createGroupViaApi(app, admin, course.id, 'Lớp B Team');
    for (const p of [teacher, s1, s2]) await addGroupMember(app, admin, course.id, group.id, p.id);
    const created = await http(app).post('/api/v1/messages/conversations/group')
      .set('Authorization', `Bearer ${s1.token}`).send({ groupId: group.id });
    expect(created.status).toBe(201);
    groupConvId = created.body.id as string;
  });
  afterAll(async () => { await closeWorkerRelayDriver(); await app.close(); });

  it('1. yêu cầu liên hệ: từ chối giữ cổng đóng, người bị chặn không thể yêu cầu, và người nhận được thông báo về yêu cầu', async () => {
    const a = await person();
    const b = await person();

    const req = await http(app).post(`/api/v1/messages/contacts/${b.id}`).set('Authorization', `Bearer ${a.token}`).send({});
    expect(req.status).toBe(201);
    expect(req.body.status).toBe('pending');
    const bNotifications = await http(app).get('/api/v1/notifications/items').set('Authorization', `Bearer ${b.token}`);
    expect((bNotifications.body.items as { eventType: string }[]).some((n) => n.eventType === 'contact_request')).toBe(true);

    const declined = await http(app).post(`/api/v1/messages/contacts/requests/${a.id}/decline`).set('Authorization', `Bearer ${b.token}`).send({});
    expect(declined.status).toBe(201);
    expect(declined.body.declined).toBe(true);
    const bQueue = await http(app).get('/api/v1/messages/contacts/requests').set('Authorization', `Bearer ${b.token}`);
    expect(bQueue.body.incoming).toEqual([]);
    const aQueue = await http(app).get('/api/v1/messages/contacts/requests').set('Authorization', `Bearer ${a.token}`);
    expect(aQueue.body.outgoing).toEqual([]);
    const blockedCreate = await http(app).post('/api/v1/messages/conversations').set('Authorization', `Bearer ${a.token}`)
      .send({ type: 1, memberIds: [b.id] });
    expect(blockedCreate.status).toBe(403);
    expect(blockedCreate.body.code).toBe('messaging.not_a_contact');
    const declineAgain = await http(app).post(`/api/v1/messages/contacts/requests/${a.id}/decline`).set('Authorization', `Bearer ${b.token}`).send({});
    expect(declineAgain.status).toBe(404);
    expect(declineAgain.body.code).toBe('messaging.contact_request_not_found');

    await http(app).post(`/api/v1/messages/contacts/${a.id}/block`).set('Authorization', `Bearer ${b.token}`).send({});
    const reqBlocked = await http(app).post(`/api/v1/messages/contacts/${b.id}`).set('Authorization', `Bearer ${a.token}`).send({});
    expect(reqBlocked.status).toBe(403);
    expect(reqBlocked.body.code).toBe('messaging.contact_blocked');
  });

  it('2. tạo nhóm tự do: học viên, người không vai và giáo viên đều bị từ chối ở tầng service; quản trị viên hệ thống và chủ trung tâm tạo được', async () => {
    const extra = await person();
    const byStudent = await http(app).post('/api/v1/messages/conversations').set('Authorization', `Bearer ${s1.token}`)
      .send({ type: 2, memberIds: [s2.id, extra.id], name: 'Nhóm tự lập' });
    expect(byStudent.status).toBe(403);
    expect(byStudent.body.code).toBe('messaging.group_creation_forbidden');
    const byNobody = await http(app).post('/api/v1/messages/conversations').set('Authorization', `Bearer ${extra.token}`)
      .send({ type: 2, memberIds: [s1.id, s2.id], name: 'Nhóm của người lạ' });
    expect(byNobody.status).toBe(403);
    expect(byNobody.body.code).toBe('messaging.group_creation_forbidden');
    const byTeacher = await http(app).post('/api/v1/messages/conversations').set('Authorization', `Bearer ${teacher.token}`)
      .send({ type: 2, memberIds: [s1.id, s2.id], name: 'Nhóm giáo viên tạo' });
    expect(byTeacher.status).toBe(403);
    expect(byTeacher.body.code).toBe('messaging.group_creation_forbidden');
    const byAdmin = await http(app).post('/api/v1/messages/conversations').set('Authorization', `Bearer ${admin}`)
      .send({ type: 2, memberIds: [s1.id, s2.id], name: 'Nhóm quản trị viên tạo' });
    expect(byAdmin.status).toBe(201);
    expect(new Set(byAdmin.body.members as string[])).toEqual(new Set([adminId, s1.id, s2.id]));
    expect(byAdmin.body.createdBy).toBe(adminId);
    const byOwner = await http(app).post('/api/v1/messages/conversations').set('Authorization', `Bearer ${owner.token}`)
      .send({ type: 2, memberIds: [s1.id, s2.id], name: 'Nhóm chủ trung tâm tạo' });
    expect(byOwner.status).toBe(201);
    expect(new Set(byOwner.body.members as string[])).toEqual(new Set([owner.id, s1.id, s2.id]));
    expect(byOwner.body.createdBy).toBe(owner.id);
  });

  it('3. chat nhóm lớp hai chiều mặc định; khi giáo viên tắt, học viên ngừng gửi nhưng giáo viên vẫn gửi được', async () => {
    const warm = await send(s1.token, groupConvId, 'tin mở đầu lớp');
    expect(warm.status).toBe(201);

    const studentToggle = await http(app).patch(`/api/v1/messages/conversations/${groupConvId}`)
      .set('Authorization', `Bearer ${s1.token}`).send({ enabled: false });
    expect(studentToggle.status).toBe(403);
    expect(studentToggle.body.code).toBe('messaging.conversation_manage_forbidden');
    const otherToggle = await http(app).patch(`/api/v1/messages/conversations/${groupConvId}`)
      .set('Authorization', `Bearer ${otherTeacher.token}`).send({ enabled: false });
    expect(otherToggle.status).toBe(403);

    const off = await http(app).patch(`/api/v1/messages/conversations/${groupConvId}`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);

    for (const student of [s1, s2]) {
      const res = await send(student.token, groupConvId, 'em gửi khi đã tắt');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('messaging.conversation_disabled');
    }
    const teacherSends = await send(teacher.token, groupConvId, 'Thông báo của giáo viên khi lớp tắt chat');
    expect(teacherSends.status).toBe(201);

    const on = await http(app).patch(`/api/v1/messages/conversations/${groupConvId}`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.enabled).toBe(true);
    const again = await send(s2.token, groupConvId, 'lớp mở lại rồi');
    expect(again.status).toBe(201);

    const freeGroup = await http(app).post('/api/v1/messages/conversations').set('Authorization', `Bearer ${owner.token}`)
      .send({ type: 2, memberIds: [teacher.id, s1.id], name: 'Nhóm ôn tập' });
    expect(freeGroup.status).toBe(201);
    const freeId = freeGroup.body.id as string;
    const freeOff = await http(app).patch(`/api/v1/messages/conversations/${freeId}`)
      .set('Authorization', `Bearer ${owner.token}`).send({ enabled: false });
    expect(freeOff.status).toBe(200);
    const studentFree = await send(s1.token, freeId, 'em gửi vào nhóm ôn tập');
    expect(studentFree.status).toBe(403);
    expect(studentFree.body.code).toBe('messaging.conversation_disabled');
    const teacherFree = await send(teacher.token, freeId, 'giáo viên gửi vào nhóm ôn tập');
    expect(teacherFree.status).toBe(403);
    expect(teacherFree.body.code).toBe('messaging.conversation_disabled');
    const ownerFree = await send(owner.token, freeId, 'chủ trung tâm gửi vào nhóm ôn tập');
    expect(ownerFree.status).toBe(201);
  });

  it('4. vòng đời theo vai: xoá-phía-mình chỉ ẩn với chính chủ; moderator gỡ cho mọi người bằng xoá cứng có lý do', async () => {
    const m1 = await send(s2.token, groupConvId, 'tin của s2 giữ lại sau');
    expect(m1.status).toBe(201);
    const marked = await http(app).post(`/api/v1/messages/conversations/${groupConvId}/read`)
      .set('Authorization', `Bearer ${s2.token}`).send({});
    expect(marked.status).toBe(201);
    const m2 = await send(s1.token, groupConvId, 'tin s1 sẽ tự xoá phía mình');
    expect(m2.status).toBe(201);
    const m1Id = m1.body.id as string;
    const m2Id = m2.body.id as string;

    const foreign = await http(app).delete(`/api/v1/messages/${m2Id}`).set('Authorization', `Bearer ${s2.token}`);
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('messaging.message_delete_forbidden');
    const outsider = await person();
    const outsiderDelete = await http(app).delete(`/api/v1/messages/${m2Id}`).set('Authorization', `Bearer ${outsider.token}`);
    expect(outsiderDelete.status).toBe(403);

    const listBefore = await http(app).get('/api/v1/messages/conversations').set('Authorization', `Bearer ${s2.token}`);
    const entryBefore = (listBefore.body as { id: string; unread: number }[]).find((c) => c.id === groupConvId);
    expect(entryBefore?.unread).toBe(1);

    const del = await http(app).delete(`/api/v1/messages/${m2Id}`).set('Authorization', `Bearer ${s1.token}`);
    expect(del.status).toBe(200);
    expect(del.body.deletedAt).toBeNull();
    expect(del.body.deletedBy).toBeNull();
    expect(del.body.fullMessage).toBe('tin s1 sẽ tự xoá phía mình');

    const s1View = await viewMessages(s1.token, groupConvId);
    expect(s1View.messages.map((m) => m.id)).not.toContain(m2Id);
    const s1List = await http(app).get('/api/v1/messages/conversations').set('Authorization', `Bearer ${s1.token}`);
    const s1Entry = (s1List.body as { id: string; lastMessage: MessageBody | null }[]).find((c) => c.id === groupConvId);
    expect(s1Entry?.lastMessage?.id).toBe(m1Id);
    const s2View = await viewMessages(s2.token, groupConvId);
    expect(s2View.canModerate).toBe(false);
    const m2ForS2 = s2View.messages.find((m) => m.id === m2Id);
    expect(m2ForS2?.fullMessage).toBe('tin s1 sẽ tự xoá phía mình');
    const listAfter = await http(app).get('/api/v1/messages/conversations').set('Authorization', `Bearer ${s2.token}`);
    const entryAfter = (listAfter.body as { id: string; unread: number; lastMessage: MessageBody | null }[])
      .find((c) => c.id === groupConvId);
    expect(entryAfter?.unread).toBe(1);
    expect(entryAfter?.lastMessage?.id).toBe(m2Id);
    const teacherView = await viewMessages(teacher.token, groupConvId);
    expect(teacherView.canModerate).toBe(true);
    const m2Traced = teacherView.messages.find((m) => m.id === m2Id);
    expect(m2Traced?.fullMessage).toBe('tin s1 sẽ tự xoá phía mình');
    expect(m2Traced?.deletedAt).toBeNull();
    const againForMe = await http(app).delete(`/api/v1/messages/${m2Id}`).set('Authorization', `Bearer ${s1.token}`);
    expect(againForMe.status).toBe(200);

    const teacherForMe = await http(app).delete(`/api/v1/messages/${m1Id}`).set('Authorization', `Bearer ${teacher.token}`);
    expect(teacherForMe.status).toBe(403);
    expect(teacherForMe.body.code).toBe('messaging.message_delete_forbidden');
    const noReason = await http(app).post(`/api/v1/messages/${m1Id}/hard-delete`)
      .set('Authorization', `Bearer ${teacher.token}`).send({});
    expect(noReason.status).toBe(400);
    const hardDel = await http(app).post(`/api/v1/messages/${m1Id}/hard-delete`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ reason: 'Nội dung không phù hợp với lớp học' });
    expect(hardDel.status).toBe(201);
    expect(hardDel.body.deleted).toBe(true);
    const s2ViewAfter = await viewMessages(s2.token, groupConvId);
    expect(s2ViewAfter.messages.map((m) => m.id)).not.toContain(m1Id);
    const teacherViewAfter = await viewMessages(teacher.token, groupConvId);
    expect(teacherViewAfter.messages.map((m) => m.id)).not.toContain(m1Id);
    const hardAgain = await http(app).post(`/api/v1/messages/${m1Id}/hard-delete`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ reason: 'xoá lại' });
    expect(hardAgain.status).toBe(404);
  });

  it('5. báo cáo chỉ tới giáo viên phụ trách và admin; duyệt được kiểm tra phạm vi và mọi lượt xem đều ghi vào event_log', async () => {
    const friendReq = await http(app).post(`/api/v1/messages/contacts/${s2.id}`).set('Authorization', `Bearer ${s1.token}`).send({});
    expect(friendReq.status).toBe(201);
    const friendAcc = await http(app).post(`/api/v1/messages/contacts/requests/${s1.id}/accept`).set('Authorization', `Bearer ${s2.token}`).send({});
    expect(friendAcc.status).toBe(201);
    const conv = await http(app).post('/api/v1/messages/conversations').set('Authorization', `Bearer ${s1.token}`)
      .send({ type: 1, memberIds: [s2.id] });
    expect(conv.status).toBe(201);
    const convId = conv.body.id as string;
    const secret = await send(s1.token, convId, 'tin riêng sẽ bị thu hồi');
    expect(secret.status).toBe(201);
    const secretId = secret.body.id as string;
    const recallOwn = await http(app).post(`/api/v1/messages/${secretId}/recall`).set('Authorization', `Bearer ${s1.token}`).send({});
    expect(recallOwn.status).toBe(201);
    expect(recallOwn.body.recalledBy).toBe(s1.id);

    const outsider = await person();
    const outsiderReport = await http(app).post(`/api/v1/messages/conversations/${convId}/report`)
      .set('Authorization', `Bearer ${outsider.token}`).send({ reason: 'người ngoài' });
    expect(outsiderReport.status).toBe(403);
    expect(outsiderReport.body.code).toBe('messaging.not_member');
    const missing = await http(app).post('/api/v1/messages/conversations/123e4567-e89b-72d3-a456-426614174000/report')
      .set('Authorization', `Bearer ${s2.token}`).send({});
    expect(missing.status).toBe(404);

    const report = await http(app).post(`/api/v1/messages/conversations/${convId}/report`)
      .set('Authorization', `Bearer ${s2.token}`).send({ reason: 'Nghi bắt nạt qua tin nhắn riêng' });
    expect(report.status).toBe(201);
    expect(report.body.status).toBe('open');
    expect(report.body.reporterId).toBe(s2.id);
    const reportId = report.body.id as string;

    const teacherNotifications = await http(app).get('/api/v1/notifications/items').set('Authorization', `Bearer ${teacher.token}`);
    expect((teacherNotifications.body.items as { eventType: string }[]).some((n) => n.eventType === 'conversation_reported')).toBe(true);
    const adminNotifications = await http(app).get('/api/v1/notifications/items').set('Authorization', `Bearer ${admin}`);
    expect((adminNotifications.body.items as { eventType: string }[]).some((n) => n.eventType === 'conversation_reported')).toBe(true);

    const adminQueue = await http(app).get('/api/v1/messages/reports').set('Authorization', `Bearer ${admin}`);
    expect((adminQueue.body as { id: string }[]).map((r) => r.id)).toContain(reportId);
    const teacherQueue = await http(app).get('/api/v1/messages/reports').set('Authorization', `Bearer ${teacher.token}`);
    expect((teacherQueue.body as { id: string }[]).map((r) => r.id)).toContain(reportId);
    const otherQueue = await http(app).get('/api/v1/messages/reports').set('Authorization', `Bearer ${otherTeacher.token}`);
    expect((otherQueue.body as { id: string }[]).map((r) => r.id)).not.toContain(reportId);
    const studentQueue = await http(app).get('/api/v1/messages/reports').set('Authorization', `Bearer ${s1.token}`);
    expect((studentQueue.body as { id: string }[]).map((r) => r.id)).not.toContain(reportId);

    const studentView = await http(app).get(`/api/v1/messages/reports/${reportId}/conversation`).set('Authorization', `Bearer ${s2.token}`);
    expect(studentView.status).toBe(403);
    expect(studentView.body.code).toBe('messaging.report_review_forbidden');
    const otherView = await http(app).get(`/api/v1/messages/reports/${reportId}/conversation`).set('Authorization', `Bearer ${otherTeacher.token}`);
    expect(otherView.status).toBe(403);
    const teacherView = await http(app).get(`/api/v1/messages/reports/${reportId}/conversation`).set('Authorization', `Bearer ${teacher.token}`);
    expect(teacherView.status).toBe(200);
    const tracedSecret = (teacherView.body.conversation.messages as MessageBody[]).find((m) => m.id === secretId);
    expect(tracedSecret?.fullMessage).toBe('tin riêng sẽ bị thu hồi');
    expect(tracedSecret?.recalledBy).toBe(s1.id);
    expect(tracedSecret?.recalledAt).toBeTruthy();
    const adminView = await http(app).get(`/api/v1/messages/reports/${reportId}/conversation`).set('Authorization', `Bearer ${admin}`);
    expect(adminView.status).toBe(200);
    expect(adminView.body.report.id).toBe(reportId);

    await flushWorkerRelay();
    const logs = await http(app).get('/api/v1/event-logs?eventType=message_conversation_report_viewed')
      .set('Authorization', `Bearer ${admin}`);
    expect(logs.status).toBe(200);
    const items = (logs.body as { items: { userId: string; objectId: string; payload: Record<string, unknown> }[] }).items;
    const teacherRow = items.find((i) => i.userId === teacher.id && i.objectId === convId);
    expect(teacherRow).toBeDefined();
    expect(teacherRow!.payload.reportId).toBe(reportId);
    const adminRow = items.find((i) => i.userId === adminId && i.objectId === convId);
    expect(adminRow).toBeDefined();

    const studentResolve = await http(app).patch(`/api/v1/messages/reports/${reportId}`)
      .set('Authorization', `Bearer ${s1.token}`).send({ status: 'resolved' });
    expect(studentResolve.status).toBe(403);
    const resolved = await http(app).patch(`/api/v1/messages/reports/${reportId}`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ status: 'resolved' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.resolvedBy).toBe(teacher.id);
    expect(resolved.body.resolvedAt).toBeTruthy();
  }, 120000);

  it('6. gỡ thành viên nhóm tự do (MSG-T4): chỉ người quản lý gỡ được; nhóm cấu trúc bị từ chối để về roster; người bị gỡ mất quyền ngay', async () => {
    const created = await http(app).post('/api/v1/messages/conversations').set('Authorization', `Bearer ${owner.token}`)
      .send({ type: 2, memberIds: [teacher.id, s1.id, s2.id], name: 'Nhóm gỡ thành viên' });
    expect(created.status).toBe(201);
    const freeId = created.body.id as string;

    const byMember = await http(app).delete(`/api/v1/messages/conversations/${freeId}/members/${s2.id}`)
      .set('Authorization', `Bearer ${s1.token}`);
    expect(byMember.status).toBe(403);
    expect(byMember.body.code).toBe('messaging.conversation_manage_forbidden');

    const removeSelf = await http(app).delete(`/api/v1/messages/conversations/${freeId}/members/${owner.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(removeSelf.status).toBe(400);
    expect(removeSelf.body.code).toBe('messaging.member_remove_self');
    const removeCreator = await http(app).delete(`/api/v1/messages/conversations/${freeId}/members/${owner.id}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(removeCreator.status).toBe(403);
    expect(removeCreator.body.code).toBe('messaging.member_remove_creator');

    const removed = await http(app).delete(`/api/v1/messages/conversations/${freeId}/members/${s2.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(removed.status).toBe(200);
    expect(new Set(removed.body.members as string[])).toEqual(new Set([owner.id, teacher.id, s1.id]));

    const viewAfter = await http(app).get(`/api/v1/messages/conversations/${freeId}`)
      .set('Authorization', `Bearer ${s2.token}`);
    expect(viewAfter.status).toBe(403);
    expect(viewAfter.body.code).toBe('messaging.not_member');
    const sendAfter = await send(s2.token, freeId, 'em còn gửi được không');
    expect(sendAfter.status).toBe(403);

    const removeAgain = await http(app).delete(`/api/v1/messages/conversations/${freeId}/members/${s2.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(removeAgain.status).toBe(404);
    expect(removeAgain.body.code).toBe('messaging.member_not_found');

    const structural = await http(app).delete(`/api/v1/messages/conversations/${groupConvId}/members/${s1.id}`)
      .set('Authorization', `Bearer ${teacher.token}`);
    expect(structural.status).toBe(400);
    expect(structural.body.code).toBe('messaging.member_remove_structural');
    const stillMember = await viewMessages(s1.token, groupConvId);
    expect(stillMember).toBeTruthy();
  });
});
