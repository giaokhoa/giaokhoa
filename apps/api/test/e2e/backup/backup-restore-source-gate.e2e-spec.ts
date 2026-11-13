import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login,
  roleIdByShortname, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse } from '../../support/course-enrolment-helpers';
import { courseContextId } from '../../support/engagement-helpers';

describe('Cổng đọc nguồn khôi phục sao lưu', () => {
  let app: INestApplication;
  let admin: string;
  let sourceCourseId: string;
  let targetCourseId: string;
  let targetCtxId: string;
  let backupJobId: string;
  let actorId: string;
  let actor: string;

  const tfBody = (stem: string, values: boolean[]) => ({
    qtype: 'truefalse',
    questionText: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: stem }] },
        {
          type: 'statementList',
          content: values.map((_v, i) => ({
            type: 'statement',
            attrs: { id: `s${i + 1}` },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: `${stem} — ý ${i + 1}` }] }],
          })),
        },
      ],
    },
    solution: { answers: values.map((v, i) => ({ statementId: `s${i + 1}`, value: v })) },
  });

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    const suffix = `${Date.now()}`;

    const sourceCat = await createCategory(app, admin, { name: `Source cat ${suffix}` });
    const source = await createCourse(app, admin, sourceCat.id);
    sourceCourseId = source.id;
    const sourceCtx = await courseContextId(app, admin, sourceCourseId);
    const bankCat = await http(app).post('/api/v1/questions/categories')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: `Source bank ${suffix}`, contextId: sourceCtx });
    expect(bankCat.status).toBeLessThan(300);
    const q = await http(app).post('/api/v1/questions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ categoryId: bankCat.body.id, ...tfBody('Source secret question.', [true, false, true, false]) });
    expect(q.status).toBeLessThan(300);

    const backup = await http(app).post('/api/v1/backup/jobs')
      .set('Authorization', `Bearer ${admin}`).send({ courseId: sourceCourseId });
    expect(backup.status).toBeLessThan(300);
    expect(backup.body.status).toBe('completed');
    backupJobId = backup.body.id as string;

    const targetCat = await createCategory(app, admin, { name: `Target cat ${suffix}` });
    const target = await createCourse(app, admin, targetCat.id);
    targetCourseId = target.id;
    targetCtxId = await courseContextId(app, admin, targetCourseId);
    const actorUser = await createUserViaApi(app, admin);
    actorId = actorUser.id;
    const teacherRole = await roleIdByShortname(app, admin, 'editingteacher');
    await assignRole(app, admin, actorUser.id, teacherRole, targetCtxId);
    actor = (await login(app, actorUser.username, STRONG_PASSWORD)).accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('từ chối đọc job sao lưu nguồn đối với actor thiếu quyền nguồn (đối chứng)', async () => {
    const read = await http(app).get(`/api/v1/backup/jobs/${backupJobId}`)
      .set('Authorization', `Bearer ${actor}`);
    expect(read.status).toBe(403);
    expect(read.body.code).toBe('backup.job_forbidden');
    const list = await http(app).get('/api/v1/backup/jobs').set('Authorization', `Bearer ${actor}`);
    expect((list.body as { id: string }[]).map((j) => j.id)).not.toContain(backupJobId);
  });

  it('từ chối restore merge bằng backup.job_forbidden và không ghi gì vào khoá đích', async () => {
    const denied = await http(app).post('/api/v1/backup/restore')
      .set('Authorization', `Bearer ${actor}`)
      .send({ backupJobId, mode: 'merge', targetCourseId });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('backup.job_forbidden');

    const jobs = await http(app).get('/api/v1/backup/jobs').set('Authorization', `Bearer ${admin}`);
    const actorRestores = (jobs.body as { type: string; userId: string }[])
      .filter((j) => j.type === 'restore' && j.userId === actorId);
    expect(actorRestores).toHaveLength(0);

    const cats = await http(app).get('/api/v1/questions/categories')
      .query({ contextId: targetCtxId }).set('Authorization', `Bearer ${admin}`);
    expect(cats.body).toHaveLength(0);
  });

  it('từ chối restore new tại cổng nguồn trước mọi kiểm tra đích', async () => {
    const denied = await http(app).post('/api/v1/backup/restore')
      .set('Authorization', `Bearer ${actor}`)
      .send({ backupJobId, mode: 'new' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('backup.job_forbidden');
  });

  it('khôi phục như trước khi actor đọc được job nguồn', async () => {
    const sourceCtx = await courseContextId(app, admin, sourceCourseId);
    const teacherRole = await roleIdByShortname(app, admin, 'editingteacher');
    await assignRole(app, admin, actorId, teacherRole, sourceCtx);

    const restore = await http(app).post('/api/v1/backup/restore')
      .set('Authorization', `Bearer ${actor}`)
      .send({ backupJobId, mode: 'merge', targetCourseId });
    expect(restore.status).toBeLessThan(300);
    expect(restore.body.status).toBe('completed');
    expect(restore.body.targetCourseId).toBe(targetCourseId);

    const cats = await http(app).get('/api/v1/questions/categories')
      .query({ contextId: targetCtxId }).set('Authorization', `Bearer ${admin}`);
    expect((cats.body as { id: string }[]).length).toBeGreaterThanOrEqual(1);
    const restoredCat = (cats.body as { id: string }[])[0]!;
    const questions = await http(app).get(`/api/v1/questions/categories/${restoredCat.id}/questions`)
      .set('Authorization', `Bearer ${admin}`);
    expect(questions.body).toHaveLength(1);
  });
});
