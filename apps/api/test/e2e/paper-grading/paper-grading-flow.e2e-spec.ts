import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD } from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser, getFirstSectionId } from '../../support/course-enrolment-helpers';
import { addExamSlot, createExamDraft, pinExam } from '../../support/exam-pin-helpers';
import { computeSheetGeometry, sbdCodeChecksumOk } from '../../../src/modules/paper-grading/domain/sheet-layout';
import { renderSheetRgba, simulatePhoto, type SlotFill } from '../../../src/modules/paper-grading/domain/sheet-render';
import { sheetQrPayload } from '../../../src/modules/paper-grading/domain/sheet-pdf';

describe('Luồng chấm bài giấy CAM-0', () => {
  let app: INestApplication;
  let admin: string;
  let pg: Client;

  const CORRECT = [1, 0, 3, 2];
  const OPTION_COUNTS = [4, 4, 4, 4, 8];

  interface Ctx {
    courseId: string;
    instanceId: string;
    quizId: string;
    teacher: string;
    studentA: { id: string; username: string };
    studentB: { id: string; username: string };
    tokenA: string;
    batch: { id: string; variantCode: string; examCode: string | null; codeDigits: number; roster: { code: string; userId: string }[]; layout: { slot: number; optionCount: number }[] };
  }
  let ctx: Ctx;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();

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

    const studentA = await createUserViaApi(app, admin);
    const studentB = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, instance.id, studentA.id);
    await enrolUser(app, admin, course.id, instance.id, studentB.id);
    const tokenA = (await login(app, studentA.username, STRONG_PASSWORD)).accessToken;

    const bankRes = await http(app).post('/api/v1/questions/categories').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Paper bank', contextId: courseCtx.id });
    const bankCatId = bankRes.body.id as string;
    async function makeQuestion(body: Record<string, unknown>): Promise<string> {
      const res = await http(app).post('/api/v1/questions').set('Authorization', `Bearer ${admin}`).send({ categoryId: bankCatId, ...body });
      if (res.status !== 201 && res.status !== 200) throw new Error(`create question failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.question.id as string;
    }
    const mcIds: string[] = [];
    for (let q = 0; q < 4; q++) {
      mcIds.push(await makeQuestion({
        qtype: 'multichoice', questionText: `Question ${q + 1}?`, defaultMark: 2,
        answers: [0, 1, 2, 3].map((k) => ({ text: `Option ${k}`, correct: k === CORRECT[q] })),
      }));
    }
    const tfId = await makeQuestion({
      qtype: 'truefalse', defaultMark: 2,
      questionText: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'The sky is blue. Xét các mệnh đề:' }] },
          {
            type: 'statementList',
            content: [true, false, true, false].map((_v, i) => ({
              type: 'statement',
              attrs: { id: `s${i + 1}` },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: `Statement ${i + 1}` }] }],
            })),
          },
        ],
      },
      solution: { answers: [true, false, true, false].map((v, i) => ({ statementId: `s${i + 1}`, value: v })) },
    });

    const draft = await createExamDraft(app, teacher, 'Paper Quiz', 10);
    for (const qid of [...mcIds, tfId]) {
      await addExamSlot(app, teacher, draft, { questionId: qid, maxMark: 2 });
    }
    const pin = await pinExam(app, teacher, course.id, draft, { sectionId, gradeMethod: 'highest' });
    const quizId = pin.id as string;

    const batchRes = await http(app).post(`/api/v1/exam-batches?pinId=${quizId}`).set('Authorization', `Bearer ${teacher}`).send({});
    if (batchRes.status !== 201) throw new Error(`create batch failed: ${batchRes.status} ${JSON.stringify(batchRes.body)}`);

    ctx = {
      courseId: course.id, instanceId: instance.id, quizId, teacher,
      studentA: { id: studentA.id, username: studentA.username },
      studentB: { id: studentB.id, username: studentB.username },
      tokenA, batch: batchRes.body,
    };
  });
  afterAll(async () => { await pg.end(); await app.close(); });

  function photoFor(input: {
    qrText: string | null; bubbleCode: string | null; fills: Map<number, SlotFill>;
    seed: number; blurPasses?: number;
    variantCode?: string | null;
    variantLightDigit?: number;
    codeDigits?: number;
  }): Buffer {
    const geometry = computeSheetGeometry(OPTION_COUNTS, input.codeDigits ?? 4);
    const sheet = renderSheetRgba({
      geometry, qrText: input.qrText, bubbleCode: input.bubbleCode, fills: input.fills,
      variantCode: input.variantCode, variantLightDigit: input.variantLightDigit,
    });
    return simulatePhoto(sheet, { seed: input.seed, blurPasses: input.blurPasses ?? 0 });
  }

  function upload(photo: Buffer, name: string, token: string) {
    return http(app)
      .post(`/api/v1/exam-batches/${ctx.batch.id}/scans`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', photo, name);
  }

  function uploadSession(photo: Buffer, name: string, token: string) {
    return http(app)
      .post(`/api/v1/exam-scans?pinId=${ctx.quizId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', photo, name);
  }

  async function createBatch(body: Record<string, unknown>) {
    const res = await http(app).post(`/api/v1/exam-batches?pinId=${ctx.quizId}`).set('Authorization', `Bearer ${ctx.teacher}`).send(body);
    if (res.status !== 201) throw new Error(`create batch failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as {
      id: string; variantCode: string; examCode: string | null; codeDigits: number;
      roster: { code: string; userId: string }[];
    };
  }

  const CORRECT_FILLS = () => {
    const fills = new Map<number, SlotFill>();
    CORRECT.forEach((choice, i) => fills.set(i + 1, { choice, style: 'full' }));
    fills.set(5, { choice: 0, choices: [3, 4, 7], style: 'full' });
    return fills;
  };

  it('lô ghim layout và chụp danh sách chỉ-học-viên kèm mã ô tròn', () => {
    expect(ctx.batch.variantCode).toBe('A');
    expect(ctx.batch.examCode).toBe('1001');
    expect(ctx.batch.codeDigits).toBe(4);
    expect(ctx.batch.layout).toHaveLength(5);
    expect(ctx.batch.layout.map((l) => l.optionCount)).toEqual(OPTION_COUNTS);
    const rosterIds = ctx.batch.roster.map((r) => r.userId).sort();
    expect(rosterIds).toEqual([ctx.studentA.id, ctx.studentB.id].sort());
    for (const entry of ctx.batch.roster) expect(entry.code).toMatch(/^\d{4}$/);
  });

  it('từ chối mã biến thể trùng và mã đề trùng cho cùng quiz', async () => {
    const res = await http(app).post(`/api/v1/exam-batches?pinId=${ctx.quizId}`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ variantCode: 'A' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('paper.variant_exists');
    const dupExam = await http(app).post(`/api/v1/exam-batches?pinId=${ctx.quizId}`).set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ examCode: '1001' });
    expect(dupExam.status).toBe(409);
    expect(dupExam.body.code).toBe('paper.exam_code_exists');
  });

  it('phục vụ PDF phiếu: chung mặc định, cá nhân hoá chỉ khi chọn tường minh', async () => {
    const parsePdf = (res: unknown, cb: (err: Error | null, body?: Buffer) => void) => {
      const chunks: Buffer[] = [];
      (res as NodeJS.ReadableStream).on('data', (c: Buffer) => chunks.push(c));
      (res as NodeJS.ReadableStream).on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const shared = await http(app).get(`/api/v1/exam-batches/${ctx.batch.id}/sheets?format=pdf`)
      .set('Authorization', `Bearer ${ctx.teacher}`).buffer(true).parse(parsePdf);
    expect(shared.status).toBe(200);
    expect(shared.headers['content-type']).toContain('application/pdf');
    expect((shared.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect(shared.headers['content-disposition']).toContain('dung-chung');
    const personal = await http(app).get(`/api/v1/exam-batches/${ctx.batch.id}/sheets?format=pdf&kind=personalized`)
      .set('Authorization', `Bearer ${ctx.teacher}`).buffer(true).parse(parsePdf);
    expect(personal.status).toBe(200);
    expect(personal.headers['content-disposition']).toContain('ca-nhan');
    const blank = await http(app).get(`/api/v1/exam-batches/${ctx.batch.id}/sheets?format=pdf&kind=blank&copies=1`)
      .set('Authorization', `Bearer ${ctx.teacher}`);
    expect(blank.status).toBe(200);
  });

  it('tham số copies không phải số nguyên trong khoảng trả 400 ProblemDetails thay vì PDF 0 trang', async () => {
    const bad = await http(app).get(`/api/v1/exam-batches/${ctx.batch.id}/sheets?format=pdf&copies=abc`)
      .set('Authorization', `Bearer ${ctx.teacher}`);
    expect(bad.status).toBe(400);
    expect(bad.headers['content-type']).toContain('application/problem+json');
    expect(bad.body.code).toBe('http.validation_failed');
    const zero = await http(app).get(`/api/v1/exam-batches/${ctx.batch.id}/sheets?format=pdf&copies=0`)
      .set('Authorization', `Bearer ${ctx.teacher}`);
    expect(zero.status).toBe(400);
    expect(zero.body.code).toBe('http.validation_failed');
  });

  it('học viên hoàn toàn không chạm được bề mặt chấm bài giấy', async () => {
    const create = await http(app).post(`/api/v1/exam-batches?pinId=${ctx.quizId}`).set('Authorization', `Bearer ${ctx.tokenA}`).send({});
    expect(create.status).toBe(403);
    const list = await http(app).get(`/api/v1/exam-scans?pinId=${ctx.quizId}`).set('Authorization', `Bearer ${ctx.tokenA}`);
    expect(list.status).toBe(403);
  });

  it('phiếu cá nhân hoá: định danh QR, tất cả chắc chắn → sẵn sàng → ghi kèm điểm kiểm tay', async () => {
    const fills = new Map<number, SlotFill>([
      [1, { choice: CORRECT[0]!, style: 'full' }],
      [2, { choice: CORRECT[1]!, style: 'full' }],
      [3, { choice: (CORRECT[2]! + 1) % 4, style: 'full' }],
      [4, { choice: CORRECT[3]!, style: 'full' }],
    ]);
    fills.set(5, { choice: 0, choices: [3, 4, 7], style: 'full' });
    const photo = photoFor({ qrText: sheetQrPayload(ctx.batch.id, ctx.batch.variantCode, ctx.studentA.id), bubbleCode: null, fills, seed: 111 });
    const res = await upload(photo, 'a.png', ctx.teacher);
    expect(res.status).toBe(201);
    const outcome = (res.body as { fileName: string; stored: boolean; scan?: { id: string; status: string; studentId: string; identitySource: string } }[])[0]!;
    expect(outcome.stored).toBe(true);
    expect(outcome.scan!.status).toBe('ready');
    expect(outcome.scan!.studentId).toBe(ctx.studentA.id);
    expect(outcome.scan!.identitySource).toBe('qr');

    const rec = await http(app).post(`/api/v1/exam-scans/${outcome.scan!.id}/record`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(rec.status).toBe(201);
    expect(rec.body.status).toBe('recorded');
    expect(rec.body.sumGrades).toBe(8);
    expect(rec.body.attemptId).toBeTruthy();

    const attempt = await pg.query<{ state: string; sum_grades: string; source: string }>(
      `select state, sum_grades, applied_settings->>'source' as source from exam_attempts where id = $1`, [rec.body.attemptId]);
    expect(attempt.rows[0]!.state).toBe('finished');
    expect(Number(attempt.rows[0]!.sum_grades)).toBe(8);
    expect(attempt.rows[0]!.source).toBe('paper-scan');

    const again = await http(app).post(`/api/v1/exam-scans/${outcome.scan!.id}/record`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('paper.already_recorded');
  });

  it('phiếu trắng: định danh bằng mã ô tròn, một đáp án mơ hồ chờ giáo viên, rồi ghi điểm tối đa', async () => {
    const codeB = ctx.batch.roster.find((r) => r.userId === ctx.studentB.id)!.code;
    const fills = new Map<number, SlotFill>([
      [1, { choice: CORRECT[0]!, style: 'full' }],
      [2, { choice: CORRECT[1]!, style: 'light' }],
      [3, { choice: CORRECT[2]!, style: 'full' }],
      [4, { choice: CORRECT[3]!, style: 'full' }],
    ]);
    fills.set(5, { choice: 0, choices: [3, 4, 7], style: 'full' });
    const photo = photoFor({ qrText: sheetQrPayload(ctx.batch.id, ctx.batch.variantCode, null), bubbleCode: codeB, fills, seed: 222 });
    const res = await upload(photo, 'b.png', ctx.teacher);
    expect(res.status).toBe(201);
    const outcome = (res.body as { stored: boolean; scan?: { id: string; status: string; studentId: string; identitySource: string } }[])[0]!;
    expect(outcome.stored).toBe(true);
    expect(outcome.scan!.studentId).toBe(ctx.studentB.id);
    expect(outcome.scan!.identitySource).toBe('bubbles');
    expect(outcome.scan!.status).toBe('needs_review');

    const early = await http(app).post(`/api/v1/exam-scans/${outcome.scan!.id}/record`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('paper.scan_not_ready');

    const resolved = await http(app).post(`/api/v1/exam-scans/${outcome.scan!.id}/resolve-readings`)
      .set('Authorization', `Bearer ${ctx.teacher}`)
      .send({ readings: [{ slot: 2, chosen: CORRECT[1] }] });
    expect(resolved.status).toBe(201);
    expect(resolved.body.status).toBe('ready');

    const rec = await http(app).post(`/api/v1/exam-scans/${outcome.scan!.id}/record`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(rec.status).toBe(201);
    expect(rec.body.sumGrades).toBe(10);
  });

  it('mã ô tròn bị sửa rơi vào hàng đợi định danh; gán thủ công sửa nó; bản quét chưa ghi có thể xoá', async () => {
    const good = ctx.batch.roster.find((r) => r.userId === ctx.studentA.id)!.code;
    const tampered = `${good.slice(0, 3)}${(Number(good[3]) + 1) % 10}`;
    const fills = new Map<number, SlotFill>([
      [1, { choice: CORRECT[0]!, style: 'full' }],
      [2, { choice: CORRECT[1]!, style: 'full' }],
      [3, { choice: CORRECT[2]!, style: 'full' }],
      [4, { choice: CORRECT[3]!, style: 'full' }],
    ]);
    fills.set(5, { choice: 0, choices: [3, 4, 7], style: 'full' });
    const photo = photoFor({ qrText: sheetQrPayload(ctx.batch.id, ctx.batch.variantCode, null), bubbleCode: tampered, fills, seed: 333 });
    const res = await upload(photo, 'c.png', ctx.teacher);
    expect(res.status).toBe(201);
    const outcome = (res.body as { stored: boolean; scan?: { id: string; status: string; studentId: string | null; identityCode: string | null } }[])[0]!;
    expect(outcome.stored).toBe(true);
    expect(outcome.scan!.status).toBe('needs_identity');
    expect(outcome.scan!.studentId).toBeNull();
    expect(outcome.scan!.identityCode).toBe(tampered);

    const outsider = await createUserViaApi(app, admin);
    const bad = await http(app).post(`/api/v1/exam-scans/${outcome.scan!.id}/assign-identity`)
      .set('Authorization', `Bearer ${ctx.teacher}`).send({ studentId: outsider.id });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('paper.student_not_in_roster');
    const assigned = await http(app).post(`/api/v1/exam-scans/${outcome.scan!.id}/assign-identity`)
      .set('Authorization', `Bearer ${ctx.teacher}`).send({ studentId: ctx.studentA.id });
    expect(assigned.status).toBe(201);
    expect(assigned.body.status).toBe('ready');
    expect(assigned.body.identitySource).toBe('manual');

    const imgDenied = await http(app).get(`/api/v1/exam-scans/${outcome.scan!.id}/image/warped`).set('Authorization', `Bearer ${ctx.tokenA}`);
    expect(imgDenied.status).toBe(403);
    const imgOk = await http(app).get(`/api/v1/exam-scans/${outcome.scan!.id}/image/warped`).set('Authorization', `Bearer ${ctx.teacher}`);
    expect(imgOk.status).toBe(200);

    const del = await http(app).delete(`/api/v1/exam-scans/${outcome.scan!.id}`).set('Authorization', `Bearer ${ctx.teacher}`);
    expect(del.status).toBe(200);
    const gone = await http(app).get(`/api/v1/exam-scans/${outcome.scan!.id}`).set('Authorization', `Bearer ${ctx.teacher}`);
    expect(gone.status).toBe(404);
  });

  it('cổng chất lượng từ chối thẳng ảnh mờ nặng (422, không lưu gì)', async () => {
    const fills = new Map<number, SlotFill>([[1, { choice: 0, style: 'full' }]]);
    const photo = photoFor({ qrText: sheetQrPayload(ctx.batch.id, ctx.batch.variantCode, ctx.studentA.id), bubbleCode: null, fills, seed: 444, blurPasses: 8 });
    const res = await upload(photo, 'blur.png', ctx.teacher);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('paper.all_images_rejected');
    const queue = await http(app).get(`/api/v1/exam-scans?pinId=${ctx.quizId}&status=needs_identity`).set('Authorization', `Bearer ${ctx.teacher}`);
    expect(queue.status).toBe(200);
    expect((queue.body as unknown[]).length).toBe(0);
  });


  type ScanOutcome = { fileName: string; stored: boolean; scan?: { id: string; batchId: string | null; sessionId: string | null; status: string; studentId: string | null; identitySource: string | null; identityCode: string | null; variantCodeRead: string | null } };

  it('tải lên theo phiên định tuyến phiếu chung tới lô in của nó theo mã đề đã tô, rồi ghi', async () => {
    const batch2 = await createBatch({ examCode: '1002' });
    const codeB = batch2.roster.find((r) => r.userId === ctx.studentB.id)!.code;
    const photo = photoFor({
      qrText: sheetQrPayload(batch2.id, '1002', null), bubbleCode: codeB,
      variantCode: '1002', fills: CORRECT_FILLS(), seed: 555,
    });
    const res = await uploadSession(photo, 'session-b.png', ctx.teacher);
    expect(res.status).toBe(201);
    const outcome = (res.body as ScanOutcome[])[0]!;
    expect(outcome.stored).toBe(true);
    expect(outcome.scan!.batchId).toBe(batch2.id);
    expect(outcome.scan!.sessionId).toBeTruthy();
    expect(outcome.scan!.variantCodeRead).toBe('1002');
    expect(outcome.scan!.studentId).toBe(ctx.studentB.id);
    expect(outcome.scan!.identitySource).toBe('bubbles');
    expect(outcome.scan!.status).toBe('ready');

    const rec = await http(app).post(`/api/v1/exam-scans/${outcome.scan!.id}/record`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(rec.status).toBe(201);
    expect(rec.body.sumGrades).toBe(10);
  });

  it('phiếu thứ hai nhận học viên đã khớp chờ trong hàng đợi định danh thay vì ghi đè', async () => {
    const batch2Id = (await http(app).get(`/api/v1/exam-batches?pinId=${ctx.quizId}`).set('Authorization', `Bearer ${ctx.teacher}`)).body
      .find((b: { examCode: string }) => b.examCode === '1002').id as string;
    const batches = (await http(app).get(`/api/v1/exam-batches?pinId=${ctx.quizId}`).set('Authorization', `Bearer ${ctx.teacher}`)).body as { id: string; roster: { code: string; userId: string }[] }[];
    const codeB = batches.find((b) => b.id === batch2Id)!.roster.find((r) => r.userId === ctx.studentB.id)!.code;
    const photo = photoFor({
      qrText: sheetQrPayload(batch2Id, '1002', null), bubbleCode: codeB,
      variantCode: '1002', fills: CORRECT_FILLS(), seed: 556,
    });
    const res = await uploadSession(photo, 'session-b-dup.png', ctx.teacher);
    expect(res.status).toBe(201);
    const outcome = (res.body as ScanOutcome[])[0]!;
    expect(outcome.stored).toBe(true);
    expect(outcome.scan!.batchId).toBe(batch2Id);
    expect(outcome.scan!.status).toBe('needs_identity');
    expect(outcome.scan!.studentId).toBeNull();
    expect(outcome.scan!.identityCode).toBe(codeB);
    const detail = await http(app).get(`/api/v1/exam-scans/${outcome.scan!.id}`).set('Authorization', `Bearer ${ctx.teacher}`);
    const candidateIds = (detail.body.identityCandidates as { userId: string }[]).map((c) => c.userId);
    expect(candidateIds).not.toContain(ctx.studentB.id);
    expect(candidateIds).toContain(ctx.studentA.id);
    const del = await http(app).delete(`/api/v1/exam-scans/${outcome.scan!.id}`).set('Authorization', `Bearer ${ctx.teacher}`);
    expect(del.status).toBe(200);
  });

  it('tải lên theo phiên: mã đề mơ hồ fallback về định tuyến QR, không bao giờ đoán', async () => {
    const batches = (await http(app).get(`/api/v1/exam-batches?pinId=${ctx.quizId}`).set('Authorization', `Bearer ${ctx.teacher}`)).body as { id: string; examCode: string | null; roster: { code: string; userId: string }[] }[];
    const batch2 = batches.find((b) => b.examCode === '1002')!;
    const codeA = batch2.roster.find((r) => r.userId === ctx.studentA.id)!.code;
    const photo = photoFor({
      qrText: sheetQrPayload(batch2.id, '1002', null), bubbleCode: codeA,
      variantCode: '1002', variantLightDigit: 1, fills: CORRECT_FILLS(), seed: 557,
    });
    const res = await uploadSession(photo, 'session-a-ambig-variant.png', ctx.teacher);
    expect(res.status).toBe(201);
    const outcome = (res.body as ScanOutcome[])[0]!;
    expect(outcome.stored).toBe(true);
    expect(outcome.scan!.batchId).toBe(batch2.id);
    expect(outcome.scan!.variantCodeRead).toBeNull();
    expect(outcome.scan!.studentId).toBe(ctx.studentA.id);
    expect(outcome.scan!.status).toBe('ready');
  });

  it('phiếu chưa định tuyến (mã đề lạ, không QR) chờ chưa xếp lô; giáo viên gán lô + định danh kèm vết event-log', async () => {
    const studentC = await createUserViaApi(app, admin);
    await enrolUser(app, admin, ctx.courseId, ctx.instanceId, studentC.id);
    const batch3 = await createBatch({ examCode: '1003' });
    const codeC = batch3.roster.find((r) => r.userId === studentC.id)!.code;

    const photo = photoFor({
      qrText: null, bubbleCode: codeC, variantCode: '9999', fills: CORRECT_FILLS(), seed: 558,
    });
    const res = await uploadSession(photo, 'session-c-unknown.png', ctx.teacher);
    expect(res.status).toBe(201);
    const outcome = (res.body as ScanOutcome[])[0]!;
    expect(outcome.stored).toBe(true);
    expect(outcome.scan!.batchId).toBeNull();
    expect(outcome.scan!.variantCodeRead).toBe('9999');
    expect(outcome.scan!.status).toBe('needs_identity');
    const scanId = outcome.scan!.id;

    const early = await http(app).post(`/api/v1/exam-scans/${scanId}/assign-identity`)
      .set('Authorization', `Bearer ${ctx.teacher}`).send({ studentId: studentC.id });
    expect(early.status).toBe(400);
    expect(early.body.code).toBe('paper.batch_required');

    const assigned = await http(app).post(`/api/v1/exam-scans/${scanId}/assign-batch`)
      .set('Authorization', `Bearer ${ctx.teacher}`).send({ batchId: batch3.id });
    expect(assigned.status).toBe(201);
    expect(assigned.body.batchId).toBe(batch3.id);
    expect(assigned.body.studentId).toBe(studentC.id);
    expect(assigned.body.identitySource).toBe('bubbles');
    expect(assigned.body.status).toBe('ready');
    expect(assigned.body.variantCodeRead).toBe('1003');
    const batchEvent = await pg.query<{ payload: { machineReadVariantCode?: string } }>(
      `select payload from outbox_events where type = 'paper_batch_assigned' and payload->>'scanId' = $1`, [scanId]);
    expect(batchEvent.rows.length).toBeGreaterThanOrEqual(1);
    expect(batchEvent.rows[0]!.payload.machineReadVariantCode).toBe('9999');

    const codeA3 = batch3.roster.find((r) => r.userId === ctx.studentA.id)!.code;
    const manual = await http(app).post(`/api/v1/exam-scans/${scanId}/assign-identity`)
      .set('Authorization', `Bearer ${ctx.teacher}`).send({ studentId: ctx.studentA.id });
    expect(manual.status).toBe(201);
    expect(manual.body.identitySource).toBe('manual');
    const identityEvent = await pg.query<{ payload: { previousCode?: string; newCode?: string; actorId?: string } }>(
      `select payload from outbox_events where type = 'paper_identity_assigned' and payload->>'scanId' = $1`, [scanId]);
    expect(identityEvent.rows.length).toBeGreaterThanOrEqual(1);
    expect(identityEvent.rows[0]!.payload.previousCode).toBe(codeC);
    expect(identityEvent.rows[0]!.payload.newCode).toBe(codeA3);
    expect(identityEvent.rows[0]!.payload.actorId).toBeTruthy();

    const back = await http(app).post(`/api/v1/exam-scans/${scanId}/assign-identity`)
      .set('Authorization', `Bearer ${ctx.teacher}`).send({ studentId: studentC.id });
    expect(back.status).toBe(201);
    const rec = await http(app).post(`/api/v1/exam-scans/${scanId}/record`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(rec.status).toBe(201);
    expect(rec.body.sumGrades).toBe(10);
  });

  it('tải lên theo lô vẫn định tuyến phiếu lạc tới lô của mã đề đã tô của nó', async () => {
    const studentD = await createUserViaApi(app, admin);
    await enrolUser(app, admin, ctx.courseId, ctx.instanceId, studentD.id);
    const batch4 = await createBatch({ examCode: '1004' });
    const codeD = batch4.roster.find((r) => r.userId === studentD.id)!.code;
    const photo = photoFor({
      qrText: sheetQrPayload(batch4.id, '1004', null), bubbleCode: codeD,
      variantCode: '1004', fills: CORRECT_FILLS(), seed: 559,
    });
    const res = await upload(photo, 'stray-d.png', ctx.teacher);
    expect(res.status).toBe(201);
    const outcome = (res.body as ScanOutcome[])[0]!;
    expect(outcome.stored).toBe(true);
    expect(outcome.scan!.batchId).toBe(batch4.id);
    expect(outcome.scan!.studentId).toBe(studentD.id);
    expect(outcome.scan!.status).toBe('ready');
  });

  it('phiếu có mã đề đọc được khác lô đã định tuyến bị chặn ghi (lệch biến thể)', async () => {
    const batch5 = await createBatch({ examCode: '1005' });
    const codeA = batch5.roster.find((r) => r.userId === ctx.studentA.id)!.code;
    const photo = photoFor({
      qrText: sheetQrPayload(batch5.id, '1005', null), bubbleCode: codeA,
      variantCode: '9998', fills: CORRECT_FILLS(), seed: 560,
    });
    const res = await uploadSession(photo, 'session-mismatch.png', ctx.teacher);
    expect(res.status).toBe(201);
    const outcome = (res.body as ScanOutcome[])[0]!;
    expect(outcome.scan!.batchId).toBe(batch5.id);
    expect(outcome.scan!.variantCodeRead).toBe('9998');
    expect(outcome.scan!.status).toBe('ready');
    const rec = await http(app).post(`/api/v1/exam-scans/${outcome.scan!.id}/record`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(rec.status).toBe(409);
    expect(rec.body.code).toBe('paper.variant_mismatch');
  });

  it('Lô SBD (mã 8 chữ số): danh sách mang mã 8 chữ số và phiếu chung ghi đầu-cuối', async () => {
    const batchSbd = await createBatch({ codeDigits: 8, examCode: '2001' });
    expect(batchSbd.codeDigits).toBe(8);
    for (const entry of batchSbd.roster) expect(entry.code).toMatch(/^\d{8}$/);
    const codeB = batchSbd.roster.find((r) => r.userId === ctx.studentB.id)!.code;
    const photo = photoFor({
      qrText: sheetQrPayload(batchSbd.id, '2001', null), bubbleCode: codeB,
      variantCode: '2001', fills: CORRECT_FILLS(), seed: 561, codeDigits: 8,
    });
    const res = await uploadSession(photo, 'session-sbd.png', ctx.teacher);
    expect(res.status).toBe(201);
    const outcome = (res.body as ScanOutcome[])[0]!;
    expect(outcome.stored).toBe(true);
    expect(outcome.scan!.batchId).toBe(batchSbd.id);
    expect(outcome.scan!.studentId).toBe(ctx.studentB.id);
    expect(outcome.scan!.identitySource).toBe('bubbles');
    expect(outcome.scan!.status).toBe('ready');
    const rec = await http(app).post(`/api/v1/exam-scans/${outcome.scan!.id}/record`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(rec.status).toBe(201);
    expect(rec.body.sumGrades).toBe(10);
  });

  it('đột biến một chữ số tại vị trí từng rò rỉ rơi vào hàng đợi định danh — không bao giờ lặng lẽ gán cho học viên khác', async () => {
    for (let k = 0; k < 21; k++) {
      const u = await createUserViaApi(app, admin);
      await enrolUser(app, admin, ctx.courseId, ctx.instanceId, u.id);
    }

    const classBatch = await createBatch({ examCode: '1006' });
    expect(classBatch.roster.length).toBeGreaterThanOrEqual(21);
    const first = classBatch.roster.find((r) => Number(r.code.slice(0, 3)) === 1)!;
    const target = classBatch.roster.find((r) => Number(r.code.slice(0, 3)) === 21)!;
    const mutatedClass = `${first.code[0]}${(Number(first.code[1]) + 2) % 10}${first.code.slice(2)}`;
    const td = target.code.slice(0, 3).split('').map(Number);
    const oldFormulaTargetCode = `${td.join('')}${(td[0]! * 3 + td[1]! * 5 + td[2]! * 7) % 10}`;
    expect(mutatedClass).toBe(oldFormulaTargetCode);
    expect(classBatch.roster.map((r) => r.code)).not.toContain(mutatedClass);
    const photoClass = photoFor({
      qrText: sheetQrPayload(classBatch.id, '1006', null), bubbleCode: mutatedClass,
      variantCode: '1006', fills: CORRECT_FILLS(), seed: 562,
    });
    const resClass = await uploadSession(photoClass, 'session-mutated-class.png', ctx.teacher);
    expect(resClass.status).toBe(201);
    const outClass = (resClass.body as ScanOutcome[])[0]!;
    expect(outClass.stored).toBe(true);
    expect(outClass.scan!.batchId).toBe(classBatch.id);
    expect(outClass.scan!.status).toBe('needs_identity');
    expect(outClass.scan!.studentId).toBeNull();
    expect(outClass.scan!.identityCode).toBe(mutatedClass);
    const recClass = await http(app).post(`/api/v1/exam-scans/${outClass.scan!.id}/record`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(recClass.status).toBe(409);
    const delClass = await http(app).delete(`/api/v1/exam-scans/${outClass.scan!.id}`).set('Authorization', `Bearer ${ctx.teacher}`);
    expect(delClass.status).toBe(200);

    const W_OLD = [3, 5, 7, 9, 1, 3, 5];
    const oldCodeOf = (body: string) => `${body}${body.split('').reduce((s, c, i) => s + Number(c) * W_OLD[i]!, 0) % 10}`;
    const oldFirst = oldCodeOf('0000001');
    const oldMutated = `${oldFirst.slice(0, 6)}${(Number(oldFirst[6]) + 2) % 10}${oldFirst.slice(7)}`;
    expect(oldMutated).toBe(oldCodeOf('0000003'));
    const sbdBatch = await createBatch({ codeDigits: 8, examCode: '2002' });
    expect(sbdBatch.roster.length).toBeGreaterThanOrEqual(21);
    const firstSbd = sbdBatch.roster.find((r) => Number(r.code.slice(0, 7)) === 1)!;
    const mutatedSbd = `${firstSbd.code.slice(0, 6)}${(Number(firstSbd.code[6]) + 2) % 10}${firstSbd.code.slice(7)}`;
    expect(sbdBatch.roster.map((r) => r.code)).not.toContain(mutatedSbd);
    const photoSbd = photoFor({
      qrText: sheetQrPayload(sbdBatch.id, '2002', null), bubbleCode: mutatedSbd,
      variantCode: '2002', fills: CORRECT_FILLS(), seed: 563, codeDigits: 8,
    });
    const resSbd = await uploadSession(photoSbd, 'session-mutated-sbd.png', ctx.teacher);
    expect(resSbd.status).toBe(201);
    const outSbd = (resSbd.body as ScanOutcome[])[0]!;
    expect(outSbd.stored).toBe(true);
    expect(outSbd.scan!.batchId).toBe(sbdBatch.id);
    expect(outSbd.scan!.status).toBe('needs_identity');
    expect(outSbd.scan!.studentId).toBeNull();
    expect(outSbd.scan!.identityCode).toBe(mutatedSbd);
    const delSbd = await http(app).delete(`/api/v1/exam-scans/${outSbd.scan!.id}`).set('Authorization', `Bearer ${ctx.teacher}`);
    expect(delSbd.status).toBe(200);
  }, 180_000);

  it('hoán vị cặp biên SBD (chữ số thân cuối hoán với chữ số kiểm) bị checksum bắt — hàng đợi định danh, không bao giờ là học viên khác', async () => {
    const sbdBatch = await createBatch({ codeDigits: 8, examCode: '2003' });
    const firstSbd = sbdBatch.roster.find((r) => Number(r.code.slice(0, 7)) === 1)!;
    expect(firstSbd.code).toBe('00000017');
    const a = Number(firstSbd.code[6]);
    const b = Number(firstSbd.code[7]);
    expect(a).not.toBe(b);
    expect(Math.abs(a - b)).not.toBe(5);
    const transposed = `${firstSbd.code.slice(0, 6)}${b}${a}`;
    expect(transposed).toBe('00000071');
    expect(sbdCodeChecksumOk(transposed)).toBe(false);
    expect(sbdBatch.roster.map((r) => r.code)).not.toContain(transposed);
    const photo = photoFor({
      qrText: sheetQrPayload(sbdBatch.id, '2003', null), bubbleCode: transposed,
      variantCode: '2003', fills: CORRECT_FILLS(), seed: 564, codeDigits: 8,
    });
    const res = await uploadSession(photo, 'session-sbd-edge-transposed.png', ctx.teacher);
    expect(res.status).toBe(201);
    const outcome = (res.body as ScanOutcome[])[0]!;
    expect(outcome.stored).toBe(true);
    expect(outcome.scan!.batchId).toBe(sbdBatch.id);
    expect(outcome.scan!.status).toBe('needs_identity');
    expect(outcome.scan!.studentId).toBeNull();
    expect(outcome.scan!.identityCode).toBe(transposed);
    const rec = await http(app).post(`/api/v1/exam-scans/${outcome.scan!.id}/record`).set('Authorization', `Bearer ${ctx.teacher}`).send({});
    expect(rec.status).toBe(409);
    const del = await http(app).delete(`/api/v1/exam-scans/${outcome.scan!.id}`).set('Authorization', `Bearer ${ctx.teacher}`);
    expect(del.status).toBe(200);
  });
});
