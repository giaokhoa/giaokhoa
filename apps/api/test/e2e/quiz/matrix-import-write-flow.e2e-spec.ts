import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { Client } from 'pg';
import {
  STRONG_PASSWORD, adminToken, assignRole, createRoleViaApi, createTestApp, createUserViaApi, login, roleIdByShortname, setOverride, systemContextId,
} from '../../support/identity-access-helpers';
import { createCategory, createCourse } from '../../support/course-enrolment-helpers';
import { courseContextId } from '../../support/engagement-helpers';


const http = (app: INestApplication) => request(app.getHttpServer());
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: INestApplication;
let admin: string;
let subjectId: string;
let curriculumId: string;
let lesson1Id: string;
let lesson2Id: string;

async function countMatricesByName(name: string): Promise<number> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("select set_config('app.platform', 'on', false)");
    const res = await client.query('select count(*)::int as n from exam_matrices where name = $1', [name]);
    return res.rows[0]!.n as number;
  } finally {
    await client.end();
  }
}

async function downloadTemplate(token: string): Promise<ExcelJS.Workbook> {
  const qs = new URLSearchParams({ subjectId, curriculumId }).toString();
  const res = await http(app)
    .get(`/api/v1/exam-matrices/template?${qs}`)
    .set(auth(token))
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  if (res.status !== 200) throw new Error(`template failed: ${res.status} ${JSON.stringify(res.body)}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
  return wb;
}

function fillValid(wb: ExcelJS.Workbook, name: string): void {
  const ws = wb.getWorksheet('Ma trận')!;
  ws.getCell('B2').value = name;
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
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function postImport(token: string, buffer: Buffer) {
  return http(app)
    .post('/api/v1/exam-matrices/import')
    .set(auth(token))
    .attach('file', buffer, 'ma-tran.xlsx');
}

async function postPreview(token: string, buffer: Buffer) {
  const res = await http(app)
    .post('/api/v1/exam-matrices/import/preview')
    .set(auth(token))
    .attach('file', buffer, 'ma-tran.xlsx')
    .expect(200);
  return res.body as {
    valid: boolean;
    cells: { curriculumNodeId: string; cognitiveLevel: string; qtype: string; questionCount: number; cellScore: number }[];
    availability: { curriculumNodeId: string; cognitiveLevel: string; qtype: string; required: number; available: number; deficit: number }[];
  };
}

beforeAll(async () => {
  app = await createTestApp();
  admin = await adminToken(app);
  const ctx = await http(app).get('/api/v1/access/contexts').set(auth(admin)).expect(200);
  const system = (ctx.body as { id: string; contextLevel: number }[]).find((c) => c.contextLevel === 10)!;
  const suffix = Date.now().toString(36);
  const subject = await http(app).post('/api/v1/curriculum/subjects').set(auth(admin))
    .send({ contextId: system.id, name: 'Toán học', slug: `toan-i2-${suffix}` }).expect(201);
  subjectId = subject.body.id as string;
  const curriculum = await http(app).post('/api/v1/curriculum/curricula').set(auth(admin))
    .send({ subjectId, grade: 10 }).expect(201);
  curriculumId = curriculum.body.id as string;
  const node = (body: object) => http(app).post('/api/v1/curriculum/nodes').set(auth(admin)).send(body).expect(201);
  const topic = await node({ curriculumId, parentId: null, kind: 'topic', title: 'Hàm số', position: 1 });
  const lesson1 = await node({ curriculumId, parentId: topic.body.id, kind: 'lesson', title: 'Hàm số bậc hai', position: 1 });
  const lesson2 = await node({ curriculumId, parentId: topic.body.id, kind: 'lesson', title: 'Hàm số bậc nhất', position: 2 });
  lesson1Id = lesson1.body.id as string;
  lesson2Id = lesson2.body.id as string;
  const outcome = (nodeId: string, content: string) => http(app).post('/api/v1/curriculum/outcomes').set(auth(admin))
    .send({ nodeId, content }).expect(201);
  const o1 = await outcome(lesson1Id, 'Nhận biết được hàm số bậc hai');
  await outcome(lesson1Id, 'Vẽ được đồ thị hàm số bậc hai');
  await outcome(lesson2Id, 'Nhận biết được hàm số bậc nhất');

  const contexts = await http(app).get('/api/v1/access/contexts').set(auth(admin)).expect(200);
  const sys = (contexts.body as { id: string; contextLevel: number }[]).find((c) => c.contextLevel === 10)!;
  const category = await http(app).post('/api/v1/questions/categories').set(auth(admin))
    .send({ name: `Danh mục I-2 ${suffix}`, contextId: sys.id }).expect(201);
  for (let i = 0; i < 3; i++) {
    const r = await http(app).post('/api/v1/questions').set(auth(admin)).send({
      categoryId: category.body.id, qtype: 'multichoice',
      questionText: `Câu I-2 ${i + 1}: chọn đáp án đúng.`, defaultMark: 1,
      answers: [
        { text: 'Đúng', correct: true },
        { text: 'Sai 1', correct: false },
        { text: 'Sai 2', correct: false },
        { text: 'Sai 3', correct: false },
      ],
    });
    if (r.status !== 201 && r.status !== 200) throw new Error(`question failed: ${r.status} ${JSON.stringify(r.body)}`);
    const qid = r.body.question.id as string;
    const tag = await http(app).post(`/api/v1/questions/${qid}/outcomes`).set(auth(admin))
      .send({ outcomeId: o1.body.id, cognitiveLevel: 'biet' });
    if (tag.status !== 201 && tag.status !== 200) throw new Error(`tag failed: ${tag.status} ${JSON.stringify(tag.body)}`);
  }
});

afterAll(async () => {
  await app.close();
});

describe('I-2: ghi nguyên tử khi nhập ma trận', () => {
  let validBuffer: Buffer;
  let matrixId: string;

  it('ghi thành công trọn bộ: view khớp preview, đọc lại bằng detail/availability/specification khớp', async () => {
    const wb = await downloadTemplate(admin);
    fillValid(wb, 'Ma trận nhập thử');
    validBuffer = await toBuffer(wb);
    const preview = await postPreview(admin, validBuffer);
    expect(preview.valid).toBe(true);
    expect(preview.cells).toHaveLength(9);

    const res = await postImport(admin, validBuffer).expect(201);
    const view = res.body as {
      id: string; name: string; status: string; bankId: string | null; levelSet: string;
      totalScore: number; scopeNodeIds: string[]; derivedFromMatrixId: string | null;
      cells: { id: string; curriculumNodeId: string; cognitiveLevel: string; qtype: string; questionCount: number; cellScore: number; position: number }[];
      warnings: string[];
    };
    matrixId = view.id;
    expect(view.name).toBe('Ma trận nhập thử');
    expect(view.status).toBe('draft');
    expect(view.bankId).toBeTruthy();
    expect(view.derivedFromMatrixId).toBeNull();
    expect(view.levelSet).toBe('three');
    expect(view.totalScore).toBe(10);
    expect(view.scopeNodeIds).toEqual([lesson1Id, lesson2Id]);
    expect(view.cells).toHaveLength(9);
    const key = (c: { curriculumNodeId: string; cognitiveLevel: string; qtype: string }) =>
      `${c.curriculumNodeId}|${c.cognitiveLevel}|${c.qtype}`;
    const byKey = new Map(view.cells.map((c) => [key(c), c]));
    for (const expected of preview.cells) {
      const got = byKey.get(key(expected));
      expect(got, `thiếu ô ${key(expected)}`).toBeTruthy();
      expect(got!.questionCount).toBe(expected.questionCount);
      expect(got!.cellScore).toBe(expected.cellScore);
      expect(got!.position).toBe(expected.curriculumNodeId === lesson1Id ? 1 : 2);
    }
    expect(view.warnings.some((w) => w.includes('theo dạng câu'))).toBe(false);
    expect(view.warnings.some((w) => w.includes('theo mức'))).toBe(true);

    const detail = await http(app).get(`/api/v1/exam-matrices/${matrixId}`).set(auth(admin)).expect(200);
    expect(detail.body.id).toBe(matrixId);
    expect(detail.body.cells).toHaveLength(9);

    const avail = await http(app).get(`/api/v1/exam-matrices/${matrixId}/availability`).set(auth(admin)).expect(200);
    const availBody = avail.body as { cells: { cellId: string; required: number; available: number; deficit: number }[] };
    const cellById = new Map(view.cells.map((c) => [c.id, c]));
    expect(availBody.cells).toHaveLength(9);
    for (const row of availBody.cells) {
      const cell = cellById.get(row.cellId)!;
      const expected = preview.availability.find(
        (a) => a.curriculumNodeId === cell.curriculumNodeId && a.cognitiveLevel === cell.cognitiveLevel && a.qtype === cell.qtype,
      )!;
      expect(row.required).toBe(expected.required);
      expect(row.available).toBe(expected.available);
      expect(row.deficit).toBe(expected.deficit);
    }

    const spec = await http(app).get(`/api/v1/exam-matrices/${matrixId}/specification`).set(auth(admin)).expect(200);
    const nodeIds = (spec.body.topics as { nodes: { nodeId: string }[] }[]).flatMap((t) => t.nodes.map((n) => n.nodeId));
    expect(nodeIds).toContain(lesson1Id);
    expect(nodeIds).toContain(lesson2Id);
    expect(spec.body.totals.totalScore).toBe(10);
  });

  it('gửi lại cùng file (double submit/retry): trả chính ma trận đã ghi, DB không nhân đôi', async () => {
    const res = await postImport(admin, validBuffer).expect(201);
    expect(res.body.id).toBe(matrixId);
    expect(await countMatricesByName('Ma trận nhập thử')).toBe(1);
    const list = await http(app).get(`/api/v1/exam-matrices/by-subject/${subjectId}`).set(auth(admin)).expect(200);
    const named = (list.body as { name: string }[]).filter((m) => m.name === 'Ma trận nhập thử');
    expect(named).toHaveLength(1);
  });

  it('file bị sửa tay sau xem trước: 422 kèm lỗi định vị, DB không còn dấu vết', async () => {
    const wb = await downloadTemplate(admin);
    fillValid(wb, 'Ma trận bị sửa tay');
    const clean = await postPreview(admin, await toBuffer(wb));
    expect(clean.valid).toBe(true);
    wb.getWorksheet('Ma trận')!.getCell('F15').value = 'bốn';
    const res = await postImport(admin, await toBuffer(wb)).expect(422);
    expect(res.body.status).toBe(422);
    expect(res.body.code).toBe('quiz.matrix_import_invalid');
    const issues = res.body.matrixImportIssues as { sheet: string | null; row: number | null; column: string | null; code: string }[];
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.some((i) => i.code === 'quiz.matrix_import_cell_value_invalid' && i.row === 15 && i.column === 'F')).toBe(true);
    expect(await countMatricesByName('Ma trận bị sửa tay')).toBe(0);

    const wb2 = await downloadTemplate(admin);
    fillValid(wb2, 'Ma trận lệch tổng');
    wb2.getWorksheet('Ma trận')!.getCell('B5').value = 9;
    const res2 = await postImport(admin, await toBuffer(wb2)).expect(422);
    expect(res2.body.code).toBe('quiz.matrix_import_invalid');
    const issues2 = res2.body.matrixImportIssues as { code: string }[];
    expect(issues2.some((i) => i.code === 'quiz.matrix_import_total_score_mismatch')).toBe(true);
    expect(await countMatricesByName('Ma trận lệch tổng')).toBe(0);
  });

  it('người không đủ tư cách dùng luồng nhập: bị chặn 403 tại cổng bank của luồng và không ghi', async () => {
    const suffix = Date.now().toString(36);
    const viewer = await createUserViaApi(app, admin, { username: `hs_i2_${suffix}` });
    expect(viewer.username).toBe(`hs_i2_${suffix}`);
    const roleId = await createRoleViaApi(app, admin);
    const systemId = await systemContextId(app, admin);
    await assignRole(app, admin, viewer.id, roleId, systemId);
    await setOverride(app, admin, roleId, 'curriculum:view', systemId, 1);
    const viewerToken = (await login(app, `hs_i2_${suffix}`, STRONG_PASSWORD)).accessToken;
    const wb = await downloadTemplate(admin);
    fillValid(wb, 'Ma trận của người chỉ xem');
    const res = await postImport(viewerToken, await toBuffer(wb)).expect(403);
    expect(res.body.code).toBe('question.personal_bank_staff_only');
    expect(await countMatricesByName('Ma trận của người chỉ xem')).toBe(0);

    const nobody = await createUserViaApi(app, admin, { username: `nb_i2_${suffix}` });
    expect(nobody.username).toBe(`nb_i2_${suffix}`);
    const nobodyToken = (await login(app, `nb_i2_${suffix}`, STRONG_PASSWORD)).accessToken;
    const wb2 = await downloadTemplate(admin);
    fillValid(wb2, 'Ma trận của người lạ');
    const res2 = await postImport(nobodyToken, await toBuffer(wb2)).expect(403);
    expect(res2.body.code).toBe('question.personal_bank_staff_only');
    expect(await countMatricesByName('Ma trận của người lạ')).toBe(0);
  });

  it('thiếu file: 400 quiz.matrix_import_file_required', async () => {
    const res = await http(app).post('/api/v1/exam-matrices/import').set(auth(admin)).expect(400);
    expect(res.body.code).toBe('quiz.matrix_import_file_required');
  });
});

async function readMatrixSignature(matrixId: string): Promise<string | null> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("select set_config('app.platform', 'on', false)");
    const res = await client.query('select content_signature from exam_matrices where id = $1', [matrixId]);
    return (res.rows[0]?.content_signature ?? null) as string | null;
  } finally {
    await client.end();
  }
}

describe('D-1 (issue #233): chữ ký nội dung ở DB và cửa sổ đua', () => {
  it('hai request ghi trùng đồng thời tuyệt đối: chỉ tạo một ma trận, cả hai request nhận cùng một ma trận, không request nào nhận lỗi', async () => {
    const wb = await downloadTemplate(admin);
    fillValid(wb, 'Ma trận đua đồng thời');
    const buffer = await toBuffer(wb);
    const [r1, r2] = await Promise.all([postImport(admin, buffer), postImport(admin, buffer)]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect((r1.body as { id: string }).id).toBe((r2.body as { id: string }).id);
    expect(await countMatricesByName('Ma trận đua đồng thời')).toBe(1);
    expect(await readMatrixSignature((r1.body as { id: string }).id)).toBeTruthy();
  });

  it('tầng DB: unique (bank_id, content_signature) chặn insert trùng trong cùng bank; bank_id null nằm ngoài ràng buộc', async () => {
    const wb = await downloadTemplate(admin);
    fillValid(wb, 'Ma trận neo bank D-1');
    const imported = await postImport(admin, await toBuffer(wb)).expect(201);
    const bankId = (imported.body as { bankId: string }).bankId;
    expect(bankId).toBeTruthy();

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const insertedIds: string[] = [];
    try {
      await client.query("select set_config('app.platform', 'on', false)");
      const signature = `d1-db-layer-${Date.now().toString(36)}`;
      const insertSql = `insert into exam_matrices (name, subject_id, curriculum_id, context_id, bank_id, content_signature)
        values ($1, $2, $3, $4, $5, $6) returning id`;
      const baseParams = ['Ma trận D-1 tầng DB', subjectId, curriculumId, randomUUID()];
      const first = await client.query(insertSql, [...baseParams, bankId, signature]);
      insertedIds.push(first.rows[0].id as string);
      let violation: { code?: string; constraint?: string; message?: string } | null = null;
      try {
        await client.query(insertSql, [...baseParams, bankId, signature]);
      } catch (err) {
        violation = err as { code?: string; constraint?: string; message?: string };
      }
      expect(violation?.code).toBe('23505');
      expect(violation?.constraint ?? violation?.message).toContain('exam_matrices_bank_content_signature_unique');
      const nullBank1 = await client.query(insertSql, [...baseParams, null, signature]);
      const nullBank2 = await client.query(insertSql, [...baseParams, null, signature]);
      insertedIds.push(nullBank1.rows[0].id as string, nullBank2.rows[0].id as string);
    } finally {
      for (const id of insertedIds) {
        await client.query('delete from exam_matrices where id = $1', [id]);
      }
      await client.end();
    }
  });

  it('chữ ký được ghi ở đường tạo tay và tính lại khi nội dung đổi; sửa ngoài thành phần chữ ký thì chữ ký giữ nguyên', async () => {
    const created = await http(app).post('/api/v1/exam-matrices').set(auth(admin))
      .send({ name: 'Ma trận D-1 tạo tay', subjectId, curriculumId });
    expect(created.status).toBeLessThan(300);
    const id = (created.body as { id: string }).id;
    const sig0 = await readMatrixSignature(id);
    expect(sig0).toBeTruthy();

    const withCell = await http(app).post(`/api/v1/exam-matrices/${id}/cells`).set(auth(admin))
      .send({ curriculumNodeId: lesson1Id, cognitiveLevel: 'biet', qtype: 'multichoice', questionCount: 2, cellScore: 1 });
    expect(withCell.status).toBeLessThan(300);
    const sig1 = await readMatrixSignature(id);
    expect(sig1).toBeTruthy();
    expect(sig1).not.toBe(sig0);

    const cellId = (withCell.body.cells as { id: string }[])[0]!.id;
    const cellPatch = await http(app).patch(`/api/v1/exam-matrices/${id}/cells/${cellId}`).set(auth(admin))
      .send({ questionCount: 3 });
    expect(cellPatch.status).toBeLessThan(300);
    const sig2 = await readMatrixSignature(id);
    expect(sig2).not.toBe(sig1);

    const renamed = await http(app).patch(`/api/v1/exam-matrices/${id}`).set(auth(admin))
      .send({ name: 'Ma trận D-1 đã đổi tên' });
    expect(renamed.status).toBeLessThan(300);
    const sig3 = await readMatrixSignature(id);
    expect(sig3).not.toBe(sig2);

    const statusOnly = await http(app).patch(`/api/v1/exam-matrices/${id}`).set(auth(admin))
      .send({ status: 'ready' });
    expect(statusOnly.status).toBeLessThan(300);
    expect(await readMatrixSignature(id)).toBe(sig3);
  });
});

describe('I-2 với diễn viên giáo viên mô hình seed (hồi quy D-3, issue #233)', () => {
  let teacherA: { id: string; token: string };
  let teacherB: { id: string; token: string };
  let student: { id: string; token: string };
  let bankAId: string;

  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const category = await createCategory(app, admin);
    const courseA = await createCourse(app, admin, category.id);
    const courseB = await createCourse(app, admin, category.id);
    const ctxA = await courseContextId(app, admin, courseA.id);
    const ctxB = await courseContextId(app, admin, courseB.id);
    const editingTeacherRole = await roleIdByShortname(app, admin, 'editingteacher');
    const studentRole = await roleIdByShortname(app, admin, 'student');
    const mkActor = async (username: string, roleId: string, ctxId: string) => {
      const u = await createUserViaApi(app, admin, { username });
      await assignRole(app, admin, u.id, roleId, ctxId);
      const token = (await login(app, username, STRONG_PASSWORD)).accessToken;
      return { id: u.id, token };
    };
    teacherA = await mkActor(`gv_seed_a_${suffix}`, editingTeacherRole, ctxA);
    teacherB = await mkActor(`gv_seed_b_${suffix}`, editingTeacherRole, ctxB);
    student = await mkActor(`hs_seed_${suffix}`, studentRole, ctxA);
    const banksRes = await http(app).get('/api/v1/question-banks?kind=matrix').set(auth(teacherA.token)).expect(200);
    const bankA = (banksRes.body as { id: string; scope: string }[]).find((b) => b.scope === 'personal');
    expect(bankA, 'giáo viên phải có bank ma trận cá nhân').toBeTruthy();
    bankAId = bankA!.id;
  });

  it('giáo viên tải mẫu → preview → nhập trọn luồng; ma trận vào bank cá nhân của giáo viên; gửi lại không nhân đôi', async () => {
    const wb = await downloadTemplate(teacherA.token);
    fillValid(wb, 'Ma trận nhập của giáo viên seed');
    const buffer = await toBuffer(wb);
    const preview = await postPreview(teacherA.token, buffer);
    expect(preview.valid).toBe(true);
    expect(preview.cells).toHaveLength(9);

    const res = await postImport(teacherA.token, buffer).expect(201);
    const view = res.body as { id: string; status: string; bankId: string | null; createdBy: string; cells: unknown[] };
    expect(view.status).toBe('draft');
    expect(view.bankId).toBe(bankAId);
    expect(view.createdBy).toBe(teacherA.id);
    expect(view.cells).toHaveLength(9);

    const detail = await http(app).get(`/api/v1/exam-matrices/${view.id}`).set(auth(teacherA.token)).expect(200);
    expect(detail.body.id).toBe(view.id);

    const again = await postImport(teacherA.token, buffer).expect(201);
    expect(again.body.id).toBe(view.id);
    expect(await countMatricesByName('Ma trận nhập của giáo viên seed')).toBe(1);
  });

  it('giáo viên tạo tay ma trận GẮN BANK cá nhân theo môn hệ thống: đạt (không còn vấp curriculum:view tại môn)', async () => {
    const res = await http(app).post('/api/v1/exam-matrices').set(auth(teacherA.token))
      .send({ name: 'Ma trận tạo tay của giáo viên seed', subjectId, curriculumId, bankId: bankAId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((res.body as { bankId: string }).bankId).toBe(bankAId);
    expect(await countMatricesByName('Ma trận tạo tay của giáo viên seed')).toBe(1);
  });

  it('giáo viên khác ghi vào bank cá nhân của giáo viên A: chặn tại cổng bank (403 access.capability_denied), không ghi', async () => {
    const res = await http(app).post('/api/v1/exam-matrices').set(auth(teacherB.token))
      .send({ name: 'Ma trận ghi vào bank người khác', subjectId, curriculumId, bankId: bankAId });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('access.capability_denied');
    expect(await countMatricesByName('Ma trận ghi vào bank người khác')).toBe(0);
  });

  it('nhánh tạo tay KHÔNG gắn bank giữ nguyên cổng tại context môn: giáo viên không vai hệ thống → 403, không ghi', async () => {
    const res = await http(app).post('/api/v1/exam-matrices').set(auth(teacherA.token))
      .send({ name: 'Ma trận không gắn bank của giáo viên seed', subjectId, curriculumId });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('access.capability_denied');
    expect(await countMatricesByName('Ma trận không gắn bank của giáo viên seed')).toBe(0);
  });

  it('cổng đọc CÔNG KHAI của chương trình không đổi: giáo viên vẫn không đọc được môn qua endpoint công khai', async () => {
    const res = await http(app).get(`/api/v1/curriculum/subjects/${subjectId}`).set(auth(teacherA.token));
    expect(res.status).toBe(403);
  });

  it('học sinh bị chặn ở cả ba đầu của đường nhập (mẫu, preview, import) và không ghi gì', async () => {
    const qs = new URLSearchParams({ subjectId, curriculumId }).toString();
    const tpl = await http(app).get(`/api/v1/exam-matrices/template?${qs}`).set(auth(student.token));
    expect(tpl.status).toBe(403);

    const wb = await downloadTemplate(admin);
    fillValid(wb, 'Ma trận của học sinh seed');
    const buffer = await toBuffer(wb);
    const prev = await http(app).post('/api/v1/exam-matrices/import/preview').set(auth(student.token))
      .attach('file', buffer, 'ma-tran.xlsx');
    expect(prev.status).toBe(403);
    const imp = await postImport(student.token, buffer);
    expect(imp.status).toBe(403);
    expect(await countMatricesByName('Ma trận của học sinh seed')).toBe(0);
  });

  it('giáo viên mở và xuất bản đặc tả của ma trận trong bank cá nhân của mình: đạt (điều kiện Mục 7, issue #233)', async () => {
    const wb = await downloadTemplate(teacherA.token);
    fillValid(wb, 'Ma trận đặc tả của giáo viên seed');
    const buffer = await toBuffer(wb);
    const imported = await postImport(teacherA.token, buffer).expect(201);
    const matrixId = (imported.body as { id: string }).id;
    expect((imported.body as { bankId: string }).bankId).toBe(bankAId);

    const spec = await http(app).get(`/api/v1/exam-matrices/${matrixId}/specification`).set(auth(teacherA.token)).expect(200);
    expect(spec.body.subject.id).toBe(subjectId);
    expect(spec.body.curriculum.id).toBe(curriculumId);
    const nodeIds = (spec.body.topics as { nodes: { nodeId: string; outcomes: { content: string }[] }[] }[])
      .flatMap((t) => t.nodes.map((n) => n.nodeId));
    expect(nodeIds).toContain(lesson1Id);
    expect(nodeIds).toContain(lesson2Id);
    const specNode = (spec.body.topics as { nodes: { nodeId: string; outcomes: { content: string }[] }[] }[])
      .flatMap((t) => t.nodes).find((n) => n.nodeId === lesson1Id)!;
    expect(specNode.outcomes.map((o) => o.content)).toContain('Nhận biết được hàm số bậc hai');
    expect(spec.body.totals.totalScore).toBe(10);
    expect(spec.body.totals.totalQuestions).toBe(20);

    const xlsx = await http(app).get(`/api/v1/exam-matrices/${matrixId}/specification/export?format=xlsx`)
      .set(auth(teacherA.token)).responseType('arraybuffer');
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(Buffer.from(xlsx.body as ArrayBuffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('giáo viên khác xem đặc tả ma trận trong bank cá nhân của người khác: bị chặn tại cổng xem ma trận của bank', async () => {
    const created = await http(app).post('/api/v1/exam-matrices').set(auth(teacherA.token))
      .send({ name: 'Ma trận đặc tả riêng của giáo viên seed', subjectId, curriculumId, bankId: bankAId });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const matrixId = (created.body as { id: string }).id;
    const spec = await http(app).get(`/api/v1/exam-matrices/${matrixId}/specification`).set(auth(teacherB.token));
    expect(spec.status).toBe(404);
    expect(spec.body.code).toBe('quiz.matrix_not_found');
    const exported = await http(app).get(`/api/v1/exam-matrices/${matrixId}/specification/export?format=xlsx`).set(auth(teacherB.token));
    expect(exported.status).toBe(404);
    expect(exported.body.code).toBe('quiz.matrix_not_found');
  });
});
