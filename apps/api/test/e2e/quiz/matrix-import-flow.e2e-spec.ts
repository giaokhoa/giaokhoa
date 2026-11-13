import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  STRONG_PASSWORD, adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse } from '../../support/course-enrolment-helpers';
import { courseContextId } from '../../support/engagement-helpers';

describe('Nhập ma trận I-1 (mẫu + xem trước, không ghi DB)', () => {
  let app: INestApplication;
  let admin: string;

  interface Ctx {
    subjectId: string; curriculumId: string;
    lesson1Id: string; lesson2Id: string;
  }
  let ctx: Ctx;

  interface PreviewBody {
    valid: boolean;
    errors: { sheet: string | null; row: number | null; column: string | null; code: string; message: string }[];
    warnings: string[];
    name: string | null;
    levelSet: string | null;
    rows: { nodeId: string; nodeTitle: string; outcomes: { content: string }[] }[];
    cells: { curriculumNodeId: string; cognitiveLevel: string; qtype: string; questionCount: number; cellScore: number }[];
    totals: {
      byForm: { qtype: string; questionCount: number; score: number }[];
      byLevel: { cognitiveLevel: string; questionCount: number; score: number }[];
      totalScore: number; totalQuestions: number;
    };
    availability: { curriculumNodeId: string; cognitiveLevel: string; qtype: string; required: number; available: number; deficit: number }[];
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    const contexts = await http(app).get('/api/v1/access/contexts').set('Authorization', `Bearer ${admin}`);
    const systemCtx = (contexts.body as { id: string; contextLevel: number }[]).find((c) => c.contextLevel === 10)!;

    const subjRes = await http(app).post('/api/v1/curriculum/subjects').set('Authorization', `Bearer ${admin}`)
      .send({ contextId: systemCtx.id, name: 'Toán học', slug: `toan-import-${Date.now()}` });
    if (subjRes.status !== 201 && subjRes.status !== 200) throw new Error(`subject failed: ${subjRes.status} ${JSON.stringify(subjRes.body)}`);
    const subjectId = subjRes.body.id as string;
    const currRes = await http(app).post('/api/v1/curriculum/curricula').set('Authorization', `Bearer ${admin}`)
      .send({ subjectId, grade: 10 });
    if (currRes.status !== 201 && currRes.status !== 200) throw new Error(`curriculum failed: ${currRes.status} ${JSON.stringify(currRes.body)}`);
    const curriculumId = currRes.body.id as string;
    const topicRes = await http(app).post('/api/v1/curriculum/nodes').set('Authorization', `Bearer ${admin}`)
      .send({ curriculumId, title: 'Hàm số', kind: 'topic' });
    if (topicRes.status !== 201 && topicRes.status !== 200) throw new Error(`topic failed: ${topicRes.status} ${JSON.stringify(topicRes.body)}`);
    const topicId = topicRes.body.id as string;
    const lesson1Res = await http(app).post('/api/v1/curriculum/nodes').set('Authorization', `Bearer ${admin}`)
      .send({ curriculumId, parentId: topicId, title: 'Hàm số bậc hai', kind: 'lesson' });
    if (lesson1Res.status !== 201 && lesson1Res.status !== 200) throw new Error(`lesson1 failed: ${lesson1Res.status} ${JSON.stringify(lesson1Res.body)}`);
    const lesson1Id = lesson1Res.body.id as string;
    const lesson2Res = await http(app).post('/api/v1/curriculum/nodes').set('Authorization', `Bearer ${admin}`)
      .send({ curriculumId, parentId: topicId, title: 'Hàm số bậc nhất', kind: 'lesson' });
    if (lesson2Res.status !== 201 && lesson2Res.status !== 200) throw new Error(`lesson2 failed: ${lesson2Res.status} ${JSON.stringify(lesson2Res.body)}`);
    const lesson2Id = lesson2Res.body.id as string;
    const mkOutcome = async (nodeId: string, content: string) => {
      const r = await http(app).post('/api/v1/curriculum/outcomes').set('Authorization', `Bearer ${admin}`)
        .send({ nodeId, content });
      if (r.status !== 201 && r.status !== 200) throw new Error(`outcome failed: ${r.status} ${JSON.stringify(r.body)}`);
      return r.body.id as string;
    };
    const outcome1 = await mkOutcome(lesson1Id, 'Nhận biết được tính đồng biến, nghịch biến của hàm số bậc hai.');
    await mkOutcome(lesson1Id, 'Giải thích được mối liên hệ giữa đồ thị và dấu của hệ số a.');
    await mkOutcome(lesson2Id, 'Nhận biết được hàm số bậc nhất.');

    const bankRes = await http(app).post('/api/v1/questions/categories').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Matrix import bank', contextId: systemCtx.id });
    const bankCatId = bankRes.body.id as string;
    for (const name of ['MI1', 'MI2', 'MI3']) {
      const r = await http(app).post('/api/v1/questions').set('Authorization', `Bearer ${admin}`).send({
        categoryId: bankCatId, qtype: 'multichoice', questionText: `${name}: chọn đáp án đúng.`, defaultMark: 1,
        answers: [
          { text: 'Đúng', correct: true },
          { text: 'Sai 1', correct: false },
          { text: 'Sai 2', correct: false },
          { text: 'Sai 3', correct: false },
        ],
      });
      if (r.status !== 201 && r.status !== 200) throw new Error(`question failed: ${r.status} ${JSON.stringify(r.body)}`);
      const qid = r.body.question.id as string;
      const tag = await http(app).post(`/api/v1/questions/${qid}/outcomes`).set('Authorization', `Bearer ${admin}`)
        .send({ outcomeId: outcome1, cognitiveLevel: 'biet' });
      if (tag.status !== 201 && tag.status !== 200) throw new Error(`tag failed: ${tag.status} ${JSON.stringify(tag.body)}`);
    }
    ctx = { subjectId, curriculumId, lesson1Id, lesson2Id };
  });
  afterAll(async () => { await app.close(); });

  async function downloadTemplate(query: Record<string, string>): Promise<ExcelJS.Workbook> {
    const qs = new URLSearchParams(query).toString();
    const res = await http(app).get(`/api/v1/exam-matrices/template?${qs}`)
      .set('Authorization', `Bearer ${admin}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    if (res.status !== 200) throw new Error(`template failed: ${res.status}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    return wb;
  }

  function fillValid(wb: ExcelJS.Workbook): ExcelJS.Workbook {
    const ws = wb.getWorksheet('Ma trận')!;
    ws.getCell('B2').value = 'Ma trận nhập thử';
    ws.getCell('B7').value = 0.25;
    ws.getCell('B8').value = 1;
    ws.getCell('B9').value = 0.5;
    ws.getCell('B10').value = 1.5;
    ws.getCell('F15').value = 4;
    ws.getCell('G15').value = 4;
    ws.getCell('J15').value = 1;
    ws.getCell('N15').value = 2;
    ws.getCell('Q15').value = 1;
    ws.getCell('F16').value = 4;
    ws.getCell('I16').value = 1;
    ws.getCell('M16').value = 2;
    ws.getCell('Q16').value = 1;
    return wb;
  }

  async function preview(wb: ExcelJS.Workbook): Promise<PreviewBody> {
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await http(app).post('/api/v1/exam-matrices/import/preview')
      .set('Authorization', `Bearer ${admin}`)
      .attach('file', buffer, 'ma-tran.xlsx');
    if (res.status !== 200 && res.status !== 201) throw new Error(`preview failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as PreviewBody;
  }

  it('sinh mẫu: 3 sheet, hàng theo ĐVK với cột khoá + YCCĐ đối chiếu ở cột E', async () => {
    const wb = await downloadTemplate({ subjectId: ctx.subjectId, curriculumId: ctx.curriculumId });
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Hướng dẫn', 'Ma trận', 'Đặc tả']);
    const ws = wb.getWorksheet('Ma trận')!;
    expect(ws.getCell('A15').value).toBe(ctx.lesson1Id);
    expect(ws.getCell('A16').value).toBe(ctx.lesson2Id);
    expect(String(ws.getCell('D15').value)).toBe('Hàm số bậc hai');
    expect(String(ws.getCell('E15').value)).toContain('đồng biến');
    expect(ws.getCell('B6').value).toBe('Không');
    expect(ws.getCell('N14').value).toBe('Vận dụng');
  });

  it('sinh mẫu với Vận dụng cao: lưới có thêm cột Vận dụng cao cho từng dạng', async () => {
    const wb = await downloadTemplate({ subjectId: ctx.subjectId, curriculumId: ctx.curriculumId, levelSet: 'four' });
    const ws = wb.getWorksheet('Ma trận')!;
    expect(ws.getCell('B6').value).toBe('Có');
    const levelRow: string[] = [];
    for (let c = 6; c <= 21; c++) levelRow.push(String(ws.getCell(14, c).value ?? ''));
    expect(levelRow.filter((v) => v === 'Vận dụng cao')).toHaveLength(4);
  });

  it('preview file hợp lệ: khớp từng ô, tổng hai chiều tự tính lại, khả dụng theo ô, không ghi DB', async () => {
    const wb = fillValid(await downloadTemplate({ subjectId: ctx.subjectId, curriculumId: ctx.curriculumId }));
    const body = await preview(wb);
    expect(body.valid).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.name).toBe('Ma trận nhập thử');
    expect(body.levelSet).toBe('three');
    expect(body.rows.map((r) => r.nodeId)).toEqual([ctx.lesson1Id, ctx.lesson2Id]);
    expect(body.rows[0]!.outcomes).toHaveLength(2);
    expect(body.cells).toHaveLength(9);
    const cellOf = (node: string, level: string, qtype: string) =>
      body.cells.find((c) => c.curriculumNodeId === node && c.cognitiveLevel === level && c.qtype === qtype);
    expect(cellOf(ctx.lesson1Id, 'biet', 'multichoice')).toMatchObject({ questionCount: 4, cellScore: 1 });
    expect(cellOf(ctx.lesson1Id, 'hieu', 'truefalse')).toMatchObject({ questionCount: 1, cellScore: 1 });
    expect(cellOf(ctx.lesson2Id, 'van_dung', 'essay')).toMatchObject({ questionCount: 1, cellScore: 1.5 });
    expect(body.totals.totalScore).toBe(10);
    expect(body.totals.byForm.find((f) => f.qtype === 'multichoice')).toMatchObject({ questionCount: 12, score: 3 });
    expect(body.totals.byForm.find((f) => f.qtype === 'truefalse')).toMatchObject({ questionCount: 2, score: 2 });
    expect(body.warnings.some((w) => w.includes('theo dạng câu'))).toBe(false);
    expect(body.warnings.some((w) => w.includes('theo mức'))).toBe(true);
    const availability = body.availability.find(
      (a) => a.curriculumNodeId === ctx.lesson1Id && a.cognitiveLevel === 'biet' && a.qtype === 'multichoice',
    );
    expect(availability).toMatchObject({ required: 4, available: 3, deficit: 1 });
    const list = await http(app).get(`/api/v1/exam-matrices/by-subject/${ctx.subjectId}`).set('Authorization', `Bearer ${admin}`);
    expect(list.body).toEqual([]);
  });

  it('preview lỗi: ô chứa chữ → lỗi cứng đúng dòng/cột', async () => {
    const wb = fillValid(await downloadTemplate({ subjectId: ctx.subjectId, curriculumId: ctx.curriculumId }));
    wb.getWorksheet('Ma trận')!.getCell('F15').value = 'bốn';
    const body = await preview(wb);
    expect(body.valid).toBe(false);
    const e = body.errors.find((x) => x.code === 'quiz.matrix_import_cell_value_invalid');
    expect(e).toMatchObject({ sheet: 'Ma trận', row: 15, column: 'F' });
  });

  it('preview lỗi: Mã ĐVK không tồn tại → báo lỗi ở preview, không tự tạo ĐVK', async () => {
    const wb = fillValid(await downloadTemplate({ subjectId: ctx.subjectId, curriculumId: ctx.curriculumId }));
    wb.getWorksheet('Ma trận')!.getCell('A15').value = '123e4567-e89b-42d3-a456-426614174000';
    const body = await preview(wb);
    expect(body.valid).toBe(false);
    expect(body.errors.find((x) => x.code === 'quiz.matrix_import_node_not_found')).toMatchObject({ row: 15, column: 'A' });
  });

  it('preview lỗi: tổng điểm khai khác tổng tính lại → lỗi cứng kèm tổng tính lại', async () => {
    const wb = fillValid(await downloadTemplate({ subjectId: ctx.subjectId, curriculumId: ctx.curriculumId }));
    wb.getWorksheet('Ma trận')!.getCell('B5').value = 9;
    const body = await preview(wb);
    expect(body.valid).toBe(false);
    const e = body.errors.find((x) => x.code === 'quiz.matrix_import_total_score_mismatch');
    expect(e?.message).toContain('10');
  });

  it('preview lỗi: khai "Có" Vận dụng cao nhưng lưới không có cột VDC → lỗi cứng', async () => {
    const wb = fillValid(await downloadTemplate({ subjectId: ctx.subjectId, curriculumId: ctx.curriculumId }));
    wb.getWorksheet('Ma trận')!.getCell('B6').value = 'Có';
    const body = await preview(wb);
    expect(body.valid).toBe(false);
    expect(body.errors.some((x) => x.code === 'quiz.matrix_import_levelset_mismatch')).toBe(true);
  });

  it('preview lỗi: dạng có câu nhưng thiếu điểm mỗi câu → lỗi cứng', async () => {
    const wb = fillValid(await downloadTemplate({ subjectId: ctx.subjectId, curriculumId: ctx.curriculumId }));
    wb.getWorksheet('Ma trận')!.getCell('B7').value = null;
    const body = await preview(wb);
    expect(body.valid).toBe(false);
    expect(body.errors.some((x) => x.code === 'quiz.matrix_import_score_per_question_missing')).toBe(true);
  });

  it('preview lỗi: lưới rỗng → ma trận rỗng bị chặn', async () => {
    const wb = await downloadTemplate({ subjectId: ctx.subjectId, curriculumId: ctx.curriculumId });
    const ws = wb.getWorksheet('Ma trận')!;
    ws.getCell('B2').value = 'Ma trận rỗng';
    ws.getCell('B7').value = 0.25;
    const body = await preview(wb);
    expect(body.valid).toBe(false);
    expect(body.errors.map((x) => x.code)).toEqual(['quiz.matrix_import_matrix_empty']);
  });

  it('preview lỗi: file không phải xlsx → lỗi cấp file', async () => {
    const res = await http(app).post('/api/v1/exam-matrices/import/preview')
      .set('Authorization', `Bearer ${admin}`)
      .attach('file', Buffer.from('đây không phải file excel'), 'ma-tran.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.errors[0].code).toBe('quiz.matrix_import_file_unreadable');
  });
});

describe('Nhập ma trận I-1 với actor giáo viên mô hình seed (hồi quy D-3, issue #233)', () => {
  let app: INestApplication;
  let admin: string;
  let subjectId: string;
  let curriculumId: string;
  let lesson1Id: string;
  let teacher: string;
  let student: string;

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    const contexts = await http(app).get('/api/v1/access/contexts').set(bearer(admin));
    const systemCtx = (contexts.body as { id: string; contextLevel: number }[]).find((c) => c.contextLevel === 10)!;
    const suffix = Date.now().toString(36);
    const subjRes = await http(app).post('/api/v1/curriculum/subjects').set(bearer(admin))
      .send({ contextId: systemCtx.id, name: 'Toán học', slug: `toan-import-gv-${suffix}` });
    expect(subjRes.status, JSON.stringify(subjRes.body)).toBe(201);
    subjectId = subjRes.body.id as string;
    const currRes = await http(app).post('/api/v1/curriculum/curricula').set(bearer(admin))
      .send({ subjectId, grade: 10 });
    expect(currRes.status, JSON.stringify(currRes.body)).toBe(201);
    curriculumId = currRes.body.id as string;
    const topicRes = await http(app).post('/api/v1/curriculum/nodes').set(bearer(admin))
      .send({ curriculumId, title: 'Hàm số', kind: 'topic' });
    expect(topicRes.status, JSON.stringify(topicRes.body)).toBe(201);
    const lesson1Res = await http(app).post('/api/v1/curriculum/nodes').set(bearer(admin))
      .send({ curriculumId, parentId: topicRes.body.id, title: 'Hàm số bậc hai', kind: 'lesson' });
    expect(lesson1Res.status, JSON.stringify(lesson1Res.body)).toBe(201);
    lesson1Id = lesson1Res.body.id as string;
    const lesson2Res = await http(app).post('/api/v1/curriculum/nodes').set(bearer(admin))
      .send({ curriculumId, parentId: topicRes.body.id, title: 'Hàm số bậc nhất', kind: 'lesson' });
    expect(lesson2Res.status, JSON.stringify(lesson2Res.body)).toBe(201);
    const outcomeRes = await http(app).post('/api/v1/curriculum/outcomes').set(bearer(admin))
      .send({ nodeId: lesson1Id, content: 'Nhận biết được hàm số bậc hai.' });
    expect(outcomeRes.status, JSON.stringify(outcomeRes.body)).toBe(201);

    const category = await createCategory(app, admin);
    const course = await createCourse(app, admin, category.id);
    const courseCtx = await courseContextId(app, admin, course.id);
    const editingTeacherRole = await roleIdByShortname(app, admin, 'editingteacher');
    const studentRole = await roleIdByShortname(app, admin, 'student');
    const gv = await createUserViaApi(app, admin, { username: `gv_i1_${suffix}` });
    await assignRole(app, admin, gv.id, editingTeacherRole, courseCtx);
    teacher = (await login(app, gv.username, STRONG_PASSWORD)).accessToken;
    const hs = await createUserViaApi(app, admin, { username: `hs_i1_${suffix}` });
    await assignRole(app, admin, hs.id, studentRole, courseCtx);
    student = (await login(app, hs.username, STRONG_PASSWORD)).accessToken;
  });
  afterAll(async () => { await app.close(); });

  async function downloadTemplateAs(token: string): Promise<ExcelJS.Workbook> {
    const qs = new URLSearchParams({ subjectId, curriculumId }).toString();
    const res = await http(app).get(`/api/v1/exam-matrices/template?${qs}`)
      .set(bearer(token))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    if (res.status !== 200) throw new Error(`template failed: ${res.status} ${JSON.stringify(res.body)}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    return wb;
  }

  function fillMinimalValid(wb: ExcelJS.Workbook): ExcelJS.Workbook {
    const ws = wb.getWorksheet('Ma trận')!;
    ws.getCell('B2').value = 'Ma trận của giáo viên seed';
    ws.getCell('B5').value = 1.5;
    ws.getCell('B10').value = 1.5;
    ws.getCell('Q15').value = 1;
    return wb;
  }

  it('giáo viên mô hình seed: tải mẫu được (hàng theo ĐVK của chương trình hệ thống)', async () => {
    const wb = await downloadTemplateAs(teacher);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Hướng dẫn', 'Ma trận', 'Đặc tả']);
    expect(wb.getWorksheet('Ma trận')!.getCell('A15').value).toBe(lesson1Id);
  });

  it('giáo viên mô hình seed: preview file hợp lệ → valid, khớp ô đã điền', async () => {
    const wb = fillMinimalValid(await downloadTemplateAs(teacher));
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await http(app).post('/api/v1/exam-matrices/import/preview')
      .set(bearer(teacher))
      .attach('file', buffer, 'ma-tran.xlsx');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.errors).toEqual([]);
    expect(res.body.cells).toHaveLength(1);
    expect(res.body.cells[0]).toMatchObject({
      curriculumNodeId: lesson1Id, cognitiveLevel: 'van_dung', qtype: 'essay', questionCount: 1, cellScore: 1.5,
    });
  });

  it('giáo viên mô hình seed: preview file ghi mã môn không tồn tại → vẫn trả lỗi subject_not_found trong payload (không nuốt, không 404 thô)', async () => {
    const wb = fillMinimalValid(await downloadTemplateAs(teacher));
    wb.getWorksheet('Ma trận')!.getCell('D3').value = '123e4567-e89b-42d3-a456-426614174000';
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await http(app).post('/api/v1/exam-matrices/import/preview')
      .set(bearer(teacher))
      .attach('file', buffer, 'ma-tran.xlsx');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.valid).toBe(false);
    expect((res.body.errors as { code: string }[]).some((e) => e.code === 'quiz.matrix_import_subject_not_found')).toBe(true);
  });

  it('học sinh: bị chặn 403 ở cả tải mẫu và preview', async () => {
    const qs = new URLSearchParams({ subjectId, curriculumId }).toString();
    const tpl = await http(app).get(`/api/v1/exam-matrices/template?${qs}`).set(bearer(student));
    expect(tpl.status).toBe(403);
    const wb = fillMinimalValid(await downloadTemplateAs(teacher));
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const prev = await http(app).post('/api/v1/exam-matrices/import/preview')
      .set(bearer(student))
      .attach('file', buffer, 'ma-tran.xlsx');
    expect(prev.status).toBe(403);
  });
});
