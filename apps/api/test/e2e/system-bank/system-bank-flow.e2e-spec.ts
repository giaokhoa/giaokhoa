import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken,
  assignRole,
  createTestApp,
  createUserViaApi,
  createRoleViaApi,
  seedTenantMembershipFixture,
  http,
  login,
  roleIdByShortname,
  setOverride,
  STRONG_PASSWORD,
  systemContextId,
  uniqueName,
} from '../../support/identity-access-helpers';
import { addExamSlot, createExamDraft } from '../../support/exam-pin-helpers';
import { tenantAls } from '../../../src/modules/tenants/tenant-als';
import { programmePackageChecksum } from '../../../src/modules/system-bank/programme-package-integrity';
import { RolesService } from '../../../src/modules/access/roles.service';
import { ContextsService } from '../../../src/modules/access/contexts.service';
import { FilesService } from '../../../src/modules/files/files.service';
import { OBJECT_STORAGE, sha256Hex, type ObjectStorage } from '../../../src/modules/files/storage';
import { publicationMediaStorageKey } from '../../../src/modules/system-bank/system-bank-media.service';
import { SYSTEM_FILE_DOMAIN } from '@giaokhoa/db';
import { seedLegacyCentreInShared } from '../../support/pre-migration-tenant.fixture';

const BANK_DATABASE = 'giaokhoa_test_bank_585';
const BANK_ROLE = 'giaokhoa_bank_test_585';
const BANK_PASSWORD = 'bank585test';

const UUIDV7_SHIM = `CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$ DECLARE ts_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; b bytea; BEGIN b := decode(lpad(to_hex(ts_ms), 12, '0'), 'hex') || gen_random_bytes(10); b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112); b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128); RETURN encode(b, 'hex')::uuid; END; $$ LANGUAGE plpgsql VOLATILE`;

function clusterUrl(database: string, username?: string, secret?: string): string {
  const base = new URL(process.env.DATABASE_URL!);
  base.pathname = `/${database}`;
  if (username) base.username = username;
  if (secret) base.password = secret;
  return base.toString();
}

function quoted(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function withClient<T>(connectionString: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function applySqlFile(connectionString: string, filePath: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    const version = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    if (Number(version.rows[0]!.server_version_num) < 180000) {
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await client.query(UUIDV7_SHIM);
    }
    const sqlText = readFileSync(filePath, 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.query(trimmed);
    }
  });
}

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

function multichoicePackage(text: string) {
  return {
    questionText: doc(text),
    generalFeedback: null,
    stimulusContent: null,
    answers: [
      { answer: doc('Đúng'), isCorrect: true, feedback: null, sortOrder: 0 },
      { answer: doc('Sai 1'), isCorrect: false, feedback: null, sortOrder: 1 },
      { answer: doc('Sai 2'), isCorrect: false, feedback: null, sortOrder: 2 },
      { answer: doc('Sai 3'), isCorrect: false, feedback: null, sortOrder: 3 },
    ],
    answerKey: null,
    options: null,
    outcomes: [],
  };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Ngân hàng hệ thống thành kho riêng + API (issue #585)', () => {
  let app: INestApplication;
  let appNoBank: INestApplication | null = null;
  let admin: string;
  let teacher: { id: string; token: string };
  let student: { id: string; token: string };
  let pg: Client;
  let bankPg: Client;

  beforeAll(async () => {
    const adminUrl = clusterUrl('postgres');
    await withClient(adminUrl, async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${quoted(BANK_DATABASE)} WITH (FORCE)`);
      await client.query(`DROP ROLE IF EXISTS ${quoted(BANK_ROLE)}`);
      await client.query(`CREATE ROLE ${quoted(BANK_ROLE)} LOGIN PASSWORD '${BANK_PASSWORD}'`);
      await client.query(`CREATE DATABASE ${quoted(BANK_DATABASE)} OWNER ${quoted(BANK_ROLE)}`);
      await client.query(`REVOKE CONNECT ON DATABASE ${quoted(BANK_DATABASE)} FROM PUBLIC`);
      await client.query(`GRANT CONNECT ON DATABASE ${quoted(BANK_DATABASE)} TO ${quoted(BANK_ROLE)}`);
    });
    const bankMigrationDirs = (await import('node:fs')).readdirSync(
      join(__dirname, '../../../../../packages/db/migrations/system-bank'),
    ).filter((name) => name !== 'meta').sort();
    for (const migrationDir of bankMigrationDirs) {
      await applySqlFile(
        clusterUrl(BANK_DATABASE, BANK_ROLE, BANK_PASSWORD),
        join(__dirname, '../../../../../packages/db/migrations/system-bank', migrationDir, 'migration.sql'),
      );
    }
    process.env.SYSTEM_BANK_DATABASE_URL = clusterUrl(BANK_DATABASE, BANK_ROLE, BANK_PASSWORD);
    app = await createTestApp();
    admin = await adminToken(app);
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    bankPg = new Client({ connectionString: clusterUrl(BANK_DATABASE, BANK_ROLE, BANK_PASSWORD) });
    await bankPg.connect();
    const u = await createUserViaApi(app, admin);
    await assignRole(app, admin, u.id, await roleIdByShortname(app, admin, 'teacher'), await systemContextId(app, admin));
    const session = await login(app, u.username, STRONG_PASSWORD);
    teacher = { id: u.id, token: session.accessToken };
    const s = await createUserViaApi(app, admin);
    await assignRole(app, admin, s.id, await roleIdByShortname(app, admin, 'student'), await systemContextId(app, admin));
    const studentSession = await login(app, s.username, STRONG_PASSWORD);
    student = { id: s.id, token: studentSession.accessToken };
  });

  afterAll(async () => {
    await bankPg?.end();
    await pg?.end();
    await app?.close();
    await appNoBank?.close();
    delete process.env.SYSTEM_BANK_DATABASE_URL;
    const adminUrl = clusterUrl('postgres');
    await withClient(adminUrl, async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${quoted(BANK_DATABASE)} WITH (FORCE)`);
      await client.query(`DROP ROLE IF EXISTS ${quoted(BANK_ROLE)}`);
    });
  });

  async function publish(text: string) {
    const res = await http(app).post('/api/v1/system-bank/questions').set(bearer(admin)).send({
      qtype: 'multichoice',
      package: multichoicePackage(text),
    });
    expect(res.status).toBe(201);
    return res.body as { question: { id: string }; version: { id: string; checksum: string } };
  }

  it('phát hành câu + phiên bản mới: phiên bản cũ đọc lại không đổi', async () => {
    const created = await publish('Câu hệ thống gốc');
    const questionId = created.question.id;
    const v2 = await http(app).post(`/api/v1/system-bank/questions/${questionId}/versions`).set(bearer(admin)).send({
      package: multichoicePackage('Câu hệ thống sửa'),
    });
    expect(v2.status).toBe(201);
    const v1 = await http(app).get(`/api/v1/system-bank/questions/${questionId}/versions/1`).set(bearer(admin));
    expect(v1.status).toBe(200);
    expect(v1.body.package.questionText).toMatchObject(doc('Câu hệ thống gốc'));
    const v2read = await http(app).get(`/api/v1/system-bank/questions/${questionId}/versions/2`).set(bearer(admin));
    expect(v2read.status).toBe(200);
    expect(v2read.body.package.questionText).toMatchObject(doc('Câu hệ thống sửa'));
    expect(v2read.body.checksum).not.toBe(v1.body.checksum);
  });

  it('giáo viên khám phá theo dạng câu và nhập bản chụp: đủ nội dung + truy vết, checksum khớp gói nguồn', async () => {
    const created = await publish('Câu để nhập');
    const questionId = created.question.id;
    const discovery = await http(app).get('/api/v1/system-bank/discovery?qtype=multichoice&limit=100').set(bearer(teacher.token));
    expect(discovery.status).toBe(200);
    const found = (discovery.body.items as { id: string; versions: { version: number; checksum: string }[] }[])
      .find((item) => item.id === questionId);
    expect(found).toBeDefined();
    expect(found!.versions.map((row) => row.version)).toEqual([1]);
    const imported = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: questionId,
      sourceVersionNumber: 1,
    });
    expect(imported.status).toBe(201);
    expect(imported.body.import.kind).toBe('pristine');
    expect(imported.body.import.sourceQuestionId).toBe(questionId);
    expect(imported.body.import.sourceVersionNumber).toBe(1);
    expect(imported.body.import.packageChecksum).toBe(created.version.checksum);
    expect(imported.body.import.importedVersionNumber).toBe(1);
    const centreQuestionId = imported.body.question.question.id as string;
    const read = await http(app).get(`/api/v1/questions/${centreQuestionId}`).set(bearer(teacher.token));
    expect(read.status).toBe(200);
    expect(read.body.latestVersion.questionText).toMatchObject(doc('Câu để nhập'));
  });

  it('phiên bản mới phát thông báo, trung tâm chủ động chọn bản sau và bản riêng cũ không bị sửa', async () => {
    const created = await publish('Câu gốc phiên bản đầu');
    const imported = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: created.question.id,
      sourceVersionNumber: 1,
    });
    expect(imported.status).toBe(201);
    const localId = imported.body.question.question.id as string;
    const published = await http(app).post(`/api/v1/system-bank/questions/${created.question.id}/versions`)
      .set(bearer(admin)).send({ package: multichoicePackage('Câu phiên bản mới') });
    expect(published.status).toBe(201);
    const used = await http(app).get('/api/v1/system-bank/imports').set(bearer(teacher.token));
    expect(used.status).toBe(200);
    expect(used.body).toEqual(expect.arrayContaining([expect.objectContaining({
      questionId: localId, sourceQuestionId: created.question.id, sourceVersionNumber: 1,
      latestVersionNumber: 2, hasNewVersion: true, sourceStatus: 'published',
    })]));
    const provenance = await http(app).get(`/api/v1/system-bank/imports/${localId}`).set(bearer(teacher.token));
    expect(provenance.status).toBe(200);
    expect(provenance.body.sourceVersionId).toBe(created.version.id);
    const pending = await http(app).get('/api/v1/system-bank/events/pending').set(bearer(teacher.token));
    const event = (pending.body as { id: string; sourceQuestionId: string; type: string; payload: { versionNumber: number } }[])
      .find((row) => row.sourceQuestionId === created.question.id && row.type === 'question_version_published');
    expect(event?.payload.versionNumber).toBe(2);
    const local = await http(app).get(`/api/v1/questions/${localId}`).set(bearer(teacher.token));
    expect(local.body.latestVersion.questionText).toMatchObject(doc('Câu gốc phiên bản đầu'));
    const next = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: created.question.id,
      sourceVersionNumber: 2,
    });
    expect(next.status).toBe(201);
    expect(next.body.question.question.id).not.toBe(localId);
    expect(next.body.question.latestVersion.questionText).toMatchObject(doc('Câu phiên bản mới'));
    const acknowledgement = await http(app).post(`/api/v1/system-bank/events/${event!.id}/acknowledge`)
      .set(bearer(teacher.token)).send();
    expect(acknowledgement.status).toBe(201);
    const after = await http(app).get('/api/v1/system-bank/events/pending').set(bearer(teacher.token));
    expect((after.body as { id: string }[]).some((row) => row.id === event!.id)).toBe(false);
  });

  it('API trực tiếp không cho nhận nguồn rút nếu trung tâm chưa từng nhận phiên bản', async () => {
    const created = await publish('Câu rút trước khi tiếp nhận');
    const withdrawal = await http(app).post(`/api/v1/system-bank/questions/${created.question.id}/withdraw`)
      .set(bearer(admin)).send({ reason: 'Nguồn không còn hợp lệ' });
    expect(withdrawal.status).toBe(201);
    const importResult = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: created.question.id, sourceVersionNumber: 1,
    });
    expect(importResult.status).toBe(400);
    expect(importResult.body.code).toBe('system_bank.question_withdrawn');
    const read = await http(app).get(`/api/v1/system-bank/questions/${created.question.id}/versions/1`)
      .set(bearer(teacher.token));
    expect(read.status).toBe(404);
    expect(read.body.code).toBe('system_bank.question_not_found');
    const ignored = await http(app).post(`/api/v1/system-bank/events/${randomUUID()}/acknowledge`)
      .set(bearer(teacher.token)).send();
    expect(ignored.status).toBe(404);
    expect(ignored.body.code).toBe('system_bank.event_not_found');
  });

  it('checksum lệch thì nhập bị từ chối', async () => {
    const created = await publish('Câu để phá checksum');
    const questionId = created.question.id;
    await bankPg.query(
      `UPDATE system_question_versions SET checksum = 'deadbeef' WHERE question_id = $1 AND version = 1`,
      [questionId],
    );
    const imported = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: questionId,
      sourceVersionNumber: 1,
    });
    expect(imported.status).toBe(400);
    expect((imported.body as { code?: string }).code).toBe('system_bank.checksum_mismatch');
  });

  it('rút câu: ẩn khám phá, giữ quyền dùng lại phiên bản đã nhận và ghi nhận sự kiện', async () => {
    const created = await publish('Câu sẽ rút');
    const questionId = created.question.id;
    const imported = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: questionId,
    });
    expect(imported.status).toBe(201);
    const newSourceVersion = await http(app).post(`/api/v1/system-bank/questions/${questionId}/versions`)
      .set(bearer(admin)).send({ package: multichoicePackage('Câu phiên bản chưa nhận') });
    expect(newSourceVersion.status).toBe(201);
    const withdrawn = await http(app).post(`/api/v1/system-bank/questions/${questionId}/withdraw`).set(bearer(admin)).send({
      reason: 'Nội dung lỗi thời',
    });
    expect(withdrawn.status).toBe(201);
    const discovery = await http(app).get('/api/v1/system-bank/discovery?qtype=multichoice&limit=100').set(bearer(teacher.token));
    expect((discovery.body.items as { id: string }[]).find((item) => item.id === questionId)).toBeUndefined();
    const reimport = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: questionId,
      sourceVersionNumber: 1,
    });
    expect(reimport.status).toBe(201);
    expect(reimport.body.import.sourceVersionId).toBe(created.version.id);
    const source = await http(app).get(`/api/v1/system-bank/questions/${questionId}/versions/1`).set(bearer(teacher.token));
    expect(source.status).toBe(200);
    expect(source.body.package.questionText).toMatchObject(doc('Câu sẽ rút'));
    const blockedVersion = await http(app).get(`/api/v1/system-bank/questions/${questionId}/versions/2`)
      .set(bearer(teacher.token));
    expect(blockedVersion.status).toBe(404);
    const blockedImport = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token))
      .send({ sourceQuestionId: questionId, sourceVersionNumber: 2 });
    expect(blockedImport.status).toBe(400);
    const versions = await http(app).get(`/api/v1/system-bank/questions/${questionId}/versions`)
      .set(bearer(teacher.token));
    expect(versions.status).toBe(200);
    expect(versions.body).toHaveLength(1);
    expect(versions.body[0].version).toBe(1);
    const events = await bankPg.query(
      `SELECT id FROM system_bank_events WHERE source_question_id = $1 AND type = 'question_withdrawn'`,
      [questionId],
    );
    expect(events.rowCount).toBe(1);
    const eventId = events.rows[0]!.id as string;
    const ack = await http(app).post(`/api/v1/system-bank/events/${eventId}/acknowledge`).set(bearer(teacher.token)).send();
    expect(ack.status).toBe(201);
    const receipts = await pg.query(
      `SELECT id FROM system_bank_event_receipts WHERE event_id = $1`,
      [eventId],
    );
    expect(receipts.rowCount).toBe(1);
  });

  it('sửa câu đã nhập ở trung tâm: thành bản phái sinh, phiên bản nguyên trạng còn nguyên', async () => {
    const created = await publish('Câu để sửa ở trung tâm');
    const imported = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: created.question.id,
    });
    expect(imported.status).toBe(201);
    const centreQuestionId = imported.body.question.question.id as string;
    const updated = await http(app).patch(`/api/v1/questions/${centreQuestionId}`).set(bearer(teacher.token)).send({
      questionText: doc('Câu đã sửa ở trung tâm'),
    });
    expect(updated.status).toBe(200);
    const versions = await http(app).get(`/api/v1/questions/${centreQuestionId}/versions`).set(bearer(teacher.token));
    expect(versions.status).toBe(200);
    const versionNumbers = (versions.body as { version: number }[]).map((row) => row.version);
    expect(versionNumbers).toEqual(expect.arrayContaining([1, 2]));
    const v1 = await http(app).get(`/api/v1/questions/${centreQuestionId}`).set(bearer(teacher.token));
    expect(v1.body.latestVersion.version).toBe(2);
    const rows = await pg.query(
      `SELECT kind, imported_version_number FROM system_question_imports WHERE question_id = $1`,
      [centreQuestionId],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.kind).toBe('derived');
    expect(rows.rows[0]!.imported_version_number).toBe(1);
  });

  it('đọc nội dung gói qua cổng người xem: học sinh bị từ chối ở cả 3 route đọc, giáo viên đọc được', async () => {
    const created = await publish('Câu để kiểm cổng người xem');
    const questionId = created.question.id;
    for (const path of [
      `/api/v1/system-bank/questions/${questionId}`,
      `/api/v1/system-bank/questions/${questionId}/versions`,
      `/api/v1/system-bank/questions/${questionId}/versions/1`,
    ]) {
      const denied = await http(app).get(path).set(bearer(student.token));
      expect(denied.status).toBe(404);
      expect((denied.body as { code?: string }).code).toBe('system_bank.question_not_found');
    }
    const read = await http(app).get(`/api/v1/system-bank/questions/${questionId}/versions/1`).set(bearer(teacher.token));
    expect(read.status).toBe(200);
    expect(read.body.package.questionText).toMatchObject(doc('Câu để kiểm cổng người xem'));
  });

  it('trung tâm liệt kê được sự kiện rút chưa ghi nhận qua API mà không cần biết trước id, ghi nhận xong thì hết', async () => {
    const created = await publish('Câu rút để giao thông báo qua API');
    const questionId = created.question.id;
    const imported = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: questionId,
    });
    expect(imported.status).toBe(201);
    const before = await http(app).get('/api/v1/system-bank/events/pending').set(bearer(teacher.token));
    expect(before.status).toBe(200);
    expect(
      (before.body as { sourceQuestionId: string }[]).find((event) => event.sourceQuestionId === questionId),
    ).toBeUndefined();
    const withdrawn = await http(app).post(`/api/v1/system-bank/questions/${questionId}/withdraw`).set(bearer(admin)).send({
      reason: 'Nội dung lỗi thời',
    });
    expect(withdrawn.status).toBe(201);
    const pending = await http(app).get('/api/v1/system-bank/events/pending').set(bearer(teacher.token));
    expect(pending.status).toBe(200);
    const mine = (pending.body as { id: string; type: string; sourceQuestionId: string }[])
      .filter((event) => event.sourceQuestionId === questionId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.type).toBe('question_withdrawn');
    const ack = await http(app).post(`/api/v1/system-bank/events/${mine[0]!.id}/acknowledge`).set(bearer(teacher.token)).send();
    expect(ack.status).toBe(201);
    const after = await http(app).get('/api/v1/system-bank/events/pending').set(bearer(teacher.token));
    expect(
      (after.body as { sourceQuestionId: string }[]).find((event) => event.sourceQuestionId === questionId),
    ).toBeUndefined();
  });

  it('sự kiện rút câu chỉ người có question:useall mới xem và ghi nhận được: học sinh bị từ chối ở cả hai route, ghi nhận hụt không để lại vết, giáo viên ghi nhận xong thì hết', async () => {
    const created = await publish('Câu rút để kiểm cổng sự kiện');
    const questionId = created.question.id;
    const imported = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: questionId,
    });
    expect(imported.status).toBe(201);
    const withdrawn = await http(app).post(`/api/v1/system-bank/questions/${questionId}/withdraw`).set(bearer(admin)).send({
      reason: 'Nội dung lỗi thời',
    });
    expect(withdrawn.status).toBe(201);
    const events = await bankPg.query(
      `SELECT id FROM system_bank_events WHERE source_question_id = $1 AND type = 'question_withdrawn'`,
      [questionId],
    );
    expect(events.rowCount).toBe(1);
    const eventId = events.rows[0]!.id as string;
    const deniedList = await http(app).get('/api/v1/system-bank/events/pending').set(bearer(student.token));
    expect(deniedList.status).toBe(403);
    expect((deniedList.body as { code?: string }).code).toBe('access.capability_denied');
    const deniedAck = await http(app).post(`/api/v1/system-bank/events/${eventId}/acknowledge`).set(bearer(student.token)).send();
    expect(deniedAck.status).toBe(403);
    expect((deniedAck.body as { code?: string }).code).toBe('access.capability_denied');
    const receipts = await pg.query(`SELECT id FROM system_bank_event_receipts WHERE event_id = $1`, [eventId]);
    expect(receipts.rowCount).toBe(0);
    const pending = await http(app).get('/api/v1/system-bank/events/pending').set(bearer(teacher.token));
    expect(pending.status).toBe(200);
    expect((pending.body as { id: string }[]).find((event) => event.id === eventId)).toBeDefined();
    const ack = await http(app).post(`/api/v1/system-bank/events/${eventId}/acknowledge`).set(bearer(teacher.token)).send();
    expect(ack.status).toBe(201);
    const after = await http(app).get('/api/v1/system-bank/events/pending').set(bearer(teacher.token));
    expect((after.body as { id: string }[]).find((event) => event.id === eventId)).toBeUndefined();
  });

  it('nhập bị từ chối ở cổng quyền question:add thì không để lại dòng importer ở kho ngân hàng và không có dòng nhập ở kho trung tâm', async () => {
    const created = await publish('Câu để kiểm thứ tự cổng quyền');
    const questionId = created.question.id;
    const teacherRoleId = await roleIdByShortname(app, admin, 'teacher');
    const systemId = await systemContextId(app, admin);
    await setOverride(app, admin, teacherRoleId, 'question:add', systemId, -1000);
    try {
      const denied = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
        sourceQuestionId: questionId,
      });
      expect(denied.status).toBe(403);
      expect((denied.body as { code?: string }).code).toBe('access.capability_denied');
    } finally {
      await setOverride(app, admin, teacherRoleId, 'question:add', systemId, 0);
    }
    const importers = await bankPg.query(
      `SELECT id FROM system_question_importers WHERE source_question_id = $1`,
      [questionId],
    );
    expect(importers.rowCount).toBe(0);
    const importRows = await pg.query(
      `SELECT question_id FROM system_question_imports WHERE source_question_id = $1`,
      [questionId],
    );
    expect(importRows.rowCount).toBe(0);
    const imported = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: questionId,
    });
    expect(imported.status).toBe(201);
    const importersAfter = await bankPg.query(
      `SELECT id FROM system_question_importers WHERE source_question_id = $1`,
      [questionId],
    );
    expect(importersAfter.rowCount).toBe(1);
  });

  it('nhập câu lỗi lúc ghi dấu vết trung tâm phải rollback câu và không xác nhận importer', async () => {
    const created = await publish('Câu kiểm chứng xác nhận nhập hoàn tất');
    const questionId = created.question.id as string;
    const before = (await pg.query<{ count: string }>('SELECT count(*) FROM question')).rows[0]!.count;
    await pg.query('ALTER TABLE system_question_imports ADD CONSTRAINT reject_import_receipt_test CHECK (false) NOT VALID');
    try {
      const failed = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token))
        .send({ sourceQuestionId: questionId });
      expect(failed.status).toBeGreaterThanOrEqual(400);
      expect((await pg.query<{ count: string }>('SELECT count(*) FROM question')).rows[0]!.count).toBe(before);
      expect((await pg.query('SELECT question_id FROM system_question_imports WHERE source_question_id = $1',
        [questionId])).rowCount).toBe(0);
      expect((await bankPg.query('SELECT id FROM system_question_importers WHERE source_question_id = $1',
        [questionId])).rowCount).toBe(0);
    } finally {
      await pg.query('ALTER TABLE system_question_imports DROP CONSTRAINT reject_import_receipt_test');
    }
    const completed = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token))
      .send({ sourceQuestionId: questionId });
    expect(completed.status, JSON.stringify(completed.body)).toBe(201);
    expect((await bankPg.query('SELECT id FROM system_question_importers WHERE source_question_id = $1',
      [questionId])).rowCount).toBe(1);
  });

  it('nhập câu có ảnh rồi lỗi ghi receipt: xóa metadata và object mới nhưng nhập lại thành công', async () => {
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const bytes = Buffer.concat([
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
      Buffer.from(randomUUID()),
    ]);
    const hash = sha256Hex(bytes);
    await storage.put(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(hash), bytes);
    const base = multichoicePackage('Câu nhập media rollback');
    const pkg = {
      ...base,
      questionText: { ...base.questionText, content: [
        ...base.questionText.content,
        { type: 'image', attrs: { src: `bank-media://${hash}`, alt: 'Ảnh kiểm tra rollback' } },
      ] },
      media: [{ contentHash: hash, fileName: 'rollback.png', mimeType: 'image/png' }],
    };
    const published = await http(app).post('/api/v1/system-bank/questions').set(bearer(admin))
      .send({ qtype: 'multichoice', package: pkg });
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    const sourceQuestionId = published.body.question.id as string;
    expect((await pg.query('SELECT id FROM files WHERE content_hash = $1', [hash])).rowCount).toBe(0);
    await pg.query('ALTER TABLE system_question_imports ADD CONSTRAINT reject_media_import_receipt_test CHECK (false) NOT VALID');
    try {
      const failed = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token))
        .send({ sourceQuestionId });
      expect(failed.status).toBeGreaterThanOrEqual(400);
      expect((await pg.query('SELECT id FROM files WHERE content_hash = $1', [hash])).rowCount).toBe(0);
      expect(await storage.exists(SYSTEM_FILE_DOMAIN, hash)).toBe(false);
      expect(await storage.exists(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(hash))).toBe(true);
      expect((await pg.query('SELECT question_id FROM system_question_imports WHERE source_question_id = $1',
        [sourceQuestionId])).rowCount).toBe(0);
    } finally {
      await pg.query('ALTER TABLE system_question_imports DROP CONSTRAINT reject_media_import_receipt_test');
    }
    const recovered = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token))
      .send({ sourceQuestionId });
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(201);
    expect((await pg.query('SELECT id FROM files WHERE content_hash = $1', [hash])).rowCount).toBe(1);
    expect(await storage.exists(SYSTEM_FILE_DOMAIN, hash)).toBe(true);
  });

  it('xác nhận ngân hàng lỗi sau commit trung tâm: retry không nhân bản, thông báo và đọc nguồn đã rút vẫn đúng', async () => {
    const created = await publish('Câu kiểm chứng xác nhận sau commit');
    const sourceQuestionId = created.question.id as string;
    const request = { sourceQuestionId, sourceVersionNumber: 1 };
    await bankPg.query('ALTER TABLE system_question_importers ADD CONSTRAINT reject_importer_confirmation_test CHECK (false) NOT VALID');
    let localQuestionId: string;
    try {
      const first = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send(request);
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      localQuestionId = first.body.question.question.id;
      expect((await bankPg.query('SELECT id FROM system_question_importers WHERE source_question_id = $1',
        [sourceQuestionId])).rowCount).toBe(0);
      const retry = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send(request);
      expect(retry.status, JSON.stringify(retry.body)).toBe(201);
      expect(retry.body.question.question.id).toBe(localQuestionId);
      expect((await pg.query('SELECT question_id FROM system_question_imports WHERE source_question_id = $1',
        [sourceQuestionId])).rowCount).toBe(1);
      const version = await http(app).post(`/api/v1/system-bank/questions/${sourceQuestionId}/versions`)
        .set(bearer(admin)).send({ package: multichoicePackage('Nguồn có bản mới') });
      expect(version.status).toBe(201);
      const pending = await http(app).get('/api/v1/system-bank/events/pending').set(bearer(teacher.token));
      expect(pending.status, JSON.stringify(pending.body)).toBe(200);
      expect(pending.body).toEqual(expect.arrayContaining([expect.objectContaining({
        sourceQuestionId, type: 'question_version_published', payload: expect.objectContaining({ versionNumber: 2 }),
      })]));
      const withdrawn = await http(app).post(`/api/v1/system-bank/questions/${sourceQuestionId}/withdraw`)
        .set(bearer(admin)).send({ reason: 'Thử phục hồi xác nhận' });
      expect(withdrawn.status).toBe(201);
      const read = await http(app).get(`/api/v1/system-bank/questions/${sourceQuestionId}/versions/1`)
        .set(bearer(teacher.token));
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect((await http(app).get('/api/v1/system-bank/events/pending').set(bearer(teacher.token))).body)
        .toEqual(expect.arrayContaining([expect.objectContaining({ sourceQuestionId, type: 'question_withdrawn' })]));
    } finally {
      await bankPg.query('ALTER TABLE system_question_importers DROP CONSTRAINT reject_importer_confirmation_test');
    }
    const afterRecovery = await http(app).get('/api/v1/system-bank/events/pending').set(bearer(teacher.token));
    expect(afterRecovery.status).toBe(200);
    expect((await bankPg.query('SELECT id FROM system_question_importers WHERE source_question_id = $1',
      [sourceQuestionId])).rowCount).toBe(1);
    expect((await pg.query('SELECT question_id FROM system_question_imports WHERE source_question_id = $1',
      [sourceQuestionId])).rows[0]?.question_id).toBe(localQuestionId!);
    await pg.query('DELETE FROM system_question_imports WHERE question_id = $1', [localQuestionId!]);
    const historicalRead = await http(app).get(`/api/v1/system-bank/questions/${sourceQuestionId}/versions/1`)
      .set(bearer(teacher.token));
    expect(historicalRead.status).toBe(404);
    expect(historicalRead.body.code).toBe('system_bank.version_not_found');
    const historicalEvents = await http(app).get('/api/v1/system-bank/events/pending').set(bearer(teacher.token));
    expect(historicalEvents.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceQuestionId, type: 'question_withdrawn' }),
    ]));
  });

  it('issue #13: giáo viên soạn riêng; quản trị gửi, biên tập duyệt/từ chối; B nhập sau khi A xoá nguồn và media', async () => {
    const tenantA = await seedLegacyCentreInShared({ name: uniqueName('Trung tâm gửi G13'), slug: uniqueName('g13-a').toLowerCase() });
    const tenantB = await seedLegacyCentreInShared({ name: uniqueName('Trung tâm nhận G13'), slug: uniqueName('g13-b').toLowerCase() });
    await tenantAls.run({ platform: true }, async () => {
      const contexts = app.get(ContextsService);
      await contexts.ensureTenantContext(tenantA);
      await contexts.ensureTenantContext(tenantB);
    });
    const [managerA, teacherA, teacherB, editor, studentB] = await Promise.all(
      Array.from({ length: 5 }, () => createUserViaApi(app, admin)),
    );
    const systemId = await systemContextId(app, admin);
    const teacherRole = await roleIdByShortname(app, admin, 'editingteacher');
    const managerRole = await roleIdByShortname(app, admin, 'manager');
    const studentRole = await roleIdByShortname(app, admin, 'student');
    await assignRole(app, admin, teacherA.id, teacherRole, systemId);
    await assignRole(app, admin, teacherB.id, teacherRole, systemId);
    await assignRole(app, admin, studentB.id, studentRole, systemId);
    for (const id of [managerA.id, teacherA.id]) await seedTenantMembershipFixture(app, tenantA, id);
    for (const id of [teacherB.id, studentB.id]) await seedTenantMembershipFixture(app, tenantB, id);
    const contexts = app.get(ContextsService);
    const managerContext = await tenantAls.run({ platform: true }, () => contexts.ensureTenantContext(tenantA));
    await tenantAls.run({ platform: true }, () => app.get(RolesService).assignRole(managerA.id, managerRole, managerContext.id));

    const editorRole = await createRoleViaApi(app, admin);
    await setOverride(app, admin, editorRole, 'systembank:review', systemId, 1);
    await assignRole(app, admin, editor.id, editorRole, systemId);

    const switchTo = async (user: { username: string }, tenantId: string): Promise<string> => {
      const root = await login(app, user.username, STRONG_PASSWORD);
      const res = await http(app).post(`/api/v1/auth/switch-tenant/${tenantId}`).set(bearer(root.accessToken));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.accessToken as string;
    };
    const managerToken = await switchTo(managerA, tenantA);
    const teacherAToken = await switchTo(teacherA, tenantA);
    const teacherBToken = await switchTo(teacherB, tenantB);
    const studentToken = await switchTo(studentB, tenantB);
    const editorToken = (await login(app, editor.username, STRONG_PASSWORD)).accessToken;

    const banks = await http(app).get('/api/v1/question-banks').set(bearer(teacherAToken));
    expect(banks.status, JSON.stringify(banks.body)).toBe(200);
    const personal = (banks.body as Array<{
      id: string; scope: string; ownerId: string; defaultCategoryId: string; contextId: string;
    }>).find((b) => b.scope === 'personal' && b.ownerId === teacherA.id)!;
    expect(personal?.defaultCategoryId).toBeTruthy();

    const created = await http(app).post('/api/v1/questions').set(bearer(teacherAToken)).send({
      categoryId: personal.defaultCategoryId, qtype: 'multichoice',
      questionText: 'Câu G13 chỉ thuộc trung tâm A',
      answers: [
        { text: 'Đáp án đúng G13', correct: true },
        { text: 'Sai một', correct: false },
        { text: 'Sai hai', correct: false },
        { text: 'Sai ba', correct: false },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const sourceId = created.body.question.id as string;
    const ready = await http(app).post(`/api/v1/questions/${sourceId}/status`).set(bearer(teacherAToken))
      .send({ status: 'ready' });
    expect(ready.status, JSON.stringify(ready.body)).toBe(201);

    const submitPath = '/api/v1/system-bank/submissions';
    const sources = await http(app).get(`${submitPath}/sources`).set(bearer(managerToken));
    expect(sources.status, JSON.stringify(sources.body)).toBe(200);
    expect(sources.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sourceId, qtype: 'multichoice', version: 1 }),
    ]));
    expect(JSON.stringify(sources.body)).not.toContain('Đáp án đúng G13');
    for (const token of [teacherAToken, teacherBToken, studentToken]) {
      expect((await http(app).get(`${submitPath}/sources`).set(bearer(token))).status).toBe(403);
    }
    const teacherSubmit = await http(app).post(submitPath).set(bearer(teacherAToken)).send({ questionId: sourceId });
    expect(teacherSubmit.status).toBe(403);
    const managerSubmit = await http(app).post(submitPath).set(bearer(managerToken))
      .send({ questionId: sourceId, license: 'CC BY 4.0' });
    expect(managerSubmit.status, JSON.stringify(managerSubmit.body)).toBe(201);
    expect(managerSubmit.body.status).toBe('pending');
    const rejectedId = managerSubmit.body.id as string;
    const retrySubmit = await http(app).post(submitPath).set(bearer(managerToken))
      .send({ questionId: sourceId, license: 'CC BY 4.0' });
    expect(retrySubmit.status).toBe(201);
    expect(retrySubmit.body.id).toBe(rejectedId);

    for (const token of [teacherAToken, managerToken, studentToken]) {
      const forbidden = await http(app).get(`${submitPath}/pending`).set(bearer(token));
      expect(forbidden.status).toBe(403);
      const forbiddenReview = await http(app).get(`${submitPath}/${rejectedId}`).set(bearer(token));
      expect(forbiddenReview.status).toBe(403);
    }
    const review = await http(app).get(`${submitPath}/${rejectedId}`).set(bearer(editorToken));
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    expect(review.body.package.source.license).toBe('CC BY 4.0');
    expect(review.body.package.answers).toHaveLength(4);
    const managerApprove = await http(app).post(`${submitPath}/${rejectedId}/approve`).set(bearer(managerToken));
    expect(managerApprove.status).toBe(403);
    const before = await http(app).get('/api/v1/system-bank/discovery?qtype=multichoice&limit=100').set(bearer(teacherBToken));
    expect(before.status).toBe(200);
    const beforeIds = (before.body.items as { id: string }[]).map((item) => item.id);
    expect(beforeIds).not.toContain(sourceId);
    const rejected = await http(app).post(`${submitPath}/${rejectedId}/reject`).set(bearer(editorToken))
      .send({ reason: 'Cần kiểm tra lời giải' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(201);
    expect(rejected.body.status).toBe('rejected');
    expect(rejected.body.rejectionReason).toBe('Cần kiểm tra lời giải');
    expect((await http(app).get(`${submitPath}/mine`).set(bearer(managerToken))).body[0].status).toBe('rejected');
    const rejectedRetry = await http(app).post(submitPath).set(bearer(managerToken))
      .send({ questionId: sourceId, license: 'CC BY 4.1' });
    expect(rejectedRetry.status).toBe(409);
    expect(rejectedRetry.body.code).toBe('system_bank.submission_rejected_requires_new_version');
    expect((await http(app).get(`${submitPath}/mine`).set(bearer(managerToken))).body
      .filter((row: { sourceQuestionId: string }) => row.sourceQuestionId === sourceId)).toHaveLength(1);

    const image = Buffer.concat([
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
      Buffer.from(uniqueName('-g13-source-image')),
    ]);
    const uploaded = await http(app).post('/api/v1/files/question-image').set(bearer(teacherAToken))
      .field('contextId', personal.contextId).field('fileArea', 'questiontext')
      .attach('file', image, 'so-do-g13.png');
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const fileId = (uploaded.body.file?.id ?? uploaded.body.id) as string;
    expect(fileId).toBeTruthy();
    const withImage = doc('Câu G13 có ảnh ở phiên bản mới');
    (withImage.content as Array<unknown>).push({
      type: 'image', attrs: { src: `/api/v1/files/${fileId}/content`, alt: 'Sơ đồ nguồn' },
    });
    const updated = await http(app).patch(`/api/v1/questions/${sourceId}`).set(bearer(teacherAToken))
      .send({ questionText: withImage });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const status2 = await http(app).post(`/api/v1/questions/${sourceId}/status`).set(bearer(teacherAToken))
      .send({ status: 'ready' });
    expect([200, 201]).toContain(status2.status);
    const secondSubmit = await http(app).post(submitPath).set(bearer(managerToken))
      .send({ questionId: sourceId, license: 'CC BY 4.0' });
    expect(secondSubmit.status, JSON.stringify(secondSubmit.body)).toBe(201);
    expect(secondSubmit.body.id).not.toBe(rejectedId);
    expect(secondSubmit.body.package.media).toHaveLength(1);
    const hash = secondSubmit.body.package.media[0].contentHash as string;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(secondSubmit.body.package.questionText)).toContain('bank-media://');
    const reviewImagePath = `${submitPath}/${secondSubmit.body.id}/media/${hash}`;
    for (const token of [teacherAToken, managerToken, teacherBToken, studentToken]) {
      expect((await http(app).get(reviewImagePath).set(bearer(token))).status).toBe(403);
    }
    const reviewedImage = await http(app).get(reviewImagePath).set(bearer(editorToken));
    expect(reviewedImage.status).toBe(200);
    expect(reviewedImage.headers['content-type']).toMatch(/image\/png/);
    expect(reviewedImage.headers['cache-control']).toBe('private, no-store');
    expect(reviewedImage.body).toEqual(image);
    const missingImage = await http(app).get(`${submitPath}/${secondSubmit.body.id}/media/${'0'.repeat(64)}`)
      .set(bearer(editorToken));
    expect(missingImage.status).toBe(400);
    const approved = await http(app).post(`${submitPath}/${secondSubmit.body.id}/approve`)
      .set(bearer(editorToken)).send({});
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    const publishedId = approved.body.publishedQuestionId as string;
    expect(publishedId).toBeTruthy();
    expect(approved.body.publishedVersion).toBe(1);
    const approvedRetry = await http(app).post(`${submitPath}/${secondSubmit.body.id}/approve`)
      .set(bearer(editorToken)).send({});
    expect(approvedRetry.body.publishedVersion).toBe(1);
    const after = await http(app).get('/api/v1/system-bank/discovery?qtype=multichoice&limit=100').set(bearer(teacherBToken));
    expect(after.status).toBe(200);
    expect((after.body.items as { id: string }[]).some((row) => row.id === publishedId)).toBe(true);
    for (const path of [`/api/v1/system-bank/questions/${publishedId}`,
      `/api/v1/system-bank/questions/${publishedId}/versions/1`]) {
      expect((await http(app).get(path).set(bearer(studentToken))).status).toBe(404);
    }
    const v1 = await http(app).get(`/api/v1/system-bank/questions/${publishedId}/versions/1`).set(bearer(teacherBToken));
    expect(v1.status).toBe(200);
    expect(v1.body.package.source.license).toBe('CC BY 4.0');
    expect(v1.body.package.media[0].contentHash).toBe(hash);

    const storage = app.get<ObjectStorage>(OBJECT_STORAGE, { strict: false });
    const publicationKey = publicationMediaStorageKey(hash);
    expect(publicationKey).not.toBe(hash);
    expect(await storage.exists(SYSTEM_FILE_DOMAIN, publicationKey)).toBe(true);
    const deletedImage = await http(app).delete(`/api/v1/files/${fileId}`).set(bearer(teacherAToken));
    expect([200, 204]).toContain(deletedImage.status);
    await tenantAls.run({ tenantId: tenantA, userId: teacherA.id }, () =>
      app.get(FilesService).cleanupOrphan(hash, SYSTEM_FILE_DOMAIN));
    expect(await storage.exists(SYSTEM_FILE_DOMAIN, publicationKey)).toBe(true);
    const preservedPreview = await http(app).get(reviewImagePath).set(bearer(editorToken));
    expect(preservedPreview.status).toBe(200);
    expect(preservedPreview.body).toEqual(image);

    const imported = await http(app).post('/api/v1/system-bank/import').set(bearer(teacherBToken))
      .send({ sourceQuestionId: publishedId, sourceVersionNumber: 1 });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const importId = imported.body.question.question.id as string;
    const importedView = await http(app).get(`/api/v1/questions/${importId}`).set(bearer(teacherBToken));
    expect(importedView.status).toBe(200);
    expect(JSON.stringify(importedView.body.latestVersion.questionText)).toContain('/api/v1/files/');
    expect(JSON.stringify(importedView.body.latestVersion.questionText)).not.toContain('bank-media://');

    const v3Source = await http(app).patch(`/api/v1/questions/${sourceId}`).set(bearer(teacherAToken))
      .send({ questionText: 'Câu G13 sửa sau khi đã công bố' });
    expect(v3Source.status, JSON.stringify(v3Source.body)).toBe(200);
    const thirdSubmit = await http(app).post(submitPath).set(bearer(managerToken)).send({ questionId: sourceId });
    expect(thirdSubmit.status, JSON.stringify(thirdSubmit.body)).toBe(201);
    const thirdApproval = await http(app).post(`${submitPath}/${thirdSubmit.body.id}/approve`)
      .set(bearer(editorToken)).send({});
    expect(thirdApproval.status, JSON.stringify(thirdApproval.body)).toBe(201);
    expect(thirdApproval.body.publishedQuestionId).toBe(publishedId);
    expect(thirdApproval.body.publishedVersion).toBe(2);
    const originalAgain = await http(app).get(`/api/v1/system-bank/questions/${publishedId}/versions/1`)
      .set(bearer(teacherBToken));
    expect(originalAgain.status).toBe(200);
    expect(originalAgain.body.checksum).toBe(v1.body.checksum);
    expect(originalAgain.body.package).toEqual(v1.body.package);
    const sourceRemoved = await http(app).delete(`/api/v1/questions/${sourceId}`).set(bearer(teacherAToken));
    expect([200, 204]).toContain(sourceRemoved.status);
    const afterSourceGone = await http(app).get(`/api/v1/system-bank/questions/${publishedId}/versions/1`)
      .set(bearer(teacherBToken));
    expect(afterSourceGone.status).toBe(200);
    expect(afterSourceGone.body.package).toEqual(v1.body.package);

    const additionalTypes: Array<{ qtype: string; questionText: unknown; answers?: unknown[]; solution?: unknown; options?: unknown }> = [
      {
        qtype: 'truefalse',
        questionText: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Đánh giá các mệnh đề G13' }] },
            { type: 'statementList', content: [1, 2, 3, 4].map((n) => ({
              type: 'statement', attrs: { id: `g13-s${n}` },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: `Mệnh đề ${n}` }] }],
            })) },
          ],
        },
        solution: { answers: [1, 2, 3, 4].map((n) => ({ statementId: `g13-s${n}`, value: n % 2 === 0 })) },
      },
      {
        qtype: 'shortanswer', questionText: 'Câu G13 trả lời ngắn',
        answers: [{ text: 'Hà Nội', correct: true }, { text: 'Ha Noi', correct: true }],
        options: { useCase: false },
      },
      {
        qtype: 'essay', questionText: 'Câu G13 tự luận',
        solution: { answer: 'Phân tích theo ba luận điểm.' },
        options: {
          responseFormat: 'editor', responseRequired: true, minWordLimit: 5, maxWordLimit: 300,
          graderInfo: 'Hướng dẫn chấm theo ba ý chính',
          responseTemplate: 'Mở bài - Thân bài - Kết luận',
        },
      },
    ];
    for (const payload of additionalTypes) {
      const createdType = await http(app).post('/api/v1/questions').set(bearer(teacherAToken))
        .send({ categoryId: personal.defaultCategoryId, ...payload });
      expect(createdType.status, `${payload.qtype}: ${JSON.stringify(createdType.body)}`).toBe(201);
      const questionTypeId = createdType.body.question.id as string;
      const readyType = await http(app).post(`/api/v1/questions/${questionTypeId}/status`)
        .set(bearer(teacherAToken)).send({ status: 'ready' });
      expect([200, 201]).toContain(readyType.status);
      const submittedType = await http(app).post(submitPath).set(bearer(managerToken))
        .send({ questionId: questionTypeId, license: 'Tác giả cho phép sử dụng' });
      expect(submittedType.status, `${payload.qtype}: ${JSON.stringify(submittedType.body)}`).toBe(201);
      const approvedType = await http(app).post(`${submitPath}/${submittedType.body.id}/approve`)
        .set(bearer(editorToken)).send({});
      expect(approvedType.status, `${payload.qtype}: ${JSON.stringify(approvedType.body)}`).toBe(201);
      const publishedTypeId = approvedType.body.publishedQuestionId as string;
      const readType = await http(app).get(`/api/v1/system-bank/questions/${publishedTypeId}/versions/1`)
        .set(bearer(teacherBToken));
      expect(readType.status).toBe(200);
      expect(readType.body.package.source.license).toBe('Tác giả cho phép sử dụng');
      const importedType = await http(app).post('/api/v1/system-bank/import').set(bearer(teacherBToken))
        .send({ sourceQuestionId: publishedTypeId, sourceVersionNumber: 1 });
      expect(importedType.status, `${payload.qtype}: ${JSON.stringify(importedType.body)}`).toBe(201);
      const copiedType = await http(app).get(`/api/v1/questions/${importedType.body.question.question.id}`)
        .set(bearer(teacherBToken));
      expect(copiedType.status).toBe(200);
      expect(copiedType.body.question.qtype).toBe(payload.qtype);
      expect(copiedType.body.options).toEqual(createdType.body.options);
      expect(copiedType.body.answerKey).toEqual(createdType.body.answerKey);
    }
  }, 180_000);

  it('HTTP gói chương trình: chỉ bản duyệt được khám phá; biên tập viên xem nội dung và duyệt công bố', async () => {
    const version = '2026.11.13.17-http';
    const curriculumId = randomUUID();
    const nodeId = randomUUID();
    const outcomeId = randomUUID();
    const text = doc('Yêu cầu cần đạt của chương trình chờ duyệt');
    const items = {
      curricula: [{ curriculumId, subjectSlug: 'toan', subjectName: 'Toán', subjectPosition: 1, grade: 6 }],
      nodes: [{ nodeId, curriculumId, parentId: null, title: 'Số tự nhiên',
        kind: 'topic', position: 1, durationPeriods: null, durationPercent: null }],
      outcomes: [{ outcomeId, nodeId, position: 1,
        content: text, sourceKind: 'program', sourceRef: 'CTGDPT 2018' }],
      mappings: [],
    };
    const checksum = programmePackageChecksum(items as never);
    const packageRow = await bankPg.query<{ id: string }>(
      `INSERT INTO system_outcome_packages
        (version, scope, checksum, outcome_count, status, centre_slug)
       VALUES ($1, 'toan', $2, 1, 'pending', 'trung-tam-a')
       RETURNING id`,
      [version, checksum],
    );
    const packageId = packageRow.rows[0]!.id;
    await bankPg.query(
      `INSERT INTO system_outcome_package_curricula
        (package_id, curriculum_id, subject_slug, subject_name, subject_position, grade)
        VALUES ($1, $2, 'toan', 'Toán', 1, 6)`,
      [packageId, curriculumId],
    );
    await bankPg.query(
      `INSERT INTO system_outcome_package_nodes
        (package_id, node_id, curriculum_id, parent_id, title, kind, position,
         duration_periods, duration_percent)
        VALUES ($1, $2, $3, NULL, 'Số tự nhiên', 'topic', 1, NULL, NULL)`,
      [packageId, nodeId, curriculumId],
    );
    await bankPg.query(
      `INSERT INTO system_outcome_package_outcomes
        (package_id, outcome_id, node_id, position, content, source_kind, source_ref)
        VALUES ($1, $2, $3, 1, $4::jsonb, 'program', 'CTGDPT 2018')`,
      [packageId, outcomeId, nodeId, JSON.stringify(text)],
    );

    const base = '/api/v1/system-bank/outcome-packages';
    const visibleBefore = await http(app).get(base).set(bearer(teacher.token));
    expect(visibleBefore.status).toBe(200);
    expect((visibleBefore.body as Array<{ version: string }>).some((row) => row.version === version)).toBe(false);
    const hiddenBefore = await http(app).get(`${base}/${version}`).set(bearer(teacher.token));
    expect(hiddenBefore.status).toBe(404);
    const forbiddenReview = await http(app).post(`${base}/${version}/approve`).set(bearer(student.token)).send({});
    expect(forbiddenReview.status).toBe(403);

    const queue = await http(app).get(`${base}/pending`).set(bearer(admin));
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    expect((queue.body as Array<{ version: string }>).map((row) => row.version)).toContain(version);
    const preview = await http(app).get(`${base}/review/${version}`).set(bearer(admin));
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.outcomes[0].content).toMatchObject(text);
    const approval = await http(app).post(`${base}/${version}/approve`).set(bearer(admin)).send({});
    expect(approval.status, JSON.stringify(approval.body)).toBe(201);
    expect(approval.body).toMatchObject({ status: 'published', version, checksum });
    const visibleAfter = await http(app).get(base).set(bearer(teacher.token));
    expect((visibleAfter.body as Array<{ version: string }>).map((row) => row.version)).toContain(version);
    const published = await http(app).get(`${base}/${version}`).set(bearer(teacher.token));
    expect(published.status).toBe(200);
    expect(published.body.package.checksum).toBe(checksum);
    expect(published.body.outcomes[0].content).toMatchObject(text);
  });

  it('bank-off: app không cấu hình kho ngân hàng vẫn đọc câu đã nhập và tạo đề từ câu đó', async () => {
    const created = await publish('Câu cho bank-off');
    const imported = await http(app).post('/api/v1/system-bank/import').set(bearer(teacher.token)).send({
      sourceQuestionId: created.question.id,
    });
    expect(imported.status).toBe(201);
    const centreQuestionId = imported.body.question.question.id as string;
    delete process.env.SYSTEM_BANK_DATABASE_URL;
    appNoBank = await createTestApp();
    const read = await http(appNoBank).get(`/api/v1/questions/${centreQuestionId}`).set(bearer(teacher.token));
    expect(read.status).toBe(200);
    expect(read.body.latestVersion.questionText).toMatchObject(doc('Câu cho bank-off'));
    const draft = await createExamDraft(appNoBank, teacher.token, `Đề bank-off ${uniqueName('')}`);
    const slots = await addExamSlot(appNoBank, teacher.token, draft, { questionId: centreQuestionId });
    expect(slots.slots).toHaveLength(1);
    expect(slots.slots[0]!.questionId).toBe(centreQuestionId);
  });
});
