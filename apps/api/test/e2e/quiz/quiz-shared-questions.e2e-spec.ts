import { VersioningType, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { validateEnv } from '../../../src/config/env';
import { ProblemDetailsFilter } from '../../../src/common/problem-details.filter';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestDatabase, dropTestDatabase, withDatabase } from '@giaokhoa/db/test-support';
import { SYSTEM_FILE_DOMAIN } from '@giaokhoa/db';
import type { SystemBankPackage } from '@giaokhoa/contracts';
import { adminToken, http, STRONG_PASSWORD, uniqueName } from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser, getFirstSectionId } from '../../support/course-enrolment-helpers';
import { createReadyQuestion, personalExamBankId } from '../../support/exam-pin-helpers';
import { DedicatedTestCentres, type DedicatedTestCentre } from '../../support/dedicated-test-centres';
import { runSpaceProvision, type SpaceProvisionResult } from '../../../src/modules/tenants/space-provision-runner';
import { SpaceDatabaseService } from '../../../src/db/routing/space-database.service';
import { SystemBankConnection } from '../../../src/modules/system-bank/system-bank.connection';
import { UsersService } from '../../../src/modules/users/users.service';
import { TenantsService } from '../../../src/modules/tenants/tenants.service';
import { ContextsService } from '../../../src/modules/access/contexts.service';
import { RolesService } from '../../../src/modules/access/roles.service';

import { OBJECT_STORAGE, sha256Hex, type ObjectStorage } from '../../../src/modules/files/storage';
import { publicationMediaStorageKey } from '../../../src/modules/system-bank/system-bank-media.service';

async function createSnapshotTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService).useValue(new ConfigService(validateEnv({ ...process.env }))).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  return app;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const emptyPackage = (): SystemBankPackage => ({ questionText: doc('Nội dung hệ thống'), generalFeedback: doc('Phản hồi đã chụp'),
  stimulusContent: doc('Ngữ liệu đã chụp'), answers: [], answerKey: null, options: null, outcomes: [], media: [] });
const mcPackage = (): SystemBankPackage => ({ ...emptyPackage(), answers: ['Đúng', 'Sai 1', 'Sai 2', 'Sai 3'].map((text, i) => ({
  answer: doc(text), isCorrect: i === 0, feedback: doc(`Nhận xét ${i}`), sortOrder: i,
})) });

describe('Giao đề trộn nguồn chung và riêng bằng snapshot trung tâm', () => {
  let app: INestApplication;
  let offlineApp: INestApplication | undefined;
  let dedicated: DedicatedTestCentres;
  let dedicatedA: DedicatedTestCentre;
  let dedicatedB: DedicatedTestCentre;
  let admin: string;
  let teacher: string;
  let manager: string;
  let student: string;
  let outsider: string;
  let foreign: string;
  let centre: Client;
  let bank: Client;
  let courseId: string;
  let sectionId: string;
  let groupId: string;
  let tenantA: string;
  let studentId: string;
  let examBankId: string;
  let localId: string;
  let storageDir: string;
  let bankUrl: string;
  const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, SYSTEM_BANK_DATABASE_URL: process.env.SYSTEM_BANK_DATABASE_URL,
    FILE_STORAGE_DIR: process.env.FILE_STORAGE_DIR };
  const adminUrl = withDatabase(process.env.DATABASE_URL!, 'postgres');
  const suffix = randomUUID().slice(0, 8);
  const centreName = `giaokhoa_test_shared_centre_${suffix}`;
  const bankName = `giaokhoa_test_shared_bank_${suffix}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = await buildTestDatabase({ adminUrl, database: centreName, store: 'centre' });
    bankUrl = await buildTestDatabase({ adminUrl, database: bankName, store: 'system-bank' });
    process.env.SYSTEM_BANK_DATABASE_URL = bankUrl;
    storageDir = await mkdtemp(join(tmpdir(), 'giaokhoa-shared-'));
    process.env.FILE_STORAGE_DIR = storageDir;
    dedicated = new DedicatedTestCentres();
    await dedicated.provision([`quiz-a-${suffix}`, `quiz-b-${suffix}`]);
    app = await createSnapshotTestApp();
    admin = await adminToken(app);
    [dedicatedA, dedicatedB] = await dedicated.activate(app);
    centre = new Client({ connectionString: withDatabase(adminUrl, dedicatedA.space.databaseName) });
    await centre.connect();
    bank = new Client({ connectionString: bankUrl });
    await bank.connect();
    tenantA = dedicatedA.space.tenantId!;
    const t = await dedicated.createUser(app, dedicatedA, 'quizteacher');
    const s = await dedicated.createUser(app, dedicatedA, 'quizstudent');
    const o = await dedicated.createUser(app, dedicatedA, 'quizoutsider');
    const f = await dedicated.createUser(app, dedicatedB, 'quizforeign');
    studentId = s.id;
    await dedicated.grantCentreManager(app, dedicatedA);
    await dedicated.grantCentreManager(app, dedicatedB);
    manager = dedicatedA.adminToken;
    teacher = t.token;
    student = s.token;
    outsider = o.token;
    foreign = f.token;
    await dedicated.grantRole(app, dedicatedA, t.id, 'teacher');
    const category = await createCategory(app, manager);
    courseId = (await createCourse(app, manager, category.id)).id;
    sectionId = await getFirstSectionId(app, manager, courseId);
    const courseCtx = (await centre.query('SELECT id FROM context WHERE context_level = 50 AND instance_id = $1', [courseId])).rows[0];
    await dedicated.grantRole(app, dedicatedA, t.id, 'editingteacher', courseCtx.id);
    const instance = await createEnrolInstance(app, manager, courseId);
    await enrolUser(app, manager, courseId, instance.id, s.id);
    await enrolUser(app, manager, courseId, instance.id, o.id);
    const group = await http(app).post(`/api/v1/courses/${courseId}/groups`).set(bearer(teacher)).send({ name: 'Nhóm nhận đề' });
    expect(group.status, JSON.stringify(group.body)).toBe(201); groupId = group.body.id;
    expect((await http(app).post(`/api/v1/courses/${courseId}/groups/${groupId}/members`).set(bearer(teacher)).send({ userId: s.id })).status).toBe(201);
    examBankId = await personalExamBankId(app, teacher);
    localId = await createReadyQuestion(app, teacher, 'Câu riêng không đổi');
  }, 180_000);

  afterAll(async () => {
    await offlineApp?.close(); await app?.close();
    await offlineApp?.get<Pool>('SHARED_CENTRE_KYSELY').end();
    await app?.get<Pool>('SHARED_CENTRE_KYSELY').end();
    await centre?.end(); await bank?.end();
    await dedicated?.cleanup();
    await dropTestDatabase(adminUrl, centreName); await dropTestDatabase(adminUrl, bankName);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });

  async function publish(qtype: string, pkg: SystemBankPackage) {
    const response = await http(app).post('/api/v1/system-bank/questions').set(bearer(admin)).send({ qtype, package: pkg });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as { question: { id: string }; version: { id: string; checksum: string } };
  }

  async function paper(questionIds: string[]) {
    const created = await http(app).post(`/api/v1/exams/banks/${examBankId}/exams`).set(bearer(teacher)).send({
      name: 'Đề trộn nguồn chung và riêng', totalScore: questionIds.length + 1,
      slots: [...questionIds.map((questionId) => ({ questionId, sourceDomain: 'bank-system', sourceVersionNumber: 1 })), { questionId: localId }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.slots.filter((s: { sourceDomain: string }) => s.sourceDomain === 'bank-system')).toHaveLength(questionIds.length);
    const ready = await http(app).post(`/api/v1/exams/${created.body.paper.id}/status`).set(bearer(teacher)).send({ status: 'ready' });
    expect(ready.status).toBe(201);
    return created.body.paper.id as string;
  }

  const pinBody = (examId: string, requestId = randomUUID()) => ({ examId, requestId, sectionId, targetGroupId: groupId,
    reviewAttempt: 0x11110, reviewCorrectness: 0x11110, reviewMarks: 0x11110, reviewSpecificFeedback: 0x11110,
    reviewGeneralFeedback: 0x11110, reviewRightAnswer: 0x11110 });

  it('ghép đủ bốn dạng, không nhập câu editable; bank ngừng truy cập vẫn làm, chấm, nhận xét và xem lại theo quyền công bố', async () => {
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFxoAAAAASUVORK5CYII=', 'base64');
    const hash = sha256Hex(image);
    await app.get<ObjectStorage>(OBJECT_STORAGE).put(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(hash), image);
    const pkg = mcPackage();
    pkg.questionText = { type: 'doc', content: [...doc('Câu có ảnh bất biến').content, { type: 'image', attrs: { src: `bank-media://${hash}`, alt: 'Ảnh đã công bố' } }] };
    pkg.media = [{ contentHash: hash, fileName: 'anh.png', mimeType: 'image/png' }];
    const mc = await publish('multichoice', pkg);
    const tf = await publish('truefalse', { ...emptyPackage(), questionText: { type: 'doc', content: [...doc('Đúng sai bốn ý').content, {
      type: 'statementList', content: [1, 2, 3, 4].map((i) => ({ type: 'statement', attrs: { id: `s${i}` }, content: doc(`Ý ${i}`).content })),
    }] }, answerKey: { guidance: null, solution: { answers: [1, 2, 3, 4].map((i) => ({ statementId: `s${i}`, value: true })) } } });
    const sa = await publish('shortanswer', { ...emptyPackage(), answers: [{ answer: doc('HaNoi'), isCorrect: true, feedback: null, sortOrder: 0 }], options: { useCase: true } });
    const essay = await publish('essay', { ...emptyPackage(), answerKey: { guidance: doc('Hướng dẫn làm bài'), solution: { answer: doc('Lời giải bí mật') } } });
    const examId = await paper([mc.question.id, tf.question.id, sa.question.id, essay.question.id]);
    const body = pinBody(examId);
    const pinned = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(body);
    expect(pinned.status, JSON.stringify(pinned.body)).toBe(201);
    const pinId = pinned.body.id as string;
    const item = await centre.query('SELECT id FROM grade_items WHERE item_instance = $1', [pinned.body.cmId]);
    const policy = await http(app).put(`/api/v1/grade-items/${item.rows[0].id}/posting-policy`).set(bearer(teacher)).send({ policy: 'manual' });
    expect(policy.status).toBe(200);
    const repeat = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(body);
    expect(repeat.status).toBe(201); expect(repeat.body.id).toBe(pinId);
    expect((await centre.query('SELECT id FROM question WHERE id = ANY($1::uuid[])', [[mc.question.id, tf.question.id, sa.question.id, essay.question.id]])).rowCount).toBe(0);
    const snapshot = await centre.query('SELECT question_snapshots, preparation_state FROM exam_pins WHERE id = $1', [pinId]);
    expect(snapshot.rows[0].preparation_state).toBe('ready');
    expect(snapshot.rows[0].question_snapshots).toHaveLength(5);
    expect(JSON.stringify(snapshot.rows[0].question_snapshots)).not.toContain('bank-media://');
    expect(JSON.stringify(snapshot.rows[0].question_snapshots)).toContain('Ngữ liệu đã chụp');
    const copiedFiles = await centre.query('SELECT f.content_hash, cr.tenant_id FROM files f JOIN context c ON c.id = f.context_id JOIN course cr ON cr.id = c.instance_id WHERE c.context_level = 50 AND c.instance_id = $1', [courseId]);
    expect(copiedFiles.rows).toEqual([{ content_hash: hash, tenant_id: tenantA }]);
    const immutableFile = (await centre.query("SELECT id FROM files WHERE file_area = 'exam_snapshot' AND content_hash = $1", [hash])).rows[0];
    const removed = await http(app).delete(`/api/v1/files/${immutableFile.id}`).set(bearer(teacher));
    expect(removed.status).toBe(403); expect(removed.body.code).toBe('file.snapshot_locked');
    await app.get<ObjectStorage>(OBJECT_STORAGE).delete(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(hash));
    const newer = await http(app).post(`/api/v1/system-bank/questions/${sa.question.id}/versions`).set(bearer(admin)).send({ package: { ...emptyPackage(), answers: [{ answer: doc('Sai mới'), isCorrect: true, feedback: null, sortOrder: 0 }] } });
    expect(newer.status).toBe(201);
    delete process.env.SYSTEM_BANK_DATABASE_URL;
    offlineApp = await createSnapshotTestApp();
    dedicated.bindApp(offlineApp, [
      { token: manager, host: dedicatedA.host }, { token: teacher, host: dedicatedA.host },
      { token: student, host: dedicatedA.host }, { token: outsider, host: dedicatedA.host },
      { token: foreign, host: dedicatedB.host },
    ]);
    expect(offlineApp.get(SystemBankConnection).isConfigured).toBe(false);
    for (const token of [outsider, foreign]) {
      const denied = await http(offlineApp).post(`/api/v1/exam-pins/${pinId}/attempts`).set(bearer(token)).send({});
      expect([403, 404]).toContain(denied.status);
    }
    const started = await http(offlineApp).post(`/api/v1/exam-pins/${pinId}/attempts`).set(bearer(student)).send({});
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const attemptId = started.body.attempt.id as string;
    expect(started.body.questions).toHaveLength(5);
    expect(JSON.stringify(started.body)).not.toContain('Lời giải bí mật');
    expect(started.body.questions[2].answers).toEqual([]);
    const imageNode = started.body.questions[0].questionText.content.find((n: { type: string }) => n.type === 'image');
    const imageDownload = await http(offlineApp).get(imageNode.attrs.src).set('Host', dedicatedA.host);
    expect(imageDownload.status).toBe(200); expect(sha256Hex(imageDownload.body)).toBe(hash);
    expect(started.body.questions[0].stimulus.content).toMatchObject(doc('Ngữ liệu đã chụp'));
    const responses = [started.body.questions[0].answers[0].id, JSON.stringify({ s1: true, s2: true, s3: true, s4: true }), 'HaNoi', 'Bài tự luận của học sinh', started.body.questions[4].answers[0].id];
    for (const [index, response] of responses.entries()) {
      const saved = await http(offlineApp).post(`/api/v1/quiz-attempts/${attemptId}/responses`).set(bearer(student))
        .send({ questionAttemptId: started.body.questions[index].questionAttemptId, response });
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    }
    const submitted = await http(offlineApp).post(`/api/v1/quiz-attempts/${attemptId}/submit`).set(bearer(student)).send({});
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201); expect(submitted.body.attempt.state).toBe('needsgrading');
    const graded = await http(offlineApp).post(`/api/v1/quiz-attempts/${attemptId}/questions/${started.body.questions[3].questionAttemptId}/grade`)
      .set(bearer(teacher)).send({ mark: 1, comment: 'Nhận xét chỉ lưu ở A' });
    expect(graded.status, JSON.stringify(graded.body)).toBe(201); expect(graded.body.attempt.grade).toBe(5);
    const hidden = await http(offlineApp).get(`/api/v1/quiz-attempts/${attemptId}`).set(bearer(student));
    expect(hidden.body.attempt.grade).toBeNull(); expect(hidden.body.attempt.sumGrades).toBeNull();
    expect(hidden.body.questions.every((q: { mark: unknown; fraction: unknown }) => q.mark === null && q.fraction === null)).toBe(true);
    expect((await http(offlineApp).get(`/api/v1/question-usages/${started.body.attempt.usageId}`).set(bearer(student))).status).toBe(404);
    expect((await http(offlineApp).post(`/api/v1/question-usages/${started.body.attempt.usageId}/finish`).set(bearer(student)).send({})).status).toBe(403);
    const published = await http(offlineApp).post(`/api/v1/exam-pins/${pinId}/publish`).set(bearer(teacher)).send({});
    expect(published.status).toBe(201);
    const stillHidden = await http(offlineApp).get(`/api/v1/quiz-attempts/${attemptId}`).set(bearer(student));
    expect(stillHidden.body.attempt.grade).toBeNull();
    const itemPublished = await http(offlineApp).post(`/api/v1/grade-items/${item.rows[0].id}/publish`).set(bearer(teacher)).send({});
    expect(itemPublished.status).toBe(201);
    const reviewed = await http(offlineApp).get(`/api/v1/quiz-attempts/${attemptId}`).set(bearer(student));
    expect(reviewed.status).toBe(200); expect(reviewed.body.attempt.grade).toBe(5);
    expect(reviewed.body.questions[3].manualComment).toBe('Nhận xét chỉ lưu ở A');
    expect(reviewed.body.questions[2].solution).toEqual({ acceptedAnswers: ['HaNoi'] });
    const closedReview = await http(offlineApp).patch(`/api/v1/exam-pins/${pinId}`).set(bearer(teacher)).send({ reviewSpecificFeedback: 0, reviewRightAnswer: 0 });
    expect(closedReview.status).toBe(200);
    const masked = await http(offlineApp).get(`/api/v1/quiz-attempts/${attemptId}`).set(bearer(student));
    expect(masked.body.questions.every((q: { solution: unknown; manualComment: unknown }) => q.solution === null && q.manualComment === null)).toBe(true);
    expect((await http(offlineApp).get(`/api/v1/quiz-attempts/${attemptId}`).set(bearer(foreign))).status).toBe(404);
    expect((await centre.query('SELECT user_id FROM exam_attempts WHERE id = $1', [attemptId])).rows[0].user_id).toBe(studentId);
    expect((await bank.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('exam_attempts','question_attempts','grade_grades')")).rowCount).toBe(0);
    process.env.SYSTEM_BANK_DATABASE_URL = bankUrl;
  }, 90_000);

  it('thiếu quyền, phiên bản, media hoặc checksum không tạo pin sẵn sàng; lỗi ghi snapshot được retry cùng khoá không nhân bản', async () => {
    const published = await publish('multichoice', mcPackage());
    const questionId = published.question.id;
    const examId = await paper([questionId]);
    const before = Number((await centre.query('SELECT count(*) FROM exam_pins')).rows[0].count);
    const denied = await http(app).post(`/api/v1/exams/banks/${examBankId}/exams`).set(bearer(student)).send({ name: 'Không đủ quyền', slots: [{ questionId, sourceDomain: 'bank-system', sourceVersionNumber: 1 }] });
    expect([403, 404]).toContain(denied.status);
    const invalidVersion = await http(app).post(`/api/v1/exams/banks/${examBankId}/exams`).set(bearer(teacher)).send({ name: 'Phiên bản không tồn tại', slots: [{ questionId, sourceDomain: 'bank-system', sourceVersionNumber: 999 }] });
    expect(invalidVersion.status).toBe(404);
    await bank.query("UPDATE system_question_versions SET checksum = repeat('0',64) WHERE id = $1", [published.version.id]);
    const corrupt = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(pinBody(examId));
    expect(corrupt.status).toBe(400); expect(corrupt.body.code).toBe('system_bank.checksum_mismatch');
    await bank.query('UPDATE system_question_versions SET checksum = $1 WHERE id = $2', [published.version.checksum, published.version.id]);
    const missingMedia = mcPackage();
    missingMedia.questionText = { type: 'doc', content: [{ type: 'image', attrs: { src: `bank-media://${'0'.repeat(64)}` } }] };
    missingMedia.media = [{ contentHash: '0'.repeat(64), fileName: 'mat.png', mimeType: 'image/png' }];
    const bad = await publish('multichoice', missingMedia);
    const badExamId = await paper([bad.question.id]);
    expect((await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(pinBody(badExamId))).status).toBeGreaterThanOrEqual(400);
    expect(Number((await centre.query('SELECT count(*) FROM exam_pins')).rows[0].count)).toBe(before);
    const body = pinBody(examId);
    await centre.query(`CREATE FUNCTION reject_shared_pin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'snapshot write failed'; END $$;
      CREATE TRIGGER reject_shared_pin BEFORE INSERT ON exam_pins FOR EACH ROW EXECUTE FUNCTION reject_shared_pin()`);
    try {
      expect((await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(body)).status).toBe(500);
    } finally {
      await centre.query('DROP TRIGGER reject_shared_pin ON exam_pins; DROP FUNCTION reject_shared_pin()');
    }
    const retried = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(body);
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
    const repeated = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(body);
    expect(repeated.status).toBe(201); expect(repeated.body.id).toBe(retried.body.id);
    expect(Number((await centre.query('SELECT count(*) FROM exam_pins WHERE request_id = $1', [body.requestId])).rows[0].count)).toBe(1);
  }, 90_000);
  it('retry newExam sau lỗi tạo pin giữ đúng một đề/version và một đợt giao', async () => {
    const requestId = randomUUID();
    const body = { sectionId, requestId,
      newExam: { name: 'Đề tạo mới có khoá retry', totalScore: 1, slots: [{ questionId: localId }] } };
    const withoutKey = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`)
      .set(bearer(teacher)).send({ sectionId, newExam: body.newExam });
    expect(withoutKey.status).toBe(400);
    expect(withoutKey.body.code).toBe('exam.pin_request_id_required');

    await centre.query(`CREATE FUNCTION reject_new_exam_pin() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'pin write interrupted'; END $$;
      CREATE TRIGGER reject_new_exam_pin BEFORE INSERT ON exam_pins
      FOR EACH ROW EXECUTE FUNCTION reject_new_exam_pin()`);
    try {
      const failed = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(body);
      expect(failed.status).toBe(500);
    } finally {
      await centre.query('DROP TRIGGER reject_new_exam_pin ON exam_pins; DROP FUNCTION reject_new_exam_pin()');
    }

    const papers = await centre.query('SELECT id FROM exams WHERE pin_request_id = $1', [requestId]);
    expect(papers.rowCount).toBe(1);
    const versionCount = await centre.query('SELECT count(*)::int AS n FROM exam_versions WHERE exam_id = $1', [papers.rows[0].id]);
    expect(versionCount.rows[0].n).toBe(1);
    const retried = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(body);
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
    expect(retried.body.examId).toBe(papers.rows[0].id);
    const repeated = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(body);
    expect(repeated.status).toBe(201);
    expect(repeated.body.id).toBe(retried.body.id);
    expect((await centre.query('SELECT count(*)::int AS n FROM exams WHERE pin_request_id = $1', [requestId])).rows[0].n).toBe(1);
    expect((await centre.query('SELECT count(*)::int AS n FROM exam_versions WHERE exam_id = $1', [papers.rows[0].id])).rows[0].n).toBe(1);
    expect((await centre.query('SELECT count(*)::int AS n FROM exam_pins WHERE request_id = $1', [requestId])).rows[0].n).toBe(1);
  }, 90_000);

  it('tiếp tục pin dở sau crash ở snapshot, course module và grade item; dọn media staging không xóa file thật', async () => {
    const published = await publish('multichoice', mcPackage());
    const examId = await paper([published.question.id]);
    const body = pinBody(examId);
    const deployed = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(body);
    expect(deployed.status, JSON.stringify(deployed.body)).toBe(201);
    const pinId = deployed.body.id as string;
    let cmId = deployed.body.cmId as string;
    const retry = async () => {
      const res = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.id).toBe(pinId);
      expect((await centre.query('SELECT preparation_state FROM exam_pins WHERE id = $1', [pinId])).rows[0].preparation_state).toBe('ready');
      return res.body as { cmId: string };
    };

    await centre.query("UPDATE exam_pins SET preparation_state = 'preparing' WHERE id = $1", [pinId]);
    await retry();
    expect((await centre.query('SELECT count(*)::int AS n FROM grade_items WHERE item_instance = $1', [cmId])).rows[0].n).toBe(1);

    await centre.query('DELETE FROM grade_items WHERE item_instance = $1', [cmId]);
    await centre.query("UPDATE exam_pins SET preparation_state = 'preparing' WHERE id = $1", [pinId]);
    await retry();
    expect((await centre.query('SELECT count(*)::int AS n FROM grade_items WHERE item_instance = $1', [cmId])).rows[0].n).toBe(1);

    await centre.query('DELETE FROM grade_items WHERE item_instance = $1', [cmId]);
    await centre.query("UPDATE exam_pins SET cm_id = NULL, preparation_state = 'preparing' WHERE id = $1", [pinId]);
    await centre.query('DELETE FROM course_modules WHERE id = $1', [cmId]);
    cmId = (await retry()).cmId;
    expect((await centre.query('SELECT count(*)::int AS n FROM course_modules WHERE instance_id = $1', [pinId])).rows[0].n).toBe(1);
    expect((await centre.query('SELECT count(*)::int AS n FROM grade_items WHERE item_instance = $1', [cmId])).rows[0].n).toBe(1);

    await centre.query("UPDATE exam_pins SET question_snapshots = NULL, preparation_state = 'preparing' WHERE id = $1", [pinId]);
    await retry();
    expect((await centre.query('SELECT jsonb_array_length(question_snapshots) AS n FROM exam_pins WHERE id = $1', [pinId])).rows[0].n).toBe(2);

    const original = (await centre.query("SELECT * FROM files WHERE file_area = 'exam_snapshot' ORDER BY id LIMIT 1")).rows[0];
    expect(original).toBeDefined();
    const pendingId = randomUUID();
    await centre.query(`INSERT INTO files (content_hash, storage_domain, context_id, component,
      file_area, item_id, file_path, file_name, file_size, mime_type)
      VALUES ($1,$2,$3,'question','exam_snapshot',$4,'/',$5,$6,$7)`,
      [original.content_hash, original.storage_domain, original.context_id, pendingId, original.file_name, original.file_size, original.mime_type]);
    await centre.query('UPDATE exam_pins SET pending_snapshot_id = $1 WHERE id = $2', [pendingId, pinId]);
    const patched = await http(app).patch(`/api/v1/exam-pins/${pinId}`).set(bearer(teacher)).send({ name: 'Đề đã khôi phục' });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect((await centre.query('SELECT count(*)::int AS n FROM files WHERE item_id = $1', [pendingId])).rows[0].n).toBe(0);
    expect((await centre.query('SELECT pending_snapshot_id FROM exam_pins WHERE id = $1', [pinId])).rows[0].pending_snapshot_id).toBeNull();
    expect((await centre.query('SELECT id FROM files WHERE id = $1', [original.id])).rowCount).toBe(1);
  }, 90_000);

  it('lỗi sau khi đã sao media slot trước phải dọn toàn bộ file staging và không tạo pin ready', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFxoAAAAASUVORK5CYII=', 'base64');
    const goodHash = sha256Hex(bytes);
    await app.get<ObjectStorage>(OBJECT_STORAGE).put(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(goodHash), bytes);
    const goodPkg = mcPackage();
    goodPkg.questionText = { type: 'doc', content: [{ type: 'image', attrs: { src: `bank-media://${goodHash}` } }] };
    goodPkg.media = [{ contentHash: goodHash, fileName: 'anh-dau.png', mimeType: 'image/png' }];
    const good = await publish('multichoice', goodPkg);

    const badPkg = mcPackage();
    const badHash = '0'.repeat(64);
    badPkg.questionText = { type: 'doc', content: [{ type: 'image', attrs: { src: `bank-media://${badHash}` } }] };
    badPkg.media = [{ contentHash: badHash, fileName: 'anh-thieu.png', mimeType: 'image/png' }];
    const bad = await publish('multichoice', badPkg);

    const examId = await paper([good.question.id, bad.question.id]);
    const beforeFiles = (await centre.query("SELECT count(*)::int AS n FROM files WHERE file_area = 'exam_snapshot'")).rows[0].n;
    const body = pinBody(examId);
    const failed = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`).set(bearer(teacher)).send(body);
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect((await centre.query('SELECT count(*)::int AS n FROM exam_pins WHERE request_id = $1', [body.requestId])).rows[0].n).toBe(0);
    expect((await centre.query("SELECT count(*)::int AS n FROM files WHERE file_area = 'exam_snapshot'")).rows[0].n).toBe(beforeFiles);
  }, 90_000);

  it('không cho dùng câu ready ở bank personal của đồng nghiệp, vẫn dùng được bank chung có quyền', async () => {
    const colleague = await dedicated.createUser(app, dedicatedA, 'quizcolleague');
    await dedicated.grantRole(app, dedicatedA, colleague.id, 'editingteacher');
    const colleagueToken = colleague.token;
    const privateId = await createReadyQuestion(app, colleagueToken, 'Bí mật của giáo viên B');
    const forbiddenRead = await http(app).get(`/api/v1/questions/${privateId}`).set(bearer(teacher));
    expect(forbiddenRead.status).toBe(404);
    const deniedPaper = await http(app).post(`/api/v1/exams/banks/${examBankId}/exams`)
      .set(bearer(teacher)).send({ name: 'Cố sử dụng câu riêng đồng nghiệp',
        slots: [{ questionId: privateId }] });
    expect(deniedPaper.status, JSON.stringify(deniedPaper.body)).toBe(404);
    expect(deniedPaper.body.code).toBe('question.not_found');

    const deniedNewPin = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`)
      .set(bearer(teacher)).send({ sectionId, requestId: randomUUID(),
        newExam: { name: 'Ghim câu riêng bị cấm', slots: [{ questionId: privateId }] } });
    expect(deniedNewPin.status, JSON.stringify(deniedNewPin.body)).toBe(404);

    const listed = await http(app).get('/api/v1/question-banks?kind=question').set(bearer(colleagueToken));
    expect(listed.status).toBe(200);
    const sharedBank = (listed.body as { scope: string; defaultCategoryId: string | null; contextId: string }[])
      .find((item) => item.scope === 'school');
    expect(sharedBank?.defaultCategoryId).toBeTruthy();
    await dedicated.grantRole(app, dedicatedA, colleague.id, 'qbanklead', sharedBank!.contextId);
    const sharedQuestion = await http(app).post('/api/v1/questions').set(bearer(colleagueToken)).send({
      categoryId: sharedBank!.defaultCategoryId, qtype: 'multichoice',
      questionText: 'Câu dùng chung có quyền của trường',
      answers: [
        { text: 'A', correct: true }, { text: 'B', correct: false },
        { text: 'C', correct: false }, { text: 'D', correct: false },
      ],
    });
    expect(sharedQuestion.status, JSON.stringify(sharedQuestion.body)).toBe(201);
    const allowedPaper = await http(app).post(`/api/v1/exams/banks/${examBankId}/exams`)
      .set(bearer(teacher)).send({ name: 'Đề trộn câu bản thân và trường',
        slots: [{ questionId: localId }, { questionId: sharedQuestion.body.question.id }] });
    expect(allowedPaper.status, JSON.stringify(allowedPaper.body)).toBe(201);
    expect(allowedPaper.body.slots).toHaveLength(2);
  }, 90_000);

  it('retry sai section trả 409 nhưng không xoá intent, CM, grade hay snapshot đang chuẩn bị', async () => {
    const published = await publish('multichoice', mcPackage());
    const examId = await paper([published.question.id]);
    const body = pinBody(examId);
    const created = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`)
      .set(bearer(teacher)).send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const pinId = created.body.id as string;
    const cmId = created.body.cmId as string;
    const originalGrade = (await centre.query(
      'SELECT id FROM grade_items WHERE item_instance = $1', [cmId])).rows[0].id as string;

    const otherSection = await http(app).post(`/api/v1/courses/${courseId}/sections`)
      .set(bearer(teacher)).send({ name: uniqueName('Mục khác để retry') });
    expect(otherSection.status, JSON.stringify(otherSection.body)).toBe(201);

    await centre.query("UPDATE exam_pins SET preparation_state = 'preparing' WHERE id = $1", [pinId]);
    const before = await centre.query('SELECT question_snapshots, cm_id FROM exam_pins WHERE id = $1', [pinId]);

    const conflict = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`)
      .set(bearer(teacher)).send({ ...body, sectionId: otherSection.body.id });
    expect(conflict.status, JSON.stringify(conflict.body)).toBe(409);
    expect(conflict.body.code).toBe('exam.pin_request_conflict');

    const stillPinned = await centre.query(
      'SELECT preparation_state, question_snapshots, cm_id FROM exam_pins WHERE id = $1', [pinId]);
    expect(stillPinned.rowCount).toBe(1);
    expect(stillPinned.rows[0].preparation_state).toBe('preparing');
    expect(stillPinned.rows[0].cm_id).toBe(before.rows[0].cm_id);
    expect(stillPinned.rows[0].question_snapshots).toEqual(before.rows[0].question_snapshots);
    expect((await centre.query('SELECT section FROM course_modules WHERE id = $1', [cmId])).rows[0].section).toBe(sectionId);
    expect((await centre.query('SELECT id FROM grade_items WHERE id = $1', [originalGrade])).rowCount).toBe(1);

    const recovered = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`)
      .set(bearer(teacher)).send(body);
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(201);
    expect(recovered.body.id).toBe(pinId);
    expect(recovered.body.cmId).toBe(cmId);
    expect((await centre.query('SELECT preparation_state FROM exam_pins WHERE id = $1', [pinId])).rows[0].preparation_state).toBe('ready');
    expect((await centre.query('SELECT id FROM grade_items WHERE id = $1', [originalGrade])).rowCount).toBe(1);
  }, 90_000);

  it('category local legacy không gắn bank phải giữ quyền đọc nguồn trước khi cho dùng trong đề', async () => {
    const sourceCourse = await createCourse(app, manager, (await createCategory(app, manager)).id);
    const sourceContext = (await centre.query(
      'SELECT id FROM context WHERE context_level = 50 AND instance_id = $1', [sourceCourse.id])).rows[0].id as string;
    const oldCategory = await http(app).post('/api/v1/questions/categories')
      .set(bearer(manager)).send({ name: uniqueName('Câu cũ ngoài bank'), contextId: sourceContext });
    expect(oldCategory.status, JSON.stringify(oldCategory.body)).toBe(201);
    expect((await centre.query('SELECT bank_id FROM question_categories WHERE id = $1', [oldCategory.body.id])).rows[0].bank_id).toBeNull();

    const created = await http(app).post('/api/v1/questions').set(bearer(manager)).send({
      categoryId: oldCategory.body.id, qtype: 'multichoice',
      questionText: 'Câu legacy của khoá khác không được lộ đáp án',
      answers: [
        { text: 'Bí mật', correct: true }, { text: 'Sai 1', correct: false },
        { text: 'Sai 2', correct: false }, { text: 'Sai 3', correct: false },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const questionId = created.body.question.id as string;

    const teacherRole = await dedicated.roleId(app, dedicatedA, 'teacher');
    await app.get(SpaceDatabaseService).withSpaceKysely(dedicatedA.slug, () =>
      app.get(RolesService).setCapabilityOverride(teacherRole, 'question:useall', sourceContext, -1000));
    const deniedRead = await http(app).get(`/api/v1/questions/${questionId}`).set(bearer(teacher));
    expect(deniedRead.status, JSON.stringify(deniedRead.body)).toBe(404);

    const deniedExam = await http(app).post(`/api/v1/exams/banks/${examBankId}/exams`)
      .set(bearer(teacher)).send({ name: 'Không được dùng câu legacy', slots: [{ questionId }] });
    expect(deniedExam.status, JSON.stringify(deniedExam.body)).toBe(404);
    expect(deniedExam.body.code).toBe('question.not_found');

    const deniedPin = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`)
      .set(bearer(teacher)).send({ requestId: randomUUID(), sectionId,
        newExam: { name: 'Không được ghim câu legacy', slots: [{ questionId }] } });
    expect(deniedPin.status, JSON.stringify(deniedPin.body)).toBe(404);

    const allowedRead = await http(app).get(`/api/v1/questions/${questionId}`).set(bearer(manager));
    expect(allowedRead.status, JSON.stringify(allowedRead.body)).toBe(200);
    const allowedExamBank = await personalExamBankId(app, manager);
    const allowedExam = await http(app).post(`/api/v1/exams/banks/${allowedExamBank}/exams`)
      .set(bearer(manager)).send({ name: 'Chủ nguồn dùng câu legacy đúng quyền', slots: [{ questionId }] });
    expect(allowedExam.status, JSON.stringify(allowedExam.body)).toBe(201);
  }, 90_000);

  it('retry sai section trước khi có CM phải giữ intent ban đầu và phục hồi đúng section', async () => {
    const published = await publish('multichoice', mcPackage());
    const examId = await paper([published.question.id]);
    const body = pinBody(examId);
    const created = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`)
      .set(bearer(teacher)).send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const pinId = created.body.id as string;
    const cmId = created.body.cmId as string;
    const alternative = await http(app).post(`/api/v1/courses/${courseId}/sections`)
      .set(bearer(teacher)).send({ name: uniqueName('Section retry crash sớm') });
    expect(alternative.status, JSON.stringify(alternative.body)).toBe(201);

    await centre.query('DELETE FROM grade_items WHERE item_instance = $1', [cmId]);
    await centre.query('UPDATE exam_pins SET cm_id = NULL, question_snapshots = NULL, preparation_state = \'preparing\' WHERE id = $1', [pinId]);
    await centre.query('DELETE FROM course_modules WHERE id = $1', [cmId]);
    const before = await centre.query('SELECT id, request_id, requested_section_id, question_snapshots FROM exam_pins WHERE id = $1', [pinId]);
    expect(before.rowCount).toBe(1);
    expect(before.rows[0].requested_section_id).toBe(sectionId);
    expect((await centre.query('SELECT id FROM course_modules WHERE instance_id = $1', [pinId])).rowCount).toBe(0);

    const wrong = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`)
      .set(bearer(teacher)).send({ ...body, sectionId: alternative.body.id });
    expect(wrong.status, JSON.stringify(wrong.body)).toBe(409);
    expect(wrong.body.code).toBe('exam.pin_request_conflict');
    const intact = await centre.query('SELECT id, request_id, question_snapshots, preparation_state FROM exam_pins WHERE id = $1', [pinId]);
    expect(intact.rowCount).toBe(1);
    expect(intact.rows[0].request_id).toBe(before.rows[0].request_id);
    expect(intact.rows[0].question_snapshots).toBeNull();
    expect(intact.rows[0].preparation_state).toBe('preparing');
    expect((await centre.query('SELECT id FROM course_modules WHERE instance_id = $1', [pinId])).rowCount).toBe(0);

    const recovered = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`)
      .set(bearer(teacher)).send(body);
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(201);
    expect(recovered.body.id).toBe(pinId);
    expect((await centre.query('SELECT section FROM course_modules WHERE instance_id = $1', [pinId])).rows[0].section).toBe(sectionId);
    expect((await centre.query('SELECT preparation_state FROM exam_pins WHERE id = $1', [pinId])).rows[0].preparation_state).toBe('ready');
    const wrongAfterReady = await http(app).post(`/api/v1/courses/${courseId}/exam-pins`)
      .set(bearer(teacher)).send({ ...body, sectionId: alternative.body.id });
    expect(wrongAfterReady.status).toBe(409);
    expect(wrongAfterReady.body.code).toBe('exam.pin_request_conflict');
  }, 90_000);

  it('hai kho A/B riêng biệt giữ snapshot, media, lượt làm và điểm ở A khi bank không còn kết nối', async () => {
    const cpName = `giaokhoa_test_shared_cp_${suffix}`;
    const previousCp = process.env.CONTROL_PLANE_DATABASE_URL;
    const provisioned: SpaceProvisionResult[] = [];
    let routed: INestApplication | undefined;
    let offline: INestApplication | undefined;
    const dbSecret = 'Test-only-shared-14!';
    const cpUrl = await buildTestDatabase({ adminUrl, database: cpName, store: 'control-plane' });
    const urlFor = (space: SpaceProvisionResult) => {
      const url = new URL(adminUrl); url.pathname = `/${space.databaseName}`;
      url.username = space.connectionRole; url.password = dbSecret; return url.toString();
    };
    try {
      for (const label of ['a', 'b']) {
        const space = await runSpaceProvision({ slug: `exam14-${label}-${suffix}`, name: `Trung tâm ${label}`,
          adminUsername: 'admin14', adminEmail: `exam14-${label}-${suffix}@example.com`, databasePassword: dbSecret,
          actorId: randomUUID(), env: { ...process.env, CONTROL_PLANE_DATABASE_URL: cpUrl }, log: () => undefined });
        provisioned.push(space); process.env[space.secretEnvVar] = urlFor(space);
      }
      process.env.CONTROL_PLANE_DATABASE_URL = cpUrl;
      process.env.SYSTEM_BANK_DATABASE_URL = bankUrl;
      routed = await createSnapshotTestApp();
      const [a, b] = provisioned;
      const hostA = `${a.slug}.test.local`; const hostB = `${b.slug}.test.local`;
      for (const space of provisioned) {
        const activated = await http(routed).post('/api/v1/centres/activate-invite')
          .send({ slug: space.slug, token: space.inviteToken, password: STRONG_PASSWORD });
        expect(activated.status, JSON.stringify(activated.body)).toBe(201);
      }
      const loginA = await http(routed).post('/api/v1/auth/token').set('Host', hostA).send({ username: 'admin14', password: STRONG_PASSWORD });
      const loginB = await http(routed).post('/api/v1/auth/token').set('Host', hostB).send({ username: 'admin14', password: STRONG_PASSWORD });
      expect(loginA.status).toBe(201); expect(loginB.status).toBe(201);
      const tokenA = loginA.body.accessToken as string; const tokenB = loginB.body.accessToken as string;
      await routed.get(SpaceDatabaseService).withSpaceKysely(a.slug, async () => {
        const roles = routed!.get(RolesService); const contexts = routed!.get(ContextsService);
        const role = await roles.getRoleByShortname('manager');
        const system = await contexts.ensureSystemContext();
        const tenant = await contexts.ensureTenantContext(a.tenantId!);
        await roles.assignRole(a.adminUserId!, role!.id, system.id);
        await roles.assignRole(a.adminUserId!, role!.id, tenant.id);
      }, { tenantId: a.tenantId!, userId: a.adminUserId! });

      const category = await http(routed).post('/api/v1/courses/categories').set('Host', hostA).set(bearer(tokenA)).send({ name: 'Danh mục thử đề' });
      expect(category.status, JSON.stringify(category.body)).toBe(201);
      const cls = await http(routed).post('/api/v1/classes').set('Host', hostA).set(bearer(tokenA)).send({ name: 'Lớp nhận đề' });
      expect(cls.status).toBe(201);
      const course = await http(routed).post('/api/v1/courses').set('Host', hostA).set(bearer(tokenA))
        .send({ category: category.body.id, classId: cls.body.id, shortName: 'SNAP14', fullName: 'Khoá nhận đề trộn' });
      expect(course.status, JSON.stringify(course.body)).toBe(201);
      const courseContent = await http(routed).get(`/api/v1/courses/${course.body.id}/content`).set('Host', hostA).set(bearer(tokenA));
      const learnerUser = await routed.get(SpaceDatabaseService).withSpaceKysely(a.slug, async () => {
        const user = await routed!.get(UsersService).createUser({ username: 'student14', email: 'student14@example.com',
          password: STRONG_PASSWORD, firstName: 'Học', lastName: 'Sinh' });
        await routed!.get(TenantsService).ensureActiveMembership(a.tenantId!, user.id);
        return user;
      }, { tenantId: a.tenantId!, userId: a.adminUserId! });
      const learner = { body: learnerUser };
      const enrol = await http(routed).post(`/api/v1/courses/${course.body.id}/enrol/instances`).set('Host', hostA).set(bearer(tokenA)).send({ method: 'manual' });
      expect(enrol.status).toBe(201);
      expect((await http(routed).post(`/api/v1/courses/${course.body.id}/enrol/instances/${enrol.body.id}/enrol`).set('Host', hostA).set(bearer(tokenA)).send({ userId: learner.body.id })).status).toBe(201);
      const learnerLogin = await http(routed).post('/api/v1/auth/token').set('Host', hostA).send({ username: 'student14', password: STRONG_PASSWORD });
      expect(learnerLogin.status).toBe(201); const studentA = learnerLogin.body.accessToken as string;
      const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFxoAAAAASUVORK5CYII=', 'base64');
      const hash = sha256Hex(image);
      await app.get<ObjectStorage>(OBJECT_STORAGE).put(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(hash), image);
      const pkg = mcPackage(); pkg.questionText = { type: 'doc', content: [...doc('Ảnh chuyển sang miền A').content,
        { type: 'image', attrs: { src: `bank-media://${hash}` } }] };
      pkg.media = [{ contentHash: hash, fileName: 'anh14.png', mimeType: 'image/png' }];
      const routedPlatformAdmin = await adminToken(routed);
      const bankPublished = await http(routed).post('/api/v1/system-bank/questions')
        .set(bearer(routedPlatformAdmin)).send({ qtype: 'multichoice', package: pkg });
      expect(bankPublished.status, JSON.stringify(bankPublished.body)).toBe(201);
      const source = bankPublished.body as { question: { id: string }; version: { id: string; checksum: string } };
      const pinned = await http(routed).post(`/api/v1/courses/${course.body.id}/exam-pins`).set('Host', hostA).set(bearer(tokenA))
        .send({ sectionId: courseContent.body.sections[0].id, requestId: randomUUID(), newExam: { name: 'Đề giao trực tiếp', totalScore: 1,
          slots: [{ questionId: source.question.id, sourceDomain: 'bank-system', sourceVersionNumber: 1 }] } });
      expect(pinned.status, JSON.stringify(pinned.body)).toBe(201);
      const dbA = new Client({ connectionString: urlFor(a) }); const dbB = new Client({ connectionString: urlFor(b) });
      await dbA.connect(); await dbB.connect();
      try {
        await dbA.query("SELECT set_config('app.tenant_id', $1, false)", [a.tenantId]);
        await dbB.query("SELECT set_config('app.tenant_id', $1, false)", [b.tenantId]);
        const files = await dbA.query("SELECT storage_domain FROM files WHERE file_area = 'exam_snapshot'");
        expect(files.rows).toEqual([{ storage_domain: `space-${a.spaceId}` }]);
        expect((await dbA.query('SELECT id FROM question WHERE id = $1', [source.question.id])).rowCount).toBe(0);
        delete process.env.SYSTEM_BANK_DATABASE_URL;
        offline = await createSnapshotTestApp();
        expect(offline.get(SystemBankConnection).isConfigured).toBe(false);
        expect((await http(offline).get(`/api/v1/exam-pins/${pinned.body.id}`).set('Host', hostB).set(bearer(tokenB))).status).toBe(404);
        const started = await http(offline).post(`/api/v1/exam-pins/${pinned.body.id}/attempts`).set('Host', hostA).set(bearer(studentA)).send({});
        expect(started.status, JSON.stringify(started.body)).toBe(201);
        const question = started.body.questions[0];
        expect((await http(offline).post(`/api/v1/quiz-attempts/${started.body.attempt.id}/responses`).set('Host', hostA).set(bearer(studentA))
          .send({ questionAttemptId: question.questionAttemptId, response: question.answers[0].id })).status).toBe(201);
        const finished = await http(offline).post(`/api/v1/quiz-attempts/${started.body.attempt.id}/submit`).set('Host', hostA).set(bearer(studentA)).send({});
        expect(finished.status).toBe(201); expect(finished.body.attempt.state).toBe('finished');
        expect((await dbA.query('SELECT count(*) FROM exam_attempts')).rows[0].count).toBe('1');
        expect((await dbB.query('SELECT count(*) FROM exam_attempts')).rows[0].count).toBe('0');
        expect((await dbB.query('SELECT count(*) FROM question_attempts')).rows[0].count).toBe('0');
        expect((await dbB.query('SELECT count(*) FROM grade_grades')).rows[0].count).toBe('0');
        const score = await dbA.query('SELECT final_grade FROM grade_grades WHERE user_id = $1 AND item_id = (SELECT id FROM grade_items WHERE item_instance = $2)', [learner.body.id, pinned.body.cmId]);
        expect(Number(score.rows[0].final_grade)).toBe(1);
      } finally { await dbA.end(); await dbB.end(); }
    } finally {
      await offline?.close(); await routed?.close();
      await offline?.get<Pool>('SHARED_CENTRE_KYSELY').end(); await routed?.get<Pool>('SHARED_CENTRE_KYSELY').end();
      process.env.SYSTEM_BANK_DATABASE_URL = bankUrl;
      if (previousCp === undefined) delete process.env.CONTROL_PLANE_DATABASE_URL; else process.env.CONTROL_PLANE_DATABASE_URL = previousCp;
      for (const space of provisioned) {
        delete process.env[space.secretEnvVar]; await dropTestDatabase(adminUrl, space.databaseName);
      }
      const cluster = new Client({ connectionString: adminUrl }); await cluster.connect();
      try { for (const space of provisioned) await cluster.query(`DROP ROLE "${space.connectionRole}"`); } finally { await cluster.end(); }
      await dropTestDatabase(adminUrl, cpName);
    }
  }, 180_000);


});
