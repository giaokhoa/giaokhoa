import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD, uniqueName } from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser, getFirstSectionId } from '../../support/course-enrolment-helpers';
import { addExamSlot, createExamDraft, createReadyQuestion, pinExam } from '../../support/exam-pin-helpers';

describe('Cập nhật phiên bản ghim + chấm lại theo đáp án (issue #254)', () => {
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

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  interface Ctx {
    courseId: string;
    sectionId: string;
    teacher: string;
    students: { id: string; token: string }[];
  }

  async function setup(studentCount = 2): Promise<Ctx> {
    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);
    const sectionId = await getFirstSectionId(app, admin, course.id);
    const instance = await createEnrolInstance(app, admin, course.id);
    const contexts = await http(app).get('/api/v1/access/contexts').set(bearer(admin));
    const courseCtx = (contexts.body as { id: string; contextLevel: number; instanceId: string }[])
      .find((c) => c.contextLevel === 50 && c.instanceId === course.id)!;
    const teacherUser = await createUserViaApi(app, admin);
    await assignRole(app, admin, teacherUser.id, await roleIdByShortname(app, admin, 'editingteacher'), courseCtx.id);
    const teacher = (await login(app, teacherUser.username, STRONG_PASSWORD)).accessToken;
    const students: Ctx['students'] = [];
    for (let i = 0; i < studentCount; i += 1) {
      const u = await createUserViaApi(app, admin);
      await enrolUser(app, admin, course.id, instance.id, u.id);
      const token = (await login(app, u.username, STRONG_PASSWORD)).accessToken;
      students.push({ id: u.id, token });
    }
    return { courseId: course.id, sectionId, teacher, students };
  }

  function plainText(doc: unknown): string {
    if (!doc || typeof doc !== 'object') return '';
    const node = doc as { type?: string; text?: string; content?: unknown[] };
    if (node.type === 'text') return node.text ?? '';
    return (node.content ?? []).map((child) => plainText(child)).join('');
  }

  async function createQuestion(token: string, name: string, correctIndex = 0): Promise<{ questionId: string; versionId: string }> {
    const me = await http(app).get('/api/v1/users/me').set(bearer(token));
    const ownerId = me.body.id as string;
    const banks = await http(app).get('/api/v1/question-banks?kind=question').set(bearer(token));
    const bank = (banks.body as { id: string; scope: string; bankKind: string; ownerId: string | null; defaultCategoryId: string | null }[])
      .find((b) => b.scope === 'personal' && b.bankKind === 'question' && b.ownerId === ownerId)!;
    const texts = ['Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D'];
    const res = await http(app).post('/api/v1/questions').set(bearer(token)).send({
      categoryId: bank.defaultCategoryId, qtype: 'multichoice', questionText: `Thân câu ${name}?`,
      answers: texts.map((text, i) => ({ text, correct: i === correctIndex })),
    });
    if (res.status !== 201) throw new Error(`create question failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { questionId: res.body.question.id as string, versionId: res.body.latestVersion.id as string };
  }

  async function editQuestionCorrect(token: string, questionId: string, correctIndex: number): Promise<string> {
    const texts = ['Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D'];
    const res = await http(app).patch(`/api/v1/questions/${questionId}`).set(bearer(token)).send({
      answers: texts.map((text, i) => ({ text, correct: i === correctIndex })),
    });
    if (res.status !== 200) throw new Error(`edit question failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.latestVersion.id as string;
  }

  async function setExamSlots(token: string, examId: string, slots: { questionId: string; maxMark?: number }[]): Promise<Record<string, any>> {
    const res = await http(app).put(`/api/v1/exams/${examId}/slots`).set(bearer(token)).send({ slots });
    if (res.status !== 200 && res.status !== 201) throw new Error(`set slots failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as Record<string, any>;
  }

  async function pinnedQuestionVersionOf(examAttemptId: string): Promise<string> {
    const rows = await pg.query<{ question_version_id: string }>(
      `SELECT qa.question_version_id FROM exam_attempts ea
         JOIN question_attempts qa ON qa.question_usage_id = ea.usage_id
        WHERE ea.id = $1`, [examAttemptId]);
    return rows.rows[0]!.question_version_id;
  }

  interface AttemptViewBody {
    attempt: { id: string; state: string; sumGrades: number | null };
    questions: { slot: number; questionAttemptId: string; fraction: number | null; answers: { id: string; text: unknown }[] }[];
  }

  async function finishAttemptChoosing(token: string, pinId: string, answerText: string): Promise<AttemptViewBody> {
    const start = await http(app).post(`/api/v1/exam-pins/${pinId}/attempts`).set(bearer(token)).send({});
    if (start.status !== 200 && start.status !== 201) throw new Error(`start failed: ${start.status} ${JSON.stringify(start.body)}`);
    const view = start.body as AttemptViewBody;
    const q = view.questions.find((x) => x.slot === 1)!;
    const answer = q.answers.find((a) => plainText(a.text) === answerText);
    if (!answer) throw new Error(`answer "${answerText}" not found in attempt view`);
    const ans = await http(app).post(`/api/v1/quiz-attempts/${view.attempt.id}/responses`).set(bearer(token))
      .send({ questionAttemptId: q.questionAttemptId, response: answer.id });
    if (ans.status !== 200 && ans.status !== 201) throw new Error(`answer failed: ${ans.status} ${JSON.stringify(ans.body)}`);
    const submit = await http(app).post(`/api/v1/quiz-attempts/${view.attempt.id}/submit`).set(bearer(token)).send({});
    if (submit.status !== 200 && submit.status !== 201) throw new Error(`submit failed: ${submit.status} ${JSON.stringify(submit.body)}`);
    return submit.body as AttemptViewBody;
  }

  it('(1)+(2) badge dữ kiện đúng ở soạn đề và cấp pin; cập nhật tường minh có diff từng slot và ghi vết', async () => {
    const ctx = await setup();
    const q1 = await createQuestion(ctx.teacher, 'badge-q1');
    const q2 = await createQuestion(ctx.teacher, 'badge-q2');
    const draft = await createExamDraft(app, ctx.teacher, 'Đề cập nhật version');
    await addExamSlot(app, ctx.teacher, draft, { questionId: q1.questionId, maxMark: 1 });
    await addExamSlot(app, ctx.teacher, draft, { questionId: q2.questionId, maxMark: 1 });
    const pin = await pinExam(app, ctx.teacher, ctx.courseId, draft, { sectionId: ctx.sectionId });
    const pinId = pin.id as string;
    const pinnedVersionNumber = pin.examVersionNumber as number;
    expect(pin.hasNewerExamVersion).toBe(false);

    const before = await http(app).get(`/api/v1/exams/${draft.examId}`).set(bearer(ctx.teacher));
    const slotBefore = (before.body.slots as Record<string, any>[]).find((s) => s.questionId === q1.questionId)!;
    expect(slotBefore.hasNewerVersion).toBe(false);
    expect(slotBefore.pinnedVersionNumber).toBe(1);

    await editQuestionCorrect(ctx.teacher, q1.questionId, 0);
    const after = await http(app).get(`/api/v1/exams/${draft.examId}`).set(bearer(ctx.teacher));
    const slotAfter = (after.body.slots as Record<string, any>[]).find((s) => s.questionId === q1.questionId)!;
    expect(slotAfter.hasNewerVersion).toBe(true);
    expect(slotAfter.latestReadyVersionNumber).toBe(2);
    expect(slotAfter.pinnedVersionNumber).toBe(1);

    const newExamView = await setExamSlots(ctx.teacher, draft.examId, [
      { questionId: q1.questionId, maxMark: 1 },
      { questionId: q2.questionId, maxMark: 3 },
    ]);
    const targetVersionId = newExamView.version.id as string;
    const targetVersionNumber = newExamView.version.version as number;
    expect(targetVersionNumber).toBe(pinnedVersionNumber + 1);

    const pinNow = await http(app).get(`/api/v1/exam-pins/${pinId}`).set(bearer(ctx.teacher));
    expect(pinNow.body.quiz.hasNewerExamVersion).toBe(true);
    expect(pinNow.body.quiz.examVersionNumber).toBe(pinnedVersionNumber);
    expect(pinNow.body.quiz.latestExamVersionNumber).toBe(targetVersionNumber);
    const preview = await http(app).get(`/api/v1/exam-pins/${pinId}/version-update`).set(bearer(ctx.teacher));
    expect(preview.status).toBe(200);
    expect(preview.body.available).toBe(true);
    expect(preview.body.blockedByAttempts).toBe(false);
    expect(preview.body.fromVersionNumber).toBe(pinnedVersionNumber);
    expect(preview.body.toVersionNumber).toBe(targetVersionNumber);
    expect(preview.body.toExamVersionId).toBe(targetVersionId);
    const diff1 = (preview.body.slotDiffs as Record<string, any>[]).find((d) => d.position === 1)!;
    expect(diff1.change).toBe('question_version_changed');
    expect(diff1.fromPinnedVersionNumber).toBe(1);
    expect(diff1.toPinnedVersionNumber).toBe(2);
    const diff2 = (preview.body.slotDiffs as Record<string, any>[]).find((d) => d.position === 2)!;
    expect(diff2.change).toBe('mark_changed');
    expect(diff2.fromMaxMark).toBe(1);
    expect(diff2.toMaxMark).toBe(3);

    const applied = await http(app).post(`/api/v1/exam-pins/${pinId}/version-update`).set(bearer(ctx.teacher))
      .send({ toExamVersionId: targetVersionId });
    expect(applied.status === 200 || applied.status === 201).toBe(true);
    expect(applied.body.examVersionId).toBe(targetVersionId);
    expect(applied.body.examVersionNumber).toBe(targetVersionNumber);
    expect(applied.body.hasNewerExamVersion).toBe(false);
    const trace = await pg.query(
      'SELECT pin_id, actor_id, from_exam_version_id, to_exam_version_id FROM exam_pin_version_updates WHERE pin_id = $1', [pinId]);
    expect(trace.rows).toHaveLength(1);
    expect(trace.rows[0].from_exam_version_id).toBe(pin.examVersionId);
    expect(trace.rows[0].to_exam_version_id).toBe(targetVersionId);
    const me = await http(app).get('/api/v1/users/me').set(bearer(ctx.teacher));
    expect(trace.rows[0].actor_id).toBe(me.body.id);

    const again = await http(app).post(`/api/v1/exam-pins/${pinId}/version-update`).set(bearer(ctx.teacher))
      .send({ toExamVersionId: targetVersionId });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('exam.pin_version_unchanged');
    const previewAfter = await http(app).get(`/api/v1/exam-pins/${pinId}/version-update`).set(bearer(ctx.teacher));
    expect(previewAfter.body.available).toBe(false);
  });

  it('(3) pin đã có attempt: API chặn cập nhật version (exam.pin_locked) ở cả đường cập nhật tường minh và đường sửa pin', async () => {
    const ctx = await setup();
    const q = await createQuestion(ctx.teacher, 'locked-q');
    const draft = await createExamDraft(app, ctx.teacher, 'Đề đã có lượt làm');
    await addExamSlot(app, ctx.teacher, draft, { questionId: q.questionId, maxMark: 1 });
    const pin = await pinExam(app, ctx.teacher, ctx.courseId, draft, { sectionId: ctx.sectionId });
    const pinId = pin.id as string;

    const submitted = await finishAttemptChoosing(ctx.students[0]!.token, pinId, 'Đáp án A');
    expect(submitted.attempt.state).toBe('finished');

    const newView = await setExamSlots(ctx.teacher, draft.examId, [{ questionId: q.questionId, maxMark: 2 }]);
    const targetId = newView.version.id as string;
    const preview = await http(app).get(`/api/v1/exam-pins/${pinId}/version-update`).set(bearer(ctx.teacher));
    expect(preview.body.available).toBe(true);
    expect(preview.body.blockedByAttempts).toBe(true);

    const apply = await http(app).post(`/api/v1/exam-pins/${pinId}/version-update`).set(bearer(ctx.teacher))
      .send({ toExamVersionId: targetId });
    expect(apply.status).toBe(400);
    expect(apply.body.code).toBe('exam.pin_locked');

    const patch = await http(app).patch(`/api/v1/exam-pins/${pinId}`).set(bearer(ctx.teacher))
      .send({ examVersionId: targetId });
    expect(patch.status).toBe(400);
    expect(patch.body.code).toBe('exam.pin_locked');
  });

  it('(3b) định nghĩa "đã có attempt" (quyết định Q2, issue #228): lượt ĐANG LÀM DỞ cũng khoá pin — lượt XEM TRƯỚC của giáo viên thì không', async () => {
    const ctx = await setup();
    const q = await createQuestion(ctx.teacher, 'q2-lock-q');
    const draft = await createExamDraft(app, ctx.teacher, 'Đề Q2 khoá theo lượt');
    await addExamSlot(app, ctx.teacher, draft, { questionId: q.questionId, maxMark: 1 });
    const pin = await pinExam(app, ctx.teacher, ctx.courseId, draft, { sectionId: ctx.sectionId });
    const pinId = pin.id as string;

    const previewStart = await http(app).post(`/api/v1/exam-pins/${pinId}/attempts`).set(bearer(ctx.teacher)).send({ preview: true });
    expect([200, 201], JSON.stringify(previewStart.body)).toContain(previewStart.status);
    const v2 = await setExamSlots(ctx.teacher, draft.examId, [{ questionId: q.questionId, maxMark: 2 }]);
    const applyAfterPreview = await http(app).post(`/api/v1/exam-pins/${pinId}/version-update`).set(bearer(ctx.teacher))
      .send({ toExamVersionId: v2.version.id });
    expect(applyAfterPreview.status === 200 || applyAfterPreview.status === 201, JSON.stringify(applyAfterPreview.body)).toBe(true);

    const start = await http(app).post(`/api/v1/exam-pins/${pinId}/attempts`).set(bearer(ctx.students[0]!.token)).send({});
    expect([200, 201], JSON.stringify(start.body)).toContain(start.status);
    expect((start.body as AttemptViewBody).attempt.state).not.toBe('finished');
    const v3 = await setExamSlots(ctx.teacher, draft.examId, [{ questionId: q.questionId, maxMark: 3 }]);
    const preview2 = await http(app).get(`/api/v1/exam-pins/${pinId}/version-update`).set(bearer(ctx.teacher));
    expect(preview2.body.blockedByAttempts).toBe(true);
    const apply = await http(app).post(`/api/v1/exam-pins/${pinId}/version-update`).set(bearer(ctx.teacher))
      .send({ toExamVersionId: v3.version.id });
    expect(apply.status).toBe(400);
    expect(apply.body.code).toBe('exam.pin_locked');
  });

  it('(4)+(5) hai học sinh cùng cửa sổ thấy cùng version; attempt đã có giữ nguyên version và điểm sau khi câu được sửa', async () => {
    const ctx = await setup(3);
    const q = await createQuestion(ctx.teacher, 'frozen-q');
    const draft = await createExamDraft(app, ctx.teacher, 'Đề đóng băng version');
    await addExamSlot(app, ctx.teacher, draft, { questionId: q.questionId, maxMark: 2 });
    const pin = await pinExam(app, ctx.teacher, ctx.courseId, draft, { sectionId: ctx.sectionId });
    const pinId = pin.id as string;

    const s1 = await finishAttemptChoosing(ctx.students[0]!.token, pinId, 'Đáp án A');
    const s2 = await finishAttemptChoosing(ctx.students[1]!.token, pinId, 'Đáp án B');
    expect(await pinnedQuestionVersionOf(s1.attempt.id)).toBe(q.versionId);
    expect(await pinnedQuestionVersionOf(s2.attempt.id)).toBe(q.versionId);
    expect(s1.questions[0]!.fraction).toBe(1);
    expect(s2.questions[0]!.fraction).toBe(0);

    await editQuestionCorrect(ctx.teacher, q.questionId, 1);
    const s1After = await http(app).get(`/api/v1/quiz-attempts/${s1.attempt.id}`).set(bearer(ctx.teacher));
    expect(s1After.body.questions[0].fraction).toBe(1);
    expect(await pinnedQuestionVersionOf(s1.attempt.id)).toBe(q.versionId);
    const s2After = await http(app).get(`/api/v1/quiz-attempts/${s2.attempt.id}`).set(bearer(ctx.teacher));
    expect(s2After.body.questions[0].fraction).toBe(0);

    const s3 = await finishAttemptChoosing(ctx.students[2]!.token, pinId, 'Đáp án A');
    expect(await pinnedQuestionVersionOf(s3.attempt.id)).toBe(q.versionId);
    expect(s3.questions[0]!.fraction).toBe(1);
  });

  it('(6) chấm lại theo đáp án: dry-run khớp áp thật, có log, học sinh xem được lịch sử sửa sau công bố', async () => {
    const ctx = await setup();
    const q = await createQuestion(ctx.teacher, 'regrade-q', 0);
    const draft = await createExamDraft(app, ctx.teacher, 'Đề chấm lại');
    await addExamSlot(app, ctx.teacher, draft, { questionId: q.questionId, maxMark: 2 });
    const pin = await pinExam(app, ctx.teacher, ctx.courseId, draft, { sectionId: ctx.sectionId });
    const pinId = pin.id as string;

    const submitted = await finishAttemptChoosing(ctx.students[0]!.token, pinId, 'Đáp án B');
    expect(submitted.questions[0]!.fraction).toBe(0);
    expect(submitted.attempt.sumGrades).toBe(0);

    const v2 = await editQuestionCorrect(ctx.teacher, q.questionId, 1);

    const forbidden = await http(app).post(`/api/v1/exam-pins/${pinId}/regrades`).set(bearer(ctx.students[0]!.token))
      .send({ questionId: q.questionId, toVersionId: v2, dryRun: true });
    expect(forbidden.status).toBe(403);

    const dry = await http(app).post(`/api/v1/exam-pins/${pinId}/regrades`).set(bearer(ctx.teacher))
      .send({ questionId: q.questionId, toVersionId: v2, dryRun: true });
    expect(dry.status === 200 || dry.status === 201).toBe(true);
    expect(dry.body.dryRun).toBe(true);
    expect(dry.body.fromVersionIds).toEqual([q.versionId]);
    expect(dry.body.changes).toHaveLength(1);
    expect(dry.body.changes[0]).toMatchObject({
      userId: ctx.students[0]!.id, oldFraction: 0, newFraction: 1,
      oldSumGrades: 0, newSumGrades: 2, changed: true,
    });
    const logAfterDry = await http(app).get(`/api/v1/exam-pins/${pinId}/regrades`).set(bearer(ctx.teacher));
    expect(logAfterDry.body).toHaveLength(0);
    expect(await pinnedQuestionVersionOf(submitted.attempt.id)).toBe(q.versionId);

    const applied = await http(app).post(`/api/v1/exam-pins/${pinId}/regrades`).set(bearer(ctx.teacher))
      .send({ questionId: q.questionId, toVersionId: v2, dryRun: false });
    expect(applied.status === 200 || applied.status === 201).toBe(true);
    expect(applied.body.changes).toEqual(dry.body.changes);
    expect(await pinnedQuestionVersionOf(submitted.attempt.id)).toBe(v2);
    const viewAfter = await http(app).get(`/api/v1/quiz-attempts/${submitted.attempt.id}`).set(bearer(ctx.teacher));
    expect(viewAfter.body.questions[0].fraction).toBe(1);
    expect(viewAfter.body.attempt.sumGrades).toBe(2);

    const log = await http(app).get(`/api/v1/exam-pins/${pinId}/regrades`).set(bearer(ctx.teacher));
    expect(log.body).toHaveLength(1);
    expect(log.body[0]).toMatchObject({ questionId: q.questionId, fromVersionId: q.versionId, toVersionId: v2 });
    expect(log.body[0].items).toHaveLength(1);
    expect(log.body[0].items[0]).toMatchObject({ userId: ctx.students[0]!.id, oldSumGrades: 0, newSumGrades: 2 });

    const mineBefore = await http(app).get(`/api/v1/exam-pins/${pinId}/my-regrades`).set(bearer(ctx.students[0]!.token));
    expect(mineBefore.body).toHaveLength(0);
    const publish = await http(app).post(`/api/v1/exam-pins/${pinId}/publish`).set(bearer(ctx.teacher)).send({});
    expect(publish.status === 200 || publish.status === 201).toBe(true);
    const mine = await http(app).get(`/api/v1/exam-pins/${pinId}/my-regrades`).set(bearer(ctx.students[0]!.token));
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].items).toHaveLength(1);
    expect(mine.body[0].items[0]).toMatchObject({ oldSumGrades: 0, newSumGrades: 2 });
    const other = await http(app).get(`/api/v1/exam-pins/${pinId}/my-regrades`).set(bearer(ctx.students[1]!.token));
    expect(other.body).toHaveLength(0);
  });

  it('(7) float_latest_ready: bị chặn ở API cho kiểm tra chính thức, được phép cho luyện tập và phân giải bản ready mới nhất lúc bắt đầu lượt', async () => {
    const ctx = await setup();
    const q = await createQuestion(ctx.teacher, 'float-q');
    const draft = await createExamDraft(app, ctx.teacher, 'Đề float');
    await addExamSlot(app, ctx.teacher, draft, { questionId: q.questionId, maxMark: 1 });
    await http(app).post(`/api/v1/exams/${draft.examId}/status`).set(bearer(ctx.teacher)).send({ status: 'ready' });

    const mkPin = (body: Record<string, unknown>) => http(app).post(`/api/v1/courses/${ctx.courseId}/exam-pins`)
      .set(bearer(ctx.teacher)).send({ sectionId: ctx.sectionId, examId: draft.examId, ...body });

    for (const body of [
      { preset: 'periodic', versionMode: 'float_latest_ready' },
      { preset: 'mock', versionMode: 'float_latest_ready' },
      { versionMode: 'float_latest_ready' },
    ]) {
      const res = await mkPin(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('exam.version_mode_not_allowed');
    }

    const floatPin = await mkPin({ preset: 'regular', versionMode: 'float_latest_ready' });
    expect(floatPin.status).toBe(201);
    expect(floatPin.body.versionMode).toBe('float_latest_ready');
    const floatPinId = floatPin.body.id as string;

    const badPatch = await http(app).patch(`/api/v1/exam-pins/${floatPinId}`).set(bearer(ctx.teacher)).send({ preset: 'periodic' });
    expect(badPatch.status).toBe(400);
    expect(badPatch.body.code).toBe('exam.version_mode_not_allowed');
    const unfloat = await http(app).patch(`/api/v1/exam-pins/${floatPinId}`).set(bearer(ctx.teacher)).send({ versionMode: 'pinned' });
    expect(unfloat.status).toBe(200);
    expect(unfloat.body.versionMode).toBe('pinned');
    const rePreset = await http(app).patch(`/api/v1/exam-pins/${floatPinId}`).set(bearer(ctx.teacher)).send({ preset: 'periodic' });
    expect(rePreset.status).toBe(200);
    const badFloat = await http(app).patch(`/api/v1/exam-pins/${floatPinId}`).set(bearer(ctx.teacher)).send({ versionMode: 'float_latest_ready' });
    expect(badFloat.status).toBe(400);
    expect(badFloat.body.code).toBe('exam.version_mode_not_allowed');

    const floatPin2 = await mkPin({ preset: 'regular', versionMode: 'float_latest_ready' });
    const floatPin2Id = floatPin2.body.id as string;
    const early = await finishAttemptChoosing(ctx.students[0]!.token, floatPin2Id, 'Đáp án A');
    expect(await pinnedQuestionVersionOf(early.attempt.id)).toBe(q.versionId);
    const v2 = await editQuestionCorrect(ctx.teacher, q.questionId, 0);
    const late = await finishAttemptChoosing(ctx.students[1]!.token, floatPin2Id, 'Đáp án A');
    expect(await pinnedQuestionVersionOf(late.attempt.id)).toBe(v2);
    expect(await pinnedQuestionVersionOf(early.attempt.id)).toBe(q.versionId);
  });

  it('(9) sao chép khoá mang theo cờ version_mode (Q3, issue #228): pin float vẫn float, pin pinned vẫn pinned', async () => {
    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id, { startDate: '2026-03-02', endDate: '2026-05-30' });
    const sectionId = await getFirstSectionId(app, admin, course.id);
    const q = await createReadyQuestion(app, admin, 'Q3 câu sao chép');
    const draft = await createExamDraft(app, admin, 'Đề Q3 sao chép');
    await addExamSlot(app, admin, draft, { questionId: q, maxMark: 1 });
    const ready = await http(app).post(`/api/v1/exams/${draft.examId}/status`).set(bearer(admin)).send({ status: 'ready' });
    expect(ready.status, JSON.stringify(ready.body)).toBe(201);

    const floatPin = await http(app).post(`/api/v1/courses/${course.id}/exam-pins`).set(bearer(admin))
      .send({ sectionId, examId: draft.examId, preset: 'regular', versionMode: 'float_latest_ready' });
    expect(floatPin.status, JSON.stringify(floatPin.body)).toBe(201);
    expect(floatPin.body.versionMode).toBe('float_latest_ready');
    const pinnedPin = await http(app).post(`/api/v1/courses/${course.id}/exam-pins`).set(bearer(admin))
      .send({ sectionId, examId: draft.examId });
    expect(pinnedPin.status, JSON.stringify(pinnedPin.body)).toBe(201);
    expect(pinnedPin.body.versionMode).toBe('pinned');

    const dup = await http(app).post(`/api/v1/courses/${course.id}/copy`).set(bearer(admin))
      .send({ fullName: 'Bản sao khoá Q3', shortName: uniqueName('q3copy'), startDate: '2026-09-07' });
    expect(dup.status, JSON.stringify(dup.body)).toBe(201);

    const copied = await http(app).get(`/api/v1/courses/${dup.body.id}/exam-pins`).set(bearer(admin));
    expect(copied.body).toHaveLength(2);
    const modes: string[] = [];
    for (const p of copied.body as { id: string }[]) {
      expect([floatPin.body.id, pinnedPin.body.id]).not.toContain(p.id);
      const detail = await http(app).get(`/api/v1/exam-pins/${p.id}`).set(bearer(admin));
      modes.push(detail.body.quiz.versionMode as string);
    }
    expect(modes.sort()).toEqual(['float_latest_ready', 'pinned']);
  });
});
