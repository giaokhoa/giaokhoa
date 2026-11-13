import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleSeparationService } from '../../../src/modules/access/role-separation.service';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, hasCapability, http, login,
  roleIdByShortname, STRONG_PASSWORD,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';

describe('Tách vai trò theo ngữ cảnh (#425)', () => {
  let app: INestApplication;
  let pg: Client;
  let admin: string;
  let categoryId: string;
  let studentRoleId: string;
  let editingTeacherRoleId: string;
  let teacherRoleId: string;

  let ownCourseTeacherId: string;
  let crossCourseTeacherId: string;
  let classOwnerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    admin = await adminToken(app);
    categoryId = (await createCategory(app, admin)).id;
    studentRoleId = await roleIdByShortname(app, admin, 'student');
    editingTeacherRoleId = await roleIdByShortname(app, admin, 'editingteacher');
    teacherRoleId = await roleIdByShortname(app, admin, 'teacher');
  });
  afterAll(async () => {
    await pg.end();
    await app.close();
  });

  async function courseContextId(courseId: string): Promise<string> {
    const content = await http(app).get(`/api/v1/courses/${courseId}/content`).set('Authorization', `Bearer ${admin}`);
    expect(content.status).toBe(200);
    return content.body.contextId as string;
  }

  async function contextIdByLevelInstance(level: number, instanceId: string): Promise<string> {
    const rows = await pg.query<{ id: string }>(
      'select id from context where context_level = $1 and instance_id = $2',
      [level, instanceId],
    );
    if (!rows.rows[0]) throw new Error(`context not found for level ${level} instance ${instanceId}`);
    return rows.rows[0].id;
  }

  interface AssignmentRow { id: string; roleId: string; component: string; itemId: string | null }

  async function assignmentsOf(userId: string, contextId: string): Promise<AssignmentRow[]> {
    const res = await http(app).get('/api/v1/access/assignments')
      .query({ userId, contextId }).set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    return res.body.assignments as AssignmentRow[];
  }

  async function enrolmentCount(courseId: string, userId: string): Promise<number> {
    const rows = await pg.query<{ n: string }>(
      `select count(*)::text as n from user_enrolments ue join enrol e on e.id = ue.enrol_id
        where e.course_id = $1 and ue.user_id = $2`,
      [courseId, userId],
    );
    return Number(rows.rows[0]!.n);
  }

  it('phễu 1: ghi danh thủ công giáo viên vào chính khoá của họ bị từ chối và không để lại ghi danh hay vai học viên', async () => {
    const teacher = await createUserViaApi(app, admin);
    ownCourseTeacherId = teacher.id;
    const course = await createCourse(app, admin, categoryId);
    const ctxId = await courseContextId(course.id);
    await assignRole(app, admin, teacher.id, editingTeacherRoleId, ctxId);
    const instance = await createEnrolInstance(app, admin, course.id, { method: 'manual' });

    const blocked = await http(app)
      .post(`/api/v1/courses/${course.id}/enrol/instances/${instance.id}/enrol`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ userId: teacher.id });
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe('access.role_context_conflict');

    expect(await enrolmentCount(course.id, teacher.id)).toBe(0);
    const rows = await assignmentsOf(teacher.id, ctxId);
    expect(rows.filter((a) => a.roleId === studentRoleId)).toHaveLength(0);

    const teacherLogin = await login(app, teacher.username, STRONG_PASSWORD);
    const mine = await http(app).get(`/api/v1/courses/${course.id}/enrolments/me`)
      .set('Authorization', `Bearer ${teacherLogin.accessToken}`);
    expect(mine.body).toMatchObject({ enrolled: false, active: false });
  });

  it('phễu 2: thêm chủ lớp vào chính danh sách của họ qua email bị từ chối; học viên thường vẫn được thêm', async () => {
    const owner = await createUserViaApi(app, admin);
    classOwnerId = owner.id;
    const ownerLogin = await login(app, owner.username, STRONG_PASSWORD);
    const ownerToken = ownerLogin.accessToken;

    const current = await http(app).get('/api/v1/tenants/current').set('Authorization', `Bearer ${admin}`);
    const tenantId = current.body.id as string;
    await http(app).post(`/api/v1/tenants/${tenantId}/members`).set('Authorization', `Bearer ${admin}`).send({ userId: owner.id });
    const tenantCtxId = await contextIdByLevelInstance(20, tenantId);
    await assignRole(app, admin, owner.id, editingTeacherRoleId, tenantCtxId);

    const cls = await http(app).post('/api/v1/classes').set('Authorization', `Bearer ${ownerToken}`).send({ name: `Role separation class ${Date.now().toString(36)}` });
    expect(cls.status).toBe(201);
    const classId = cls.body.id as string;
    const course = await http(app).post('/api/v1/courses').set('Authorization', `Bearer ${ownerToken}`).send({
      fullName: 'Course in owner class', shortName: `rs${Date.now().toString(36)}`, category: categoryId, classId,
    });
    expect(course.status).toBe(201);
    const courseId = course.body.id as string;

    const blocked = await http(app).post(`/api/v1/classes/${classId}/roster/identity`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ fullName: 'Class Owner', email: owner.email });
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe('access.role_context_conflict');

    const cohort = await pg.query<{ cohort_id: string }>('select cohort_id from classes where id = $1', [classId]);
    const memberRows = await pg.query(
      'select 1 from cohort_members where cohort_id = $1 and user_id = $2',
      [cohort.rows[0]!.cohort_id, owner.id],
    );
    expect(memberRows.rowCount).toBe(0);
    expect(await enrolmentCount(courseId, owner.id)).toBe(0);

    const student = await createUserViaApi(app, admin);
    const added = await http(app).post(`/api/v1/classes/${classId}/roster/identity`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ fullName: 'Regular Student', email: student.email });
    expect(added.status).toBe(201);
    expect(added.body.outcome).toBe('matched');
    expect(added.body.userId).toBe(student.id);
    const studentMember = await pg.query(
      'select 1 from cohort_members where cohort_id = $1 and user_id = $2',
      [cohort.rows[0]!.cohort_id, student.id],
    );
    expect(studentMember.rowCount).toBe(1);
  });

  it('giáo viên vẫn có thể ghi danh làm học viên ở khoá không liên quan, và ở đó không có bề mặt giảng dạy', async () => {
    const teacher = await createUserViaApi(app, admin);
    crossCourseTeacherId = teacher.id;
    const taught = await createCourse(app, admin, categoryId);
    const taughtCtx = await courseContextId(taught.id);
    await assignRole(app, admin, teacher.id, editingTeacherRoleId, taughtCtx);

    const learned = await createCourse(app, admin, categoryId);
    const learnedCtx = await courseContextId(learned.id);
    const instance = await createEnrolInstance(app, admin, learned.id, { method: 'manual' });
    await enrolUser(app, admin, learned.id, instance.id, teacher.id);

    expect(await hasCapability(app, admin, teacher.id, 'grade:viewall', learnedCtx)).toBe(false);
    const teacherLogin = await login(app, teacher.username, STRONG_PASSWORD);
    const mine = await http(app).get(`/api/v1/courses/${learned.id}/enrolments/me`)
      .set('Authorization', `Bearer ${teacherLogin.accessToken}`);
    expect(mine.body).toMatchObject({ enrolled: true, active: true });
    const content = await http(app).get(`/api/v1/courses/${learned.id}/content`)
      .set('Authorization', `Bearer ${teacherLogin.accessToken}`);
    expect(content.status).toBe(200);
  });

  it('cổng ngược: gán vai trò giảng dạy ở ngữ cảnh khoá học hay lớp cho học viên đang hoạt động của khoá được bao phủ bị từ chối', async () => {
    const course = await createCourse(app, admin, categoryId);
    const ctxId = await courseContextId(course.id);
    const instance = await createEnrolInstance(app, admin, course.id, { method: 'manual' });
    const learner = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, instance.id, learner.id);

    const blockedCourse = await http(app).post('/api/v1/access/assignments')
      .set('Authorization', `Bearer ${admin}`)
      .send({ userId: learner.id, roleId: editingTeacherRoleId, contextId: ctxId });
    expect(blockedCourse.status).toBe(400);
    expect(blockedCourse.body.code).toBe('access.role_context_conflict');
    expect((await assignmentsOf(learner.id, ctxId)).filter((a) => a.roleId === editingTeacherRoleId)).toHaveLength(0);

    const cls = await http(app).post('/api/v1/classes').set('Authorization', `Bearer ${admin}`).send({ name: `Reverse gate class ${Date.now().toString(36)}` });
    expect(cls.status).toBe(201);
    const classId = cls.body.id as string;
    const classCourse = await createCourse(app, admin, categoryId, { classId });
    const classInstance = await createEnrolInstance(app, admin, classCourse.id, { method: 'manual' });
    const classLearner = await createUserViaApi(app, admin);
    await enrolUser(app, admin, classCourse.id, classInstance.id, classLearner.id);
    const classCtxId = await contextIdByLevelInstance(45, classId);
    const blockedClass = await http(app).post('/api/v1/access/assignments')
      .set('Authorization', `Bearer ${admin}`)
      .send({ userId: classLearner.id, roleId: teacherRoleId, contextId: classCtxId });
    expect(blockedClass.status).toBe(400);
    expect(blockedClass.body.code).toBe('access.role_context_conflict');

    const fresh = await createUserViaApi(app, admin);
    const ok = await http(app).post('/api/v1/access/assignments')
      .set('Authorization', `Bearer ${admin}`)
      .send({ userId: fresh.id, roleId: editingTeacherRoleId, contextId: ctxId });
    expect(ok.status).toBe(201);
  });

  it('phễu 3: restore bỏ qua ghi danh của người dạy khoá đích, khôi phục ghi danh hợp lệ, và ghi lại lần bỏ qua trong chi tiết bước', async () => {
    const source = await createCourse(app, admin, categoryId);
    const instance = await createEnrolInstance(app, admin, source.id, { method: 'manual' });
    const conflicting = await createUserViaApi(app, admin);
    const valid = await createUserViaApi(app, admin);
    await enrolUser(app, admin, source.id, instance.id, conflicting.id);
    await enrolUser(app, admin, source.id, instance.id, valid.id);

    const target = await createCourse(app, admin, categoryId);
    const targetCtx = await courseContextId(target.id);
    await assignRole(app, admin, conflicting.id, editingTeacherRoleId, targetCtx);

    const backup = await http(app).post('/api/v1/backup/jobs').set('Authorization', `Bearer ${admin}`).send({ courseId: source.id });
    expect(backup.status).toBeLessThan(300);
    expect(backup.body.status).toBe('completed');

    const restore = await http(app).post('/api/v1/backup/restore').set('Authorization', `Bearer ${admin}`)
      .send({ backupJobId: backup.body.id, mode: 'merge', targetCourseId: target.id });
    expect(restore.status).toBeLessThan(300);
    expect(restore.body.status).toBe('completed');

    const steps = await http(app).get(`/api/v1/backup/jobs/${restore.body.id}/steps`).set('Authorization', `Bearer ${admin}`);
    const enrolStep = (steps.body as { name: string; detail: { skippedRoleConflictEnrolments?: number } | null }[])
      .find((s) => s.name === 'enrol');
    expect(enrolStep).toBeDefined();
    expect(enrolStep!.detail?.skippedRoleConflictEnrolments).toBe(1);

    expect(await enrolmentCount(target.id, conflicting.id)).toBe(0);
    expect(await enrolmentCount(target.id, valid.id)).toBe(1);
    const validLogin = await login(app, valid.username, STRONG_PASSWORD);
    const mine = await http(app).get(`/api/v1/courses/${target.id}/enrolments/me`)
      .set('Authorization', `Bearer ${validLogin.accessToken}`);
    expect(mine.body).toMatchObject({ enrolled: true, active: true });
  });

  it('kích hoạt lại: kích hoạt lại ghi danh bị đình chỉ sau khi gán giảng dạy ở cùng khoá bị từ chối và ghi danh vẫn bị đình chỉ', async () => {
    const course = await createCourse(app, admin, categoryId);
    const instance = await createEnrolInstance(app, admin, course.id, { method: 'manual' });
    const learner = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, instance.id, learner.id);
    const suspend = await http(app)
      .post(`/api/v1/courses/${course.id}/enrol/instances/${instance.id}/users/${learner.id}/suspend`)
      .set('Authorization', `Bearer ${admin}`);
    expect(suspend.status).toBe(201);
    await assignRole(app, admin, learner.id, editingTeacherRoleId, await courseContextId(course.id));
    const reactivate = await http(app)
      .post(`/api/v1/courses/${course.id}/enrol/instances/${instance.id}/users/${learner.id}/reactivate`)
      .set('Authorization', `Bearer ${admin}`);
    expect(reactivate.status).toBe(400);
    expect(reactivate.body.code).toBe('access.role_context_conflict');
    const rows = await pg.query(
      'select status from user_enrolments where enrol_id = $1 and user_id = $2',
      [instance.id, learner.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.status).toBe(1);
  });

  it('kiểm toán: dữ liệu cùng-khoá sẵn có xếp loại vi phạm, khác-khoá xếp loại hợp lệ, và kiểm toán không ghi gì', async () => {
    const legacy = await createUserViaApi(app, admin);
    const course = await createCourse(app, admin, categoryId);
    const ctxId = await courseContextId(course.id);
    await assignRole(app, admin, legacy.id, editingTeacherRoleId, ctxId);
    const instance = await createEnrolInstance(app, admin, course.id, { method: 'manual' });
    await pg.query('insert into user_enrolments (enrol_id, user_id, status) values ($1, $2, 0)', [instance.id, legacy.id]);

    const service = app.get(RoleSeparationService, { strict: false });
    const countBefore = await pg.query<{ n: string }>(
      'select (select count(*) from user_enrolments) + (select count(*) from role_assignments) as n',
    );
    const report = await service.auditRoleConflicts();
    const countAfter = await pg.query<{ n: string }>(
      'select (select count(*) from user_enrolments) + (select count(*) from role_assignments) as n',
    );
    expect(countAfter.rows[0]!.n).toBe(countBefore.rows[0]!.n);

    const legacyEntry = report.sameCourse.find((e) => e.userId === legacy.id);
    expect(legacyEntry).toBeDefined();
    expect(legacyEntry!.conflictingCourseIds).toContain(course.id);
    expect(report.crossCourse.some((e) => e.userId === legacy.id)).toBe(false);

    expect(report.crossCourse.some((e) => e.userId === crossCourseTeacherId)).toBe(true);
    expect(report.sameCourse.some((e) => e.userId === crossCourseTeacherId)).toBe(false);
    expect(report.sameCourse.some((e) => e.userId === ownCourseTeacherId)).toBe(false);
    expect(report.crossCourse.some((e) => e.userId === ownCourseTeacherId)).toBe(false);
    expect(report.sameCourse.some((e) => e.userId === classOwnerId)).toBe(false);
    expect(report.crossCourse.some((e) => e.userId === classOwnerId)).toBe(false);
  });
});
