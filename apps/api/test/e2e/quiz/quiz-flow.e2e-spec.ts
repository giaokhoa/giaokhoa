import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD } from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser, getFirstSectionId } from '../../support/course-enrolment-helpers';
import { addExamSlot, createExamDraft, pinExam } from '../../support/exam-pin-helpers';
import { getGradebook } from '../../support/assessment-helpers';

describe('Hoạt động quiz (mod_quiz)', () => {
  const TF_ALL_TRUE = JSON.stringify({ s1: true, s2: true, s3: true, s4: true });
  const TF_ALL_FALSE = JSON.stringify({ s1: false, s2: false, s3: false, s4: false });

  let app: INestApplication;
  let admin: string;
  let pg: Client;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
  });
  afterAll(async () => { await pg.end(); await app.close(); });

  interface Ctx {
    course: { id: string };
    sectionId: string;
    teacher: string;
    teacherId: string;
    student: { id: string; username: string };
    studentToken: string;
    bankCatId: string;
    randomCatId: string;
    qRandom: string;
    qMc: string;
    qTf: string;
    qSa: string;
    qEssay: string;
  }

  async function setup(): Promise<Ctx> {
    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);
    const sectionId = await getFirstSectionId(app, admin, course.id);
    const instance = await createEnrolInstance(app, admin, course.id);
    const contexts = await http(app).get('/api/v1/access/contexts').set('Authorization', `Bearer ${admin}`);
    const courseCtx = (contexts.body as { id: string; contextLevel: number; instanceId: string }[])
      .find((c) => c.contextLevel === 50 && c.instanceId === course.id)!;
    const teacherUser = await createUserViaApi(app, admin);
    await assignRole(app, admin, teacherUser.id, await roleIdByShortname(app, admin, 'editingteacher'), courseCtx.id);
    const teacher = (await login(app, teacherUser.username, STRONG_PASSWORD)).accessToken;
    const student = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, instance.id, student.id);
    const studentToken = (await login(app, student.username, STRONG_PASSWORD)).accessToken;

    const bankRes = await http(app).post('/api/v1/questions/categories').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Quiz bank', contextId: courseCtx.id });
    const bankCatId = bankRes.body.id as string;
    const randomRes = await http(app).post('/api/v1/questions/categories').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Quiz random pool', contextId: courseCtx.id });
    const randomCatId = randomRes.body.id as string;

    async function makeQuestion(categoryId: string, body: Record<string, unknown>): Promise<string> {
      const res = await http(app).post('/api/v1/questions').set('Authorization', `Bearer ${admin}`).send({ categoryId, ...body });
      if (res.status !== 201 && res.status !== 200) throw new Error(`create question failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.question.id as string;
    }

  const tfText = (stem: string) => ({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: stem }] },
      {
        type: 'statementList',
        content: [1, 2, 3, 4].map((i) => ({
          type: 'statement',
          attrs: { id: `s${i}` },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `${stem} — ý ${i}` }] }],
        })),
      },
    ],
  });
  const tfSolution = { answers: [1, 2, 3, 4].map((i) => ({ statementId: `s${i}`, value: true })) };
    const qMc = await makeQuestion(bankCatId, {
      qtype: 'multichoice', questionText: 'Capital of France?', defaultMark: 2,
      answers: [{ text: 'Paris', correct: true }, { text: 'London', correct: false }, { text: 'Đáp án khác 1', correct: false }, { text: 'Đáp án khác 2', correct: false }],
    });
    const qTf = await makeQuestion(bankCatId, {
      qtype: 'truefalse', questionText: tfText('Water is wet.'), defaultMark: 1, solution: tfSolution,
    });
    const qSa = await makeQuestion(bankCatId, {
      qtype: 'shortanswer', questionText: 'Capital of Vietnam?', defaultMark: 1,
      answers: [{ text: 'Hanoi', correct: true }],
    });
    const qEssay = await makeQuestion(bankCatId, {
      qtype: 'essay', questionText: 'Describe your town.', defaultMark: 3,
    });
    let qRandom = '';
    for (const name of ['R1', 'R2']) {
      const id = await makeQuestion(randomCatId, {
        qtype: 'truefalse', questionText: tfText(`${name}: the sun rises in the east.`), defaultMark: 1, solution: tfSolution,
      });
      if (name === 'R1') qRandom = id;
    }
    const readable = await http(app).get(`/api/v1/questions/${qMc}`).set('Authorization', `Bearer ${teacher}`);
    expect(readable.status, JSON.stringify(readable.body)).toBe(200);
    return { course, sectionId, teacher, teacherId: teacherUser.id, student, studentToken, bankCatId, randomCatId, qRandom, qMc, qTf, qSa, qEssay };
  }

  const pinBodies = new Map<string, Record<string, unknown>>();
  const slotLists = new Map<string, { questionId: string; maxMark?: number }[]>();

  async function examBankId(token: string): Promise<string> {
    const me = await http(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);
    const ownerId = me.body.id as string;
    const res = await http(app).get('/api/v1/question-banks?kind=exam').set('Authorization', `Bearer ${token}`);
    const bank = (res.body as { id: string; scope: string; bankKind: string; ownerId: string | null }[])
      .find((b) => b.scope === 'personal' && b.bankKind === 'exam' && b.ownerId === ownerId);
    if (!bank) throw new Error('personal exam bank not found');
    return bank.id;
  }

  async function createQuiz(token: string, _courseId: string, body: Record<string, unknown>) {
    const bankId = await examBankId(token);
    const res = await http(app).post(`/api/v1/exams/banks/${bankId}/exams`).set('Authorization', `Bearer ${token}`)
      .send({ name: body.name, totalScore: body.grade ?? 10 });
    if (res.status === 201) {
      const examId = res.body.paper.id as string;
      pinBodies.set(examId, body);
      slotLists.set(examId, []);
      return { status: 201, body: { id: examId } };
    }
    return res;
  }

  async function addSlot(token: string, examId: string, body: Record<string, unknown>) {
    const slots = slotLists.get(examId)!;
    slots.push({ questionId: body.questionId as string, ...(body.maxMark !== undefined ? { maxMark: body.maxMark as number } : {}) });
    const res = await http(app).put(`/api/v1/exams/${examId}/slots`).set('Authorization', `Bearer ${token}`).send({ slots });
    if (res.status !== 201 && res.status !== 200) throw new Error(`add slot failed: ${res.status} ${JSON.stringify(res.body)}`);
    const viewSlots = (res.body.slots as { position: number; questionId: string; maxMark: number }[])
      .map((x) => ({ id: `${examId}:${x.position}`, slot: x.position, questionId: x.questionId, maxMark: x.maxMark }));
    return { sumGrades: viewSlots.reduce((a, x) => a + x.maxMark, 0), slots: viewSlots };
  }

  async function pinQuiz(token: string, courseId: string, examId: string) {
    const body = pinBodies.get(examId)!;
    const statusRes = await http(app).post(`/api/v1/exams/${examId}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'ready' });
    if (statusRes.status !== 201) throw new Error(`ready failed: ${statusRes.status} ${JSON.stringify(statusRes.body)}`);
    const pinBody: Record<string, unknown> = { sectionId: body.sectionId, examId };
    for (const k of ['gradeMethod', 'attemptsAllowed', 'timeOpen', 'timeClose', 'timeLimitSeconds', 'shuffleAnswers', 'preset', 'lateEntryMinutes', 'monitorEvents', 'variantCount', 'targetGroupId']) {
      if (body[k] !== undefined) pinBody[k] = body[k];
    }
    const res = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set('Authorization', `Bearer ${token}`).send(pinBody);
    if (res.status !== 201) throw new Error(`pin failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: string; cmId: string };
  }
  async function answerSlot(token: string, attemptId: string, view: AttemptViewBody, slot: number, response: string) {
    const q = view.questions.find((x) => x.slot === slot)!;
    const res = await http(app).post(`/api/v1/quiz-attempts/${attemptId}/responses`).set('Authorization', `Bearer ${token}`)
      .send({ questionAttemptId: q.questionAttemptId, response });
    if (res.status !== 200 && res.status !== 201) throw new Error(`answer failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as AttemptViewBody;
  }
  interface AttemptViewBody {
    attempt: { id: string; state: string; sumGrades: number | null; grade: number | null; preview: boolean; attemptNumber: number };
    questions: {
      slot: number; page: number; questionAttemptId: string; questionId: string; qtype: string;
      maxMark: number; state: string; fraction: number | null; mark: number | null; response: string | null;
      answers: { id: string; text: unknown }[];
    }[];
    pendingManualCount: number;
    closedDueToTimeLimit: boolean;
  }
  async function gradeOfQuizItem(courseId: string, cmId: string, userId: string): Promise<number | null> {
    const book = await getGradebook(app, admin, courseId, userId);
    const found = book.activities.find((i) => i.item.itemInstance === cmId);
    return found?.grade?.finalGrade ?? null;
  }

  it('vòng đầy đủ: quy tắc điểm slot, slot ngẫu nhiên, chấm thủ công essay đổi điểm đã ghi', async () => {
    const ctx = await setup();
    const quizRes = await createQuiz(ctx.teacher, ctx.course.id, {
      sectionId: ctx.sectionId, name: 'Quiz 1', grade: 10, gradeMethod: 'highest',
    });
    expect(quizRes.status).toBe(201);
    let quizId = quizRes.body.id as string;

    const denied = await http(app).post(`/api/v1/courses/${ctx.course.id}/exam-pins`).set('Authorization', `Bearer ${ctx.studentToken}`)
      .send({ sectionId: ctx.sectionId, examId: quizId });
    expect(denied.status).toBe(403);

    await addSlot(ctx.teacher, quizId, { questionId: ctx.qMc, maxMark: 5 });
    await addSlot(ctx.teacher, quizId, { questionId: ctx.qTf });
    await addSlot(ctx.teacher, quizId, { questionId: ctx.qRandom, maxMark: 2 });
    const withSlots = await addSlot(ctx.teacher, quizId, { questionId: ctx.qEssay });
    expect(withSlots.sumGrades).toBe(11);
    expect(withSlots.slots.map((s: { maxMark: number }) => s.maxMark)).toEqual([5, 1, 2, 3]);

    const quiz = await pinQuiz(ctx.teacher, ctx.course.id, quizId);
    expect(quiz.cmId).toBeTruthy();
    quizId = quiz.id;

    const info = await http(app).get(`/api/v1/exam-pins/${quizId}`).set('Authorization', `Bearer ${ctx.studentToken}`);
    expect(info.status).toBe(200);
    expect(info.body.canAttempt).toBe(true);

    const start = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
    expect(start.status).toBe(201);
    let view = start.body as AttemptViewBody;
    const attemptId = view.attempt.id;
    expect(view.questions.map((q) => q.slot)).toEqual([1, 2, 3, 4]);
    expect(view.questions.map((q) => q.maxMark)).toEqual([5, 1, 2, 3]);
    expect(view.questions[2]!.qtype).toBe('truefalse');
    for (const q of view.questions) {
      for (const a of q.answers) expect(a).not.toHaveProperty('fraction');
    }

    const mcQ = view.questions[0]!;
    const paris = mcQ.answers.find((a) => JSON.stringify(a.text).includes('Paris'))!;
    view = await answerSlot(ctx.studentToken, attemptId, view, 1, paris.id);
    view = await answerSlot(ctx.studentToken, attemptId, view, 2, TF_ALL_TRUE);
    view = await answerSlot(ctx.studentToken, attemptId, view, 3, TF_ALL_TRUE);
    await answerSlot(ctx.studentToken, attemptId, view, 4, 'My town is small and quiet.');

    const submit = await http(app).post(`/api/v1/quiz-attempts/${attemptId}/submit`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
    expect(submit.status).toBe(201);
    const submitted = submit.body as AttemptViewBody;
    expect(submitted.attempt.state).toBe('needsgrading');
    expect(submitted.pendingManualCount).toBe(1);
    expect(submitted.attempt.sumGrades).toBe(8);
    expect(await gradeOfQuizItem(ctx.course.id, quiz.cmId, ctx.student.id)).toBeNull();

    const reportsDenied = await http(app).get(`/api/v1/exam-pins/${quizId}/results`).set('Authorization', `Bearer ${ctx.studentToken}`);
    expect(reportsDenied.status).toBe(403);
    const results = await http(app).get(`/api/v1/exam-pins/${quizId}/results`).set('Authorization', `Bearer ${ctx.teacher}`);
    expect(results.status).toBe(200);
    expect(results.body.needsGrading).toHaveLength(1);
    expect(results.body.needsGrading[0].slot).toBe(4);
    expect(results.body.needsGrading[0].response).toBe('My town is small and quiet.');

    const essayQa = results.body.needsGrading[0].questionAttemptId as string;
    const graded = await http(app).post(`/api/v1/quiz-attempts/${attemptId}/questions/${essayQa}/grade`)
      .set('Authorization', `Bearer ${ctx.teacher}`).send({ mark: 3, comment: 'Good' });
    expect(graded.status).toBe(201);
    expect(graded.body.attempt.state).toBe('finished');
    expect(graded.body.attempt.sumGrades).toBe(11);
    expect(graded.body.attempt.grade).toBe(10);
    expect(await gradeOfQuizItem(ctx.course.id, quiz.cmId, ctx.student.id)).toBe(10);

    const progress = await http(app).get(`/api/v1/courses/${ctx.course.id}/completion/users/${ctx.student.id}`).set('Authorization', `Bearer ${admin}`);
    const cmState = (progress.body.activities as { cmId: string; state: number }[]).find((a) => a.cmId === quiz.cmId)?.state;
    expect(cmState).toBeGreaterThanOrEqual(1);

    const events = await pg.query("select type from outbox_events where payload->>'pinId' = $1", [quizId]);
    const types = (events.rows as { type: string }[]).map((r) => r.type);
    expect(types).toContain('exam_pinned');
    expect(types).toContain('quiz_attempt_started');
    expect(types).toContain('quiz_attempt_finished');
    expect(types).toContain('exam_attempt_regraded');
  });

  it('thống kê câu hỏi: câu sai nhiều nhất trước kèm học viên làm sai nó; lượt xem trước và đang dở bị loại', async () => {
    const ctx = await setup();
    const instance = await createEnrolInstance(app, admin, ctx.course.id);
    const studentB = await createUserViaApi(app, admin, { firstName: 'An', lastName: 'Ba' });
    await enrolUser(app, admin, ctx.course.id, instance.id, studentB.id);
    const studentBToken = (await login(app, studentB.username, STRONG_PASSWORD)).accessToken;

    const quizRes = await createQuiz(ctx.teacher, ctx.course.id, { sectionId: ctx.sectionId, name: 'Stats quiz', grade: 10 });
    let quizId = quizRes.body.id as string;
    await addSlot(ctx.teacher, quizId, { questionId: ctx.qMc, maxMark: 5 });
    await addSlot(ctx.teacher, quizId, { questionId: ctx.qTf, maxMark: 1 });
    await addSlot(ctx.teacher, quizId, { questionId: ctx.qSa, maxMark: 1 });
    quizId = (await pinQuiz(ctx.teacher, ctx.course.id, quizId)).id;

    async function play(token: string, answers: Record<number, string | 'MC_WRONG'>): Promise<void> {
      const start = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${token}`).send({});
      expect(start.status).toBe(201);
      let view = start.body as AttemptViewBody;
      const attemptId = view.attempt.id;
      for (const [slotText, response] of Object.entries(answers)) {
        const slot = Number(slotText);
        let value = response;
        if (response === 'MC_WRONG') {
          const mcQ = view.questions.find((q) => q.slot === slot)!;
          value = mcQ.answers.find((a) => JSON.stringify(a.text).includes('London'))!.id;
        }
        view = await answerSlot(token, attemptId, view, slot, value);
      }
      const submit = await http(app).post(`/api/v1/quiz-attempts/${attemptId}/submit`).set('Authorization', `Bearer ${token}`).send({});
      expect(submit.status).toBe(201);
    }

    await play(ctx.studentToken, { 1: 'MC_WRONG', 2: TF_ALL_FALSE, 3: 'Hanoi' });
    await play(studentBToken, { 1: 'MC_WRONG', 2: TF_ALL_TRUE, 3: 'Hue' });
    const previewStart = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${ctx.teacher}`).send({ preview: true });
    expect(previewStart.status).toBe(201);
    let previewView = previewStart.body as AttemptViewBody;
    const paris = previewView.questions[0]!.answers.find((a) => JSON.stringify(a.text).includes('Paris'))!;
    previewView = await answerSlot(ctx.teacher, previewView.attempt.id, previewView, 1, paris.id);
    const previewSubmit = await http(app).post(`/api/v1/quiz-attempts/${previewView.attempt.id}/submit`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(previewSubmit.status).toBe(201);
    const dangling = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${studentBToken}`).send({});
    expect(dangling.status).toBe(201);

    const results = await http(app).get(`/api/v1/exam-pins/${quizId}/results`).set('Authorization', `Bearer ${ctx.teacher}`);
    expect(results.status).toBe(200);
    interface StatBody {
      slot: number; questionId: string | null; questionName: string | null; maxMark: number;
      attemptsCount: number; gradedCount: number; pendingCount: number;
      wrongCount: number; fullyWrongCount: number;
      wrongStudents: { userId: string; displayName: string; fraction: number; mark: number; attemptNumber: number }[];
    }
    const stats = results.body.questionStats as StatBody[];
    expect(stats).toHaveLength(3);
    expect(stats[0]).toMatchObject({
      slot: 1, questionId: ctx.qMc, questionName: 'Capital of France?',
      attemptsCount: 2, gradedCount: 2, pendingCount: 0, wrongCount: 2, fullyWrongCount: 2,
    });
    expect(stats[0]!.wrongStudents.map((w) => w.userId).sort()).toEqual([ctx.student.id, studentB.id].sort());
    expect(stats[0]!.wrongStudents.map((w) => w.displayName).sort()).toEqual(['An Ba', 'Test User']);
    for (const w of stats[0]!.wrongStudents) {
      expect(w.fraction).toBe(0);
      expect(w.mark).toBe(0);
      expect(w.attemptNumber).toBe(1);
    }
    expect(stats[1]).toMatchObject({ slot: 2, questionId: ctx.qTf, questionName: 'Water is wet.\nWater is wet. — ý 1\nWater is wet. — ý 2\nWater is wet. — ý 3\nWater is wet. — ý 4', wrongCount: 1, fullyWrongCount: 1, gradedCount: 2 });
    expect(stats[1]!.wrongStudents.map((w) => w.userId)).toEqual([ctx.student.id]);
    expect(stats[2]).toMatchObject({ slot: 3, questionId: ctx.qSa, questionName: 'Capital of Vietnam?', wrongCount: 1, fullyWrongCount: 1, gradedCount: 2 });
    expect(stats[2]!.wrongStudents.map((w) => w.userId)).toEqual([studentB.id]);
  });

  it('phương thức điểm cao nhất qua các lượt, giới hạn lượt được áp đặt, lượt của người khác riêng tư', async () => {
    const ctx = await setup();
    const quizRes = await createQuiz(ctx.teacher, ctx.course.id, {
      sectionId: ctx.sectionId, name: 'Quiz 2', grade: 10, gradeMethod: 'highest', attemptsAllowed: 2,
    });
    let quizId = quizRes.body.id as string;
    await addSlot(ctx.teacher, quizId, { questionId: ctx.qTf, maxMark: 1 });
    await addSlot(ctx.teacher, quizId, { questionId: ctx.qSa, maxMark: 1 });
    const quiz = await pinQuiz(ctx.teacher, ctx.course.id, quizId);
    quizId = quiz.id;

    async function playAll(correctTf: boolean, correctSa: boolean): Promise<AttemptViewBody> {
      const start = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
      expect(start.status).toBe(201);
      let view = start.body as AttemptViewBody;
      const attemptId = view.attempt.id;
      view = await answerSlot(ctx.studentToken, attemptId, view, 1, correctTf ? TF_ALL_TRUE : TF_ALL_FALSE);
      await answerSlot(ctx.studentToken, attemptId, view, 2, correctSa ? 'Hanoi' : 'Hue');
      const submit = await http(app).post(`/api/v1/quiz-attempts/${attemptId}/submit`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
      expect(submit.status).toBe(201);
      return submit.body as AttemptViewBody;
    }

    const first = await playAll(false, false);
    expect(first.attempt.state).toBe('finished');
    expect(first.attempt.grade).toBe(0);
    const second = await playAll(true, true);
    expect(second.attempt.grade).toBe(10);
    expect(await gradeOfQuizItem(ctx.course.id, quiz.cmId, ctx.student.id)).toBe(10);

    const third = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
    expect(third.status).toBe(403);
    expect(third.body.code).toBe('quiz.no_more_attempts');

    const other = await createUserViaApi(app, admin);
    const instance = await createEnrolInstance(app, admin, ctx.course.id);
    await enrolUser(app, admin, ctx.course.id, instance.id, other.id);
    const otherToken = (await login(app, other.username, STRONG_PASSWORD)).accessToken;
    const peek = await http(app).get(`/api/v1/quiz-attempts/${first.attempt.id}`).set('Authorization', `Bearer ${otherToken}`);
    expect(peek.status).toBe(403);
  });

  it('cửa sổ thời gian chặn lượt ngoài open/close; giới hạn thời gian đóng lượt phía server khi tương tác', async () => {
    const ctx = await setup();
    const future = new Date(Date.now() + 3600_000).toISOString();
    const past = new Date(Date.now() - 3600_000).toISOString();

    const notOpenRes = await createQuiz(ctx.teacher, ctx.course.id, {
      sectionId: ctx.sectionId, name: 'Future quiz', timeOpen: future,
    });
    let notOpenId = notOpenRes.body.id as string;
    await addSlot(ctx.teacher, notOpenId, { questionId: ctx.qTf });
    notOpenId = (await pinQuiz(ctx.teacher, ctx.course.id, notOpenId)).id;
    const early = await http(app).post(`/api/v1/exam-pins/${notOpenId}/attempts`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
    expect(early.status).toBe(403);
    expect(early.body.code).toBe('quiz.not_yet_open');

    const closedRes = await createQuiz(ctx.teacher, ctx.course.id, {
      sectionId: ctx.sectionId, name: 'Closed quiz', timeClose: past,
    });
    let closedId = closedRes.body.id as string;
    await addSlot(ctx.teacher, closedId, { questionId: ctx.qTf });
    closedId = (await pinQuiz(ctx.teacher, ctx.course.id, closedId)).id;
    const late = await http(app).post(`/api/v1/exam-pins/${closedId}/attempts`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
    expect(late.status).toBe(403);
    expect(late.body.code).toBe('quiz.closed');

    const timedRes = await createQuiz(ctx.teacher, ctx.course.id, {
      sectionId: ctx.sectionId, name: 'Timed quiz', timeLimitSeconds: 600, grade: 10,
    });
    const timedExamId = timedRes.body.id as string;
    await addSlot(ctx.teacher, timedExamId, { questionId: ctx.qTf, maxMark: 1 });
    const timed = await pinQuiz(ctx.teacher, ctx.course.id, timedExamId);
    const start = await http(app).post(`/api/v1/exam-pins/${timed.id}/attempts`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
    expect(start.status).toBe(201);
    const attemptId = (start.body as AttemptViewBody).attempt.id;
    await pg.query("update exam_attempts set time_start = now() - interval '1 hour' where id = $1", [attemptId]);
    const view = start.body as AttemptViewBody;
    const after = await answerSlot(ctx.studentToken, attemptId, view, 1, TF_ALL_TRUE);
    expect(after.closedDueToTimeLimit).toBe(true);
    expect(after.attempt.state).toBe('finished');
  });

  it('xem trước của giáo viên không tiêu lượt cũng không ghi điểm; học viên không thể xem trước', async () => {
    const ctx = await setup();
    const quizRes = await createQuiz(ctx.teacher, ctx.course.id, {
      sectionId: ctx.sectionId, name: 'Preview quiz', grade: 10, attemptsAllowed: 1,
    });
    let quizId = quizRes.body.id as string;
    await addSlot(ctx.teacher, quizId, { questionId: ctx.qTf, maxMark: 1 });
    const quiz = await pinQuiz(ctx.teacher, ctx.course.id, quizId);
    quizId = quiz.id;

    const denied = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${ctx.studentToken}`).send({ preview: true });
    expect(denied.status).toBe(403);

    const start = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${ctx.teacher}`).send({ preview: true });
    expect(start.status).toBe(201);
    const view = start.body as AttemptViewBody;
    expect(view.attempt.preview).toBe(true);
    const attemptId = view.attempt.id;
    await answerSlot(ctx.teacher, attemptId, view, 1, TF_ALL_TRUE);
    const submit = await http(app).post(`/api/v1/quiz-attempts/${attemptId}/submit`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(submit.status).toBe(201);
    expect((submit.body as AttemptViewBody).attempt.state).toBe('finished');
    expect(await gradeOfQuizItem(ctx.course.id, quiz.cmId, ctx.teacherId)).toBeNull();
    const infoStudent = await http(app).get(`/api/v1/exam-pins/${quizId}`).set('Authorization', `Bearer ${ctx.studentToken}`);
    expect(infoStudent.body.myAttempts).toHaveLength(0);
    expect(infoStudent.body.canAttempt).toBe(true);
  });

  it('quản lý slot trên đề: sửa điểm, đổi thứ tự, xoá đánh lại số và tổng theo phiên bản đã ghim', async () => {
    const ctx = await setup();
    const quizRes = await createQuiz(ctx.teacher, ctx.course.id, { sectionId: ctx.sectionId, name: 'Slots quiz' });
    const examId = quizRes.body.id as string;
    await addSlot(ctx.teacher, examId, { questionId: ctx.qTf, maxMark: 1 });
    const view = await addSlot(ctx.teacher, examId, { questionId: ctx.qSa, maxMark: 2 });
    expect(view.sumGrades).toBe(3);

    const pin = await pinQuiz(ctx.teacher, ctx.course.id, examId);
    const pinId = pin.id;

    const editedRes = await http(app).put(`/api/v1/exams/${examId}/slots`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ slots: [{ questionId: ctx.qTf, maxMark: 4 }, { questionId: ctx.qSa, maxMark: 2 }] });
    expect(editedRes.status).toBe(200);
    expect((editedRes.body.slots as { maxMark: number }[]).reduce((a, x) => a + x.maxMark, 0)).toBe(6);
    const pinBefore = await http(app).get(`/api/v1/exam-pins/${pinId}`).set('Authorization', `Bearer ${ctx.teacher}`);
    expect(pinBefore.body.quiz.slots.reduce((a: number, x: { maxMark: number }) => a + x.maxMark, 0)).toBe(3);

    const newVersionId = editedRes.body.version.id as string;
    const upgraded = await http(app).patch(`/api/v1/exam-pins/${pinId}`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ examVersionId: newVersionId });
    expect(upgraded.status).toBe(200);
    expect(upgraded.body.slots.reduce((a: number, x: { maxMark: number }) => a + x.maxMark, 0)).toBe(6);

    const swappedRes = await http(app).put(`/api/v1/exams/${examId}/slots`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ slots: [{ questionId: ctx.qSa, maxMark: 2 }, { questionId: ctx.qTf, maxMark: 4 }] });
    expect(swappedRes.status).toBe(200);
    const upgraded2 = await http(app).patch(`/api/v1/exam-pins/${pinId}`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ examVersionId: swappedRes.body.version.id as string });
    expect(upgraded2.status).toBe(200);
    expect((upgraded2.body.slots as { questionId: string }[]).map((x) => x.questionId)).toEqual([ctx.qSa, ctx.qTf]);

    const removedRes = await http(app).put(`/api/v1/exams/${examId}/slots`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ slots: [{ questionId: ctx.qTf, maxMark: 4 }] });
    expect(removedRes.status).toBe(200);
    const upgraded3 = await http(app).patch(`/api/v1/exam-pins/${pinId}`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ examVersionId: removedRes.body.version.id as string });
    expect(upgraded3.status).toBe(200);
    expect(upgraded3.body.slots).toHaveLength(1);
    expect(upgraded3.body.slots[0].slot).toBe(1);
    expect(upgraded3.body.slots[0].maxMark).toBe(4);

    const denied = await http(app).put(`/api/v1/exams/${examId}/slots`).set('Authorization', `Bearer ${ctx.studentToken}`)
      .send({ slots: [{ questionId: ctx.qTf, maxMark: 9 }] });
    expect(denied.status).toBe(403);
    const deniedPin = await http(app).patch(`/api/v1/exam-pins/${pinId}`).set('Authorization', `Bearer ${ctx.studentToken}`)
      .send({ examVersionId: removedRes.body.version.id as string });
    expect(deniedPin.status).toBe(403);
  });

  it('hồi quy F1: xem trước và lượt thật chia sẻ MỘT dãy đánh số — không xung đột, không usage mồ côi', async () => {
    const ctx = await setup();
    const contexts = await http(app).get('/api/v1/access/contexts').set('Authorization', `Bearer ${admin}`);
    const courseCtx = (contexts.body as { id: string; contextLevel: number; instanceId: string }[])
      .find((c) => c.contextLevel === 50 && c.instanceId === ctx.course.id)!;
    await assignRole(app, admin, ctx.teacherId, await roleIdByShortname(app, admin, 'student'), courseCtx.id);

    async function play(token: string, quizId: string, preview: boolean): Promise<AttemptViewBody> {
      const start = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${token}`)
        .send(preview ? { preview: true } : {});
      expect(start.status).toBe(201);
      let view = start.body as AttemptViewBody;
      view = await answerSlot(token, view.attempt.id, view, 1, TF_ALL_TRUE);
      const submit = await http(app).post(`/api/v1/quiz-attempts/${view.attempt.id}/submit`).set('Authorization', `Bearer ${token}`).send({});
      expect(submit.status).toBe(201);
      return submit.body as AttemptViewBody;
    }
    async function expectNoOrphanUsage(quizId: string) {
      const usages = await pg.query("select count(*)::int as n from question_usages where instance_id::text = $1", [quizId]);
      const attempts = await pg.query('select count(*)::int as n from exam_attempts where pin_id = $1', [quizId]);
      expect((usages.rows[0] as { n: number }).n).toBe((attempts.rows[0] as { n: number }).n);
    }

    const quizARes = await createQuiz(ctx.teacher, ctx.course.id, { sectionId: ctx.sectionId, name: 'F1 quiz A', grade: 10 });
    let quizA = quizARes.body.id as string;
    await addSlot(ctx.teacher, quizA, { questionId: ctx.qTf, maxMark: 1 });
    quizA = (await pinQuiz(ctx.teacher, ctx.course.id, quizA)).id;
    const previewFirst = await play(ctx.teacher, quizA, true);
    expect(previewFirst.attempt.preview).toBe(true);
    expect(previewFirst.attempt.attemptNumber).toBe(1);
    const realAfter = await play(ctx.teacher, quizA, false);
    expect(realAfter.attempt.preview).toBe(false);
    expect(realAfter.attempt.attemptNumber).toBe(2);
    await expectNoOrphanUsage(quizA);

    const quizBRes = await createQuiz(ctx.teacher, ctx.course.id, { sectionId: ctx.sectionId, name: 'F1 quiz B', grade: 10 });
    let quizB = quizBRes.body.id as string;
    await addSlot(ctx.teacher, quizB, { questionId: ctx.qTf, maxMark: 1 });
    quizB = (await pinQuiz(ctx.teacher, ctx.course.id, quizB)).id;
    const realFirst = await play(ctx.teacher, quizB, false);
    expect(realFirst.attempt.attemptNumber).toBe(1);
    const previewAfter = await play(ctx.teacher, quizB, true);
    expect(previewAfter.attempt.preview).toBe(true);
    expect(previewAfter.attempt.attemptNumber).toBe(2);
    await expectNoOrphanUsage(quizB);
  });

  it('hồi quy F2: đáp án nộp sau timeClose không được lưu — lượt làm đóng phía server', async () => {
    const ctx = await setup();
    const quizRes = await createQuiz(ctx.teacher, ctx.course.id, {
      sectionId: ctx.sectionId, name: 'Closing quiz', grade: 10,
    });
    let quizId = quizRes.body.id as string;
    await addSlot(ctx.teacher, quizId, { questionId: ctx.qTf, maxMark: 1 });
    await addSlot(ctx.teacher, quizId, { questionId: ctx.qSa, maxMark: 1 });
    const quiz = await pinQuiz(ctx.teacher, ctx.course.id, quizId);
    quizId = quiz.id;

    const start = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
    expect(start.status).toBe(201);
    const view = start.body as AttemptViewBody;
    const attemptId = view.attempt.id;
    await answerSlot(ctx.studentToken, attemptId, view, 1, TF_ALL_TRUE);

    const past = new Date(Date.now() - 60_000).toISOString();
    const patch = await http(app).patch(`/api/v1/exam-pins/${quizId}`).set('Authorization', `Bearer ${ctx.teacher}`).send({ timeClose: past });
    expect(patch.status).toBe(200);

    const slot2 = view.questions.find((q) => q.slot === 2)!;
    const late = await http(app).post(`/api/v1/quiz-attempts/${attemptId}/responses`).set('Authorization', `Bearer ${ctx.studentToken}`)
      .send({ questionAttemptId: slot2.questionAttemptId, response: 'Hanoi' });
    expect([200, 201]).toContain(late.status);
    const closed = late.body as AttemptViewBody;
    expect(closed.attempt.state).toBe('finished');
    expect(closed.closedDueToTimeLimit).toBe(true);
    const q2 = closed.questions.find((q) => q.slot === 2)!;
    expect(q2.response).toBeNull();
    expect(q2.mark ?? 0).toBe(0);
    expect(closed.attempt.sumGrades).toBe(1);
    expect(closed.attempt.grade).toBe(5);
    expect(await gradeOfQuizItem(ctx.course.id, quiz.cmId, ctx.student.id)).toBe(5);
  });

  it('hồi quy F3: mục điểm bị khoá không được làm lỗi bài nộp của học viên', async () => {
    const ctx = await setup();
    const quizRes = await createQuiz(ctx.teacher, ctx.course.id, {
      sectionId: ctx.sectionId, name: 'Locked item quiz', grade: 10,
    });
    let quizId = quizRes.body.id as string;
    await addSlot(ctx.teacher, quizId, { questionId: ctx.qTf, maxMark: 1 });
    const quiz = await pinQuiz(ctx.teacher, ctx.course.id, quizId);
    quizId = quiz.id;

    const items = await http(app).get(`/api/v1/courses/${ctx.course.id}/grade-items`).set('Authorization', `Bearer ${admin}`);
    const item = (items.body as { id: string; itemType: string; itemInstance: string | null }[])
      .find((i) => i.itemType === 'mod' && i.itemInstance === quiz.cmId)!;
    expect(item).toBeTruthy();
    const lock = await http(app).patch(`/api/v1/grade-items/${item.id}`).set('Authorization', `Bearer ${admin}`)
      .send({ locked: true });
    expect(lock.status).toBe(200);

    const start = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
    expect(start.status).toBe(201);
    const view = start.body as AttemptViewBody;
    const attemptId = view.attempt.id;
    await answerSlot(ctx.studentToken, attemptId, view, 1, TF_ALL_TRUE);
    const submit = await http(app).post(`/api/v1/quiz-attempts/${attemptId}/submit`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
    expect(submit.status).toBe(201);
    const submitted = submit.body as AttemptViewBody;
    expect(submitted.attempt.state).toBe('finished');
    expect(submitted.attempt.grade).toBe(10);
    expect(await gradeOfQuizItem(ctx.course.id, quiz.cmId, ctx.student.id)).toBeNull();
  });

  it('tạo-đề-rồi-ghim (newExam): một thao tác tạo pin từ đề mới có slot — học sinh làm được ngay', async () => {
    const ctx = await setup();
    const res = await http(app).post(`/api/v1/courses/${ctx.course.id}/exam-pins`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ sectionId: ctx.sectionId, requestId: randomUUID(), newExam: { name: 'Đề tạo nhanh', slots: [{ questionId: ctx.qMc }] } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const pin = res.body as { id: string; examId: string; name: string };
    expect(pin.examId).toBeTruthy();
    expect(pin.name).toBe('Đề tạo nhanh');
    const start = await http(app).post(`/api/v1/exam-pins/${pin.id}/attempts`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    expect((start.body as { questions: unknown[] }).questions).toHaveLength(1);
  });

  it('ghim theo nhóm: chỉ thành viên nhóm đích thấy + làm được; toàn khoá thì mọi học sinh làm được; nhóm khoá khác → 400', async () => {
    const ctx = await setup();
    const instance2 = await createEnrolInstance(app, admin, ctx.course.id);
    const studentB = await createUserViaApi(app, admin);
    await enrolUser(app, admin, ctx.course.id, instance2.id, studentB.id);
    const studentBToken = (await login(app, studentB.username, STRONG_PASSWORD)).accessToken;

    const groupRes = await http(app).post(`/api/v1/courses/${ctx.course.id}/groups`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ name: 'Nhóm đích 1' });
    expect(groupRes.status, JSON.stringify(groupRes.body)).toBe(201);
    const groupId = (groupRes.body as { id: string }).id;
    const addRes = await http(app).post(`/api/v1/courses/${ctx.course.id}/groups/${groupId}/members`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ userId: ctx.student.id });
    expect(addRes.status, JSON.stringify(addRes.body)).toBeLessThan(300);

    const draft = await createExamDraft(app, ctx.teacher, 'Đề theo nhóm');
    await addExamSlot(app, ctx.teacher, draft, { questionId: ctx.qMc });
    const pin = await pinExam(app, ctx.teacher, ctx.course.id, draft, { sectionId: ctx.sectionId, targetGroupId: groupId });
    expect(pin.targetGroupId).toBe(groupId);
    const pinId = pin.id as string;

    const listB = await http(app).get(`/api/v1/courses/${ctx.course.id}/exam-pins`).set('Authorization', `Bearer ${studentBToken}`);
    expect(listB.status).toBe(200);
    expect((listB.body as { id: string }[]).map((x) => x.id)).not.toContain(pinId);
    const getB = await http(app).get(`/api/v1/exam-pins/${pinId}`).set('Authorization', `Bearer ${studentBToken}`);
    expect(getB.status).toBe(404);
    const startB = await http(app).post(`/api/v1/exam-pins/${pinId}/attempts`).set('Authorization', `Bearer ${studentBToken}`).send({});
    expect(startB.status).toBe(403);
    expect((startB.body as { code?: string }).code).toBe('exam.pin_not_in_target_group');

    const listA = await http(app).get(`/api/v1/courses/${ctx.course.id}/exam-pins`).set('Authorization', `Bearer ${ctx.studentToken}`);
    expect((listA.body as { id: string }[]).map((x) => x.id)).toContain(pinId);
    const startA = await http(app).post(`/api/v1/exam-pins/${pinId}/attempts`).set('Authorization', `Bearer ${ctx.studentToken}`).send({});
    expect(startA.status, JSON.stringify(startA.body)).toBe(201);

    const draft2 = await createExamDraft(app, ctx.teacher, 'Đề toàn khoá');
    await addExamSlot(app, ctx.teacher, draft2, { questionId: ctx.qMc });
    const pin2 = await pinExam(app, ctx.teacher, ctx.course.id, draft2, { sectionId: ctx.sectionId });
    expect(pin2.targetGroupId ?? null).toBeNull();
    const startB2 = await http(app).post(`/api/v1/exam-pins/${pin2.id}/attempts`).set('Authorization', `Bearer ${studentBToken}`).send({});
    expect(startB2.status, JSON.stringify(startB2.body)).toBe(201);

    const other = await setup();
    const otherGroup = await http(app).post(`/api/v1/courses/${other.course.id}/groups`).set('Authorization', `Bearer ${other.teacher}`)
      .send({ name: 'Nhóm khoá khác' });
    const otherGroupId = (otherGroup.body as { id: string }).id;
    const draft3 = await createExamDraft(app, ctx.teacher, 'Đề nhóm lạ');
    await addExamSlot(app, ctx.teacher, draft3, { questionId: ctx.qMc });
    await http(app).post(`/api/v1/exams/${draft3.examId}/status`).set('Authorization', `Bearer ${ctx.teacher}`).send({ status: 'ready' });
    const badPin = await http(app).post(`/api/v1/courses/${ctx.course.id}/exam-pins`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ sectionId: ctx.sectionId, examId: draft3.examId, targetGroupId: otherGroupId });
    expect(badPin.status).toBe(400);
    expect((badPin.body as { code?: string }).code).toBe('exam.pin_target_group_invalid');
  });
});

