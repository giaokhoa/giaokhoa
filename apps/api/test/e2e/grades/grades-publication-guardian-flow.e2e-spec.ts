import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorkerRelayDriver, flushWorkerRelay } from '../../support/worker-relay-driver';
import { adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD } from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';
import { createGradeItem, getGradebook, setGrade } from '../../support/assessment-helpers';

describe('PH-0: công bố điểm theo bài + liên kết giám hộ + audit (issue #116, #224)', () => {
  let app: INestApplication;
  let admin: string;
  let catId: string;

  interface ActivityGrade {
    item: { id: string };
    grade: { finalGrade: number | null; feedback: string | null } | null;
    publication: { policy: string; published: boolean };
  }
  interface GuardianBook { courseId: string; userId: string; activities: ActivityGrade[] }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    catId = (await createCategory(app, admin)).id;
  }, 120000);
  afterAll(async () => { await closeWorkerRelayDriver(); await app.close(); });

  async function courseWithPeople() {
    const course = await createCourse(app, admin, catId);
    const instance = await createEnrolInstance(app, admin, course.id);
    const student = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, instance.id, student.id);
    const contexts = await http(app).get('/api/v1/access/contexts').set('Authorization', `Bearer ${admin}`);
    const courseCtx = (contexts.body as { id: string; contextLevel: number; instanceId: string }[])
      .find((c) => c.contextLevel === 50 && c.instanceId === course.id)!;
    const teacherUser = await createUserViaApi(app, admin);
    await assignRole(app, admin, teacherUser.id, await roleIdByShortname(app, admin, 'editingteacher'), courseCtx.id);
    const teacher = (await login(app, teacherUser.username, STRONG_PASSWORD)).accessToken;
    const studentToken = (await login(app, student.username, STRONG_PASSWORD)).accessToken;
    return { course, student, studentToken, teacher, teacherUser };
  }

  async function flushRelay() {
    await flushWorkerRelay();
  }

  async function queryLogs(query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString();
    const res = await http(app).get(`/api/v1/event-logs?${qs}`).set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    return res.body as { items: { eventType: string; userId: string | null; relatedUserId: string | null; payload: Record<string, unknown> | null }[] };
  }

  it('công bố theo hoạt động: policy manual ẩn điểm phía học sinh cho tới khi GV công bố; rút công bố thì mất lại', async () => {
    const { course, student, studentToken, teacher } = await courseWithPeople();
    const item = await createGradeItem(app, admin, course.id, { itemName: 'Kiểm tra 15 phút', gradeMax: 10 });
    await setGrade(app, admin, item.id, student.id, 8, 'Làm tốt');

    let mine = (await getGradebook(app, studentToken, course.id)).activities;
    let leaf = mine.find((g) => g.item.id === item.id);
    expect(leaf?.grade?.finalGrade).toBe(8);
    expect(leaf?.publication).toEqual({ policy: 'auto', published: true });

    const selfPolicy = await http(app).put(`/api/v1/grade-items/${item.id}/posting-policy`)
      .set('Authorization', `Bearer ${studentToken}`).send({ policy: 'manual' });
    expect(selfPolicy.status).toBe(403);
    const selfPublish = await http(app).post(`/api/v1/grade-items/${item.id}/publish`)
      .set('Authorization', `Bearer ${studentToken}`).send({});
    expect(selfPublish.status).toBe(403);

    const setPolicy = await http(app).put(`/api/v1/grade-items/${item.id}/posting-policy`)
      .set('Authorization', `Bearer ${teacher}`).send({ policy: 'manual' });
    expect(setPolicy.status).toBe(200);
    mine = (await getGradebook(app, studentToken, course.id)).activities;
    leaf = mine.find((g) => g.item.id === item.id);
    expect(leaf?.grade).toBeNull();
    expect(leaf?.publication).toEqual({ policy: 'manual', published: false });

    const teacherBook = (await getGradebook(app, teacher, course.id, student.id)).activities;
    expect(teacherBook.find((g) => g.item.id === item.id)?.grade?.finalGrade).toBe(8);

    const pub = await http(app).post(`/api/v1/grade-items/${item.id}/publish`)
      .set('Authorization', `Bearer ${teacher}`).send({});
    expect(pub.status).toBe(201);
    expect(pub.body.published).toBe(true);
    mine = (await getGradebook(app, studentToken, course.id)).activities;
    leaf = mine.find((g) => g.item.id === item.id);
    expect(leaf?.grade?.finalGrade).toBe(8);
    expect(leaf?.grade?.feedback).toBe('Làm tốt');

    const unpub = await http(app).post(`/api/v1/grade-items/${item.id}/unpublish`)
      .set('Authorization', `Bearer ${teacher}`).send({});
    expect(unpub.status).toBe(201);
    expect(unpub.body.published).toBe(false);
    mine = (await getGradebook(app, studentToken, course.id)).activities;
    expect(mine.find((g) => g.item.id === item.id)?.grade).toBeNull();

    const repub = await http(app).post(`/api/v1/grade-items/${item.id}/publish`)
      .set('Authorization', `Bearer ${teacher}`).send({});
    expect(repub.status).toBe(201);
    await setGrade(app, teacher, item.id, student.id, 9);
    await flushRelay();
    const publishLogs = await queryLogs({ eventType: 'grade_item_published', courseId: course.id });
    expect(publishLogs.items.some((i) => i.payload?.itemId === item.id)).toBe(true);
    const changedLogs = await queryLogs({ eventType: 'grade_changed_after_publish', courseId: course.id });
    const changed = changedLogs.items.find((i) => i.payload?.itemId === item.id);
    expect(changed).toBeDefined();
    expect(changed!.relatedUserId).toBe(student.id);
  }, 120000);

  it('liên kết giám hộ: trường xác lập, phụ huynh chỉ đọc điểm đã công bố của đúng con mình, mọi lần xem có audit', async () => {
    const { course, student, teacher } = await courseWithPeople();
    const guardian = await createUserViaApi(app, admin);
    const guardianToken = (await login(app, guardian.username, STRONG_PASSWORD)).accessToken;
    const stranger = await createUserViaApi(app, admin);
    const strangerToken = (await login(app, stranger.username, STRONG_PASSWORD)).accessToken;
    const studentToken = (await login(app, student.username, STRONG_PASSWORD)).accessToken;

    const autoItem = await createGradeItem(app, admin, course.id, { itemName: 'Luyện tập', gradeMax: 10 });
    const manualItem = await createGradeItem(app, admin, course.id, { itemName: 'Kiểm tra định kỳ', gradeMax: 10 });
    await setGrade(app, admin, autoItem.id, student.id, 7);
    await setGrade(app, admin, manualItem.id, student.id, 5);
    await http(app).put(`/api/v1/grade-items/${manualItem.id}/posting-policy`)
      .set('Authorization', `Bearer ${teacher}`).send({ policy: 'manual' });

    const noLink = await http(app).get(`/api/v1/guardian/students/${student.id}/gradebooks/${course.id}`)
      .set('Authorization', `Bearer ${guardianToken}`);
    expect(noLink.status).toBe(403);
    expect(noLink.body.code).toBe('guardian.no_active_link');

    const byGuardian = await http(app).post('/api/v1/guardian-links').set('Authorization', `Bearer ${guardianToken}`)
      .send({ guardianUserId: guardian.id, studentUserId: student.id, relationship: 'Cha' });
    expect(byGuardian.status).toBe(403);
    const byStudent = await http(app).post('/api/v1/guardian-links').set('Authorization', `Bearer ${studentToken}`)
      .send({ guardianUserId: guardian.id, studentUserId: student.id, relationship: 'Cha' });
    expect(byStudent.status).toBe(403);

    const created = await http(app).post('/api/v1/guardian-links').set('Authorization', `Bearer ${teacher}`)
      .send({ guardianUserId: guardian.id, studentUserId: student.id, relationship: 'Cha' });
    expect(created.status).toBe(201);
    const linkId = (created.body as { id: string }).id;
    const dup = await http(app).post('/api/v1/guardian-links').set('Authorization', `Bearer ${teacher}`)
      .send({ guardianUserId: guardian.id, studentUserId: student.id, relationship: 'Cha' });
    expect(dup.status).toBe(409);

    const myStudents = await http(app).get('/api/v1/guardian-links/mine/students').set('Authorization', `Bearer ${guardianToken}`);
    expect(myStudents.status).toBe(200);
    expect((myStudents.body as { student: { id: string } }[]).map((x) => x.student.id)).toContain(student.id);
    const myGuardians = await http(app).get('/api/v1/guardian-links/mine/guardians').set('Authorization', `Bearer ${studentToken}`);
    expect((myGuardians.body as { guardianUserId: string }[]).map((x) => x.guardianUserId)).toContain(guardian.id);

    const gBook = await http(app).get(`/api/v1/guardian/students/${student.id}/gradebooks/${course.id}`)
      .set('Authorization', `Bearer ${guardianToken}`);
    expect(gBook.status).toBe(200);
    const gGrades = (gBook.body as GuardianBook).activities;
    expect(gGrades.find((g) => g.item.id === autoItem.id)?.grade?.finalGrade).toBe(7);
    expect(gGrades.find((g) => g.item.id === manualItem.id)?.grade).toBeNull();

    const aliasBook = await http(app).get(`/api/v1/guardian/students/${student.id}/courses/${course.id}/gradebook`)
      .set('Authorization', `Bearer ${guardianToken}`);
    expect(aliasBook.status).toBe(200);
    expect(aliasBook.headers['deprecation']).toBe('true');
    expect(aliasBook.headers['sunset']).toContain('2027');

    const strangerRes = await http(app).get(`/api/v1/guardian/students/${student.id}/gradebooks/${course.id}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(strangerRes.status).toBe(403);

    await flushRelay();
    const linkLogs = await queryLogs({ eventType: 'guardian_link_created', relatedUserId: student.id });
    expect(linkLogs.items.some((i) => i.payload?.guardianUserId === guardian.id)).toBe(true);
    const viewLogs = await queryLogs({ eventType: 'guardian_student_results_viewed', relatedUserId: student.id });
    expect(viewLogs.items.some((i) => i.userId === guardian.id)).toBe(true);

    const revoked = await http(app).delete(`/api/v1/guardian-links/${linkId}`).set('Authorization', `Bearer ${teacher}`);
    expect(revoked.status).toBe(200);
    expect((revoked.body as { status: string }).status).toBe('revoked');
    const afterRevoke = await http(app).get(`/api/v1/guardian/students/${student.id}/gradebooks/${course.id}`)
      .set('Authorization', `Bearer ${guardianToken}`);
    expect(afterRevoke.status).toBe(403);
    const recreated = await http(app).post('/api/v1/guardian-links').set('Authorization', `Bearer ${teacher}`)
      .send({ guardianUserId: guardian.id, studentUserId: student.id, relationship: 'Cha' });
    expect(recreated.status).toBe(201);

    await flushRelay();
    const revokeLogs = await queryLogs({ eventType: 'guardian_link_revoked', relatedUserId: student.id });
    expect(revokeLogs.items.some((i) => i.payload?.guardianUserId === guardian.id)).toBe(true);
  }, 120000);
});
