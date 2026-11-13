import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuestionsService } from '../../../src/modules/questions/questions.service';
import { adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD } from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser, getFirstSectionId } from '../../support/course-enrolment-helpers';
import { addExamSlot, createExamDraft, pinExam } from '../../support/exam-pin-helpers';

describe('Cổng chủ sở hữu usage câu hỏi (issue #60)', () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
  });
  afterAll(async () => { await app.close(); });

  interface QuizView {
    attempt: { id: string; usageId: string; state: string };
    questions: {
      slot: number; questionAttemptId: string; state: string;
      fraction: number | null; rightAnswer: string | null; response: string | null;
    }[];
  }

  interface Scenario {
    quizId: string;
    questionId: string;
    tokenA: string;
    tokenB: string;
    userIdA: string;
  }


  const TF_TEXT = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Water is wet.' }] },
      {
        type: 'statementList',
        content: [1, 2, 3, 4].map((i) => ({
          type: 'statement',
          attrs: { id: `s${i}` },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `Water is wet — ý ${i}` }] }],
        })),
      },
    ],
  };
  const TF_SOLUTION = { answers: [1, 2, 3, 4].map((i) => ({ statementId: `s${i}`, value: true })) };
  const TF_ALL_TRUE = JSON.stringify({ s1: true, s2: true, s3: true, s4: true });
  const TF_ALL_FALSE = JSON.stringify({ s1: false, s2: false, s3: false, s4: false });
  const TF_RIGHT_ANSWER = 'Đúng, Đúng, Đúng, Đúng';
  async function setup(): Promise<Scenario> {
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

    async function enrolledStudent(): Promise<{ token: string; userId: string }> {
      const user = await createUserViaApi(app, admin);
      await enrolUser(app, admin, course.id, instance.id, user.id);
      return { token: (await login(app, user.username, STRONG_PASSWORD)).accessToken, userId: user.id };
    }
    const studentA = await enrolledStudent();
    const studentB = await enrolledStudent();
    const tokenA = studentA.token;
    const tokenB = studentB.token;
    const userIdA = studentA.userId;

    const bankRes = await http(app).post('/api/v1/questions/categories').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Gate bank', contextId: courseCtx.id });
    const qRes = await http(app).post('/api/v1/questions').set('Authorization', `Bearer ${admin}`)
      .send({
        categoryId: bankRes.body.id, qtype: 'truefalse', questionText: TF_TEXT,
        defaultMark: 1, solution: TF_SOLUTION,
      });
    const questionId = qRes.body.question.id as string;

    const draft = await createExamDraft(app, teacher, 'Gate quiz', 10);
    await addExamSlot(app, teacher, draft, { questionId });
    const pin = await pinExam(app, teacher, course.id, draft, { sectionId, reviewRightAnswer: 4368 });
    const quizId = pin.id as string;
    return { quizId, questionId, tokenA, tokenB, userIdA };
  }

  async function startAndAnswer(token: string, quizId: string): Promise<QuizView> {
    const start = await http(app).post(`/api/v1/exam-pins/${quizId}/attempts`).set('Authorization', `Bearer ${token}`).send({});
    expect(start.status).toBe(201);
    const view = start.body as QuizView;
    expect(view.attempt.state).toBe('inprogress');
    expect(view.questions[0]!.rightAnswer).toBeNull();
    const answered = await http(app).post(`/api/v1/quiz-attempts/${view.attempt.id}/responses`)
      .set('Authorization', `Bearer ${token}`)
      .send({ questionAttemptId: view.questions[0]!.questionAttemptId, response: TF_ALL_TRUE });
    expect(answered.status).toBeLessThan(300);
    return answered.body as QuizView;
  }

  it('người lạ không thể nộp hay kết thúc lượt làm quiz đang dở của học viên khác; chủ sở hữu kết thúc qua luồng quiz', async () => {
    const s = await setup();
    const view = await startAndAnswer(s.tokenA, s.quizId);
    const usageId = view.attempt.usageId;
    const questionAttemptId = view.questions[0]!.questionAttemptId;

    const bSubmit = await http(app).post(`/api/v1/question-usages/${usageId}/attempts/${questionAttemptId}/submit`)
      .set('Authorization', `Bearer ${s.tokenB}`).send({ response: TF_ALL_FALSE });
    expect(bSubmit.status).toBe(404);
    expect(bSubmit.body.code).toBe('question.attempt_not_found');
    const bStartAttempt = await http(app).post(`/api/v1/question-usages/${usageId}/attempts/${questionAttemptId}/start`)
      .set('Authorization', `Bearer ${s.tokenB}`);
    expect(bStartAttempt.status).toBe(404);
    expect(bStartAttempt.body.code).toBe('question.attempt_not_found');
    const bFinishAttempt = await http(app).post(`/api/v1/question-usages/${usageId}/attempts/${questionAttemptId}/finish`)
      .set('Authorization', `Bearer ${s.tokenB}`);
    expect(bFinishAttempt.status).toBe(404);
    const bFinish = await http(app).post(`/api/v1/question-usages/${usageId}/finish`).set('Authorization', `Bearer ${s.tokenB}`);
    expect(bFinish.status).toBe(404);
    expect(bFinish.body.code).toBe('question.usage_not_found');
    const bStart = await http(app).post(`/api/v1/question-usages/${usageId}/start`).set('Authorization', `Bearer ${s.tokenB}`);
    expect(bStart.status).toBe(404);
    expect(bStart.body.code).toBe('question.usage_not_found');
    const ghost = await http(app).post(`/api/v1/question-usages/01900000-0000-7000-8000-0000000000ff/finish`)
      .set('Authorization', `Bearer ${s.tokenB}`);
    expect(ghost.status).toBe(404);
    expect(ghost.body.code).toBe(bFinish.body.code);

    const after = await http(app).get(`/api/v1/quiz-attempts/${view.attempt.id}`).set('Authorization', `Bearer ${s.tokenA}`);
    expect(after.status).toBe(200);
    const afterView = after.body as QuizView;
    expect(afterView.attempt.state).toBe('inprogress');
    expect(afterView.questions[0]!.response).toBe(TF_ALL_TRUE);
    expect(afterView.questions[0]!.rightAnswer).toBeNull();

    const submit = await http(app).post(`/api/v1/quiz-attempts/${view.attempt.id}/submit`)
      .set('Authorization', `Bearer ${s.tokenA}`).send({});
    expect(submit.status).toBeLessThan(300);
    const submitted = submit.body as QuizView;
    expect(submitted.attempt.state).toBe('finished');
    expect(submitted.questions[0]!.fraction).toBe(1);
    expect(submitted.questions[0]!.rightAnswer).toBe(TF_RIGHT_ANSWER);
  });

  it('chủ sở hữu không thể kết thúc hay nộp sớm qua route thô khi lượt làm quiz đang diễn ra', async () => {
    const s = await setup();
    const view = await startAndAnswer(s.tokenA, s.quizId);
    const usageId = view.attempt.usageId;
    const questionAttemptId = view.questions[0]!.questionAttemptId;

    const aFinish = await http(app).post(`/api/v1/question-usages/${usageId}/finish`).set('Authorization', `Bearer ${s.tokenA}`);
    expect(aFinish.status).toBe(403);
    expect(aFinish.body.code).toBe('question.usage_managed_by_quiz');
    expect(aFinish.body.attempts).toBeUndefined();
    expect(JSON.stringify(aFinish.body)).not.toContain('rightAnswer');
    const aSubmit = await http(app).post(`/api/v1/question-usages/${usageId}/attempts/${questionAttemptId}/submit`)
      .set('Authorization', `Bearer ${s.tokenA}`).send({ response: TF_ALL_FALSE });
    expect(aSubmit.status).toBe(403);
    expect(aSubmit.body.code).toBe('question.usage_managed_by_quiz');
    const aFinishAttempt = await http(app).post(`/api/v1/question-usages/${usageId}/attempts/${questionAttemptId}/finish`)
      .set('Authorization', `Bearer ${s.tokenA}`);
    expect(aFinishAttempt.status).toBe(403);
    const aStart = await http(app).post(`/api/v1/question-usages/${usageId}/start`).set('Authorization', `Bearer ${s.tokenA}`);
    expect(aStart.status).toBe(403);

    const after = await http(app).get(`/api/v1/quiz-attempts/${view.attempt.id}`).set('Authorization', `Bearer ${s.tokenA}`);
    const afterView = after.body as QuizView;
    expect(afterView.attempt.state).toBe('inprogress');
    expect(afterView.questions[0]!.response).toBe(TF_ALL_TRUE);
    expect(afterView.questions[0]!.rightAnswer).toBeNull();

    const submit = await http(app).post(`/api/v1/quiz-attempts/${view.attempt.id}/submit`)
      .set('Authorization', `Bearer ${s.tokenA}`).send({});
    const submitted = submit.body as QuizView;
    expect(submitted.attempt.state).toBe('finished');
    expect(submitted.questions[0]!.fraction).toBe(1);
    expect(submitted.questions[0]!.rightAnswer).toBe(TF_RIGHT_ANSWER);
  });

  it('usage ngân hàng tự do: chủ sở hữu chạy đầy đủ luồng thô; người lạ nhận 404 và đường dẫn lệch không tìm thấy', async () => {
    const s = await setup();
    const created = await app.get(QuestionsService).createUsage(s.userIdA, {
      component: 'mod_quiz', slots: [{ questionId: s.questionId }],
    });
    const usageId = created.usage.id as string;
    const attemptId = created.attempts[0].id as string;

    const bStart = await http(app).post(`/api/v1/question-usages/${usageId}/start`).set('Authorization', `Bearer ${s.tokenB}`);
    expect(bStart.status).toBe(404);
    expect(bStart.body.code).toBe('question.usage_not_found');
    const bSubmit = await http(app).post(`/api/v1/question-usages/${usageId}/attempts/${attemptId}/submit`)
      .set('Authorization', `Bearer ${s.tokenB}`).send({ response: TF_ALL_TRUE });
    expect(bSubmit.status).toBe(404);
    expect(bSubmit.body.code).toBe('question.attempt_not_found');
    const bFinish = await http(app).post(`/api/v1/question-usages/${usageId}/finish`).set('Authorization', `Bearer ${s.tokenB}`);
    expect(bFinish.status).toBe(404);

    const other = await app.get(QuestionsService).createUsage(s.userIdA, {
      component: 'mod_quiz', slots: [{ questionId: s.questionId }],
    });
    const otherUsageId = other.usage.id as string;
    const mismatched = await http(app).post(`/api/v1/question-usages/${otherUsageId}/attempts/${attemptId}/start`)
      .set('Authorization', `Bearer ${s.tokenA}`);
    expect(mismatched.status).toBe(404);
    expect(mismatched.body.code).toBe('question.attempt_not_found');

    const started = await http(app).post(`/api/v1/question-usages/${usageId}/start`).set('Authorization', `Bearer ${s.tokenA}`);
    expect(started.status).toBeLessThan(300);
    const submitted = await http(app).post(`/api/v1/question-usages/${usageId}/attempts/${attemptId}/submit`)
      .set('Authorization', `Bearer ${s.tokenA}`).send({ response: TF_ALL_TRUE });
    expect(submitted.status).toBeLessThan(300);
    expect(submitted.body.state).toBe('complete');
    const finished = await http(app).post(`/api/v1/question-usages/${usageId}/finish`).set('Authorization', `Bearer ${s.tokenA}`);
    expect(finished.status).toBeLessThan(300);
    expect(finished.body.state).toBe('finished');
    expect(finished.body.attempts[0].state).toBe('gradedright');
    expect(finished.body.attempts[0].fraction).toBe(1);
    expect(finished.body.attempts[0].rightAnswer).toBe(TF_RIGHT_ANSWER);
  });
});
