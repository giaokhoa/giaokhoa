import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorkerRelayDriver, flushWorkerRelay } from '../../support/worker-relay-driver';
import { adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD } from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser, getFirstSectionId } from '../../support/course-enrolment-helpers';
import { addExamSlot, createExamDraft, pinExam } from '../../support/exam-pin-helpers';
import { createGradeItem, setGrade } from '../../support/assessment-helpers';

describe('PH-1: bề mặt phụ huynh chỉ-xem (issue #130)', () => {
  let app: INestApplication;
  let admin: string;
  let catId: string;
  let pg: Client;

  interface Overview {
    student: { id: string; firstName: string; lastName: string };
    generatedAt: string;
    previousSeenAt: string | null;
    weekly: {
      weekStart: string; weekEnd: string;
      dueThisWeek: number; submitted: number; notSubmitted: number; overdue: number;
      items: { courseId: string; cmId: string; kind: string; name: string; dueAt: string; status: string }[];
    };
    newResults: { courseId: string; kind: string; itemId: string | null; finalGrade: number | null; feedback: string | null }[];
    announcements: { id: string; courseId: string; subject: string; body: string }[];
    courseProgress: { courseId: string; total: number; completed: number; percent: number | null }[];
  }
  interface Results {
    student: { id: string };
    courses: {
      courseId: string;
      activities: { itemId: string; itemName: string; finalGrade: number | null; gradeMax: number; feedback: string | null }[];
    }[];
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    catId = (await createCategory(app, admin)).id;
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
  }, 120000);
  afterAll(async () => { await closeWorkerRelayDriver(); await pg.end(); await app.close(); });

  async function courseWithPeople() {
    const course = await createCourse(app, admin, catId);
    const sectionId = await getFirstSectionId(app, admin, course.id);
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
    return { course, sectionId, student, studentToken, teacher };
  }

  async function freshGuardian() {
    const user = await createUserViaApi(app, admin);
    const token = (await login(app, user.username, STRONG_PASSWORD)).accessToken;
    return { user, token };
  }

  async function link(teacher: string, guardianId: string, studentId: string): Promise<string> {
    const res = await http(app).post('/api/v1/guardian-links').set('Authorization', `Bearer ${teacher}`)
      .send({ guardianUserId: guardianId, studentUserId: studentId, relationship: 'Cha' });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  async function overview(token: string, studentId: string) {
    return http(app).get(`/api/v1/guardian/students/${studentId}/overview`).set('Authorization', `Bearer ${token}`);
  }
  async function results(token: string, studentId: string) {
    return http(app).get(`/api/v1/guardian/students/${studentId}/results`).set('Authorization', `Bearer ${token}`);
  }

  async function createQuiz(courseId: string, sectionId: string, teacher: string, overrides: Record<string, unknown>) {
    const contexts = await http(app).get('/api/v1/access/contexts').set('Authorization', `Bearer ${admin}`);
    const courseCtx = (contexts.body as { id: string; contextLevel: number; instanceId: string }[])
      .find((c) => c.contextLevel === 50 && c.instanceId === courseId)!;
    const bankRes = await http(app).post('/api/v1/questions/categories').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'PH1 bank', contextId: courseCtx.id });
    const qRes = await http(app).post('/api/v1/questions').set('Authorization', `Bearer ${admin}`).send({
      categoryId: bankRes.body.id,
      qtype: 'multichoice', questionText: 'Capital of France?', defaultMark: 1,
      answers: [{ text: 'Paris', correct: true }, { text: 'London', correct: false }, { text: 'Đáp án khác 1', correct: false }, { text: 'Đáp án khác 2', correct: false }],
    });
    const draft = await createExamDraft(app, teacher, 'Quiz PH1');
    await addExamSlot(app, teacher, draft, { questionId: qRes.body.question.id });
    const pin = await pinExam(app, teacher, courseId, draft, { sectionId, ...overrides });
    return pin as unknown as { id: string; cmId: string };
  }

  async function createAssignment(courseId: string, sectionId: string, teacher: string, overrides: Record<string, unknown>) {
    const res = await http(app).post(`/api/v1/courses/${courseId}/assignments`).set('Authorization', `Bearer ${teacher}`)
      .send({ sectionId, name: 'Bài nộp PH1', grade: 10, ...overrides });
    expect([200, 201]).toContain(res.status);
    return res.body as { id: string; cmId: string };
  }

  async function submitAssignment(token: string, assignmentId: string): Promise<void> {
    const up = await http(app).post(`/api/v1/assignments/${assignmentId}/submission/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('anh-bai-lam'), 'bai-lam.jpg');
    expect(up.status).toBe(201);
    const sub = await http(app).post(`/api/v1/assignments/${assignmentId}/submission/submit`).set('Authorization', `Bearer ${token}`);
    expect(sub.status).toBe(201);
  }

  function weekBounds(now: Date): { start: Date; end: Date } {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    return { start, end: new Date(start.getTime() + 7 * 86_400_000 - 1) };
  }

  async function flushRelay() {
    await flushWorkerRelay();
  }

  it('tổng quan 4 khối: tuần (đã nộp/chưa nộp/quá hạn), thông báo lớp (loại thông báo điểm), tiến độ, kết quả mới theo mốc xem của PH', async () => {
    const { course, sectionId, student, studentToken, teacher } = await courseWithPeople();
    const { user: guardian, token: guardianToken } = await freshGuardian();
    await link(teacher, guardian.id, student.id);

    const now = new Date();
    const { start, end } = weekBounds(now);
    const inWeek = (d: Date) => d >= start && d <= end;
    const quizDue = new Date(end.getTime() - 3_600_000);
    const overdueDue = new Date(now.getTime() - 2 * 3_600_000);
    const submittedDue = new Date(now.getTime() + 3 * 3_600_000);
    const quiz = await createQuiz(course.id, sectionId, teacher, { timeClose: quizDue.toISOString() });
    const overdueAssign = await createAssignment(course.id, sectionId, teacher, { dueDate: overdueDue.toISOString() });
    const submittedAssign = await createAssignment(course.id, sectionId, teacher, { name: 'Bài đã nộp', dueDate: submittedDue.toISOString() });
    await submitAssignment(studentToken, submittedAssign.id);

    interface Fx { cmId: string; due: Date; submitted: boolean }
    const fixtures: Fx[] = [
      { cmId: quiz.cmId, due: quizDue, submitted: false },
      { cmId: overdueAssign.cmId, due: overdueDue, submitted: false },
      { cmId: submittedAssign.cmId, due: submittedDue, submitted: true },
    ];
    const statusOf = (f: Fx) => (f.submitted ? 'submitted' : f.due < now ? 'overdue' : 'not_submitted');
    const expected = {
      dueThisWeek: fixtures.filter((f) => inWeek(f.due)).length,
      submitted: fixtures.filter((f) => inWeek(f.due) && statusOf(f) === 'submitted').length,
      notSubmitted: fixtures.filter((f) => inWeek(f.due) && statusOf(f) === 'not_submitted').length,
      overdue: fixtures.filter((f) => statusOf(f) === 'overdue').length,
    };

    const seedNotif = async (subject: string, eventType: string, contextUrl: string | null) => {
      await pg.query(
        `insert into notifications (user_id_from, user_id_to, subject, full_message, small_message, component, event_type, context_url, context_url_name, created_at, time_read)
         values (null, $1, $2, $3, $3, 'core_course', $4, $5, null, now(), null)`,
        [student.id, subject, `Nội dung ${subject}`, eventType, contextUrl],
      );
    };
    await seedNotif('Thông báo lớp PH1', 'announcement', `/courses/${course.id}`);
    await seedNotif('Điểm mới PH1', 'grade_updated', `/courses/${course.id}/grades`);
    const other = await courseWithPeople();
    await seedNotif('Thông báo khoá khác', 'announcement', `/courses/${other.course.id}`);

    await pg.query('update course_modules set completion = case when id = $1 then 1 else 0 end where course = $2', [quiz.cmId, course.id]);
    await pg.query(
      'insert into course_modules_completion (course_module_id, user_id, completion_state) values ($1, $2, 1)',
      [quiz.cmId, student.id],
    );

    const manualItem = await createGradeItem(app, admin, course.id, { itemName: 'Điểm manual PH1', gradeMax: 10 });
    await setGrade(app, admin, manualItem.id, student.id, 6, 'Bí mật chưa công bố');
    const policy = await http(app).put(`/api/v1/grade-items/${manualItem.id}/posting-policy`)
      .set('Authorization', `Bearer ${teacher}`).send({ policy: 'manual' });
    expect(policy.status).toBe(200);

    const first = await overview(guardianToken, student.id);
    expect(first.status).toBe(200);
    const firstBody = first.body as Overview;
    expect(firstBody.student.id).toBe(student.id);
    expect(firstBody.previousSeenAt).toBeNull();
    expect(firstBody.newResults).toEqual([]);

    expect(firstBody.weekly).toMatchObject(expected);
    for (const f of fixtures) {
      const listed = firstBody.weekly.items.find((i) => i.cmId === f.cmId);
      if (inWeek(f.due) || statusOf(f) === 'overdue') {
        expect(listed?.status).toBe(statusOf(f));
      } else {
        expect(listed).toBeUndefined();
      }
    }

    expect(firstBody.announcements.map((a) => a.subject)).toContain('Thông báo lớp PH1');
    expect(JSON.stringify(firstBody)).not.toContain('Điểm mới PH1');
    expect(JSON.stringify(firstBody)).not.toContain('Thông báo khoá khác');

    const prog = firstBody.courseProgress.find((p) => p.courseId === course.id);
    expect(prog).toMatchObject({ total: 1, completed: 1, percent: 100 });

    expect(JSON.stringify(firstBody)).not.toContain(manualItem.id);
    expect(JSON.stringify(firstBody)).not.toContain('Bí mật chưa công bố');

    const autoItem = await createGradeItem(app, admin, course.id, { itemName: 'Điểm auto PH1', gradeMax: 10 });
    await setGrade(app, teacher, autoItem.id, student.id, 7);
    const publish = await http(app).post(`/api/v1/grade-items/${manualItem.id}/publish`)
      .set('Authorization', `Bearer ${teacher}`).send({});
    expect([200, 201]).toContain(publish.status);
    const second = await overview(guardianToken, student.id);
    const secondBody = second.body as Overview;
    expect(secondBody.previousSeenAt).not.toBeNull();
    expect(new Set(secondBody.newResults.map((r) => r.itemId))).toEqual(new Set([manualItem.id, autoItem.id]));

    const third = await overview(guardianToken, student.id);
    expect((third.body as Overview).newResults).toEqual([]);
  }, 180000);

  it('kết quả theo bài: PH chỉ thấy điểm của các bài ĐÃ CÔNG BỐ (không kỳ/năm, không điểm tổng)', async () => {
    const { course, student, teacher } = await courseWithPeople();
    const { user: guardian, token: guardianToken } = await freshGuardian();
    await link(teacher, guardian.id, student.id);

    const autoItem = await createGradeItem(app, admin, course.id, { itemName: 'Kiểm tra 15 phút PH1', gradeMax: 10 });
    await setGrade(app, teacher, autoItem.id, student.id, 8);
    const manualItem = await createGradeItem(app, admin, course.id, { itemName: 'Bài chưa công bố PH1', gradeMax: 10 });
    await setGrade(app, teacher, manualItem.id, student.id, 5);
    const policy = await http(app).put(`/api/v1/grade-items/${manualItem.id}/posting-policy`)
      .set('Authorization', `Bearer ${teacher}`).send({ policy: 'manual' });
    expect(policy.status).toBe(200);

    const res1 = await results(guardianToken, student.id);
    expect(res1.status).toBe(200);
    const body1 = res1.body as Results;
    const courseView = body1.courses.find((c) => c.courseId === course.id)!;
    expect(courseView.activities).toHaveLength(1);
    expect(courseView.activities[0]).toMatchObject({ itemId: autoItem.id, itemName: 'Kiểm tra 15 phút PH1', finalGrade: 8 });
    expect(JSON.stringify(body1)).not.toContain('Bài chưa công bố PH1');
    expect(JSON.stringify(body1)).not.toContain(manualItem.id);

    const pubItem = await http(app).post(`/api/v1/grade-items/${manualItem.id}/publish`)
      .set('Authorization', `Bearer ${teacher}`).send({});
    expect([200, 201]).toContain(pubItem.status);
    const res2 = await results(guardianToken, student.id);
    const courseView2 = (res2.body as Results).courses.find((c) => c.courseId === course.id)!;
    expect(new Set(courseView2.activities.map((a) => a.itemId))).toEqual(new Set([autoItem.id, manualItem.id]));
  }, 180000);

  it('cổng chỉ con mình: PH khác/người lạ/học sinh tự gọi → 404 đồng nhất; đường ghi → 404; thu hồi liên kết → mất quyền ngay; audit đủ', async () => {
    const mine = await courseWithPeople();
    const other = await courseWithPeople();
    const { user: guardian, token: guardianToken } = await freshGuardian();
    const linkId = await link(mine.teacher, guardian.id, mine.student.id);
    const { user: guardian2, token: guardian2Token } = await freshGuardian();
    await link(other.teacher, guardian2.id, other.student.id);

    for (const res of [await overview(guardian2Token, mine.student.id), await results(guardian2Token, mine.student.id)]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('guardian.student_not_found');
    }
    const stranger = await freshGuardian();
    expect((await overview(stranger.token, mine.student.id)).status).toBe(404);
    expect((await overview(mine.studentToken, mine.student.id)).status).toBe(404);
    const ghost = await overview(guardianToken, '01900000-0000-7000-8000-00000000dead');
    expect(ghost.status).toBe(404);
    expect(ghost.body.code).toBe('guardian.student_not_found');
    const anon = await http(app).get(`/api/v1/guardian/students/${mine.student.id}/overview`);
    expect(anon.status).toBe(401);

    const post = await http(app).post(`/api/v1/guardian/students/${mine.student.id}/overview`)
      .set('Authorization', `Bearer ${guardianToken}`).send({});
    expect(post.status).toBe(404);
    const del = await http(app).delete(`/api/v1/guardian/students/${mine.student.id}/results`)
      .set('Authorization', `Bearer ${guardianToken}`);
    expect(del.status).toBe(404);

    expect((await overview(guardianToken, mine.student.id)).status).toBe(200);
    expect((await results(guardianToken, mine.student.id)).status).toBe(200);
    await flushRelay();
    const logs = await http(app).get(`/api/v1/event-logs?eventType=guardian_student_results_viewed&relatedUserId=${mine.student.id}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(logs.status).toBe(200);
    const items = (logs.body as { items: { userId: string | null; payload: { surface?: string } | null }[] }).items
      .filter((i) => i.userId === guardian.id);
    expect(items.some((i) => i.payload?.surface === 'ph1_overview')).toBe(true);
    expect(items.some((i) => i.payload?.surface === 'ph1_results')).toBe(true);

    const revoked = await http(app).delete(`/api/v1/guardian-links/${linkId}`).set('Authorization', `Bearer ${mine.teacher}`);
    expect(revoked.status).toBe(200);
    expect((await overview(guardianToken, mine.student.id)).status).toBe(404);
    expect((await results(guardianToken, mine.student.id)).status).toBe(404);
  }, 180000);

  it('PH nhiều con: dữ liệu từng con tách bạch, không chảy chéo', async () => {
    const a = await courseWithPeople();
    const b = await courseWithPeople();
    const { user: guardian, token: guardianToken } = await freshGuardian();
    await link(a.teacher, guardian.id, a.student.id);
    await link(b.teacher, guardian.id, b.student.id);

    const itemA = await createGradeItem(app, admin, a.course.id, { itemName: 'Điểm của con A', gradeMax: 10 });
    await setGrade(app, admin, itemA.id, a.student.id, 10);

    const myStudents = await http(app).get('/api/v1/guardian-links/mine/students').set('Authorization', `Bearer ${guardianToken}`);
    expect(myStudents.status).toBe(200);
    expect((myStudents.body as { student: { id: string } }[]).map((x) => x.student.id).sort())
      .toEqual([a.student.id, b.student.id].sort());

    expect((await overview(guardianToken, a.student.id)).status).toBe(200);
    const itemA2 = await createGradeItem(app, admin, a.course.id, { itemName: 'Điểm mới của con A', gradeMax: 10 });
    await setGrade(app, admin, itemA2.id, a.student.id, 9);
    const viewA = await overview(guardianToken, a.student.id);
    const newA = (viewA.body as Overview).newResults;
    expect(newA.map((r) => r.itemId)).toContain(itemA2.id);
    expect(newA.every((r) => r.courseId === a.course.id)).toBe(true);

    const viewB = await overview(guardianToken, b.student.id);
    expect(viewB.status).toBe(200);
    expect((viewB.body as Overview).newResults).toEqual([]);
    expect(JSON.stringify(viewB.body)).not.toContain(a.course.id);
    expect(JSON.stringify(viewB.body)).not.toContain(itemA2.id);
    const resultsB = await results(guardianToken, b.student.id);
    expect((resultsB.body as Results).courses.map((c) => c.courseId)).toEqual([b.course.id]);
  }, 180000);
});
