import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login,
  roleIdByShortname, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse } from '../../support/course-enrolment-helpers';
import { courseContextId } from '../../support/engagement-helpers';
import { SearchService } from '../../../src/modules/search/search.service';

describe('Search reindex — tập id theo area và số đếm tài liệu ở SQL', () => {
  let app: INestApplication;
  let admin: string;
  let pg: Client;
  let search: SearchService;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    search = app.get(SearchService);
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
  });
  afterAll(async () => { await pg.end(); await app.close(); });

  it('dựng lại toàn bộ: chỉ id đủ điều kiện của từng area vào chỉ mục, countDocs bằng số dòng thật của bảng', async () => {
    const activeUser = await createUserViaApi(app, admin);
    const suspendedUser = await createUserViaApi(app, admin);
    const suspend = await http(app).post(`/api/v1/users/${suspendedUser.id}/suspend`).set('Authorization', `Bearer ${admin}`).send({});
    expect(suspend.status).toBeLessThan(300);
    const deletedUser = await createUserViaApi(app, admin);
    const del = await http(app).delete(`/api/v1/users/${deletedUser.id}`).set('Authorization', `Bearer ${admin}`);
    expect(del.status).toBeLessThan(300);

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

    await search.reindexAll();
    const docs = await search.listDocs();
    const idsOf = (area: string) => new Set(docs.filter((d) => d.area === area).map((d) => d.itemId));

    const userIds = idsOf('users');
    expect(userIds.has(activeUser.id)).toBe(true);
    expect(userIds.has(suspendedUser.id)).toBe(false);
    expect(userIds.has(deletedUser.id)).toBe(false);

    expect(idsOf('courses').has(course.id)).toBe(true);

    const contentIds = idsOf('contentbank');
    expect(contentIds.has(publicItem.body.id as string)).toBe(true);
    expect(contentIds.has(draftItem.body.id as string)).toBe(false);

    const counted = await search.countDocs();
    const tableCount = await pg.query('select count(*)::int as total from search_documents');
    expect(counted).toBe((tableCount.rows[0] as { total: number }).total);
    expect(counted).toBe(docs.length);
  });
});
