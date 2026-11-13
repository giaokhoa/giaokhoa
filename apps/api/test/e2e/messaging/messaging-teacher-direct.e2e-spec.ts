import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';
import { contextIdByLevelInstance } from '../../support/engagement-helpers';


interface Person { id: string; username: string; token: string }

interface RosterMember {
  userId: string; displayName: string; username: string;
  role: 'teacher' | 'student'; relationship: string; canDirectMessage: boolean;
}

describe('Messaging — GV nhắn riêng học sinh trong khoá không cần kết bạn (issue #33)', () => {
  let app: INestApplication;
  let admin: string;
  let editingTeacher: string;

  let courseA: string;
  let teacherA: Person;
  let coTeacherA: Person;
  let s1: Person;
  let s2: Person;
  let teacherB: Person;
  let sB: Person;
  let teacherC: Person;
  let sC: Person;
  let courseD: string;
  let instanceD: string;
  let teacherD: Person;
  let sD1: Person;
  let sD2: Person;
  let ctxE: string;
  let teacherE: Person;
  let sE: Person;

  async function person(firstName: string, lastName: string): Promise<Person> {
    const u = await createUserViaApi(app, admin, { firstName, lastName });
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, username: u.username, token: session.accessToken };
  }

  async function courseWithTeacher(teacherFirst: string, studentNames: [string, string][]): Promise<{
    courseId: string; instanceId: string; ctxId: string; teacher: Person; students: Person[];
  }> {
    const category = await createCategory(app, admin);
    const course = await createCourse(app, admin, category.id, {});
    const instance = await createEnrolInstance(app, admin, course.id);
    const teacher = await person(teacherFirst, 'GiaoVien');
    const ctxId = await contextIdByLevelInstance(app, admin, 50, course.id);
    await assignRole(app, admin, teacher.id, editingTeacher, ctxId);
    const students: Person[] = [];
    for (const [first, last] of studentNames) {
      const s = await person(first, last);
      await enrolUser(app, admin, course.id, instance.id, s.id);
      students.push(s);
    }
    return { courseId: course.id, instanceId: instance.id, ctxId, teacher, students };
  }

  async function openConversation(sender: Person, other: Person) {
    return http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${sender.token}`).send({ type: 1, memberIds: [other.id] });
  }

  async function send(sender: Person, conversationId: string, text: string) {
    return http(app).post(`/api/v1/messages/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${sender.token}`).send({ text });
  }

  async function roster(token: string, courseId: string) {
    return http(app).get(`/api/v1/messages/courses/${courseId}/members`)
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    editingTeacher = await roleIdByShortname(app, admin, 'editingteacher');

    const a = await courseWithTeacher('Co', [['Hoc', 'Mot'], ['Hoc', 'Hai']]);
    courseA = a.courseId;
    teacherA = a.teacher;
    [s1, s2] = a.students as [Person, Person];
    coTeacherA = await person('Co', 'Hai');
    await assignRole(app, admin, coTeacherA.id, editingTeacher, a.ctxId);

    const b = await courseWithTeacher('Thay', [['Hoc', 'Ba']]);
    teacherB = b.teacher;
    [sB] = b.students as [Person];

    const c = await courseWithTeacher('Co', [['Hoc', 'Bon']]);
    teacherC = c.teacher;
    [sC] = c.students as [Person];

    const d = await courseWithTeacher('Thay', [['Hoc', 'Nam'], ['Hoc', 'Sau']]);
    courseD = d.courseId;
    instanceD = d.instanceId;
    teacherD = d.teacher;
    [sD1, sD2] = d.students as [Person, Person];

    const e = await courseWithTeacher('Co', [['Hoc', 'Bay']]);
    ctxE = e.ctxId;
    teacherE = e.teacher;
    [sE] = e.students as [Person];
  }, 180000);
  afterAll(async () => { await app.close(); });

  it('1. GV mở hội thoại mới và gửi thẳng cho học sinh đang ghi danh, không cần kết bạn; roster gắn cờ canDirectMessage đúng phía người xem', async () => {
    const asTeacher = await roster(teacherA.token, courseA);
    expect(asTeacher.status).toBe(200);
    const byId = new Map((asTeacher.body.members as RosterMember[]).map((m) => [m.userId, m]));
    expect(byId.get(s1.id)).toMatchObject({ role: 'student', relationship: 'none', canDirectMessage: true });
    expect(byId.get(s2.id)?.canDirectMessage).toBe(true);
    expect(byId.get(coTeacherA.id)).toMatchObject({ role: 'teacher', canDirectMessage: false });
    const asStudent = await roster(s1.token, courseA);
    const studentView = new Map((asStudent.body.members as RosterMember[]).map((m) => [m.userId, m]));
    expect(studentView.get(teacherA.id)?.canDirectMessage).toBe(false);
    expect(studentView.get(s2.id)?.canDirectMessage).toBe(false);

    const contacts = await http(app).get('/api/v1/messages/contacts').set('Authorization', `Bearer ${teacherA.token}`);
    expect(contacts.body.contacts).not.toContain(s1.id);

    const conv = await openConversation(teacherA, s1);
    expect(conv.status).toBe(201);
    const sent = await send(teacherA, conv.body.id as string, 'Cô nhắn riêng em về bài tập');
    expect(sent.status).toBe(201);
  });

  it('2. học sinh trả lời được trong cùng hội thoại (cổng mở cả hai chiều, gồm gửi vào hội thoại có sẵn)', async () => {
    const conv = await openConversation(teacherA, s1);
    expect(conv.status).toBe(201);
    const reply = await send(s1, conv.body.id as string, 'Em thưa cô, em đã nộp bài');
    expect(reply.status).toBe(201);
    const reopened = await openConversation(s1, teacherA);
    expect(reopened.status).toBe(201);
    expect(reopened.body.id).toBe(conv.body.id);
  });

  it('3. không có quan hệ GV–HS của một khoá chung thì cổng cũ vẫn chặn: học sinh khoá khác, giáo viên khoá khác', async () => {
    const t2otherStudent = await openConversation(teacherA, sB);
    expect(t2otherStudent.status).toBe(403);
    expect(t2otherStudent.body.code).toBe('messaging.not_a_contact');
    const otherStudent2t = await openConversation(sB, teacherA);
    expect(otherStudent2t.status).toBe(403);
    expect(otherStudent2t.body.code).toBe('messaging.not_a_contact');
    const otherTeacher2s = await openConversation(teacherB, s1);
    expect(otherTeacher2s.status).toBe(403);
    expect(otherTeacher2s.body.code).toBe('messaging.not_a_contact');
    const s2otherTeacher = await openConversation(s1, teacherB);
    expect(s2otherTeacher.status).toBe(403);
    expect(s2otherTeacher.body.code).toBe('messaging.not_a_contact');
  });

  it('4. HS↔HS cùng khoá chưa kết bạn vẫn bị chặn — ngoại lệ không rò sang cặp học sinh', async () => {
    const res = await openConversation(s1, s2);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('messaging.not_a_contact');
    const reverse = await openConversation(s2, s1);
    expect(reverse.status).toBe(403);
    expect(reverse.body.code).toBe('messaging.not_a_contact');
  });

  it('5. quan hệ chặn thắng ngoại lệ: chặn trước thì mở mới bị chặn; chặn sau thì gửi bị chặn cả hai chiều', async () => {
    const block = await http(app).post(`/api/v1/messages/contacts/${sD2.id}/block`)
      .set('Authorization', `Bearer ${teacherD.token}`).send({});
    expect(block.status).toBe(201);
    const openByTeacher = await openConversation(teacherD, sD2);
    expect(openByTeacher.status).toBe(403);
    expect(openByTeacher.body.code).toBe('messaging.not_a_contact');
    const openByStudent = await openConversation(sD2, teacherD);
    expect(openByStudent.status).toBe(403);
    expect(openByStudent.body.code).toBe('messaging.not_a_contact');

    const conv = await openConversation(teacherC, sC);
    expect(conv.status).toBe(201);
    const convId = conv.body.id as string;
    const before = await send(teacherC, convId, 'Tin trước khi bị chặn');
    expect(before.status).toBe(201);
    const block2 = await http(app).post(`/api/v1/messages/contacts/${teacherC.id}/block`)
      .set('Authorization', `Bearer ${sC.token}`).send({});
    expect(block2.status).toBe(201);
    const teacherSends = await send(teacherC, convId, 'GV gửi sau khi bị chặn');
    expect(teacherSends.status).toBe(403);
    expect(teacherSends.body.code).toBe('messaging.contact_blocked');
    const studentSends = await send(sC, convId, 'HS gửi sau khi đã chặn');
    expect(studentSends.status).toBe(403);
    expect(studentSends.body.code).toBe('messaging.contact_blocked');
  });

  it('6. hết ghi danh hoặc hết vai dạy: gửi bị chặn lại cả hai chiều, lịch sử cũ vẫn đọc được', async () => {
    const conv = await openConversation(teacherD, sD1);
    expect(conv.status).toBe(201);
    const convId = conv.body.id as string;
    expect((await send(teacherD, convId, 'Tin khi còn ghi danh')).status).toBe(201);
    expect((await send(sD1, convId, 'Em trả lời khi còn ghi danh')).status).toBe(201);

    const del = await http(app).delete(`/api/v1/courses/${courseD}/enrol/instances/${instanceD}/users/${sD1.id}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(del.status).toBe(200);
    expect(del.body.withdrawn).toBe(false);
    const enrolments = await http(app).get(`/api/v1/courses/${courseD}/enrolments`)
      .set('Authorization', `Bearer ${admin}`);
    expect((enrolments.body as { userId: string }[]).some((e) => e.userId === sD1.id)).toBe(false);
    const studentSends = await send(sD1, convId, 'Tin sau khi huỷ ghi danh');
    expect(studentSends.status).toBe(403);
    expect(studentSends.body.code).toBe('messaging.not_a_contact');
    const teacherSends = await send(teacherD, convId, 'Tin sau khi trò huỷ ghi danh');
    expect(teacherSends.status).toBe(403);
    expect(teacherSends.body.code).toBe('messaging.not_a_contact');
    for (const viewer of [sD1, teacherD]) {
      const history = await http(app).get(`/api/v1/messages/conversations/${convId}`)
        .set('Authorization', `Bearer ${viewer.token}`);
      expect(history.status).toBe(200);
      const texts = (history.body.messages as { fullMessage: string }[]).map((m) => m.fullMessage);
      expect(texts).toContain('Tin khi còn ghi danh');
      expect(texts).toContain('Em trả lời khi còn ghi danh');
    }

    const convE = await openConversation(teacherE, sE);
    expect(convE.status).toBe(201);
    const convEId = convE.body.id as string;
    expect((await send(teacherE, convEId, 'Tin khi còn vai dạy')).status).toBe(201);
    const assignments = await http(app).get(`/api/v1/access/assignments?userId=${teacherE.id}&contextId=${ctxE}`)
      .set('Authorization', `Bearer ${admin}`);
    const mine = (assignments.body.assignments as { id: string; userId: string; contextId: string }[])
      .find((a) => a.userId === teacherE.id && a.contextId === ctxE);
    expect(mine).toBeDefined();
    const unassign = await http(app).delete(`/api/v1/access/assignments/${mine!.id}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(unassign.status).toBe(200);
    const exTeacherSends = await send(teacherE, convEId, 'Tin sau khi hết vai dạy');
    expect(exTeacherSends.status).toBe(403);
    expect(exTeacherSends.body.code).toBe('messaging.not_a_contact');
    const studentSendsE = await send(sE, convEId, 'Tin gửi cho cô đã hết vai dạy');
    expect(studentSendsE.status).toBe(403);
    expect(studentSendsE.body.code).toBe('messaging.not_a_contact');
    const historyE = await http(app).get(`/api/v1/messages/conversations/${convEId}`)
      .set('Authorization', `Bearer ${sE.token}`);
    expect(historyE.status).toBe(200);
    expect((historyE.body.messages as { fullMessage: string }[]).map((m) => m.fullMessage)).toContain('Tin khi còn vai dạy');
  });
});
