import { VersioningType, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestDatabase, dropTestDatabase, withDatabase } from '@giaokhoa/db/test-support';
import { SYSTEM_FILE_DOMAIN } from '@giaokhoa/db';
import { OBJECT_STORAGE, sha256Hex, type ObjectStorage } from '../../../src/modules/files/storage';
import { publicationMediaStorageKey } from '../../../src/modules/system-bank/system-bank-media.service';
import { AppModule } from '../../../src/app.module';
import { ProblemDetailsFilter } from '../../../src/common/problem-details.filter';
import { validateEnv } from '../../../src/config/env';
import { ContextsService } from '../../../src/modules/access/contexts.service';
import { RolesService } from '../../../src/modules/access/roles.service';
import { tenantAls } from '../../../src/modules/tenants/tenant-als';
import {
  adminToken, assignRole, createUserViaApi, http, login, roleIdByShortname, seedTenantMembershipFixture,
  STRONG_PASSWORD, systemContextId, uniqueName,
} from '../../support/identity-access-helpers';
import {
  createCategory, createCourse, createEnrolInstance, enrolUser, getFirstSectionId,
} from '../../support/course-enrolment-helpers';
import { createReadyQuestion, personalExamBankId } from '../../support/exam-pin-helpers';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function testApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService).useValue(new ConfigService(validateEnv({ ...process.env }))).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  return app;
}

describe('Giao phiên bản đề chung cho nhiều trung tâm không sao chép câu chỉnh sửa', () => {
  let app: INestApplication;
  let offlineApp: INestApplication | undefined;
  let centre: Client;
  let bank: Client;
  let admin: string;
  let managerA: string;
  let managerB: string;
  let studentA: string;
  let studentB: string;
  let tenantA: string;
  let tenantB: string;
  let courseA: string;
  let courseB: string;
  let sectionA: string;
  let sectionB: string;
  let examId: string;
  let publishedId: string;
  let localQuestionId: string;
  let bankUrl: string;
  let storageDir: string;
  const oldEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    SYSTEM_BANK_DATABASE_URL: process.env.SYSTEM_BANK_DATABASE_URL,
    FILE_STORAGE_DIR: process.env.FILE_STORAGE_DIR,
  };
  const adminUrl = withDatabase(process.env.DATABASE_URL!, 'postgres');
  const suffix = randomUUID().slice(0, 8);
  const centreName = `giaokhoa_test_shared_exam_centre_${suffix}`;
  const bankName = `giaokhoa_test_shared_exam_system_${suffix}`;

  async function centreSession(user: { username: string }, tenantId: string) {
    const original = await login(app, user.username, STRONG_PASSWORD);
    const switched = await http(app).post(`/api/v1/auth/switch-tenant/${tenantId}`).set(bearer(original.accessToken));
    expect(switched.status, JSON.stringify(switched.body)).toBe(201);
    return switched.body.accessToken as string;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = await buildTestDatabase({ adminUrl, database: centreName, store: 'centre' });
    bankUrl = await buildTestDatabase({ adminUrl, database: bankName, store: 'system-bank' });
    process.env.SYSTEM_BANK_DATABASE_URL = bankUrl;
    storageDir = await mkdtemp(join(tmpdir(), 'giaokhoa-shared-exam-'));
    process.env.FILE_STORAGE_DIR = storageDir;
    app = await testApp();
    admin = await adminToken(app);
    centre = new Client({ connectionString: process.env.DATABASE_URL }); await centre.connect();
    bank = new Client({ connectionString: bankUrl }); await bank.connect();

    const first = await http(app).post('/api/v1/tenants').set(bearer(admin))
      .send({ name: uniqueName('Trung tâm A'), slug: uniqueName('exam-a'), kind: 'school' });
    const second = await http(app).post('/api/v1/tenants').set(bearer(admin))
      .send({ name: uniqueName('Trung tâm B'), slug: uniqueName('exam-b'), kind: 'school' });
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    tenantA = first.body.id; tenantB = second.body.id;
    const [a, b, sa, sb] = await Promise.all(Array.from({ length: 4 }, () => createUserViaApi(app, admin)));
    for (const user of [a, sa]) await seedTenantMembershipFixture(app, tenantA, user.id);
    for (const user of [b, sb]) await seedTenantMembershipFixture(app, tenantB, user.id);
    await assignRole(app, admin, a.id, await roleIdByShortname(app, admin, 'teacher'), await systemContextId(app, admin));
    const managerRole = await roleIdByShortname(app, admin, 'manager');
    for (const [user, tenant] of [[a, tenantA], [b, tenantB]] as const) {
      const context = await tenantAls.run({ platform: true }, () => app.get(ContextsService).ensureTenantContext(tenant));
      await tenantAls.run({ platform: true }, () => app.get(RolesService).assignRole(user.id, managerRole, context.id));
    }
    managerA = await centreSession(a, tenantA);
    managerB = await centreSession(b, tenantB);
    studentA = await centreSession(sa, tenantA);
    studentB = await centreSession(sb, tenantB);

    const catA = await createCategory(app, managerA);
    const catB = await createCategory(app, managerB);
    courseA = (await createCourse(app, managerA, catA.id)).id;
    courseB = (await createCourse(app, managerB, catB.id)).id;
    sectionA = await getFirstSectionId(app, managerA, courseA);
    sectionB = await getFirstSectionId(app, managerB, courseB);
    const enrolA = await createEnrolInstance(app, managerA, courseA);
    const enrolB = await createEnrolInstance(app, managerB, courseB);
    await enrolUser(app, managerA, courseA, enrolA.id, sa.id);
    await enrolUser(app, managerB, courseB, enrolB.id, sb.id);

    localQuestionId = await createReadyQuestion(app, managerA, 'Chỉ thuộc trung tâm A');
    const examBank = await personalExamBankId(app, managerA);
    const created = await http(app).post(`/api/v1/exams/banks/${examBank}/exams`)
      .set(bearer(managerA)).send({ name: 'Đề chung để kiểm tra hai trung tâm', totalScore: 1,
        slots: [{ questionId: localQuestionId }] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    examId = created.body.paper.id;
    const ready = await http(app).post(`/api/v1/exams/${examId}/status`).set(bearer(managerA)).send({ status: 'ready' });
    expect(ready.status, JSON.stringify(ready.body)).toBe(201);
  }, 180_000);

  afterAll(async () => {
    await offlineApp?.close();
    await app?.close();
    await offlineApp?.get<Pool>('SHARED_CENTRE_KYSELY').end();
    await app?.get<Pool>('SHARED_CENTRE_KYSELY').end();
    await centre?.end();
    await bank?.end();
    await dropTestDatabase(adminUrl, centreName);
    await dropTestDatabase(adminUrl, bankName);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('chỉ bản được duyệt mới giao được; A và B giữ snapshot, lịch, câu trả lời và điểm riêng', async () => {
    const submitted = await http(app).post('/api/v1/system-bank/exams').set(bearer(managerA)).send({ examId });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    publishedId = submitted.body.id;
    expect(submitted.body.status).toBe('pending');
    expect((await http(app).post('/api/v1/system-bank/exams').set(bearer(managerA))
      .send({ examId })).body.id).toBe(publishedId);

    const bodyA = { sharedExamVersionId: publishedId, requestId: randomUUID(), sectionId: sectionA, name: 'Đợt A' };
    const bodyB = { sharedExamVersionId: publishedId, requestId: randomUUID(), sectionId: sectionB, name: 'Đợt B' };
    const rejected = await http(app).post(`/api/v1/courses/${courseA}/exam-pins`).set(bearer(managerA)).send(bodyA);
    expect(rejected.status).toBe(404);
    expect((await http(app).get(`/api/v1/system-bank/exams?courseId=${courseA}`).set(bearer(managerA))).body).toEqual([]);
    expect((await http(app).get('/api/v1/system-bank/exams/pending').set(bearer(managerA))).status).toBe(403);
    expect((await http(app).post(`/api/v1/system-bank/exams/${publishedId}/approve`).set(bearer(managerA))).status).toBe(403);
    const review = await http(app).get(`/api/v1/system-bank/exams/${publishedId}`).set(bearer(admin));
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    expect(review.body.package.slots[0].package.answers).toHaveLength(4);
    expect(JSON.stringify(review.body)).toContain('Chỉ thuộc trung tâm A');
    expect((await http(app).post(`/api/v1/system-bank/exams/${publishedId}/approve`).set(bearer(admin))).status).toBe(201);
    const listed = await http(app).get(`/api/v1/system-bank/exams?courseId=${courseB}`).set(bearer(managerB));
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(listed.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: publishedId, status: 'approved' })]));
    expect(JSON.stringify(listed.body)).not.toContain('Đúng');
    expect((await http(app).get(`/api/v1/system-bank/exams?courseId=${courseB}`).set(bearer(studentB))).status).toBe(403);

    const assignA = await http(app).post(`/api/v1/courses/${courseA}/exam-pins`).set(bearer(managerA)).send(bodyA);
    const assignB = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB)).send(bodyB);
    expect(assignA.status, JSON.stringify(assignA.body)).toBe(201);
    expect(assignB.status, JSON.stringify(assignB.body)).toBe(201);
    expect(assignA.body.id).not.toBe(assignB.body.id);
    expect(assignA.body.sharedSource).toEqual({ examId, versionId: publishedId, versionNumber: 1 });
    expect(assignB.body.sharedSource).toEqual(assignA.body.sharedSource);
    expect(assignA.body.versionMode).toBe('pinned');
    expect(assignB.body.versionMode).toBe('pinned');

    const internalA = (await centre.query('SELECT kind, bank_id FROM exams WHERE id = $1', [assignA.body.examId])).rows[0];
    const internalB = (await centre.query('SELECT kind, bank_id FROM exams WHERE id = $1', [assignB.body.examId])).rows[0];
    expect(internalA.kind).toBe('system_execution');
    expect(internalB.kind).toBe('system_execution');
    expect((await http(app).get(`/api/v1/exams/${assignB.body.examId}`).set(bearer(managerB))).status).toBe(404);
    const listedPapers = await http(app).get(`/api/v1/exams/banks/${internalB.bank_id}/exams`).set(bearer(managerB));
    expect(JSON.stringify(listedPapers.body)).not.toContain(assignB.body.examId);
    expect((await centre.query('SELECT id FROM question WHERE id = $1', [localQuestionId])).rowCount).toBe(1);
    expect((await bank.query("SELECT tablename FROM pg_tables WHERE tablename IN ('exam_attempts','grade_grades')")).rowCount).toBe(0);

    const snapA = (await centre.query('SELECT question_snapshots FROM exam_pins WHERE id = $1', [assignA.body.id])).rows[0];
    const snapB = (await centre.query('SELECT question_snapshots FROM exam_pins WHERE id = $1', [assignB.body.id])).rows[0];
    expect(snapA.question_snapshots).toHaveLength(1);
    expect(snapB.question_snapshots).toHaveLength(1);
    expect(snapA.question_snapshots[0].checksum).toBe(snapB.question_snapshots[0].checksum);
    const attemptsBefore = (await bank.query("SELECT COUNT(*)::int AS n FROM system_exam_versions")).rows[0].n;
    expect(attemptsBefore).toBe(1);

    delete process.env.SYSTEM_BANK_DATABASE_URL;
    offlineApp = await testApp();
    const startedA = await http(offlineApp).post(`/api/v1/exam-pins/${assignA.body.id}/attempts`).set(bearer(studentA)).send({});
    const startedB = await http(offlineApp).post(`/api/v1/exam-pins/${assignB.body.id}/attempts`).set(bearer(studentB)).send({});
    expect(startedA.status, JSON.stringify(startedA.body)).toBe(201);
    expect(startedB.status, JSON.stringify(startedB.body)).toBe(201);
    expect(startedA.body.questions[0].questionExcerpt).toBe(startedB.body.questions[0].questionExcerpt);
    expect(startedA.body.questions[0].questionAttemptId).not.toBe(startedB.body.questions[0].questionAttemptId);
    expect((await http(offlineApp).post(`/api/v1/exam-pins/${assignB.body.id}/attempts`).set(bearer(studentA)).send({})).status).not.toBe(201);
    for (const started of [startedA, startedB]) {
      const token = started === startedA ? studentA : studentB;
      const q = started.body.questions[0];
      const saved = await http(offlineApp).post(`/api/v1/quiz-attempts/${started.body.attempt.id}/responses`)
        .set(bearer(token)).send({ questionAttemptId: q.questionAttemptId, response: q.answers[0].id });
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
      const finished = await http(offlineApp).post(`/api/v1/quiz-attempts/${started.body.attempt.id}/submit`)
        .set(bearer(token)).send({});
      expect(finished.status, JSON.stringify(finished.body)).toBe(201);
      expect(finished.body.attempt.state).toBe('finished');
    }
    const attempts = await centre.query('SELECT pin_id, user_id, sum_grades FROM exam_attempts WHERE pin_id = ANY($1::uuid[])',
      [[assignA.body.id, assignB.body.id]]);
    expect(attempts.rowCount).toBe(2);
    expect(attempts.rows.map((r) => r.pin_id).sort()).toEqual([assignA.body.id, assignB.body.id].sort());
    expect((await http(offlineApp).get(`/api/v1/quiz-attempts/${startedB.body.attempt.id}`).set(bearer(studentA))).status).toBe(403);
    process.env.SYSTEM_BANK_DATABASE_URL = bankUrl;
  }, 150_000);


  it('đóng gói media, thất bại an toàn khi thiếu file, retry và chấm tự động/tự luận khi bank offline', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFxoAAAAASUVORK5CYII=', 'base64');
    const hash = sha256Hex(bytes);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const key = publicationMediaStorageKey(hash);
    await storage.put(SYSTEM_FILE_DOMAIN, key, bytes);
    const text = (value: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] });
    const essayPackage = {
      questionText: { type: 'doc', content: [...text('Tự luận có ảnh không đổi').content,
        { type: 'image', attrs: { src: `bank-media://${hash}`, alt: 'Ảnh của đề' } }] },
      generalFeedback: null, stimulusContent: null, answers: [],
      answerKey: { guidance: null, solution: { answer: text('Lời giải được khóa') } },
      options: null, outcomes: [], media: [{ contentHash: hash, fileName: 'minh-hoa.png', mimeType: 'image/png' }],
    };
    const published = await http(app).post('/api/v1/system-bank/questions')
      .set(bearer(admin)).send({ qtype: 'essay', package: essayPackage });
    expect(published.status, JSON.stringify(published.body)).toBe(201);

    const examBank = await personalExamBankId(app, managerA);
    const source = await http(app).post(`/api/v1/exams/banks/${examBank}/exams`).set(bearer(managerA)).send({
      name: 'Đề chung có tự luận và ảnh', totalScore: 2,
      slots: [{ questionId: localQuestionId }, {
        questionId: published.body.question.id, sourceDomain: 'bank-system', sourceVersionNumber: 1,
      }],
    });
    expect(source.status, JSON.stringify(source.body)).toBe(201);
    const sourceId = source.body.paper.id as string;
    expect((await http(app).post(`/api/v1/exams/${sourceId}/status`)
      .set(bearer(managerA)).send({ status: 'ready' })).status).toBe(201);
    const submitted = await http(app).post('/api/v1/system-bank/exams')
      .set(bearer(managerA)).send({ examId: sourceId });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const sharedId = submitted.body.id as string;
    expect((await http(app).get(`/api/v1/system-bank/exams/${sharedId}/media/${hash}`)
      .set(bearer(admin))).status).toBe(200);

    await storage.delete(SYSTEM_FILE_DOMAIN, key);
    const badApproval = await http(app).post(`/api/v1/system-bank/exams/${sharedId}/approve`).set(bearer(admin));
    expect(badApproval.status).toBeGreaterThanOrEqual(400);
    expect((await bank.query('SELECT status FROM system_exam_versions WHERE id = $1', [sharedId])).rows[0].status).toBe('pending');
    await storage.put(SYSTEM_FILE_DOMAIN, key, bytes);
    expect((await http(app).post(`/api/v1/system-bank/exams/${sharedId}/approve`).set(bearer(admin))).status).toBe(201);

    const requestId = randomUUID();
    const body = { sharedExamVersionId: sharedId, sectionId: sectionB, requestId };
    await storage.delete(SYSTEM_FILE_DOMAIN, key);
    const failedPin = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`)
      .set(bearer(managerB)).send(body);
    expect(failedPin.status).toBeGreaterThanOrEqual(400);
    expect((await centre.query('SELECT count(*)::int AS n FROM exam_pins WHERE request_id = $1', [requestId])).rows[0].n).toBe(0);
    await storage.put(SYSTEM_FILE_DOMAIN, key, bytes);
    const assigned = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`)
      .set(bearer(managerB)).send(body);
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    const pinId = assigned.body.id as string;
    expect((await http(app).post(`/api/v1/courses/${courseB}/exam-pins`)
      .set(bearer(managerB)).send(body)).body.id).toBe(pinId);
    const snapshot = (await centre.query('SELECT question_snapshots FROM exam_pins WHERE id = $1', [pinId])).rows[0];
    expect(snapshot.question_snapshots).toHaveLength(2);
    expect(JSON.stringify(snapshot.question_snapshots)).not.toContain('bank-media://');

    await storage.delete(SYSTEM_FILE_DOMAIN, key);
    const started = await http(offlineApp!).post(`/api/v1/exam-pins/${pinId}/attempts`)
      .set(bearer(studentB)).send({});
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect(started.body.questions).toHaveLength(2);
    expect(JSON.stringify(started.body)).not.toContain('Lời giải được khóa');
    const imageNode = started.body.questions[1].questionText.content.find((n: { type: string }) => n.type === 'image');
    const imageResponse = await http(offlineApp!).get(imageNode.attrs.src);
    expect(imageResponse.status).toBe(200);
    expect(sha256Hex(imageResponse.body)).toBe(hash);
    for (const [index, response] of [started.body.questions[0].answers[0].id, 'Bài tự luận riêng B'].entries()) {
      const saved = await http(offlineApp!).post(`/api/v1/quiz-attempts/${started.body.attempt.id}/responses`)
        .set(bearer(studentB)).send({
          questionAttemptId: started.body.questions[index].questionAttemptId, response,
        });
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    }
    const finished = await http(offlineApp!).post(`/api/v1/quiz-attempts/${started.body.attempt.id}/submit`)
      .set(bearer(studentB)).send({});
    expect(finished.status).toBe(201);
    expect(finished.body.attempt.state).toBe('needsgrading');
    const graded = await http(offlineApp!).post(
      `/api/v1/quiz-attempts/${started.body.attempt.id}/questions/${started.body.questions[1].questionAttemptId}/grade`,
    ).set(bearer(managerB)).send({ mark: 1, comment: 'Nhận xét nằm tại trung tâm B' });
    expect(graded.status, JSON.stringify(graded.body)).toBe(201);
    expect(graded.body.attempt.grade).toBe(2);
    expect((await centre.query('SELECT count(*)::int AS n FROM exam_attempts WHERE pin_id = $1', [pinId])).rows[0].n).toBe(1);
  }, 120_000);

  it('retry giữ một bản thực thi và một pin; sai nguồn hoặc section không thể tái dùng requestId', async () => {
    const requestId = randomUUID();
    const body = { sharedExamVersionId: publishedId, requestId, sectionId: sectionB };
    await centre.query(`CREATE FUNCTION reject_system_exam_pin() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'pin write interrupted'; END $$;
      CREATE TRIGGER reject_system_exam_pin BEFORE INSERT ON exam_pins
      FOR EACH ROW EXECUTE FUNCTION reject_system_exam_pin()`);
    try {
      const failed = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB)).send(body);
      expect(failed.status).toBe(500);
    } finally {
      await centre.query('DROP TRIGGER reject_system_exam_pin ON exam_pins; DROP FUNCTION reject_system_exam_pin()');
    }
    expect((await centre.query('SELECT count(*)::int AS n FROM exams WHERE pin_request_id = $1', [requestId])).rows[0].n).toBe(1);
    const again = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB)).send(body);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const repeated = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB)).send(body);
    expect(repeated.status).toBe(201);
    expect(repeated.body.id).toBe(again.body.id);
    expect((await centre.query('SELECT count(*)::int AS n FROM exam_pins WHERE request_id = $1', [requestId])).rows[0].n).toBe(1);
    const wrong = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB))
      .send({ ...body, sharedExamVersionId: randomUUID() });
    expect(wrong.status).toBe(409);
    const wrongSection = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB))
      .send({ ...body, sectionId: randomUUID() });
    expect(wrongSection.status).toBe(409);
    const wrongMode = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB))
      .send({ ...body, requestId: randomUUID(), versionMode: 'float_latest_ready' });
    expect(wrongMode.status).toBe(400);
  }, 90_000);
});
