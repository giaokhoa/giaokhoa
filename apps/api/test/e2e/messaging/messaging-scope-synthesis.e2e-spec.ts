import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, createTestApp, createUserViaApi, http, login, roleIdByShortname,
  STRONG_PASSWORD, systemContextId,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';

interface Person { id: string; username: string; token: string }
interface ListRow { id: string; unread: number; component: string | null; itemType: string | null }

describe('Messaging — người có phạm vi nhưng chưa từng mở vẫn thấy hàng tổng hợp (issue #592)', () => {
  let app: INestApplication;
  let admin: string;
  let teacher: Person;
  let student: Person;
  let scopeViewer: Person;
  let courseId: string;
  let courseConvId: string;
  let classConvId: string;

  async function person(firstName: string, lastName: string): Promise<Person> {
    const u = await createUserViaApi(app, admin, { firstName, lastName });
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, username: u.username, token: session.accessToken };
  }

  async function scopeList(): Promise<ListRow[]> {
    const res = await http(app).get('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${scopeViewer.token}`);
    expect(res.status).toBe(200);
    return res.body as ListRow[];
  }

  async function scopeBadge(): Promise<number> {
    const res = await http(app).get('/api/v1/messages/unread-count')
      .set('Authorization', `Bearer ${scopeViewer.token}`);
    expect(res.status).toBe(200);
    return (res.body as { conversations: number }).conversations;
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    teacher = await person('Giang', 'DayTongHop');
    student = await person('Hanh', 'HocTongHop');
    scopeViewer = await person('Pham', 'CoPhamVi');

    const current = await http(app).get('/api/v1/tenants/current').set('Authorization', `Bearer ${admin}`);
    const tenantId = (current.body as { id: string }).id;
    for (const p of [teacher, student, scopeViewer]) {
      await http(app).post(`/api/v1/tenants/${tenantId}/members`)
        .set('Authorization', `Bearer ${admin}`).send({ userId: p.id });
    }

    const category = await createCategory(app, admin);
    const course = await createCourse(app, admin, category.id);
    courseId = course.id;
    const instance = await createEnrolInstance(app, admin, course.id);
    for (const p of [teacher, student]) await enrolUser(app, admin, course.id, instance.id, p.id);
    const courseEnsured = await http(app).get(`/api/v1/messages/courses/${course.id}/conversation`)
      .set('Authorization', `Bearer ${teacher.token}`);
    expect(courseEnsured.status).toBe(200);
    courseConvId = (courseEnsured.body as { id: string }).id;

    const created = await http(app).post('/api/v1/classes')
      .set('Authorization', `Bearer ${admin}`).send({ name: 'Lớp chat chưa mở tổng hợp', ownerId: teacher.id });
    expect(created.status).toBe(201);
    const classId = (created.body as { id: string }).id;
    const added = await http(app).post(`/api/v1/classes/${classId}/roster`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ userId: student.id });
    expect(added.status).toBe(201);
    const classEnsured = await http(app).get(`/api/v1/messages/classes/${classId}/conversation`)
      .set('Authorization', `Bearer ${teacher.token}`);
    expect(classEnsured.status).toBe(200);
    classConvId = (classEnsured.body as { id: string }).id;

    expect((await http(app).post(`/api/v1/messages/conversations/${courseConvId}/messages`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ text: 'tin khoá chưa mở' })).status).toBe(201);
    expect((await http(app).post(`/api/v1/messages/conversations/${classConvId}/messages`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ text: 'tin lớp chưa mở' })).status).toBe(201);

    const managerRoleId = await roleIdByShortname(app, admin, 'manager');
    const sysCtxId = await systemContextId(app, admin);
    const assigned = await http(app).post('/api/v1/access/assignments')
      .set('Authorization', `Bearer ${admin}`)
      .send({ userId: scopeViewer.id, roleId: managerRoleId, contextId: sysCtxId });
    expect(assigned.status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('người có phạm vi nhưng chưa từng mở vẫn thấy hàng lớp/khoá với số chưa đọc 0, và mở lần đầu thì hàng chuyển thành thật và bắt đầu đếm', async () => {
    expect(await scopeBadge()).toBe(0);
    const rows = await scopeList();
    const courseRow = rows.find((row) => row.id === courseConvId);
    const classRow = rows.find((row) => row.id === classConvId);
    expect(courseRow).toBeDefined();
    expect(courseRow!.component).toBe('core_course');
    expect(courseRow!.itemType).toBe('course');
    expect(courseRow!.unread).toBe(0);
    expect(classRow).toBeDefined();
    expect(classRow!.component).toBe('core_class');
    expect(classRow!.itemType).toBe('class');
    expect(classRow!.unread).toBe(0);

    const opened = await http(app).get(`/api/v1/messages/courses/${courseId}/conversation`)
      .set('Authorization', `Bearer ${scopeViewer.token}`);
    expect(opened.status).toBe(200);
    const rowsAfter = await scopeList();
    expect(rowsAfter.find((row) => row.id === courseConvId)?.unread).toBe(1);
    expect(rowsAfter.find((row) => row.id === classConvId)?.unread).toBe(0);
    expect(await scopeBadge()).toBe(1);
  });
});
