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
import { checksumPackage } from '../../../src/modules/system-bank/system-bank-package';
import { ProblemDetailsFilter } from '../../../src/common/problem-details.filter';
import { validateEnv } from '../../../src/config/env';
import { ContextsService } from '../../../src/modules/access/contexts.service';
import { SpaceDatabaseService } from '../../../src/db/routing/space-database.service';
import { runSpaceProvision, type SpaceProvisionResult } from '../../../src/modules/tenants/space-provision-runner';
import { UsersService } from '../../../src/modules/users/users.service';
import { TenantsService } from '../../../src/modules/tenants/tenants.service';
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
import { seedLegacyCentreInShared } from '../../support/pre-migration-tenant.fixture';

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

    tenantA = await seedLegacyCentreInShared({ name: uniqueName('Trung tâm A'), slug: uniqueName('exam-a') });
    tenantB = await seedLegacyCentreInShared({ name: uniqueName('Trung tâm B'), slug: uniqueName('exam-b') });
    await tenantAls.run({ platform: true }, async () => {
      const contexts = app.get(ContextsService);
      await contexts.ensureTenantContext(tenantA);
      await contexts.ensureTenantContext(tenantB);
    });
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
    const studentPin = await http(app).get(`/api/v1/exam-pins/${assignA.body.id}`).set(bearer(studentA));
    const teacherPin = await http(app).get(`/api/v1/exam-pins/${assignA.body.id}`).set(bearer(managerA));
    expect(studentPin.status, JSON.stringify(studentPin.body)).toBe(200);
    expect(teacherPin.status, JSON.stringify(teacherPin.body)).toBe(200);
    expect(studentPin.body.quiz).not.toHaveProperty('sharedSource');
    expect(studentPin.body.quiz.slots[0].questionId).toBeNull();
    expect(teacherPin.body.quiz.sharedSource).toEqual({ examId, versionId: publishedId, versionNumber: 1 });
    expect(teacherPin.body.quiz.slots[0].questionId).toBe(localQuestionId);
    const studentList = await http(app).get(`/api/v1/courses/${courseA}/exam-pins`).set(bearer(studentA));
    const managerList = await http(app).get(`/api/v1/courses/${courseA}/exam-pins`).set(bearer(managerA));
    expect(studentList.status).toBe(200);
    expect(managerList.status).toBe(200);
    expect(studentList.body.find((pin: { id: string }) => pin.id === assignA.body.id)).not.toHaveProperty('sharedSource');
    expect(managerList.body.find((pin: { id: string }) => pin.id === assignA.body.id).sharedSource.versionId).toBe(publishedId);


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
    const nextSource = await http(app).patch(`/api/v1/exams/${examId}`).set(bearer(managerA))
      .send({ name: 'Đề chung phiên bản nguồn mới' });
    expect(nextSource.status, JSON.stringify(nextSource.body)).toBe(200);
    expect(nextSource.body.version.version).toBe(2);
    const nextPublished = await http(app).post('/api/v1/system-bank/exams')
      .set(bearer(managerA)).send({ examId });
    expect(nextPublished.status, JSON.stringify(nextPublished.body)).toBe(201);
    expect(nextPublished.body.id).not.toBe(publishedId);
    expect(nextPublished.body.sourceVersionNumber).toBe(2);
    expect((await http(app).post(`/api/v1/system-bank/exams/${nextPublished.body.id}/approve`)
      .set(bearer(admin))).status).toBe(201);
    const stableA = await http(app).get(`/api/v1/exam-pins/${assignA.body.id}`).set(bearer(managerA));
    expect(stableA.body.quiz.sharedSource.versionId).toBe(publishedId);
    expect(stableA.body.quiz.sharedSource.versionNumber).toBe(1);
    expect(stableA.body.quiz.name).toBe('Đợt A');
    const unchangedSnapshot = (await centre.query('SELECT question_snapshots FROM exam_pins WHERE id = $1',
      [assignA.body.id])).rows[0].question_snapshots;
    expect(unchangedSnapshot).toEqual(snapA.question_snapshots);

    const attemptsBefore = (await bank.query("SELECT COUNT(*)::int AS n FROM system_exam_versions")).rows[0].n;
    expect(attemptsBefore).toBe(2);

    delete process.env.SYSTEM_BANK_DATABASE_URL;
    offlineApp = await testApp();
    const startedA = await http(offlineApp).post(`/api/v1/exam-pins/${assignA.body.id}/attempts`).set(bearer(studentA)).send({});
    const startedB = await http(offlineApp).post(`/api/v1/exam-pins/${assignB.body.id}/attempts`).set(bearer(studentB)).send({});
    expect(startedA.status, JSON.stringify(startedA.body)).toBe(201);
    expect(startedA.body.quiz).not.toHaveProperty('sharedSource');

    expect(startedB.status, JSON.stringify(startedB.body)).toBe(201);
    expect(startedA.body.questions[0].questionExcerpt).toBe(startedB.body.questions[0].questionExcerpt);
    expect(startedA.body.quiz.slots[0].questionId).toBeNull();
    expect(startedB.body.quiz.slots[0].questionId).toBeNull();
    for (const started of [startedA, startedB]) {
      expect(started.body.questions[0].questionId).toBe(started.body.quiz.slots[0].id);
      expect(started.body.questions[0].questionId).not.toBe(localQuestionId);
      expect(started.body.attempt.appliedSettings).not.toHaveProperty('questionOrder');
    }
    expect(startedA.body.questions[0].questionId).not.toBe(startedB.body.questions[0].questionId);
    expect(startedA.body.questions[0].answers[0].id).toMatch(/^[a-f0-9-]{36}$/);
    expect(startedB.body.questions[0].answers[0].id).toMatch(/^[a-f0-9-]{36}$/);
    expect(startedA.body.questions[0].answers[0].id).not.toBe(startedB.body.questions[0].answers[0].id);
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
    const ownerReview = await http(offlineApp).get(`/api/v1/quiz-attempts/${startedA.body.attempt.id}`).set(bearer(studentA));
    expect(ownerReview.status).toBe(200);
    expect(ownerReview.body.quiz).not.toHaveProperty('sharedSource');
    expect(ownerReview.body.questions[0].questionId).not.toBe(localQuestionId);
    expect(ownerReview.body.attempt.appliedSettings).not.toHaveProperty('questionOrder');
    const learnerAttempts = await http(offlineApp).get(`/api/v1/exam-pins/${assignA.body.id}/attempts`)
      .set(bearer(studentA));
    expect(learnerAttempts.status, JSON.stringify(learnerAttempts.body)).toBe(200);
    expect(learnerAttempts.body).toHaveLength(1);
    expect(learnerAttempts.body[0].appliedSettings).not.toHaveProperty('questionOrder');
    expect(JSON.stringify(learnerAttempts.body)).not.toContain(localQuestionId);
    const managerAttempts = await http(offlineApp).get(`/api/v1/exam-pins/${assignA.body.id}/attempts`)
      .set(bearer(managerA));
    expect(managerAttempts.status, JSON.stringify(managerAttempts.body)).toBe(200);
    expect(managerAttempts.body).toHaveLength(1);
    expect(managerAttempts.body[0].appliedSettings.questionOrder).toContain(localQuestionId);
    const learnerDetails = await http(offlineApp).get(`/api/v1/exam-pins/${assignA.body.id}`).set(bearer(studentA));
    expect(learnerDetails.status).toBe(200);
    expect(learnerDetails.body.myAttempts[0].appliedSettings).not.toHaveProperty('questionOrder');

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
      generalFeedback: null, stimulusContent: text('Ngữ liệu tự luận độc lập'), answers: [],
      answerKey: { guidance: text('Rubric tự luận tuyệt mật'), solution: { answer: text('Lời giải được khóa') } },
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
    const body = {
      sharedExamVersionId: sharedId, sectionId: sectionB, requestId,
      reviewAttempt: 0x11110, reviewRightAnswer: 0x11110,
    };
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
    const gradeItemId = (await centre.query('SELECT id FROM grade_items WHERE item_instance = $1',
      [assigned.body.cmId])).rows[0].id as string;
    const manualGradeRelease = await http(app).put(`/api/v1/grade-items/${gradeItemId}/posting-policy`)
      .set(bearer(managerB)).send({ policy: 'manual' });
    expect(manualGradeRelease.status, JSON.stringify(manualGradeRelease.body)).toBe(200);
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
    expect(started.body.questions[1].guidance).toBeNull();
    expect(started.body.questions[1].solution).toBeNull();
    expect(started.body.questions[1].stimulus.id).toBe(started.body.quiz.slots[1].id);
    expect(JSON.stringify(started.body.questions[1].stimulus.content)).toContain('Ngữ liệu tự luận độc lập');
    expect(started.body.questions[0].answers[0].id).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.stringify(started.body)).not.toContain('Rubric tự luận tuyệt mật');
    expect(JSON.stringify(started.body)).not.toContain('Lời giải được khóa');
    const beforeSubmission = await http(offlineApp!).get(`/api/v1/quiz-attempts/${started.body.attempt.id}`)
      .set(bearer(studentB));
    expect(beforeSubmission.status).toBe(200);
    expect(beforeSubmission.body.questions[1].guidance).toBeNull();
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
    const beforePublication = await http(offlineApp!).get(`/api/v1/quiz-attempts/${started.body.attempt.id}`)
      .set(bearer(studentB));
    expect(beforePublication.status).toBe(200);
    expect(beforePublication.body.questions[1].guidance).toBeNull();
    expect(beforePublication.body.questions[1].solution).toBeNull();
    expect(JSON.stringify(beforePublication.body)).not.toContain('Rubric tự luận tuyệt mật');
    const staffReview = await http(offlineApp!).get(`/api/v1/quiz-attempts/${started.body.attempt.id}`)
      .set(bearer(managerB));
    expect(staffReview.status).toBe(200);
    expect(JSON.stringify(staffReview.body.questions[1].guidance)).toContain('Rubric tự luận tuyệt mật');
    const publishedGrade = await http(offlineApp!).post(`/api/v1/grade-items/${gradeItemId}/publish`)
      .set(bearer(managerB)).send({});
    expect(publishedGrade.status, JSON.stringify(publishedGrade.body)).toBe(201);
    const afterPublication = await http(offlineApp!).get(`/api/v1/quiz-attempts/${started.body.attempt.id}`)
      .set(bearer(studentB));
    expect(afterPublication.status).toBe(200);
    expect(JSON.stringify(afterPublication.body.questions[1].guidance)).toContain('Rubric tự luận tuyệt mật');
    expect(JSON.stringify(afterPublication.body.questions[1].solution)).toContain('Lời giải được khóa');
    expect((await centre.query('SELECT count(*)::int AS n FROM exam_attempts WHERE pin_id = $1', [pinId])).rows[0].n).toBe(1);
  }, 120_000);

  it('retry giữ một bản thực thi và một pin; sai nguồn hoặc section không thể tái dùng requestId', async () => {
    const requestId = randomUUID();
    const body = { sharedExamVersionId: publishedId, requestId, sectionId: sectionB, password: 'Mật khẩu kiểm tra retry #15' };
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
    const stored = (await centre.query('SELECT shared_request_checksum FROM exams WHERE pin_request_id = $1',
      [requestId])).rows[0].shared_request_checksum as string;
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toContain('Mật khẩu kiểm tra retry #15');
    const changedDuringResume = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB))
      .send({ ...body, timeClose: '2026-12-15T12:00:00.000Z' });
    expect(changedDuringResume.status).toBe(409);
    expect(changedDuringResume.body.code).toBe('exam.pin_request_conflict');
    expect((await centre.query('SELECT count(*)::int AS n FROM exam_pins WHERE request_id = $1', [requestId])).rows[0].n).toBe(0);

    const again = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB)).send(body);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const repeated = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB)).send(body);
    expect(repeated.status).toBe(201);
    expect(repeated.body.id).toBe(again.body.id);
    const equivalent = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB))
      .send({ ...body, versionMode: 'pinned', variantCount: 1, targetGroupId: null, timeOpen: null });
    expect(equivalent.status).toBe(201);
    expect(equivalent.body.id).toBe(again.body.id);
    for (const change of [
      { name: 'Tên khác' },
      { intro: 'Hướng dẫn khác' },
      { timeOpen: '2026-12-01T09:00:00Z' },
      { timeClose: '2026-12-01T10:00:00Z' },
      { targetGroupId: randomUUID() },
      { attemptsAllowed: 2 },
      { variantCount: 2 },
      { reviewMarks: 0 },
      { password: 'another-password' },
      { preset: 'regular' },
    ]) {
      const conflict = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB))
        .send({ ...body, ...change });
      expect(conflict.status, JSON.stringify({ change, body: conflict.body })).toBe(409);
      expect(conflict.body.code).toBe('exam.pin_request_conflict');
    }

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
    const invalidTime = await http(app).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB))
      .send({ ...body, requestId: randomUUID(), timeOpen: 'invalid-date' });
    expect(invalidTime.status).toBe(400);
    expect(invalidTime.body.code).toBe('quiz.bad_window');

  }, 90_000);

  it('hai database trung tâm tách biệt giao cùng phiên bản, lưu kết quả riêng và công bố điểm độc lập', async () => {
    const cpName = `giaokhoa_test_exam15_cp_${suffix}`;
    const previousCp = process.env.CONTROL_PLANE_DATABASE_URL;
    const provisioned: SpaceProvisionResult[] = [];
    let routed: INestApplication | undefined;
    let offline: INestApplication | undefined;
    const dbSecret = 'Test-only-shared-15!';
    const cpUrl = await buildTestDatabase({ adminUrl, database: cpName, store: 'control-plane' });
    const urlFor = (space: SpaceProvisionResult) => {
      const url = new URL(adminUrl);
      url.pathname = `/${space.databaseName}`;
      url.username = space.connectionRole;
      url.password = dbSecret;
      return url.toString();
    };
    try {
      for (const label of ['a', 'b']) {
        const space = await runSpaceProvision({
          slug: `exam15-${label}-${suffix}`, name: `Trung tâm ${label}`,
          adminUsername: 'admin15', adminEmail: `exam15-${label}-${suffix}@example.com`,
          databasePassword: dbSecret, actorId: randomUUID(),
          env: { ...process.env, CONTROL_PLANE_DATABASE_URL: cpUrl }, log: () => undefined,
        });
        provisioned.push(space);
        process.env[space.secretEnvVar] = urlFor(space);
      }
      process.env.CONTROL_PLANE_DATABASE_URL = cpUrl;
      process.env.SYSTEM_BANK_DATABASE_URL = bankUrl;
      routed = await testApp();
      const [a, b] = provisioned;
      const hostA = `${a.slug}.test.local`;
      const hostB = `${b.slug}.test.local`;
      const hosts = [hostA, hostB];
      const sessions: Array<{ admin: string; student: string; studentId: string; courseId: string; sectionId: string }> = [];
      for (const [index, space] of provisioned.entries()) {
        const activated = await http(routed).post('/api/v1/centres/activate-invite')
          .send({ slug: space.slug, token: space.inviteToken, password: STRONG_PASSWORD });
        expect(activated.status, JSON.stringify(activated.body)).toBe(201);
        const loggedIn = await http(routed).post('/api/v1/auth/token').set('Host', hosts[index]!)
          .send({ username: 'admin15', password: STRONG_PASSWORD });
        expect(loggedIn.status, JSON.stringify(loggedIn.body)).toBe(201);
        const adminToken = loggedIn.body.accessToken as string;
        const student = await routed.get(SpaceDatabaseService).withSpaceKysely(space.slug, async () => {
          const roles = routed!.get(RolesService);
          const contexts = routed!.get(ContextsService);
          const managerRole = await roles.getRoleByShortname('manager');
          const system = await contexts.ensureSystemContext();
          const tenant = await contexts.ensureTenantContext(space.tenantId!);
          await roles.assignRole(space.adminUserId!, managerRole!.id, system.id);
          await roles.assignRole(space.adminUserId!, managerRole!.id, tenant.id);
          const user = await routed!.get(UsersService).createUser({
            username: 'student15', email: `student15-${index}@example.com`,
            password: STRONG_PASSWORD, firstName: 'Học', lastName: 'Sinh',
          });
          await routed!.get(TenantsService).ensureActiveMembership(space.tenantId!, user.id);
          return user;
        }, { tenantId: space.tenantId!, userId: space.adminUserId! });

        const category = await http(routed).post('/api/v1/courses/categories').set('Host', hosts[index]!)
          .set(bearer(adminToken)).send({ name: `Danh mục ${index}` });
        expect(category.status, JSON.stringify(category.body)).toBe(201);
        const cls = await http(routed).post('/api/v1/classes').set('Host', hosts[index]!)
          .set(bearer(adminToken)).send({ name: `Lớp ${index}` });
        expect(cls.status).toBe(201);
        const course = await http(routed).post('/api/v1/courses').set('Host', hosts[index]!)
          .set(bearer(adminToken)).send({
            category: category.body.id, classId: cls.body.id,
            shortName: `EX15${index}`, fullName: `Khoá riêng ${index}`,
          });
        expect(course.status, JSON.stringify(course.body)).toBe(201);
        const content = await http(routed).get(`/api/v1/courses/${course.body.id}/content`)
          .set('Host', hosts[index]!).set(bearer(adminToken));
        expect(content.status).toBe(200);
        const enrol = await http(routed).post(`/api/v1/courses/${course.body.id}/enrol/instances`)
          .set('Host', hosts[index]!).set(bearer(adminToken)).send({ method: 'manual' });
        expect(enrol.status).toBe(201);
        const enrolled = await http(routed).post(
          `/api/v1/courses/${course.body.id}/enrol/instances/${enrol.body.id}/enrol`,
        ).set('Host', hosts[index]!).set(bearer(adminToken)).send({ userId: student.id });
        expect(enrolled.status).toBe(201);
        const learnerLogin = await http(routed).post('/api/v1/auth/token').set('Host', hosts[index]!)
          .send({ username: 'student15', password: STRONG_PASSWORD });
        expect(learnerLogin.status, JSON.stringify(learnerLogin.body)).toBe(201);
        sessions.push({
          admin: adminToken, student: learnerLogin.body.accessToken as string, studentId: student.id,
          courseId: course.body.id, sectionId: content.body.sections[0].id,
        });
      }

      const [userA, userB] = sessions;
      const testNow = Date.now();
      const sendPin = (index: number) => {
        const u = sessions[index]!;
        const body = {
          sharedExamVersionId: publishedId, sectionId: u.sectionId, requestId: randomUUID(),
          name: `Đợt ${index === 0 ? 'A' : 'B'}`,
          timeOpen: new Date(testNow - (index + 2) * 60_000).toISOString(),
          timeClose: new Date(testNow + (index + 2) * 3_600_000).toISOString(),
          timeLimitSeconds: index === 0 ? 900 : 1800,
          reviewAttempt: 0x11110, reviewMarks: 0x11110, reviewRightAnswer: 0, reviewCorrectness: 0x11110,
        };
        return http(routed!).post(`/api/v1/courses/${u.courseId}/exam-pins`)
          .set('Host', hosts[index]!).set(bearer(u.admin)).send(body);
      };
      const pinA = await sendPin(0);
      const pinB = await sendPin(1);
      expect(pinA.status, JSON.stringify(pinA.body)).toBe(201);
      expect(pinB.status, JSON.stringify(pinB.body)).toBe(201);
      expect(pinA.body.id).not.toBe(pinB.body.id);
      expect(pinA.body.slots[0].questionId).toBe(localQuestionId);
      expect(pinB.body.slots[0].questionId).toBe(localQuestionId);
      expect(pinA.body.sharedSource).toEqual(pinB.body.sharedSource);
      expect(pinA.body.sharedSource.versionId).toBe(publishedId);
      expect(pinA.body.timeLimitSeconds).toBe(900);
      expect(pinB.body.timeLimitSeconds).toBe(1800);
      expect(pinA.body.timeOpen).not.toBe(pinB.body.timeOpen);

      const dbA = new Client({ connectionString: urlFor(a) });
      const dbB = new Client({ connectionString: urlFor(b) });
      await dbA.connect();
      await dbB.connect();
      try {
        await dbA.query("SELECT set_config('app.tenant_id', $1, false)", [a.tenantId]);
        await dbB.query("SELECT set_config('app.tenant_id', $1, false)", [b.tenantId]);
        const rowsA = await dbA.query('SELECT shared_exam_version_id FROM exams WHERE id = $1', [pinA.body.examId]);
        const rowsB = await dbB.query('SELECT shared_exam_version_id FROM exams WHERE id = $1', [pinB.body.examId]);
        expect(rowsA.rows[0].shared_exam_version_id).toBe(publishedId);
        expect(rowsB.rows[0].shared_exam_version_id).toBe(publishedId);
        expect((await dbA.query('SELECT id FROM exams WHERE id = $1', [pinB.body.examId])).rowCount).toBe(0);
        expect((await dbB.query('SELECT id FROM exams WHERE id = $1', [pinA.body.examId])).rowCount).toBe(0);
        expect((await dbA.query('SELECT jsonb_array_length(question_snapshots) AS n FROM exam_pins WHERE id = $1',
          [pinA.body.id])).rows[0].n).toBe(1);
        expect((await dbB.query('SELECT jsonb_array_length(question_snapshots) AS n FROM exam_pins WHERE id = $1',
          [pinB.body.id])).rows[0].n).toBe(1);
        const itemA = (await dbA.query('SELECT id FROM grade_items WHERE item_instance = $1', [pinA.body.cmId])).rows[0].id;
        const itemB = (await dbB.query('SELECT id FROM grade_items WHERE item_instance = $1', [pinB.body.cmId])).rows[0].id;
        for (const [index, itemId] of [itemA, itemB].entries()) {
          const policy = await http(routed).put(`/api/v1/grade-items/${itemId}/posting-policy`)
            .set('Host', hosts[index]!).set(bearer(sessions[index]!.admin)).send({ policy: 'manual' });
          expect(policy.status, JSON.stringify(policy.body)).toBe(200);
        }
        delete process.env.SYSTEM_BANK_DATABASE_URL;
        offline = await testApp();
        expect((await http(offline).get(`/api/v1/exam-pins/${pinB.body.id}`)
          .set('Host', hostA).set(bearer(userA.admin))).status).toBe(404);
        expect((await http(offline).get(`/api/v1/exam-pins/${pinA.body.id}`)
          .set('Host', hostB).set(bearer(userB.admin))).status).toBe(404);
        expect((await http(offline).get(`/api/v1/exam-pins/${pinB.body.id}`)
          .set('Host', hostB).set(bearer(userA.student))).status).not.toBe(200);

        const started = [];
        for (const [index, pin] of [pinA, pinB].entries()) {
          const u = sessions[index]!;
          const begin = await http(offline).post(`/api/v1/exam-pins/${pin.body.id}/attempts`)
            .set('Host', hosts[index]!).set(bearer(u.student)).send({});
          expect(begin.status, JSON.stringify(begin.body)).toBe(201);
          expect(begin.body.quiz).not.toHaveProperty('sharedSource');
          expect(begin.body.quiz.slots[0].questionId).toBeNull();
          expect(begin.body.questions[0].questionId).toBe(begin.body.quiz.slots[0].id);
          expect(begin.body.questions[0].questionId).not.toBe(localQuestionId);
          expect(begin.body.attempt.appliedSettings).not.toHaveProperty('questionOrder');
          const learnerList = await http(offline).get(`/api/v1/exam-pins/${pin.body.id}/attempts`)
            .set('Host', hosts[index]!).set(bearer(u.student));
          expect(learnerList.status, JSON.stringify(learnerList.body)).toBe(200);
          expect(learnerList.body[0].appliedSettings).not.toHaveProperty('questionOrder');
          const managerList = await http(offline).get(`/api/v1/exam-pins/${pin.body.id}/attempts`)
            .set('Host', hosts[index]!).set(bearer(u.admin));
          expect(managerList.status, JSON.stringify(managerList.body)).toBe(200);
          expect(managerList.body[0].appliedSettings.questionOrder).toContain(localQuestionId);
          expect(begin.body.questions[0].answers[0].id).toMatch(/^[a-f0-9-]{36}$/);
          started.push(begin);
          const saved = await http(offline).post(`/api/v1/quiz-attempts/${begin.body.attempt.id}/responses`)
            .set('Host', hosts[index]!).set(bearer(u.student)).send({
              questionAttemptId: begin.body.questions[0].questionAttemptId,
              response: begin.body.questions[0].answers[0].id,
            });
          expect(saved.status, JSON.stringify(saved.body)).toBe(201);
          const submitted = await http(offline).post(`/api/v1/quiz-attempts/${begin.body.attempt.id}/submit`)
            .set('Host', hosts[index]!).set(bearer(u.student)).send({});
          expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
          const hidden = await http(offline).get(`/api/v1/quiz-attempts/${begin.body.attempt.id}`)
            .set('Host', hosts[index]!).set(bearer(u.student));
          expect(hidden.status).toBe(200);
          expect(hidden.body.quiz).not.toHaveProperty('sharedSource');
          expect(hidden.body.attempt.grade).toBeNull();
          expect(hidden.body.questions[0].solution).toBeNull();
        }
        expect((await dbA.query('SELECT count(*)::int AS n FROM exam_attempts')).rows[0].n).toBe(1);
        expect((await dbB.query('SELECT count(*)::int AS n FROM exam_attempts')).rows[0].n).toBe(1);
        expect((await dbA.query('SELECT count(*)::int AS n FROM exam_attempts WHERE pin_id = $1',
          [pinB.body.id])).rows[0].n).toBe(0);
        expect((await dbB.query('SELECT count(*)::int AS n FROM exam_attempts WHERE pin_id = $1',
          [pinA.body.id])).rows[0].n).toBe(0);
        expect((await dbA.query('SELECT count(*)::int AS n FROM question_attempts')).rows[0].n).toBe(1);
        expect((await dbB.query('SELECT count(*)::int AS n FROM question_attempts')).rows[0].n).toBe(1);

        const releaseA = await http(offline).post(`/api/v1/exam-pins/${pinA.body.id}/publish`)
          .set('Host', hostA).set(bearer(userA.admin)).send({});
        expect(releaseA.status).toBe(201);
        const publishGradeA = await http(offline).post(`/api/v1/grade-items/${itemA}/publish`)
          .set('Host', hostA).set(bearer(userA.admin)).send({});
        expect(publishGradeA.status).toBe(201);
        const revealAnswersA = await http(offline).patch(`/api/v1/exam-pins/${pinA.body.id}`)
          .set('Host', hostA).set(bearer(userA.admin)).send({ reviewRightAnswer: 0x11110 });
        expect(revealAnswersA.status, JSON.stringify(revealAnswersA.body)).toBe(200);
        const shownA = await http(offline).get(`/api/v1/quiz-attempts/${started[0]!.body.attempt.id}`)
          .set('Host', hostA).set(bearer(userA.student));
        const hiddenB = await http(offline).get(`/api/v1/quiz-attempts/${started[1]!.body.attempt.id}`)
          .set('Host', hostB).set(bearer(userB.student));
        expect(shownA.body.attempt.grade).toBe(1);
        expect(hiddenB.body.attempt.grade).toBeNull();
        expect(shownA.body.questions[0].solution).not.toBeNull();
        expect(hiddenB.body.questions[0].solution).toBeNull();
        expect(shownA.body.quiz).not.toHaveProperty('sharedSource');
        expect((await dbA.query('SELECT final_grade FROM grade_grades WHERE user_id = $1 AND item_id = $2',
          [userA.studentId, itemA])).rows[0].final_grade).toBeDefined();
        expect((await dbB.query('SELECT final_grade FROM grade_grades WHERE user_id = $1 AND item_id = $2',
          [userB.studentId, itemB])).rows[0].final_grade).toBeDefined();
        expect((await bank.query("SELECT count(*)::int AS n FROM pg_tables WHERE tablename IN ('exam_attempts','question_attempts','grade_grades')")).rows[0].n).toBe(0);
      } finally {
        await dbA.end(); await dbB.end();
      }
    } finally {
      await offline?.close(); await routed?.close();
      await offline?.get<Pool>('SHARED_CENTRE_KYSELY').end();
      await routed?.get<Pool>('SHARED_CENTRE_KYSELY').end();
      process.env.SYSTEM_BANK_DATABASE_URL = bankUrl;
      if (previousCp === undefined) delete process.env.CONTROL_PLANE_DATABASE_URL;
      else process.env.CONTROL_PLANE_DATABASE_URL = previousCp;
      for (const space of provisioned) {
        delete process.env[space.secretEnvVar];
        await dropTestDatabase(adminUrl, space.databaseName);
      }
      const cluster = new Client({ connectionString: adminUrl });
      await cluster.connect();
      try {
        for (const space of provisioned) await cluster.query(`DROP ROLE "${space.connectionRole}"`);
      } finally {
        await cluster.end();
      }
      await dropTestDatabase(adminUrl, cpName);
    }
  }, 180_000);

  it('fork đề có ảnh lỗi ở slot thứ hai dọn metadata, object và rollback câu/đề/outbox', async () => {
    const forkApp = await testApp();
    try {
    const original = (await bank.query('SELECT * FROM system_exam_versions WHERE id = $1', [publishedId])).rows[0];
    const versionId = (await bank.query<{ id: string }>('SELECT uuidv7() AS id')).rows[0]!.id;
    const source = original.package as { source: Record<string, unknown>; slots: Array<Record<string, unknown>>; totalScore: number };
    const bytes = Buffer.concat([
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
      Buffer.from(randomUUID()),
    ]);
    const hash = sha256Hex(bytes);
    const storage = forkApp.get<ObjectStorage>(OBJECT_STORAGE);
    await storage.put(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(hash), bytes);
    const originalSlot = source.slots[0]!;
    const originalQuestion = originalSlot.package as {
      questionText: { type: string; content: unknown[] };
      media?: Array<{ contentHash: string; fileName: string; mimeType: string }>;
    };
    const imageQuestion = {
      ...originalQuestion,
      questionText: { ...originalQuestion.questionText, content: [
        ...originalQuestion.questionText.content,
        { type: 'image', attrs: { src: `bank-media://${hash}`, alt: 'Ảnh của bản fork' } },
      ] },
      media: [
        ...(originalQuestion.media ?? []),
        { contentHash: hash, fileName: 'fork-rollback.png', mimeType: 'image/png' },
      ],
    };
    const pkg = {
      ...source,
      source: { ...source.source, versionId, versionNumber: 22 },
      slots: [
        { ...originalSlot, position: 1, package: imageQuestion, checksum: checksumPackage(imageQuestion) },
        { ...originalSlot, position: 2 },
      ],
      totalScore: source.totalScore * 2,
    };
    const inserted = await bank.query<{ id: string }>(
      `INSERT INTO system_exam_versions
       (centre_slug, source_exam_id, source_version_id, source_version_number, package, checksum,
        submitted_by, status, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, 22, $4, $5, $6, 'approved', $7, now()) RETURNING id`,
      [original.centre_slug, original.source_exam_id, versionId,
        JSON.stringify(pkg), checksumPackage(pkg), original.submitted_by, original.reviewed_by],
    );
    const sharedId = inserted.rows[0]!.id;
    const beforeQuestions = (await centre.query<{ count: string }>('SELECT count(*) FROM question')).rows[0]!.count;
    const beforePapers = (await centre.query<{ count: string }>('SELECT count(*) FROM exams')).rows[0]!.count;
    const beforeOutbox = (await centre.query<{ count: string }>("SELECT count(*) FROM outbox_events WHERE aggregate IN ('question', 'stimulus')")).rows[0]!.count;
    await centre.query('ALTER TABLE exam_slots ADD CONSTRAINT reject_second_fork_slot CHECK (position <> 2) NOT VALID');
    try {
      const failed = await http(forkApp).post(`/api/v1/system-bank/exams/${sharedId}/fork`)
        .set(bearer(managerB)).send({});
      expect(failed.status, JSON.stringify(failed.body)).toBe(500);
      expect((await centre.query<{ count: string }>('SELECT count(*) FROM question')).rows[0]!.count).toBe(beforeQuestions);
      expect((await centre.query<{ count: string }>('SELECT count(*) FROM exams')).rows[0]!.count).toBe(beforePapers);
      expect((await centre.query<{ count: string }>("SELECT count(*) FROM outbox_events WHERE aggregate IN ('question', 'stimulus')")).rows[0]!.count).toBe(beforeOutbox);
      expect((await centre.query('SELECT id FROM files WHERE content_hash = $1', [hash])).rowCount).toBe(0);
      expect(await storage.exists(SYSTEM_FILE_DOMAIN, hash)).toBe(false);
      expect(await storage.exists(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(hash))).toBe(true);
    } finally {
      await centre.query('ALTER TABLE exam_slots DROP CONSTRAINT reject_second_fork_slot');
    }
    const succeeded = await http(forkApp).post(`/api/v1/system-bank/exams/${sharedId}/fork`)
      .set(bearer(managerB)).send({});
    expect(succeeded.status, JSON.stringify(succeeded.body)).toBe(201);
    expect(succeeded.body.questionIds).toHaveLength(2);
    expect((await centre.query('SELECT id FROM files WHERE content_hash = $1', [hash])).rowCount).toBe(1);
    expect(await storage.exists(SYSTEM_FILE_DOMAIN, hash)).toBe(true);
    const beforeReusedFile = (await centre.query('SELECT id FROM files WHERE content_hash = $1', [hash])).rows[0]!.id;
    const beforeReusedQuestions = (await centre.query<{ count: string }>('SELECT count(*) FROM question')).rows[0]!.count;
    await centre.query('ALTER TABLE exam_slots ADD CONSTRAINT reject_shared_media_fork CHECK (position <> 2) NOT VALID');
    try {
      const failedAgain = await http(forkApp).post(`/api/v1/system-bank/exams/${sharedId}/fork`)
        .set(bearer(managerB)).send({});
      expect(failedAgain.status).toBe(500);
      const remaining = await centre.query('SELECT id FROM files WHERE content_hash = $1', [hash]);
      expect(remaining.rowCount).toBe(1);
      expect(remaining.rows[0]!.id).toBe(beforeReusedFile);
      expect((await centre.query<{ count: string }>('SELECT count(*) FROM question')).rows[0]!.count)
        .toBe(beforeReusedQuestions);
      expect(await storage.exists(SYSTEM_FILE_DOMAIN, hash)).toBe(true);
    } finally {
      await centre.query('ALTER TABLE exam_slots DROP CONSTRAINT reject_shared_media_fork');
    }
    } finally {
      await forkApp.close();
      await forkApp.get<Pool>('SHARED_CENTRE_KYSELY').end();
    }
  });

  it('rút đề nguồn: B dùng lại bản đã ghim, tạo bản riêng chỉnh sửa, không nhận phiên bản chưa ghim', async () => {
    const lifecycleApp = await testApp();
    try {
    const version2 = await bank.query<{ id: string }>(
      'select id from system_exam_versions where source_exam_id=$1 and source_version_number=2 and status=$2',
      [examId, 'approved'],
    );
    expect(version2.rowCount).toBe(1);
    const reviewer = await adminToken(lifecycleApp);
    const before = await http(lifecycleApp).get('/api/v1/system-bank/exams/approved').set(bearer(reviewer));
    expect(before.status).toBe(200);
    expect(before.body.some((row: { id: string }) => row.id === publishedId)).toBe(true);
    const original = (await bank.query('SELECT * FROM system_exam_versions WHERE id = $1', [publishedId])).rows[0];
    const versionId = (await bank.query<{ id: string }>('SELECT uuidv7() AS id')).rows[0]!.id;
    const pkg = {
      ...original.package,
      source: { ...original.package.source, versionId, versionNumber: 23 },
    };
    const pendingRow = await bank.query<{ id: string }>(
      `INSERT INTO system_exam_versions
       (centre_slug, source_exam_id, source_version_id, source_version_number, package, checksum, submitted_by)
       VALUES ($1, $2, $3, 23, $4, $5, $6) RETURNING id`,
      [original.centre_slug, original.source_exam_id, versionId,
        JSON.stringify(pkg), checksumPackage(pkg), original.submitted_by],
    );
    const pendingId = pendingRow.rows[0]!.id;
    const withdrawal = await http(lifecycleApp).post(`/api/v1/system-bank/exams/${publishedId}/withdraw`)
      .set(bearer(reviewer)).send({ reason: 'Đề nguồn cần thu hồi' });
    expect(withdrawal.status, JSON.stringify(withdrawal.body)).toBe(201);
    expect(withdrawal.body.status).toBe('withdrawn');
    const resurrect = await http(lifecycleApp).post(`/api/v1/system-bank/exams/${pendingId}/approve`)
      .set(bearer(reviewer)).send({});
    expect(resurrect.status, JSON.stringify(resurrect.body)).toBe(409);
    expect(resurrect.body.code).toBe('system_exam.source_withdrawn');
    expect((await bank.query('SELECT status FROM system_exam_versions WHERE id = $1', [pendingId])).rows[0].status).toBe('pending');
    const availableToReview = await http(lifecycleApp).get('/api/v1/system-bank/exams/approved').set(bearer(reviewer));
    expect(availableToReview.body.some((row: { id: string }) => row.id === publishedId)).toBe(false);
    const used = await http(lifecycleApp).get('/api/v1/system-bank/exams/used').set(bearer(managerB));
    expect(used.status, JSON.stringify(used.body)).toBe(200);
    expect(used.body).toEqual(expect.arrayContaining([expect.objectContaining({
      id: publishedId, status: 'withdrawn', sourceExamId: examId,
    })]));
    const published = await http(lifecycleApp).get(`/api/v1/system-bank/exams?courseId=${courseB}`).set(bearer(managerB));
    expect(published.status).toBe(200);
    expect(published.body.some((item: { id: string }) => item.id === publishedId)).toBe(false);
    const rejected = await http(lifecycleApp).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB))
      .send({ sharedExamVersionId: version2.rows[0]!.id, requestId: randomUUID(), sectionId: sectionB });
    expect(rejected.status).toBe(404);
    const reissued = await http(lifecycleApp).post(`/api/v1/courses/${courseB}/exam-pins`).set(bearer(managerB))
      .send({ sharedExamVersionId: publishedId, requestId: randomUUID(), sectionId: sectionB });
    expect(reissued.status, JSON.stringify(reissued.body)).toBe(201);
    expect(reissued.body.sharedSource.versionId).toBe(publishedId);
    const fork = await http(lifecycleApp).post(`/api/v1/system-bank/exams/${publishedId}/fork`)
      .set(bearer(managerB)).send({});
    expect(fork.status, JSON.stringify(fork.body)).toBe(201);
    expect(fork.body.sourceExamVersionId).toBe(publishedId);
    expect(fork.body.questionIds).toHaveLength(1);
    expect(fork.body.questionIds[0]).not.toBe(localQuestionId);
    const local = await centre.query('select kind, system_exam_fork_version_id from exams where id=$1', [fork.body.paperId]);
    expect(local.rows[0]).toMatchObject({ kind: 'snapshot', system_exam_fork_version_id: publishedId });
    const edited = await http(lifecycleApp).patch(`/api/v1/exams/${fork.body.paperId}`)
      .set(bearer(managerB)).send({ name: 'Đề bản riêng B đã chỉnh sửa' });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const neverAdopted = await http(lifecycleApp).post(`/api/v1/system-bank/exams/${version2.rows[0]!.id}/fork`)
      .set(bearer(managerB)).send({});
    expect(neverAdopted.status).toBe(404);
    const pending = await http(lifecycleApp).get('/api/v1/system-bank/events/pending').set(bearer(managerB));
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    const event = pending.body.find((item: { type: string }) => item.type === 'exam_withdrawn');
    expect(event?.resourceKey).toMatch(examId);
    const ack = await http(lifecycleApp).post(`/api/v1/system-bank/events/${event.id}/acknowledge`)
      .set(bearer(managerB)).send({});
    expect(ack.status).toBe(201);
    expect((await http(lifecycleApp).get('/api/v1/system-bank/events/pending').set(bearer(managerB)))
      .body.some((item: { id: string }) => item.id === event.id)).toBe(false);
    } finally {
      await lifecycleApp.close();
      await lifecycleApp.get<Pool>('SHARED_CENTRE_KYSELY').end();
    }
  });

});
