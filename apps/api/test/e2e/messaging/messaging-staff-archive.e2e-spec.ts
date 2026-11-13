import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, createTestApp, createUserViaApi, http, login, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';

interface Person { id: string; username: string; token: string }
interface ListRow { id: string; archivedAt: string | null }

describe('Messaging — staff lưu trữ hội thoại khoá (vòng sửa issue #623)', () => {
  let app: INestApplication;
  let admin: string;
  let teacher: Person;
  let student: Person;
  let courseConvId: string;

  async function person(firstName: string, lastName: string): Promise<Person> {
    const u = await createUserViaApi(app, admin, { firstName, lastName });
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, username: u.username, token: session.accessToken };
  }

  async function teacherList(archived = false): Promise<ListRow[]> {
    const res = await http(app).get(`/api/v1/messages/conversations${archived ? '?archived=true' : ''}`)
      .set('Authorization', `Bearer ${teacher.token}`);
    expect(res.status).toBe(200);
    return res.body as ListRow[];
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    teacher = await person('Thao', 'DayLuuTru');
    student = await person('Luu', 'HocLuuTru');

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
    const ensured = await http(app).get(`/api/v1/messages/courses/${course.id}/conversation`)
      .set('Authorization', `Bearer ${teacher.token}`);
    expect(ensured.status).toBe(200);
    courseConvId = (ensured.body as { id: string }).id;
    expect((await http(app).post(`/api/v1/messages/conversations/${courseConvId}/messages`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ text: 'tin mở đầu hội thoại khoá' })).status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('staff lưu trữ hội thoại khoá thì hội thoại vắng khỏi danh sách chính của chính họ và chỉ hiện ở tập đã lưu', async () => {
    const before = await teacherList();
    expect(before.find((row) => row.id === courseConvId)).toMatchObject({ archivedAt: null });
    expect((await teacherList(true)).map((row) => row.id)).not.toContain(courseConvId);

    const patched = await http(app).patch(`/api/v1/messages/conversations/${courseConvId}/state`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ archived: true });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ archived: true });

    expect((await teacherList()).map((row) => row.id)).not.toContain(courseConvId);
    const storedRow = (await teacherList(true)).find((row) => row.id === courseConvId);
    expect(storedRow).toBeDefined();
    expect(typeof storedRow!.archivedAt).toBe('string');
  });

  it('mở hội thoại khoá đã lưu thì chi tiết mang trạng thái lưu trữ của chính người xem, và bỏ lưu đưa hội thoại về danh sách chính ngay', async () => {
    const detail = await http(app).get(`/api/v1/messages/conversations/${courseConvId}`)
      .set('Authorization', `Bearer ${teacher.token}`);
    expect(detail.status).toBe(200);
    expect(typeof (detail.body as { archivedAt: string | null }).archivedAt).toBe('string');

    const unpatched = await http(app).patch(`/api/v1/messages/conversations/${courseConvId}/state`)
      .set('Authorization', `Bearer ${teacher.token}`).send({ archived: false });
    expect(unpatched.status).toBe(200);
    expect(unpatched.body).toMatchObject({ archived: false, archivedAt: null });
    expect((await teacherList()).map((row) => row.id)).toContain(courseConvId);
    expect((await teacherList(true)).map((row) => row.id)).not.toContain(courseConvId);
    const detailAfter = await http(app).get(`/api/v1/messages/conversations/${courseConvId}`)
      .set('Authorization', `Bearer ${teacher.token}`);
    expect((detailAfter.body as { archivedAt: string | null }).archivedAt).toBeNull();
  });
});
