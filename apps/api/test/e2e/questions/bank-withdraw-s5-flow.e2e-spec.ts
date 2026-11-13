import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login,
  roleIdByShortname, STRONG_PASSWORD, systemContextId, uniqueName,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser, getFirstSectionId } from '../../support/course-enrolment-helpers';


const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface BankBody { id: string; scope: string; bankKind: string; ownerId: string | null; defaultCategoryId: string | null }
interface PaperBody {
  paper: {
    id: string; status: string;
    withdrawnReason: string | null; withdrawnBy: string | null; withdrawnAt: string | null;
  };
  version: { id: string };
}
interface MatrixBody {
  id: string; status: string;
  withdrawnReason: string | null; withdrawnBy: string | null; withdrawnAt: string | null;
}

describe('Bank withdraw trace S5 (issue #228): rút/khôi phục đề + ma trận', () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
  }, 120_000);
  afterAll(async () => { await app.close(); });

  async function mkStaffUser(): Promise<{ id: string; token: string }> {
    const u = await createUserViaApi(app, admin);
    await assignRole(app, admin, u.id, await roleIdByShortname(app, admin, 'teacher'), await systemContextId(app, admin));
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, token: session.accessToken };
  }

  async function bankOfKind(token: string, kind: 'question' | 'exam' | 'matrix', ownerId: string): Promise<BankBody> {
    const res = await http(app).get(`/api/v1/question-banks?kind=${kind}`).set(bearer(token));
    const bank = (res.body as BankBody[]).find((b) => b.scope === 'personal' && b.bankKind === kind && b.ownerId === ownerId);
    expect(bank).toBeTruthy();
    return bank!;
  }

  it('TC-S5-1: rút đề kèm truy vết — pin đã ghim vẫn thi được, đổi trạng thái thường bị gác, khôi phục xoá sạch truy vết', async () => {
    const owner = await mkStaffUser();
    const qBank = await bankOfKind(owner.token, 'question', owner.id);
    const eBank = await bankOfKind(owner.token, 'exam', owner.id);
    const qRes = await http(app).post('/api/v1/questions').set(bearer(owner.token)).send({
      categoryId: qBank.defaultCategoryId, qtype: 'multichoice', questionText: 'Câu S5?',
      answers: [{ text: 'Đúng', correct: true }, { text: 'Sai', correct: false }, { text: 'Khác 1', correct: false }, { text: 'Khác 2', correct: false }],
    });
    const q1 = (qRes.body as { question: { id: string } }).question.id;
    const paperRes = await http(app).post(`/api/v1/exams/banks/${eBank.id}/exams`).set(bearer(owner.token))
      .send({ name: 'Đề S5-1', examKind: 'regular', slots: [{ questionId: q1 }] });
    const paper = paperRes.body as PaperBody;
    expect(paper.paper.status).toBe('draft');
    expect(paper.paper.withdrawnReason).toBeNull();
    await http(app).post(`/api/v1/exams/${paper.paper.id}/status`).set(bearer(owner.token)).send({ status: 'ready' });

    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);
    const sectionId = await getFirstSectionId(app, admin, course.id);
    const contexts = await http(app).get('/api/v1/access/contexts').set(bearer(admin));
    const courseCtx = (contexts.body as { id: string; contextLevel: number; instanceId: string }[])
      .find((c) => c.contextLevel === 50 && c.instanceId === course.id)!;
    await assignRole(app, admin, owner.id, await roleIdByShortname(app, admin, 'editingteacher'), courseCtx.id);
    const studentUser = await createUserViaApi(app, admin);
    const instance = await createEnrolInstance(app, admin, course.id);
    await enrolUser(app, admin, course.id, instance.id, studentUser.id);
    const student = (await login(app, studentUser.username, STRONG_PASSWORD)).accessToken;
    const pin = await http(app).post(`/api/v1/courses/${course.id}/exam-pins`).set(bearer(owner.token))
      .send({ sectionId, examId: paper.paper.id, name: 'Pin S5-1' });
    expect(pin.status, JSON.stringify(pin.body)).toBe(201);
    const pinId = (pin.body as { id: string }).id;

    const emptyReason = await http(app).post(`/api/v1/exams/${paper.paper.id}/withdraw`).set(bearer(owner.token)).send({ reason: '   ' });
    expect(emptyReason.status).toBe(400);

    const withdrawn = await http(app).post(`/api/v1/exams/${paper.paper.id}/withdraw`).set(bearer(owner.token))
      .send({ reason: 'Đề lỗi cấu trúc phần 2' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(201);
    expect(withdrawn.body).toMatchObject({ examId: paper.paper.id, status: 'hidden', affectedPinIds: [pinId] });
    const view = await http(app).get(`/api/v1/exams/${paper.paper.id}`).set(bearer(owner.token));
    const viewPaper = (view.body as PaperBody).paper;
    expect(viewPaper.status).toBe('hidden');
    expect(viewPaper.withdrawnReason).toBe('Đề lỗi cấu trúc phần 2');
    expect(viewPaper.withdrawnBy).toBe(owner.id);
    expect(viewPaper.withdrawnAt).toBeTruthy();

    const flip = await http(app).post(`/api/v1/exams/${paper.paper.id}/status`).set(bearer(owner.token)).send({ status: 'ready' });
    expect(flip.status).toBe(409);
    expect((flip.body as { code?: string }).code).toBe('exam.status_withdrawn');

    const start = await http(app).post(`/api/v1/exam-pins/${pinId}/attempts`).set(bearer(student)).send({});
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    expect((start.body as { questions: unknown[] }).questions).toHaveLength(1);
    const pinAgain = await http(app).post(`/api/v1/courses/${course.id}/exam-pins`).set(bearer(owner.token))
      .send({ sectionId, examId: paper.paper.id, name: 'Pin mới trên đề đã rút' });
    expect(pinAgain.status).toBe(400);
    expect((pinAgain.body as { code?: string }).code).toBe('exam.pin_requires_ready');
    const again = await http(app).post(`/api/v1/exams/${paper.paper.id}/withdraw`).set(bearer(owner.token)).send({ reason: 'Lại rút' });
    expect(again.status).toBe(409);
    expect((again.body as { code?: string }).code).toBe('exam.already_withdrawn');

    const restored = await http(app).post(`/api/v1/exams/${paper.paper.id}/restore`).set(bearer(owner.token)).send({});
    expect(restored.status, JSON.stringify(restored.body)).toBe(201);
    expect(restored.body).toMatchObject({ examId: paper.paper.id, status: 'ready' });
    const viewAfter = await http(app).get(`/api/v1/exams/${paper.paper.id}`).set(bearer(owner.token));
    const afterPaper = (viewAfter.body as PaperBody).paper;
    expect(afterPaper.status).toBe('ready');
    expect(afterPaper.withdrawnReason).toBeNull();
    expect(afterPaper.withdrawnBy).toBeNull();
    expect(afterPaper.withdrawnAt).toBeNull();
    const restoreAgain = await http(app).post(`/api/v1/exams/${paper.paper.id}/restore`).set(bearer(owner.token)).send({});
    expect(restoreAgain.status).toBe(409);
    expect((restoreAgain.body as { code?: string }).code).toBe('exam.not_withdrawn');
  }, 120_000);

  it('TC-S5-2: rút ma trận kèm truy vết — PATCH trạng thái bị gác, sửa trường khác vẫn được, khôi phục xoá sạch truy vết', async () => {
    const owner = await mkStaffUser();
    const matrixBank = await bankOfKind(owner.token, 'matrix', owner.id);
    const contexts = await http(app).get('/api/v1/access/contexts').set(bearer(admin));
    const systemCtx = (contexts.body as { id: string; contextLevel: number }[]).find((c) => c.contextLevel === 10)!;
    const subj = await http(app).post('/api/v1/curriculum/subjects').set(bearer(admin))
      .send({ contextId: systemCtx.id, name: uniqueName('Môn S5'), slug: uniqueName('mon-s5') });
    const curr = await http(app).post('/api/v1/curriculum/curricula').set(bearer(admin)).send({ subjectId: subj.body.id, grade: 10 });
    const matrixRes = await http(app).post('/api/v1/exam-matrices').set(bearer(owner.token))
      .send({ name: 'Ma trận S5-2', subjectId: subj.body.id, curriculumId: curr.body.id, bankId: matrixBank.id, totalScore: 10 });
    expect(matrixRes.status, JSON.stringify(matrixRes.body)).toBeLessThan(300);
    const matrix = matrixRes.body as MatrixBody;
    expect(matrix.status).toBe('draft');
    expect(matrix.withdrawnAt).toBeNull();
    const ready = await http(app).patch(`/api/v1/exam-matrices/${matrix.id}`).set(bearer(owner.token)).send({ status: 'ready' });
    expect(ready.status).toBe(200);

    const emptyReason = await http(app).post(`/api/v1/exam-matrices/${matrix.id}/withdraw`).set(bearer(owner.token)).send({ reason: '' });
    expect(emptyReason.status).toBe(400);

    const withdrawn = await http(app).post(`/api/v1/exam-matrices/${matrix.id}/withdraw`).set(bearer(owner.token))
      .send({ reason: 'Sai cấu trúc lưới' });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(201);
    expect(withdrawn.body).toMatchObject({ matrixId: matrix.id, status: 'hidden' });
    const view = await http(app).get(`/api/v1/exam-matrices/${matrix.id}`).set(bearer(owner.token));
    const viewMatrix = view.body as MatrixBody;
    expect(viewMatrix.status).toBe('hidden');
    expect(viewMatrix.withdrawnReason).toBe('Sai cấu trúc lưới');
    expect(viewMatrix.withdrawnBy).toBe(owner.id);
    expect(viewMatrix.withdrawnAt).toBeTruthy();

    const flip = await http(app).patch(`/api/v1/exam-matrices/${matrix.id}`).set(bearer(owner.token)).send({ status: 'ready' });
    expect(flip.status).toBe(409);
    expect((flip.body as { code?: string }).code).toBe('quiz.matrix_status_withdrawn');
    const rename = await http(app).patch(`/api/v1/exam-matrices/${matrix.id}`).set(bearer(owner.token)).send({ name: 'Ma trận S5-2 (đã rút)' });
    expect(rename.status, JSON.stringify(rename.body)).toBe(200);

    const schoolRes = await http(app).post('/api/v1/question-banks').set(bearer(admin))
      .send({ name: uniqueName('Bank ma trận trường S5'), scope: 'school', bankKind: 'matrix' });
    const propose = await http(app).post(`/api/v1/exam-matrices/${matrix.id}/contributions`).set(bearer(owner.token))
      .send({ targetBankId: (schoolRes.body as { id: string }).id });
    expect(propose.status).toBe(400);
    expect((propose.body as { code?: string }).code).toBe('quiz.matrix_contribution_source_not_ready');
    const again = await http(app).post(`/api/v1/exam-matrices/${matrix.id}/withdraw`).set(bearer(owner.token)).send({ reason: 'Lại rút' });
    expect(again.status).toBe(409);
    expect((again.body as { code?: string }).code).toBe('quiz.matrix_already_withdrawn');

    const restored = await http(app).post(`/api/v1/exam-matrices/${matrix.id}/restore`).set(bearer(owner.token)).send({});
    expect(restored.status, JSON.stringify(restored.body)).toBe(201);
    expect(restored.body).toMatchObject({ matrixId: matrix.id, status: 'ready' });
    const viewAfter = await http(app).get(`/api/v1/exam-matrices/${matrix.id}`).set(bearer(owner.token));
    const afterMatrix = viewAfter.body as MatrixBody;
    expect(afterMatrix.status).toBe('ready');
    expect(afterMatrix.withdrawnReason).toBeNull();
    expect(afterMatrix.withdrawnBy).toBeNull();
    expect(afterMatrix.withdrawnAt).toBeNull();
    const restoreAgain = await http(app).post(`/api/v1/exam-matrices/${matrix.id}/restore`).set(bearer(owner.token)).send({});
    expect(restoreAgain.status).toBe(409);
    expect((restoreAgain.body as { code?: string }).code).toBe('quiz.matrix_not_withdrawn');
  }, 120_000);
});
