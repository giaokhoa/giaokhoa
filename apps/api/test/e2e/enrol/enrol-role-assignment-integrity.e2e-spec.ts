import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, assignRole, createRoleViaApi, createTestApp, createUserViaApi, hasCapability, http, login,
  roleIdByShortname, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';

describe('Toàn vẹn gán vai trò ghi danh (#157)', () => {
  let app: INestApplication;
  let admin: string;
  let studentRole: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    studentRole = await roleIdByShortname(app, admin, 'student');
  });
  afterAll(async () => { await app.close(); });

  interface AssignmentRow { id: string; roleId: string; component: string; itemId: string | null }

  async function courseContextId(courseId: string): Promise<string> {
    const content = await http(app).get(`/api/v1/courses/${courseId}/content`).set('Authorization', `Bearer ${admin}`);
    return content.body.contextId as string;
  }

  async function assignmentsOf(userId: string, contextId: string): Promise<AssignmentRow[]> {
    const res = await http(app).get('/api/v1/access/assignments')
      .query({ userId, contextId }).set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    return res.body.assignments as AssignmentRow[];
  }

  async function setupCourse(): Promise<{ course: { id: string }; ctxId: string }> {
    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);
    return { course, ctxId: await courseContextId(course.id) };
  }

  it('hai instance cùng vai trò: huỷ ghi danh ở một instance giữ vai trò, view ghi danh và năng lực khoá học', async () => {
    const { course, ctxId } = await setupCourse();
    const instanceA = await createEnrolInstance(app, admin, course.id, { method: 'manual' });
    const instanceB = await createEnrolInstance(app, admin, course.id, { method: 'manual' });
    const user = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, instanceA.id, user.id);
    await enrolUser(app, admin, course.id, instanceB.id, user.id);

    const before = (await assignmentsOf(user.id, ctxId)).filter((a) => a.roleId === studentRole);
    expect(before).toHaveLength(2);
    expect(before.map((a) => a.itemId).sort()).toEqual([instanceA.id, instanceB.id].sort());
    for (const a of before) expect(a.component).toBe('enrol');

    const del = await http(app).delete(`/api/v1/courses/${course.id}/enrol/instances/${instanceA.id}/users/${user.id}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(del.body.withdrawn).toBe(false);
    const after = (await assignmentsOf(user.id, ctxId)).filter((a) => a.roleId === studentRole);
    expect(after).toHaveLength(1);
    expect(after[0]!.itemId).toBe(instanceB.id);

    const userLogin = await login(app, user.username, STRONG_PASSWORD);
    const mine = await http(app).get(`/api/v1/courses/${course.id}/enrolments/me`).set('Authorization', `Bearer ${userLogin.accessToken}`);
    expect(mine.body).toMatchObject({ enrolled: true, active: true });
    expect(await hasCapability(app, admin, user.id, 'course:view', ctxId)).toBe(true);
    const content = await http(app).get(`/api/v1/courses/${course.id}/content`).set('Authorization', `Bearer ${userLogin.accessToken}`);
    expect(content.status).toBe(200);

    await http(app).delete(`/api/v1/courses/${course.id}/enrol/instances/${instanceB.id}/users/${user.id}`)
      .set('Authorization', `Bearer ${admin}`);
    expect((await assignmentsOf(user.id, ctxId)).filter((a) => a.roleId === studentRole)).toHaveLength(0);
    const mineAfter = await http(app).get(`/api/v1/courses/${course.id}/enrolments/me`).set('Authorization', `Bearer ${userLogin.accessToken}`);
    expect(mineAfter.body).toMatchObject({ enrolled: false, active: false });
    const blocked = await http(app).get(`/api/v1/courses/${course.id}/content`).set('Authorization', `Bearer ${userLogin.accessToken}`);
    expect(blocked.status).toBe(403);
  });

  it('rời cohort với onCohortLeave=unenrol chỉ xoá dòng instance cohort; ghi danh thủ công giữ vai trò', async () => {
    const { course, ctxId } = await setupCourse();
    const manual = await createEnrolInstance(app, admin, course.id, { method: 'manual' });
    const cohortRes = await http(app).post('/api/v1/cohorts').set('Authorization', `Bearer ${admin}`).send({ name: 'Integrity cohort' });
    expect(cohortRes.status).toBe(201);
    const cohortId = cohortRes.body.id as string;
    const cohortInstance = await createEnrolInstance(app, admin, course.id, { method: 'cohort', cohortId, onCohortLeave: 'unenrol' });

    const user = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, manual.id, user.id);
    await http(app).post(`/api/v1/cohorts/${cohortId}/members`).set('Authorization', `Bearer ${admin}`).send({ userId: user.id });

    const before = (await assignmentsOf(user.id, ctxId)).filter((a) => a.roleId === studentRole);
    expect(before.map((a) => a.itemId).sort()).toEqual([manual.id, cohortInstance.id].sort());

    await http(app).delete(`/api/v1/cohorts/${cohortId}/members/${user.id}`).set('Authorization', `Bearer ${admin}`);
    const after = (await assignmentsOf(user.id, ctxId)).filter((a) => a.roleId === studentRole);
    expect(after).toHaveLength(1);
    expect(after[0]!.itemId).toBe(manual.id);

    const userLogin = await login(app, user.username, STRONG_PASSWORD);
    const mine = await http(app).get(`/api/v1/courses/${course.id}/enrolments/me`).set('Authorization', `Bearer ${userLogin.accessToken}`);
    expect(mine.body).toMatchObject({ enrolled: true, active: true });
    expect(await hasCapability(app, admin, user.id, 'course:view', ctxId)).toBe(true);
  });

  it('API assignments của admin không thể xoá gán do enrol quản lý, nhưng gán thủ công xoá bình thường', async () => {
    const { course, ctxId } = await setupCourse();
    const instance = await createEnrolInstance(app, admin, course.id, { method: 'manual' });
    const user = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, instance.id, user.id);

    const rows = await assignmentsOf(user.id, ctxId);
    const enrolRow = rows.find((a) => a.roleId === studentRole)!;
    expect(enrolRow.component).toBe('enrol');
    expect(enrolRow.itemId).toBe(instance.id);

    const blocked = await http(app).delete(`/api/v1/access/assignments/${enrolRow.id}`).set('Authorization', `Bearer ${admin}`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe('access.assignment_enrol_managed');
    expect((await assignmentsOf(user.id, ctxId)).some((a) => a.id === enrolRow.id)).toBe(true);

    const manualRole = await createRoleViaApi(app, admin);
    await assignRole(app, admin, user.id, manualRole, ctxId);
    const manualRow = (await assignmentsOf(user.id, ctxId)).find((a) => a.roleId === manualRole)!;
    expect(manualRow.component).toBe('');
    expect(manualRow.itemId).toBeNull();
    const ok = await http(app).delete(`/api/v1/access/assignments/${manualRow.id}`).set('Authorization', `Bearer ${admin}`);
    expect(ok.status).toBe(200);
    expect((await assignmentsOf(user.id, ctxId)).some((a) => a.id === manualRow.id)).toBe(false);
  });

  it('gán thủ công cùng vai trò sống sót sau unenrol: unenrol chỉ xoá dòng instance của chính nó', async () => {
    const { course, ctxId } = await setupCourse();
    const instance = await createEnrolInstance(app, admin, course.id, { method: 'manual' });
    const user = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, instance.id, user.id);
    await assignRole(app, admin, user.id, studentRole, ctxId);

    const before = (await assignmentsOf(user.id, ctxId)).filter((a) => a.roleId === studentRole);
    expect(before).toHaveLength(2);
    expect(before.filter((a) => a.component === 'enrol')).toHaveLength(1);
    expect(before.filter((a) => a.component === '')).toHaveLength(1);

    await http(app).delete(`/api/v1/courses/${course.id}/enrol/instances/${instance.id}/users/${user.id}`)
      .set('Authorization', `Bearer ${admin}`);
    const after = (await assignmentsOf(user.id, ctxId)).filter((a) => a.roleId === studentRole);
    expect(after).toHaveLength(1);
    expect(after[0]!.component).toBe('');
    expect(after[0]!.itemId).toBeNull();
    expect(await hasCapability(app, admin, user.id, 'course:view', ctxId)).toBe(true);
  });
});
