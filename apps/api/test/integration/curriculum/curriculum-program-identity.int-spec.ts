import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, adminToken, createTestApp, http, login, systemContextId, uniqueName } from '../../support/identity-access-helpers';
import { ProgramImportService } from '../../../src/modules/curriculum/program-import.service';
import { ProgramDumpService } from '../../../src/modules/curriculum/program-dump.service';
import { CurriculumService } from '../../../src/modules/curriculum/curriculum.service';
import { QuestionsRepository } from '@giaokhoa/db/repositories/questions';
import { QuizService } from '../../../src/modules/quiz/quiz.service';
import {
  loadProgramDataset, programAncestorNodeId, programCurriculumId, programDatasetByKey, programLessonNodeId,
  programOutcomeDocText, programRecordOutcomeEntries, programSubjectId, type ProgramDatasetFile,
  type ProgramOutcomeDoc, type ProgramRecord,
} from '../../../src/modules/curriculum/program-datasets';


const DATASET_KEY = 'gdcd';
const SLUG = 'giao-duc-cong-dan';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Định danh chương trình + phân phối dump đã đóng băng (issue #161)', () => {
  let app: INestApplication;
  let admin: string;
  let adminId: string;
  let systemCtxId: string;
  let pg: Client;
  let svc: ProgramImportService;
  let dumpSvc: ProgramDumpService;
  let curriculumSvc: CurriculumService;
  let questionsRepo: QuestionsRepository;
  let quizSvc: QuizService;
  let file: ProgramDatasetFile;

  let recA: ProgramRecord;
  let recB: ProgramRecord;
  let recC: ProgramRecord;
  let recD: ProgramRecord;
  let recE: ProgramRecord;
  let recF: ProgramRecord;
  let recG: ProgramRecord;
  let lessonA = '';
  let lessonB = '';
  let lessonC = '';
  let lessonE = '';
  let outcomeA1 = '';
  let outcomeB1 = '';
  let outcomeE1 = '';
  let questionE = '';
  let matrixE = '';
  let derivedId = '';
  let bookNodeId = '';

  async function sql<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
    const res = await pg.query(text, params);
    return res.rows as T[];
  }

  async function wipeSubject(): Promise<void> {
    await pg.query(`delete from curriculum_program_records where dataset_key = $1`, [DATASET_KEY]);
    await pg.query(`delete from subjects where slug = $1`, [SLUG]);
  }

  async function snapshotIds(): Promise<{ nodes: string[]; outcomes: string[] }> {
    const nodes = await sql<{ id: string }>(
      `select n.id from curriculum_nodes n
       join curricula c on c.id = n.curriculum_id join subjects s on s.id = c.subject_id
       where s.slug = $1 order by n.id`, [SLUG]);
    const outcomes = await sql<{ id: string }>(
      `select o.id from learning_outcomes o
       join curriculum_nodes n on n.id = o.node_id
       join curricula c on c.id = n.curriculum_id join subjects s on s.id = c.subject_id
       where s.slug = $1 order by o.id`, [SLUG]);
    return { nodes: nodes.map((r) => r.id), outcomes: outcomes.map((r) => r.id) };
  }

  async function lessonIdOf(recordId: string): Promise<string> {
    const rows = await sql<{ node_id: string }>(
      `select node_id from curriculum_program_records where dataset_key = $1 and record_id = $2`, [DATASET_KEY, recordId]);
    expect(rows.length, `ledger row for ${recordId}`).toBe(1);
    return rows[0]!.node_id;
  }

  async function outcomesOf(nodeId: string): Promise<{ id: string; content: ProgramOutcomeDoc; position: number; retired_at: Date | null }[]> {
    return sql(`select id, content, position, retired_at from learning_outcomes where node_id = $1 order by position`, [nodeId]);
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    adminId = (await login(app, ADMIN.username, ADMIN.password)).userId;
    systemCtxId = await systemContextId(app, admin);
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    svc = app.get(ProgramImportService, { strict: false });
    dumpSvc = app.get(ProgramDumpService, { strict: false });
    curriculumSvc = app.get(CurriculumService, { strict: false });
    questionsRepo = app.get(QuestionsRepository, { strict: false });
    quizSvc = app.get(QuizService, { strict: false });
    file = loadProgramDataset(programDatasetByKey(DATASET_KEY)!);
    expect(file.records.length).toBe(40);
    const withOutcomes = file.records.filter((r) => (r.outcomes?.length ?? 0) >= 1);
    recA = withOutcomes.find((r) => (r.outcomes?.length ?? 0) >= 2 && r.topic)!;
    recB = withOutcomes.find((r) => r.id !== recA.id && r.grade === recA.grade)!;
    const grades = new Set(file.records.map((r) => r.grade));
    recC = withOutcomes.find((r) => r.id !== recA.id && r.id !== recB.id && r.grade !== null && grades.has(r.grade + 1))!;
    const used = new Set([recA.id, recB.id, recC.id]);
    recD = withOutcomes.find((r) => !used.has(r.id) && (r.outcomes?.length ?? 0) >= 4
      && new Set(programRecordOutcomeEntries(r).map((e) => e.text)).size === (r.outcomes?.length ?? 0))!;
    used.add(recD.id);
    recE = withOutcomes.find((r) => !used.has(r.id) && (r.outcomes?.length ?? 0) >= 2)!;
    used.add(recE.id);
    recF = withOutcomes.find((r) => !used.has(r.id))!;
    used.add(recF.id);
    recG = withOutcomes.find((r) => !used.has(r.id))!;
    expect(recA && recB && recC && recD && recE && recF && recG).toBeTruthy();
    await wipeSubject();
  }, 120_000);
  afterAll(async () => {
    try {
      await pg.query(`delete from books where title like 'Sach kiem chung GDPT-SEED%'`);
      await pg.query(`delete from question where category in (select id from question_categories where name like 'cat-gdpt-seed%')`);
      await pg.query(`delete from exam_matrices where name like 'Ma trận kiểm chứng %'`);
      await pg.query(`delete from question_categories where name like 'cat-gdpt-seed%'`);
      await wipeSubject();
    } catch {   }
    await pg.end();
    await app.close();
  });

  it('bản production trung tâm: trình nhập nạp GDCD; id outcome do DB cấp dạng uuidv7, không suy ra từ thuộc tính nào', async () => {
    const res = await svc.importDatasetInternal(DATASET_KEY);
    expect(res.totalRecords).toBe(40);
    expect(res.created).toBe(40);
    expect(res.updated).toBe(0);
    expect(res.orphanedNodes).toBe(0);
    expect(res.retiredOutcomes).toBe(0);
    expect(res.changeCounts.added).toBeGreaterThan(0);
    expect(res.changesOmitted).toBe(0);
    expect(res.changes.length).toBe(res.changeCounts.added);

    const subjects = await sql<{ id: string }>(`select id from subjects where slug = $1`, [SLUG]);
    expect(subjects[0]!.id).toBe(programSubjectId(SLUG));
    expect(res.subjectId).toBe(programSubjectId(SLUG));

    const grade = recA.grade!;
    const curricula = await sql<{ id: string }>(
      `select id from curricula where subject_id = $1 and grade = $2`, [subjects[0]!.id, grade]);
    expect(curricula[0]!.id).toBe(programCurriculumId(SLUG, grade));

    lessonA = await lessonIdOf(recA.id);
    expect(lessonA).toBe(programLessonNodeId(DATASET_KEY, recA.id));

    const ancestors = await sql<{ id: string; kind: string; title: string }>(
      `with recursive chain as (
         select id, parent_id, kind, title, 1 as depth from curriculum_nodes where id =
           (select parent_id from curriculum_nodes where id = $1)
         union all
         select n.id, n.parent_id, n.kind, n.title, chain.depth + 1 from curriculum_nodes n
         join chain on chain.parent_id = n.id
       ) select id, kind, title from chain order by depth desc`, [lessonA]);
    expect(ancestors.map((a) => [a.kind, a.title])).toEqual([
      ['strand', recA.section], ['topic', recA.topic],
    ]);
    expect(ancestors[0]!.id).toBe(programAncestorNodeId(SLUG, grade, [['strand', recA.section!]]));
    expect(ancestors[1]!.id).toBe(programAncestorNodeId(SLUG, grade, [['strand', recA.section!], ['topic', recA.topic!]]));

    const expected = programRecordOutcomeEntries(recA);
    const outcomes = await outcomesOf(lessonA);
    expect(outcomes.map((o) => programOutcomeDocText(o.content))).toEqual(expected.map((e) => e.text));
    expect(outcomes.map((o) => o.position)).toEqual(expected.map((e) => e.position));
    for (const o of outcomes) expect(o.id).toMatch(UUID_V7);
    outcomeA1 = outcomes[0]!.id;
  }, 180_000);

  it('dump đã đóng băng: xuất → xoá → khôi phục tái tạo đúng tập id; khôi phục trên DB đã có dữ liệu thì không làm gì', async () => {
    const before = await snapshotIds();
    expect(before.nodes.length).toBeGreaterThan(80);
    expect(before.outcomes.length).toBeGreaterThan(150);

    const dumpSql = await dumpSvc.buildDumpSql({ datasetKey: DATASET_KEY });
    expect(dumpSql).toContain('DUMP ĐÔNG CỨNG');

    await wipeSubject();
    await dumpSvc.restoreDumpSql(dumpSql);
    const afterFirst = await snapshotIds();
    expect(afterFirst).toEqual(before);

    const second = await dumpSvc.restoreIfEmpty();
    expect(second.restored).toBe(false);
    expect(await snapshotIds()).toEqual(before);

    await wipeSubject();
    await dumpSvc.restoreDumpSql(dumpSql);
    expect(await snapshotIds()).toEqual(before);

    const res = await svc.importDatasetInternal(DATASET_KEY);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(0);
    expect(res.skipped).toBe(40);
    expect(res.changes).toEqual([]);
    expect(res.retiredOutcomes).toBe(0);

    lessonA = await lessonIdOf(recA.id);
    lessonB = await lessonIdOf(recB.id);
    lessonC = await lessonIdOf(recC.id);
    outcomeB1 = (await outcomesOf(lessonB))[0]!.id;
    outcomeA1 = (await outcomesOf(lessonA))[0]!.id;
  }, 180_000);

  it('restore dump của môi trường khác: môn neo lại về context hệ thống của môi trường đích (issue #233)', async () => {
    const before = await snapshotIds();
    const dump = await dumpSvc.buildDumpSql({ datasetKey: DATASET_KEY });
    const foreignCtx = randomUUID();
    const foreignDump = dump.split(systemCtxId).join(foreignCtx);
    expect(foreignDump).toContain(foreignCtx);

    await wipeSubject();
    await dumpSvc.restoreDumpSql(foreignDump);

    const rows = await sql<{ id: string; context_id: string }>(
      `select id, context_id from subjects where slug = $1`, [SLUG]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.context_id).toBe(systemCtxId);
    expect(await snapshotIds()).toEqual(before);
    const view = await curriculumSvc.getSubject(adminId, rows[0]!.id);
    expect(view.id).toBe(rows[0]!.id);
  }, 180_000);

  it('bản vá trung tâm — sửa văn bản giữ nguyên id outcome và mọi tham chiếu', async () => {
    const derivedRes = await http(app).post('/api/v1/curriculum/outcomes').set(bearer(admin))
      .send({ nodeId: lessonA, content: 'YCCĐ suy ra phục vụ kiểm chứng.', sourceKind: 'derived', derivedFromId: outcomeA1 });
    expect(derivedRes.status).toBe(201);
    derivedId = (derivedRes.body as { id: string }).id;

    const book = await sql<{ id: string }>(
      `insert into books (title, subject_id, grade) values ($1, $2, $3) returning id`,
      [uniqueName('Sach kiem chung GDPT-SEED'), programSubjectId(SLUG), recA.grade]);
    const bookNode = await sql<{ id: string }>(
      `insert into book_nodes (book_id, title, kind) values ($1, 'Bài kiểm chứng', 'lesson') returning id`, [book[0]!.id]);
    bookNodeId = bookNode[0]!.id;
    await pg.query(
      `insert into book_mappings (book_node_id, curriculum_node_id, position) values ($1, $2, 1)`, [bookNodeId, lessonA]);
    await pg.query(
      `insert into book_mappings (book_node_id, learning_outcome_id, position) values ($1, $2, 2)`, [bookNodeId, outcomeA1]);

    const category = await sql<{ id: string }>(
      `insert into question_categories (name, context_id) values ($1, $2) returning id`, [uniqueName('cat-gdpt-seed'), systemCtxId]);
    const question = await sql<{ id: string }>(
      `insert into question (category, qtype) values ($1, 'multichoice') returning id`, [category[0]!.id]);
    await pg.query(
      `insert into question_bank_entries (question_category_id, question_id, status) values ($1, $2, 'ready')`, [category[0]!.id, question[0]!.id]);
    await pg.query(
      `insert into question_learning_outcomes (question_id, learning_outcome_id, cognitive_level) values ($1, $2, 'biet')`,
      [question[0]!.id, outcomeB1]);

    const matrix = await sql<{ id: string }>(
      `insert into exam_matrices (name, subject_id, curriculum_id, context_id)
       values ('Ma trận kiểm chứng sửa chữ', $1,
               (select curriculum_id from curriculum_program_records where dataset_key = $2 and record_id = $3), $4)
       returning id`,
      [programSubjectId(SLUG), DATASET_KEY, recC.id, systemCtxId]);
    const matrixVersion = await sql<{ id: string }>(
      `insert into exam_matrix_versions (matrix_id, version, created_by) values ($1, 1, $2) returning id`,
      [matrix[0]!.id, adminId]);
    await pg.query(
      `insert into exam_matrix_cells (matrix_id, matrix_version_id, curriculum_node_id, cognitive_level, qtype, question_count, cell_score)
       values ($1, $2, $3, 'hieu', 'multichoice', 1, 1)`, [matrix[0]!.id, matrixVersion[0]!.id, lessonC]);

    const refsBefore = await referenceSnapshot();
    const outcomeTotalBefore = (await snapshotIds()).outcomes.length;

    const mutated = structuredClone(file) as ProgramDatasetFile;
    const mA = mutated.records.find((r) => r.id === recA.id)!;
    mA.topic = `${recA.topic} (đính chính)`;
    const mB = mutated.records.find((r) => r.id === recB.id)!;
    const firstTextB = programRecordOutcomeEntries(recB)[0]!.text;
    const newTextB = `${firstTextB} [bản đính chính]`;
    mB.outcomes = [newTextB, ...recB.outcomes!.slice(1)];
    const mC = mutated.records.find((r) => r.id === recC.id)!;
    mC.grade = recC.grade! + 1;

    const res = await svc.importDatasetFileInternal(DATASET_KEY, mutated);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(3);
    expect(res.orphanedNodes).toBe(0);
    expect(res.changeCounts.textChanged).toBe(1);
    const textChange = res.changes.find((c) => c.kind === 'text-changed');
    expect(textChange).toMatchObject({ recordId: recB.id, position: 1, oldText: firstTextB, newText: newTextB });

    const nodeA = await sql<{ id: string; title: string }>(`select id, title from curriculum_nodes where id = $1`, [lessonA]);
    expect(nodeA[0]!.title).toBe(mA.topic);

    const bRows = await outcomesOf(lessonB);
    const corrected = bRows.find((r) => r.id === outcomeB1);
    expect(corrected, 'the corrected outcome keeps its row and id').toBeTruthy();
    expect(programOutcomeDocText(corrected!.content)).toBe(newTextB);
    expect(corrected!.retired_at).toBeNull();
    expect((await snapshotIds()).outcomes.length).toBe(outcomeTotalBefore);

    const nodeC = await sql<{ id: string; curriculum_id: string }>(
      `select id, curriculum_id from curriculum_nodes where id = $1`, [lessonC]);
    expect(nodeC[0]!.curriculum_id).toBe(programCurriculumId(SLUG, recC.grade! + 1));

    expect(await referenceSnapshot()).toEqual(refsBefore);
    const derived = await sql<{ id: string; node_id: string; source_kind: string; content: string; derived_from_id: string }>(
      `select id, node_id, source_kind, content, derived_from_id from learning_outcomes where id = $1`, [derivedId]);
    expect(derived.length).toBe(1);
    expect(derived[0]!.derived_from_id).toBe(outcomeA1);
  }, 180_000);

  it('bản vá trung tâm — chèn một dòng vào giữa cấp id mới cho dòng đó và chỉ đánh lại thứ tự vị trí', async () => {
    const lessonD = await lessonIdOf(recD.id);
    const beforeRows = await outcomesOf(lessonD);
    expect(beforeRows.length).toBeGreaterThanOrEqual(4);
    const idsBefore = new Set(beforeRows.map((r) => r.id));

    const insertedText = 'Ý mới chèn giữa phục vụ kiểm chứng neo định danh.';
    const mutated = structuredClone(file) as ProgramDatasetFile;
    const mD = mutated.records.find((r) => r.id === recD.id)!;
    mD.outcomes = [...recD.outcomes!.slice(0, 2), insertedText, ...recD.outcomes!.slice(2)];

    const res = await svc.importDatasetFileInternal(DATASET_KEY, mutated);
    expect(res.changeCounts.added).toBe(1);
    expect(res.changeCounts.moved).toBe(beforeRows.length - 2);
    const added = res.changes.find((c) => c.kind === 'added' && c.recordId === recD.id);
    expect(added).toMatchObject({ position: 3, newText: insertedText });

    const afterRows = await outcomesOf(lessonD);
    expect(afterRows.length).toBe(beforeRows.length + 1);
    expect(afterRows[0]!.id).toBe(beforeRows[0]!.id);
    expect(afterRows[1]!.id).toBe(beforeRows[1]!.id);
    expect(programOutcomeDocText(afterRows[2]!.content)).toBe(insertedText);
    expect(afterRows[2]!.id).toMatch(UUID_V7);
    expect(idsBefore.has(afterRows[2]!.id)).toBe(false);
    for (let i = 3; i < afterRows.length; i += 1) {
      expect(afterRows[i]!.id).toBe(beforeRows[i - 1]!.id);
      expect(afterRows[i]!.position).toBe(beforeRows[i - 1]!.position + 1);
    }
  }, 180_000);

  it('cho một dòng nghỉ hưu sẽ loại nó khỏi ngân hàng câu hỏi và khỏi đặc tả, nhưng không bao giờ xoá hẳn', async () => {
    lessonE = await lessonIdOf(recE.id);
    outcomeE1 = (await outcomesOf(lessonE))[0]!.id;

    const category = await sql<{ id: string }>(
      `insert into question_categories (name, context_id) values ($1, $2) returning id`, [uniqueName('cat-gdpt-seed'), systemCtxId]);
    const question = await sql<{ id: string }>(
      `insert into question (category, qtype) values ($1, 'multichoice') returning id`, [category[0]!.id]);
    questionE = question[0]!.id;
    await pg.query(
      `insert into question_bank_entries (question_category_id, question_id, status) values ($1, $2, 'ready')`, [category[0]!.id, questionE]);
    await pg.query(
      `insert into question_learning_outcomes (question_id, learning_outcome_id, cognitive_level) values ($1, $2, 'biet')`,
      [questionE, outcomeE1]);
    const matrix = await sql<{ id: string }>(
      `insert into exam_matrices (name, subject_id, curriculum_id, context_id)
       values ('Ma trận kiểm chứng rút dòng', $1,
               (select curriculum_id from curriculum_program_records where dataset_key = $2 and record_id = $3), $4)
       returning id`,
      [programSubjectId(SLUG), DATASET_KEY, recE.id, systemCtxId]);
    matrixE = matrix[0]!.id;
    const matrixVersionE = await sql<{ id: string }>(
      `insert into exam_matrix_versions (matrix_id, version, created_by) values ($1, 1, $2) returning id`,
      [matrixE, adminId]);
    await pg.query(
      `insert into exam_matrix_cells (matrix_id, matrix_version_id, curriculum_node_id, cognitive_level, qtype, question_count, cell_score)
       values ($1, $2, $3, 'biet', 'multichoice', 1, 1)`, [matrixE, matrixVersionE[0]!.id, lessonE]);

    const poolBefore = await questionsRepo.filterQuestionsByCurriculumLinks({
      nodeId: lessonE, cognitiveLevel: 'biet', qtype: 'multichoice', status: 'ready',
    });
    expect(poolBefore.map((q) => q.id)).toContain(questionE);
    const specBefore = await quizSvc.getMatrixSpecification(adminId, matrixE);
    const specOutcomesBefore = specBefore.topics.flatMap((t) => t.nodes).find((n) => n.nodeId === lessonE)?.outcomes ?? [];
    const specEntry = specOutcomesBefore.find((o) => o.outcomeId === outcomeE1);
    expect(specEntry).toBeTruthy();
    expect(specEntry!.position).toBe(1);
    expect(specEntry!.code).toBe(`${recE.id}.01`);

    const mutated = structuredClone(file) as ProgramDatasetFile;
    const mE = mutated.records.find((r) => r.id === recE.id)!;
    mE.outcomes = recE.outcomes!.slice(1);
    const res = await svc.importDatasetFileInternal(DATASET_KEY, mutated);
    const removed = res.changes.find((c) => c.kind === 'removed' && c.recordId === recE.id);
    expect(removed).toBeTruthy();
    expect(removed!.linkedQuestions).toBeGreaterThanOrEqual(1);

    const row = await sql<{ id: string; retired_at: Date | null }>(
      `select id, retired_at from learning_outcomes where id = $1`, [outcomeE1]);
    expect(row.length).toBe(1);
    expect(row[0]!.retired_at).not.toBeNull();
    const links = await sql(`select id from question_learning_outcomes where learning_outcome_id = $1`, [outcomeE1]);
    expect(links.length).toBe(1);
    const byId = await curriculumSvc.getOutcome(adminId, outcomeE1);
    expect(byId.id).toBe(outcomeE1);

    const poolAfter = await questionsRepo.filterQuestionsByCurriculumLinks({
      nodeId: lessonE, cognitiveLevel: 'biet', qtype: 'multichoice', status: 'ready',
    });
    expect(poolAfter.map((q) => q.id)).not.toContain(questionE);
    const specAfter = await quizSvc.getMatrixSpecification(adminId, matrixE);
    const specOutcomeIds = specAfter.topics.flatMap((t) => t.nodes).flatMap((n) => n.outcomes).map((o) => o.outcomeId);
    expect(specOutcomeIds).not.toContain(outcomeE1);
  }, 180_000);

  it('các dòng giống hệt nhau vẫn có id riêng; cho một dòng nghỉ hưu thì dòng còn lại vẫn hoạt động và được gắn cờ mơ hồ', async () => {
    const lessonF = await lessonIdOf(recF.id);
    const twin = 'Ý trùng hệt nhau phục vụ kiểm chứng.';
    const third = 'Ý thứ ba phân biệt phục vụ kiểm chứng.';
    const step1 = structuredClone(file) as ProgramDatasetFile;
    step1.records.find((r) => r.id === recF.id)!.outcomes = [twin, twin, third];
    await svc.importDatasetFileInternal(DATASET_KEY, step1);
    const allRows = await outcomesOf(lessonF);
    const rows = allRows.filter((r) => r.retired_at === null);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => programOutcomeDocText(r.content))).toEqual([twin, twin, third]);
    expect(programOutcomeDocText(rows[0]!.content)).toBe(twin);
    expect(programOutcomeDocText(rows[1]!.content)).toBe(twin);
    expect(programOutcomeDocText(rows[2]!.content)).toBe(third);
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
    for (const r of rows) expect(r.id).toMatch(UUID_V7);

    const step2 = structuredClone(file) as ProgramDatasetFile;
    step2.records.find((r) => r.id === recF.id)!.outcomes = [twin, third];
    const res = await svc.importDatasetFileInternal(DATASET_KEY, step2);
    const removed = res.changes.find((c) => c.kind === 'removed' && c.recordId === recF.id);
    expect(removed).toBeTruthy();
    expect(removed!.identicalTextAmbiguous).toBe(true);

    const after = await outcomesOf(lessonF);
    const keptTwin = after.find((r) => r.id === rows[0]!.id);
    expect(keptTwin!.retired_at).toBeNull();
    const retiredTwin = after.find((r) => r.id === rows[1]!.id);
    expect(retiredTwin!.retired_at).not.toBeNull();
  }, 180_000);

  it('xoá cả một bản ghi sẽ cho toàn bộ dòng của nó nghỉ hưu; bản ghi quay lại sẽ hồi sinh đúng các dòng đó', async () => {
    const lessonG = await lessonIdOf(recG.id);
    const beforeRows = await outcomesOf(lessonG);
    expect(beforeRows.length).toBeGreaterThan(0);

    const removedFile = structuredClone(file) as ProgramDatasetFile;
    removedFile.records = removedFile.records.filter((r) => r.id !== recG.id);
    const resRemoved = await svc.importDatasetFileInternal(DATASET_KEY, removedFile);
    expect(resRemoved.orphanedNodes).toBe(1);
    expect(resRemoved.changeCounts.removed).toBe(beforeRows.length);
    const duringRows = await outcomesOf(lessonG);
    expect(duringRows.length).toBe(beforeRows.length);
    for (const r of duringRows) expect(r.retired_at).not.toBeNull();

    const resBack = await svc.importDatasetFileInternal(DATASET_KEY, file);
    expect(resBack.changeCounts.revived).toBe(beforeRows.length);
    const backRows = await outcomesOf(lessonG);
    expect(backRows.map((r) => r.id)).toEqual(beforeRows.map((r) => r.id));
    for (const r of backRows) expect(r.retired_at).toBeNull();
  }, 180_000);

  it('chế độ restrict chặn xoá bằng lỗi nghiệp vụ cho tới khi hết tham chiếu', async () => {
    const delOutcome = await http(app).delete(`/api/v1/curriculum/outcomes/${outcomeA1}`).set(bearer(admin));
    expect(delOutcome.status).toBe(409);
    expect(delOutcome.body.code).toBe('curriculum.delete_referenced');
    const delNode = await http(app).delete(`/api/v1/curriculum/nodes/${lessonA}`).set(bearer(admin));
    expect(delNode.status).toBe(409);
    expect(delNode.body.code).toBe('curriculum.delete_referenced');
    let pgCode = '';
    try {
      await pg.query(`delete from learning_outcomes where id = $1`, [outcomeA1]);
    } catch (err) {
      pgCode = (err as { code?: string }).code ?? '';
    }
    expect(['23001', '23503']).toContain(pgCode);
    const stillThere = await sql<{ id: string }>(`select id from learning_outcomes where id = $1`, [outcomeA1]);
    expect(stillThere.length).toBe(1);

    await pg.query(`delete from question_learning_outcomes where learning_outcome_id = $1`, [outcomeB1]);
    const delCorrected = await http(app).delete(`/api/v1/curriculum/outcomes/${outcomeB1}`).set(bearer(admin));
    expect(delCorrected.status).toBeLessThan(300);
    const gone = await sql<{ id: string }>(`select id from learning_outcomes where id = $1`, [outcomeB1]);
    expect(gone.length).toBe(0);
  }, 120_000);

  async function referenceSnapshot(): Promise<unknown> {
    const mappings = await sql(
      `select id, book_node_id, curriculum_node_id, learning_outcome_id from book_mappings where book_node_id = $1 order by position`, [bookNodeId]);
    const links = await sql(
      `select id, question_id, learning_outcome_id from question_learning_outcomes where learning_outcome_id = $1`, [outcomeB1]);
    const cells = await sql(
      `select id, matrix_id, curriculum_node_id from exam_matrix_cells where curriculum_node_id = $1`, [lessonC]);
    return { mappings, links, cells };
  }
});
