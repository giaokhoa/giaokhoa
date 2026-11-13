import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuestionsService } from '../../../src/modules/questions/questions.service';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login,
  roleIdByShortname, STRONG_PASSWORD, systemContextId, uniqueName,
} from '../../support/identity-access-helpers';
import { createCategory as createCourseCategory, createCourse } from '../../support/course-enrolment-helpers';

describe('Cổng đọc ngân hàng câu hỏi (issue #55)', () => {

  const tfBody = (stem: string, value = true) => ({
    qtype: 'truefalse',
    questionText: {
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
    },
    solution: { answers: [1, 2, 3, 4].map((i) => ({ statementId: `s${i}`, value })) },
  });

  let app: INestApplication;
  let admin: string;
  let teacher: string;
  let student: string;
  let studentId: string;
  let systemCtxId: string;
  let courseCtxId: string;
  let courseCatId: string;
  let systemCatId: string;
  let questionId: string;
  let systemQuestionId: string;
  let stimulusId: string;
  let teacherUsageId: string;

  const SECRET_TEXT = 'QBANK-SECRET-QUESTION-TEXT';
  const SECRET_NAME = 'QBANK-SECRET-QUESTION-NAME';
  const SYSTEM_SECRET = 'QBANK-SYSTEM-SECRET-TEXT';

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    systemCtxId = await systemContextId(app, admin);

    const courseCategory = await createCourseCategory(app, admin);
    const course = await createCourse(app, admin, courseCategory.id);
    const contexts = await http(app).get('/api/v1/access/contexts').set('Authorization', `Bearer ${admin}`);
    courseCtxId = (contexts.body as { id: string; contextLevel: number; instanceId: string }[])
      .find((c) => c.contextLevel === 50 && c.instanceId === course.id)!.id;

    const teacherUser = await createUserViaApi(app, admin);
    await assignRole(app, admin, teacherUser.id, await roleIdByShortname(app, admin, 'editingteacher'), courseCtxId);
    teacher = (await login(app, teacherUser.username, STRONG_PASSWORD)).accessToken;

    const studentUser = await createUserViaApi(app, admin);
    studentId = studentUser.id;
    student = (await login(app, studentUser.username, STRONG_PASSWORD)).accessToken;

    const courseCat = await http(app).post('/api/v1/questions/categories').set('Authorization', `Bearer ${admin}`)
      .send({ name: uniqueName('coursebank'), contextId: courseCtxId });
    expect(courseCat.status).toBeLessThan(300);
    courseCatId = courseCat.body.id as string;
    const systemCat = await http(app).post('/api/v1/questions/categories').set('Authorization', `Bearer ${admin}`)
      .send({ name: uniqueName('systembank'), contextId: systemCtxId });
    expect(systemCat.status).toBeLessThan(300);
    systemCatId = systemCat.body.id as string;

    const q = await http(app).post('/api/v1/questions').set('Authorization', `Bearer ${admin}`)
      .send({ categoryId: courseCatId, ...tfBody(SECRET_TEXT) });
    expect(q.status).toBeLessThan(300);
    questionId = q.body.question.id as string;
    const edit = await http(app).patch(`/api/v1/questions/${questionId}`).set('Authorization', `Bearer ${admin}`)
      .send({ questionText: tfBody(`${SECRET_TEXT} v2`).questionText });
    expect(edit.status).toBe(200);

    const sysQ = await http(app).post('/api/v1/questions').set('Authorization', `Bearer ${admin}`)
      .send({ categoryId: systemCatId, ...tfBody(SYSTEM_SECRET, false) });
    expect(sysQ.status).toBeLessThan(300);
    systemQuestionId = sysQ.body.question.id as string;

    const stim = await http(app).post('/api/v1/stimuli').set('Authorization', `Bearer ${admin}`)
      .send({ categoryId: courseCatId, content: 'QBANK-SECRET-STIMULUS' });
    expect(stim.status).toBeLessThan(300);
    stimulusId = stim.body.id as string;

    const usage = await http(app).post('/api/v1/question-usages').set('Authorization', `Bearer ${teacher}`)
      .send({ component: 'mod_quiz', slots: [{ questionId }] });
    expect(usage.status).toBeLessThan(300);
    teacherUsageId = usage.body.usage.id as string;
  });
  afterAll(async () => { await app.close(); });

  function expectNoBankContent(res: { body: unknown }) {
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(SECRET_TEXT);
    expect(raw).not.toContain(SECRET_NAME);
    expect(raw).not.toContain(SYSTEM_SECRET);
    expect(raw).not.toContain('QBANK-SECRET-STIMULUS');
  }

  it('học viên không đọc dữ liệu ngân hàng qua endpoint đọc nào (404, không nội dung, không oracle tồn tại)', async () => {
    const attempts: [string, string][] = [
      ['categories of the course context', `/api/v1/questions/categories?contextId=${courseCtxId}`],
      ['questions in course category', `/api/v1/questions/categories/${courseCatId}/questions`],
      ['question detail', `/api/v1/questions/${questionId}`],
      ['question versions', `/api/v1/questions/${questionId}/versions`],
      ['question curriculum links', `/api/v1/questions/${questionId}/curriculum-links`],
      ['stimuli of course category', `/api/v1/stimuli?categoryId=${courseCatId}`],
      ['stimulus detail', `/api/v1/stimuli/${stimulusId}`],
      ['teacher usage detail', `/api/v1/question-usages/${teacherUsageId}`],
    ];
    for (const [label, url] of attempts) {
      const res = await http(app).get(url).set('Authorization', `Bearer ${student}`);
      expect(res.status, label).toBe(404);
      expectNoBankContent(res);
    }
    const forbidden = await http(app).get(`/api/v1/questions/${questionId}`).set('Authorization', `Bearer ${student}`);
    const missing = await http(app).get('/api/v1/questions/01900000-0000-7000-8000-000000000000').set('Authorization', `Bearer ${student}`);
    expect(forbidden.status).toBe(missing.status);
    expect((forbidden.body as { code: string }).code).toBe((missing.body as { code: string }).code);

    const cats = await http(app).get('/api/v1/questions/categories').set('Authorization', `Bearer ${student}`);
    expect(cats.status).toBe(200);
    const catIds = (cats.body as { id: string }[]).map((c) => c.id);
    expect(catIds).not.toContain(courseCatId);
    expect(catIds).not.toContain(systemCatId);

    const filtered = await http(app).get('/api/v1/questions').set('Authorization', `Bearer ${student}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body as unknown[]).toHaveLength(0);

    const create = await http(app).post('/api/v1/question-usages').set('Authorization', `Bearer ${student}`)
      .send({ component: 'mod_quiz', slots: [{ questionId }] });
    expect(create.status).toBe(404);
    expectNoBankContent(create);
  });

  it('giáo viên có editingteacher tại ngữ cảnh khoá học dùng ngân hàng khoá đó bình thường', async () => {
    const cats = await http(app).get('/api/v1/questions/categories').set('Authorization', `Bearer ${teacher}`);
    const catIds = (cats.body as { id: string }[]).map((c) => c.id);
    expect(catIds).toContain(courseCatId);
    expect(catIds).not.toContain(systemCatId);

    const list = await http(app).get(`/api/v1/questions/categories/${courseCatId}/questions`).set('Authorization', `Bearer ${teacher}`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(SECRET_TEXT);

    const detail = await http(app).get(`/api/v1/questions/${questionId}`).set('Authorization', `Bearer ${teacher}`);
    expect(detail.status).toBe(200);
    expect(detail.body.question.id).toBe(questionId);
    expect((detail.body.answerKey.solution as { answers: { statementId: string; value: boolean }[] }).answers).toEqual([
      { statementId: 's1', value: true },
      { statementId: 's2', value: true },
      { statementId: 's3', value: true },
      { statementId: 's4', value: true },
    ]);

    const versions = await http(app).get(`/api/v1/questions/${questionId}/versions`).set('Authorization', `Bearer ${teacher}`);
    expect(versions.status).toBe(200);
    expect((versions.body as unknown[]).length).toBe(2);

    const links = await http(app).get(`/api/v1/questions/${questionId}/curriculum-links`).set('Authorization', `Bearer ${teacher}`);
    expect(links.status).toBe(200);
    expect(links.body.questionId).toBe(questionId);

    const stimuli = await http(app).get(`/api/v1/stimuli?categoryId=${courseCatId}`).set('Authorization', `Bearer ${teacher}`);
    expect(stimuli.status).toBe(200);
    expect((stimuli.body as { id: string }[]).map((s) => s.id)).toContain(stimulusId);
    const stimulus = await http(app).get(`/api/v1/stimuli/${stimulusId}`).set('Authorization', `Bearer ${teacher}`);
    expect(stimulus.status).toBe(200);

    const filtered = await http(app).get('/api/v1/questions').set('Authorization', `Bearer ${teacher}`);
    const ids = (filtered.body as { question: { id: string } }[]).map((v) => v.question.id);
    expect(ids).toContain(questionId);
    expect(ids).not.toContain(systemQuestionId);

    const own = await http(app).get(`/api/v1/question-usages/${teacherUsageId}`).set('Authorization', `Bearer ${teacher}`);
    expect(own.status).toBe(200);
    expect(own.body.usage.id).toBe(teacherUsageId);
  });

  it('giáo viên KHÔNG đọc ngân hàng ngữ cảnh system (phạm vi ngữ cảnh khớp cổng ghi)', async () => {
    const detail = await http(app).get(`/api/v1/questions/${systemQuestionId}`).set('Authorization', `Bearer ${teacher}`);
    expect(detail.status).toBe(404);
    expectNoBankContent(detail);
    const list = await http(app).get(`/api/v1/questions/categories/${systemCatId}/questions`).set('Authorization', `Bearer ${teacher}`);
    expect(list.status).toBe(404);
  });

  it('admin đọc mọi thứ; usage của người khác hiện với đội ngân hàng', async () => {
    const detail = await http(app).get(`/api/v1/questions/${systemQuestionId}`).set('Authorization', `Bearer ${admin}`);
    expect(detail.status).toBe(200);
    const usage = await http(app).get(`/api/v1/question-usages/${teacherUsageId}`).set('Authorization', `Bearer ${admin}`);
    expect(usage.status).toBe(200);
  });

  it('tạo danh mục báo nguyên nhân thật: ngữ cảnh lạ là 400, không phải lỗi năng lực', async () => {
    const bogus = await http(app).post('/api/v1/questions/categories').set('Authorization', `Bearer ${admin}`)
      .send({ name: uniqueName('bogusctx'), contextId: '01900000-0000-7000-8000-000000000000' });
    expect(bogus.status).toBe(400);
    expect((bogus.body as { code: string }).code).toBe('question.category_context_not_found');

    const own = await http(app).post('/api/v1/questions/categories').set('Authorization', `Bearer ${teacher}`)
      .send({ name: uniqueName('teachercat'), contextId: courseCtxId });
    expect(own.status).toBeLessThan(300);
    const sys = await http(app).post('/api/v1/questions/categories').set('Authorization', `Bearer ${teacher}`)
      .send({ name: uniqueName('teachercat'), contextId: systemCtxId });
    expect(sys.status).toBe(403);
    expect((sys.body as { code: string }).code).toBe('access.capability_denied');
  });

  it('luồng làm bài của học viên qua engine không bị động tới (usage do hoạt động tạo)', async () => {
    const created = await app.get(QuestionsService).createUsage(studentId, {
      component: 'mod_quiz', slots: [{ questionId }],
    });
    const usageId = created.usage.id as string;
    const attemptId = created.attempts[0].id as string;

    const start = await http(app).post(`/api/v1/question-usages/${usageId}/attempts/${attemptId}/start`)
      .set('Authorization', `Bearer ${student}`);
    expect(start.status).toBeLessThan(300);
    const tfAllTrue = JSON.stringify({ s1: true, s2: true, s3: true, s4: true });
    const submit = await http(app).post(`/api/v1/question-usages/${usageId}/attempts/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student}`).send({ response: tfAllTrue });
    expect(submit.status).toBeLessThan(300);
    const finished = await http(app).post(`/api/v1/question-usages/${usageId}/finish`)
      .set('Authorization', `Bearer ${student}`);
    expect(finished.status).toBeLessThan(300);
    expect(finished.body.state).toBe('finished');
    expect(finished.body.attempts[0].state).toBe('gradedright');
  });

  it('thừa kế solution TF-A (S6): cùng tập mệnh đề không solution thì thừa kế; tập đổi không solution bị từ chối 400', async () => {
    const q = await http(app).post('/api/v1/questions').set('Authorization', `Bearer ${admin}`)
      .send({ categoryId: courseCatId, ...tfBody('S6 inheritance stem') });
    expect(q.status).toBeLessThan(300);
    const qid = q.body.question.id as string;
    const same = await http(app).patch(`/api/v1/questions/${qid}`).set('Authorization', `Bearer ${admin}`)
      .send({ questionText: tfBody('S6 inheritance stem v2').questionText });
    expect(same.status).toBe(200);
    expect(same.body.entry.latestVersion).toBe(2);
    const sameDetail = await http(app).get(`/api/v1/questions/${qid}`).set('Authorization', `Bearer ${admin}`);
    expect((sameDetail.body.answerKey.solution as { answers: { statementId: string; value: boolean }[] }).answers).toEqual([
      { statementId: 's1', value: true },
      { statementId: 's2', value: true },
      { statementId: 's3', value: true },
      { statementId: 's4', value: true },
    ]);
    const changedText = JSON.parse(JSON.stringify(tfBody('S6 inheritance stem v3').questionText)) as {
      content: { content: { attrs: { id: string } }[] }[];
    };
    changedText.content[1]!.content[3]!.attrs.id = 's5';
    const changed = await http(app).patch(`/api/v1/questions/${qid}`).set('Authorization', `Bearer ${admin}`)
      .send({ questionText: changedText });
    expect(changed.status).toBe(400);
    expect((changed.body as { code: string }).code).toBe('question.bad_answer_data');
    const after = await http(app).get(`/api/v1/questions/${qid}`).set('Authorization', `Bearer ${admin}`);
    expect(after.body.entry.latestVersion).toBe(2);
  });
});
