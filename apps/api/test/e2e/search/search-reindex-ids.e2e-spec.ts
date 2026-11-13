import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login,
  roleIdByShortname, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse } from '../../support/course-enrolment-helpers';
import { courseContextId } from '../../support/engagement-helpers';

describe('Search reindex — dựng lại toàn bộ chỉ mục qua HTTP', () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
  });
  afterAll(async () => { await app.close(); });

  async function reindex(token: string) {
    return http(app).post('/api/v1/search/reindex').set('Authorization', `Bearer ${token}`).send({});
  }

  it('dựng lại qua HTTP: bộ đếm indexed chỉ tính nội dung đủ điều kiện và dịch đúng khi điều kiện thay đổi', async () => {
    const activeUser = await createUserViaApi(app, admin);
    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);
    const ctxId = await courseContextId(app, admin, course.id);
    const teacher = await createUserViaApi(app, admin);
    await assignRole(app, admin, teacher.id, await roleIdByShortname(app, admin, 'editingteacher'), ctxId);
    const teacherToken = (await login(app, teacher.username, STRONG_PASSWORD)).accessToken;
    const publicItem = await http(app).post('/api/v1/contentbank').set('Authorization', `Bearer ${teacherToken}`)
      .send({ name: 'Reindex public resource', contextId: ctxId });
    expect(publicItem.status).toBeLessThan(300);
    const publish = await http(app).patch(`/api/v1/contentbank/${publicItem.body.id}`).set('Authorization', `Bearer ${teacherToken}`)
      .send({ visibility: 'public' });
    expect(publish.status).toBeLessThan(300);
    const draftItem = await http(app).post('/api/v1/contentbank').set('Authorization', `Bearer ${teacherToken}`)
      .send({ name: 'Reindex draft resource', contextId: ctxId });
    expect(draftItem.status).toBeLessThan(300);
    expect(draftItem.body.visibility).toBe('draft');

    const first = await reindex(admin);
    expect(first.status).toBe(201);
    expect(typeof first.body.indexed).toBe('number');
    const base = first.body.indexed as number;

    const public2 = await http(app).post('/api/v1/contentbank').set('Authorization', `Bearer ${teacherToken}`)
      .send({ name: 'Reindex public resource 2', contextId: ctxId });
    expect(public2.status).toBeLessThan(300);
    const publish2 = await http(app).patch(`/api/v1/contentbank/${public2.body.id}`).set('Authorization', `Bearer ${teacherToken}`)
      .send({ visibility: 'public' });
    expect(publish2.status).toBeLessThan(300);
    const second = await reindex(admin);
    expect(second.status).toBe(201);
    expect(second.body.indexed).toBe(base + 1);

    const draft2 = await http(app).post('/api/v1/contentbank').set('Authorization', `Bearer ${teacherToken}`)
      .send({ name: 'Reindex draft resource 2', contextId: ctxId });
    expect(draft2.status).toBeLessThan(300);
    expect(draft2.body.visibility).toBe('draft');
    const third = await reindex(admin);
    expect(third.status).toBe(201);
    expect(third.body.indexed).toBe(base + 1);

    const suspend = await http(app).post(`/api/v1/users/${activeUser.id}/suspend`).set('Authorization', `Bearer ${admin}`).send({});
    expect(suspend.status).toBeLessThan(300);
    const fourth = await reindex(admin);
    expect(fourth.status).toBe(201);
    expect(fourth.body.indexed).toBe(base);
  });

  it('dựng lại qua HTTP: user thường không có quyền search:manage bị chặn 403', async () => {
    const plain = await createUserViaApi(app, admin);
    const plainToken = (await login(app, plain.username, STRONG_PASSWORD)).accessToken;
    const res = await reindex(plainToken);
    expect(res.status).toBe(403);
  });
});
