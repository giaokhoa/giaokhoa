import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, createTestApp, createUserViaApi, http, login, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';

interface Person { id: string; username: string; token: string }
interface ListRow { id: string; unread: number; component: string | null; itemType: string | null }

describe('Messaging — danh sách chat của quản trị viên có hàng lớp/khoá (issue #592)', () => {
  let app: INestApplication;
  let admin: string;
  let teacher: Person;
  let student: Person;
  let courseConvId: string;
  let classConvId: string;
  let baselineBadge = 0;

  async function person(firstName: string, lastName: string): Promise<Person> {
    const u = await createUserViaApi(app, admin, { firstName, lastName });
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, username: u.username, token: session.accessToken };
  }

  async function adminList(): Promise<ListRow[]> {
    const res = await http(app).get('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    return res.body as ListRow[];
  }

  async function adminBadge(): Promise<number> {
    const res = await http(app).get('/api/v1/messages/unread-count')
      .set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    return (res.body as { conversations: number }).conversations;
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    baselineBadge = await adminBadge();
    teacher = await person('Giang', 'DayLop');
    student = await person('Hanh', 'HocLop');

    const current = await http(app).get('/api/v1/tenants/current').set('Authorization', `Bearer ${admin}`);
    const tenantId = (current.body as { id: string }).id;
    for (const p of [teacher, student]) {
      await http(app).post(`/api/v1/tenants/${tenantId}/members`)
        .set('Authorization', `Bearer ${admin}`).send({ userId: p.id });
    }

    const category = await createCategory(app, admin);
    const course = await createCourse(app, admin, category.id);
    const instance = await createEnrolInstance(app, admin, course.id);
    for (const p of [teacher, student]) await enrolUser(app, admin, course.id, instance.id, p.id);
    const courseEnsured = await http(app).get(`/api/v1/messages/courses/${course.id}/conversation`)
      .set('Authorization', `Bearer ${teacher.token}`);
    expect(courseEnsured.status).toBe(200);
    courseConvId = (courseEnsured.body as { id: string }).id;
    const courseAdminEnsured = await http(app).get(`/api/v1/messages/courses/${course.id}/conversation`)
      .set('Authorization', `Bearer ${admin}`);
    expect(courseAdminEnsured.status).toBe(200);
    expect((courseAdminEnsured.body as { id: string }).id).toBe(courseConvId);
    expect((await http(app).post(`/api/v1/messages/conversations/${courseConvId}/messages`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ text: 'tin khoá một' })).status).toBe(201);
    expect((await http(app).post(`/api/v1/messages/conversations/${courseConvId}/messages`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ text: 'tin khoá hai' })).status).toBe(201);

    const created = await http(app).post('/api/v1/classes')
      .set('Authorization', `Bearer ${admin}`).send({ name: 'Lớp chat quản trị', ownerId: teacher.id });
    expect(created.status).toBe(201);
    const classId = (created.body as { id: string }).id;
    const added = await http(app).post(`/api/v1/classes/${classId}/roster`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ userId: student.id });
    expect(added.status).toBe(201);
    const classEnsured = await http(app).get(`/api/v1/messages/classes/${classId}/conversation`)
      .set('Authorization', `Bearer ${teacher.token}`);
    expect(classEnsured.status).toBe(200);
    classConvId = (classEnsured.body as { id: string }).id;
    const classAdminEnsured = await http(app).get(`/api/v1/messages/classes/${classId}/conversation`)
      .set('Authorization', `Bearer ${admin}`);
    expect(classAdminEnsured.status).toBe(200);
    expect((classAdminEnsured.body as { id: string }).id).toBe(classConvId);
    expect((await http(app).post(`/api/v1/messages/conversations/${classConvId}/messages`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ text: 'tin lớp một' })).status).toBe(201);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('danh sách của quản trị viên có hàng khoá và hàng lớp với đúng số chưa đọc, badge tăng đúng phần dàn dựng', async () => {
    const rows = await adminList();
    const courseRow = rows.find((row) => row.id === courseConvId);
    const classRow = rows.find((row) => row.id === classConvId);
    expect(courseRow).toBeDefined();
    expect(courseRow!.unread).toBe(2);
    expect(classRow).toBeDefined();
    expect(classRow!.unread).toBe(1);
    expect(await adminBadge()).toBe(baselineBadge + 2);
  });

  it('quản trị viên mở được chi tiết cả hai hội thoại và đọc xong thì số chưa đọc hội tụ', async () => {
    for (const convId of [courseConvId, classConvId]) {
      const detail = await http(app).get(`/api/v1/messages/conversations/${convId}`)
        .set('Authorization', `Bearer ${admin}`);
      expect(detail.status).toBe(200);
    }

    const read = await http(app).post(`/api/v1/messages/conversations/${courseConvId}/read`)
      .set('Authorization', `Bearer ${admin}`).send({});
    expect(read.status).toBe(201);

    expect(await adminBadge()).toBe(baselineBadge + 1);
    const rows = await adminList();
    expect(rows.find((row) => row.id === courseConvId)?.unread).toBe(0);
    expect(rows.find((row) => row.id === classConvId)?.unread).toBe(1);
  });
});
