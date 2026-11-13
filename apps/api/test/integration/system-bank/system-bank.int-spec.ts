import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { createCentreKysely, type CentreDb } from '@giaokhoa/db';
import { createSystemBankKysely, type SystemBankDb } from '@giaokhoa/db/system-bank';
import { SystemBankCentreRepository } from '@giaokhoa/db/repositories/system-bank-centre';
import { SystemBankRepository } from '@giaokhoa/db/repositories/system-bank';
import { tenantAls } from '../../../src/modules/tenants/tenant-als';
import { SystemBankConnection } from '../../../src/modules/system-bank/system-bank.connection';
import { checksumPackage } from '../../../src/modules/system-bank/system-bank-package';
import { SystemBankService } from '../../../src/modules/system-bank/system-bank.service';

const BANK_DATABASE = 'giaokhoa_test_bank_585';
const BANK_ROLE = 'giaokhoa_bank_test_585';
const BANK_PASSWORD = 'bank585test';
const CENTRE_DATABASE = 'giaokhoa_test_centre_585';
const CENTRE_ROLE = 'giaokhoa_centre_test_585';
const CENTRE_PASSWORD = 'centre585test';
const ADMIN_ID = '01958500-0000-7000-8000-000000000001';
const SYSTEM_ID = '01958500-0000-7000-8000-000000000002';
const SUBJECT_ID = '01958500-0000-7000-8000-000000000010';
const CURRICULUM_ID = '01958500-0000-7000-8000-000000000011';
const NODE_ID = '01958500-0000-7000-8000-000000000012';
const OUTCOME_ID = '01958500-0000-7000-8000-000000000013';
const REVISED_OUTCOME_ID = '01958500-0000-7000-8000-000000000014';
const SUBJECT_SLUG = 'toan-585';

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

function doc(text: string): {
  type: 'doc';
  content: Array<{ type: string; content: Array<{ type: string; text: string }> }>;
} {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

describe('Kho ngân hàng hệ thống (issue #585)', () => {
  let bankPool: Pool;
  let centrePool: Pool;
  let centreKysely: CentreDb;
  let bankConnection: SystemBankConnection;
  let service: SystemBankService;
  let bankDb: SystemBankDb;
  let centreDb: CentreDb;

  beforeAll(async () => {
    const adminUrl = clusterUrl('postgres');
    for (const [database, role, password] of [
      [BANK_DATABASE, BANK_ROLE, BANK_PASSWORD],
      [CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD],
    ] as const) {
      await withClient(adminUrl, async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
        await client.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
        await client.query(`CREATE ROLE ${quoted(role)} LOGIN PASSWORD '${password}'`);
        await client.query(`CREATE DATABASE ${quoted(database)} OWNER ${quoted(role)}`);
        await client.query(`REVOKE CONNECT ON DATABASE ${quoted(database)} FROM PUBLIC`);
        await client.query(`GRANT CONNECT ON DATABASE ${quoted(database)} TO ${quoted(role)}`);
      });
    }
    const bankMigrationDirs = readdirSync(join(__dirname, '../../../../../packages/db/migrations/system-bank'))
      .filter((name) => name !== 'meta').sort();
    for (const migrationDir of bankMigrationDirs) {
      await applySqlFile(
        clusterUrl(BANK_DATABASE, BANK_ROLE, BANK_PASSWORD),
        join(__dirname, '../../../../../packages/db/migrations/system-bank', migrationDir, 'migration.sql'),
      );
    }
    await applySqlFile(
      clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD),
      join(__dirname, '../../../../../packages/db/migrations/centre/20261025163710_baseline/migration.sql'),
    );
    await applySqlFile(
      clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD),
      join(__dirname, '../../../../../packages/db/migrations/centre/20261113160000_outcome_package_install_checksum/migration.sql'),
    );
    bankPool = new Pool({ connectionString: clusterUrl(BANK_DATABASE, BANK_ROLE, BANK_PASSWORD) });
    centrePool = new Pool({ connectionString: clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD) });
    bankDb = createSystemBankKysely(bankPool);
    centreDb = createCentreKysely(centrePool);
    bankConnection = new SystemBankConnection({
      get: (key: string) =>
        key === 'SYSTEM_BANK_DATABASE_URL'
          ? clusterUrl(BANK_DATABASE, BANK_ROLE, BANK_PASSWORD)
          : undefined,
    } as never);
    const connection = bankConnection;
    centreKysely = createCentreKysely(centrePool);
    const repo = new SystemBankRepository(connection.kysely, () =>
      new ServiceUnavailableException({
        message: 'System bank is not configured (SYSTEM_BANK_DATABASE_URL is not set)',
        code: 'system_bank.not_configured',
      }),
    );
    const centreRepo = new SystemBankCentreRepository(centreKysely);
    const evaluator = { requireCapability: async () => {}, hasCapability: async () => true };
    const contexts = {
      ensureSystemContext: async () => ({ id: SYSTEM_ID }),
      getTenantContext: async () => ({ id: SYSTEM_ID }),
    };
    const tenantDb = {
      withPlatform: async <T>(fn: (tx: never) => Promise<T>) =>
        centreKysely.transaction().execute(fn as never) as Promise<T>,
      withCurrent: async <T>(fn: (tx: never) => Promise<T>) =>
        centreKysely.transaction().execute(fn as never) as Promise<T>,
    };
    const spaceDb = { resolveTarget: async () => ({ mode: 'dedicated' }) };
    service = new SystemBankService(
      repo,
      centreRepo,
      connection,
      evaluator as never,
      contexts as never,
      tenantDb as never,
      undefined as never,
      undefined as never,
      undefined as never,
      spaceDb as never,
    );
    await centreDb.insertInto('subjects').values({ id: SUBJECT_ID, context_id: SYSTEM_ID, name: 'Toán 585', slug: SUBJECT_SLUG }).execute();
    await centreDb.insertInto('curricula').values({ id: CURRICULUM_ID, subject_id: SUBJECT_ID, grade: 12 }).execute();
    await centreDb.insertInto('curriculum_nodes').values({
      id: NODE_ID,
      curriculum_id: CURRICULUM_ID,
      parent_id: null,
      title: 'Hàm số',
      kind: 'topic',
      position: 1,
    }).execute();
    await centreDb.insertInto('learning_outcomes').values({
      id: OUTCOME_ID,
      node_id: NODE_ID,
      content: doc('YCCĐ v1'),
      position: 1,
      source_kind: 'program',
      source_ref: 'CT Toán 12',
    }).execute();
  }, 180000);

  afterAll(async () => {
    await bankConnection?.onModuleDestroy();
    await bankPool?.end();
    await centreKysely?.destroy();
    const adminUrl = clusterUrl('postgres');
    for (const [database, role] of [
      [BANK_DATABASE, BANK_ROLE],
      [CENTRE_DATABASE, CENTRE_ROLE],
    ] as const) {
      await withClient(adminUrl, async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
        await client.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      });
    }
  });

  const multichoicePackage = (text: string) => ({
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
  });

  it('phát hành câu + phiên bản mới: phiên bản cũ đọc lại không đổi, checksum tính lại khớp checksum lưu', async () => {
    const created = await service.publishQuestion(ADMIN_ID, { qtype: 'multichoice', package: multichoicePackage('Câu gốc') });
    const questionId = created.question.id;
    await service.publishVersion(ADMIN_ID, questionId, { package: multichoicePackage('Câu sửa') });
    const v1 = await service.getVersion(ADMIN_ID, questionId, 1);
    const v2 = await service.getVersion(ADMIN_ID, questionId, 2);
    expect(v1.package).toMatchObject({ questionText: doc('Câu gốc') });
    expect(v2.package).toMatchObject({ questionText: doc('Câu sửa') });
    expect(checksumPackage(v1.package as never)).toBe(v1.checksum);
    expect(checksumPackage(v2.package as never)).toBe(v2.checksum);
    expect(v1.checksum).not.toBe(v2.checksum);
    const versions = await service.listVersions(ADMIN_ID, questionId);
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
  });

  it('rút câu: khám phá không còn thấy, sự kiện rút được ghi, danh sách trung tâm đã nhập đọc được', async () => {
    const created = await service.publishQuestion(ADMIN_ID, { qtype: 'multichoice', package: multichoicePackage('Câu sẽ rút') });
    const questionId = created.question.id;
    await service.publishVersion(ADMIN_ID, questionId, { package: multichoicePackage('Câu sẽ rút v2') });
    await bankDb.insertInto('system_question_importers').values([
      { source_question_id: questionId, centre_slug: 'trung-tam-a', imported_by: ADMIN_ID },
      { source_question_id: questionId, centre_slug: 'trung-tam-b', imported_by: ADMIN_ID },
    ]).execute();
    const withdrawn = await service.withdrawQuestion(ADMIN_ID, questionId, { reason: 'Nội dung lỗi thời' });
    expect(withdrawn.question.status).toBe('withdrawn');
    expect(withdrawn.notifiedCentres).toEqual(expect.arrayContaining(['trung-tam-a', 'trung-tam-b']));
    const discovered = await tenantAls.run({ tenantId: '01958500-0000-7000-8000-000000000099' }, () =>
      service.discover({ qtype: 'multichoice', limit: 100, offset: 0 }),
    );
    expect(discovered.items.find((item) => item.id === questionId)).toBeUndefined();
    const stillReadable = await service.getQuestion(ADMIN_ID, questionId);
    expect(stillReadable.status).toBe('withdrawn');
    const events = await bankDb.selectFrom('system_bank_events').selectAll().where('source_question_id', '=', questionId).execute();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('question_withdrawn');
    const oldVersion = await service.getVersion(ADMIN_ID, questionId, 1);
    expect(oldVersion.package).toMatchObject({ questionText: doc('Câu sẽ rút') });
  });

  it('sự kiện chưa ghi nhận: trung tâm thấy sự kiện rút của câu mình đã nhập mà không cần biết trước id, ghi nhận xong thì hết ở trung tâm mình, trung tâm khác vẫn thấy', async () => {
    const created = await service.publishQuestion(ADMIN_ID, { qtype: 'multichoice', package: multichoicePackage('Câu rút để giao thông báo') });
    const questionId = created.question.id;
    await bankDb.insertInto('system_question_importers').values([
      { source_question_id: questionId, centre_slug: 'trung-tam-a', imported_by: ADMIN_ID },
      { source_question_id: questionId, centre_slug: 'trung-tam-b', imported_by: ADMIN_ID },
    ]).execute();
    await service.withdrawQuestion(ADMIN_ID, questionId, { reason: 'Nội dung lỗi thời' });
    const pendingA = await tenantAls.run({ spaceSlug: 'trung-tam-a' }, () => service.listPendingEvents(ADMIN_ID));
    const mine = pendingA.filter((event) => event.sourceQuestionId === questionId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.type).toBe('question_withdrawn');
    await tenantAls.run({ spaceSlug: 'trung-tam-a' }, () => service.acknowledgeEvent(ADMIN_ID, mine[0]!.id));
    const pendingAfterAck = await tenantAls.run({ spaceSlug: 'trung-tam-a' }, () => service.listPendingEvents(ADMIN_ID));
    expect(pendingAfterAck.find((event) => event.sourceQuestionId === questionId)).toBeUndefined();
    const pendingB = await tenantAls.run({ spaceSlug: 'trung-tam-b' }, () => service.listPendingEvents(ADMIN_ID));
    expect(pendingB.find((event) => event.sourceQuestionId === questionId)).toBeDefined();
    const pendingC = await tenantAls.run({ spaceSlug: 'trung-tam-c' }, () => service.listPendingEvents(ADMIN_ID));
    expect(pendingC.find((event) => event.sourceQuestionId === questionId)).toBeUndefined();
  });

  const asCentre = <T>(fn: () => Promise<T>) =>
    tenantAls.run({
      tenantId: '01958500-0000-7000-8000-000000000099',
      spaceSlug: 'trung-tam-a',
    }, fn);

  const submitProgramme = (version: string) =>
    asCentre(() => service.createOutcomePackage(ADMIN_ID, { version, scope: SUBJECT_SLUG, mappings: [] }));
  const installProgramme = (version: string) =>
    asCentre(() => service.installOutcomePackage(ADMIN_ID, version));
  const approveProgramme = (version: string) =>
    service.reviewOutcomePackage(ADMIN_ID, version, true);

  it('gói chờ không công khai; duyệt rồi cài nguyên tử, retry giữ nguyên vết và checksum', async () => {
    const submitted = await submitProgramme('2026.10.31.1');
    expect(submitted.package.status).toBe('pending');
    expect(submitted.package.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect((await service.listOutcomePackages()).find((p) => p.version === submitted.package.version)).toBeUndefined();
    await expect(service.getOutcomePackage('2026.10.31.1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'system_bank.package_not_found' }),
    });
    await expect(installProgramme('2026.10.31.1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'system_bank.package_not_found' }),
    });
    expect((await service.listPendingOutcomePackages(ADMIN_ID)).map((p) => p.version)).toContain('2026.10.31.1');
    expect((await asCentre(() => service.listMyOutcomePackages(ADMIN_ID))).map((p) => p.version)).toContain('2026.10.31.1');
    const approved = await approveProgramme('2026.10.31.1');
    expect(approved?.status).toBe('published');
    expect((await service.getOutcomePackage('2026.10.31.1')).package.checksum).toBe(submitted.package.checksum);
    const installed = await installProgramme('2026.10.31.1');
    expect(installed.install.packageVersion).toBe('2026.10.31.1');
    expect(installed.install.previousVersion).toBeNull();
    expect(installed.install.packageChecksum).toBe(submitted.package.checksum);
    expect(installed.unchanged).toBe(false);
    const retried = await installProgramme('2026.10.31.1');
    expect(retried.unchanged).toBe(true);
    expect(retried.install.id).toBe(installed.install.id);
    expect(retried.install.installedAt).toEqual(installed.install.installedAt);
    const trace = await asCentre(() => service.listInstalledOutcomePackages(ADMIN_ID));
    expect(trace.filter((row) => row.packageVersion === '2026.10.31.1')).toHaveLength(1);
    await centreDb.updateTable('outcome_package_installs')
      .set({ package_checksum: '' }).where('package_version', '=', '2026.10.31.1').execute();
    const legacyRetry = await installProgramme('2026.10.31.1');
    expect(legacyRetry.unchanged).toBe(true);
    expect(legacyRetry.install.packageChecksum).toBe(submitted.package.checksum);
    expect(legacyRetry.install.installedAt).toEqual(installed.install.installedAt);
  });

  it('nội dung YCCĐ mới có ID mới và ánh xạ nguồn, bản v1 không sửa ngược', async () => {
    await centreDb.insertInto('learning_outcomes').values({
      id: REVISED_OUTCOME_ID, node_id: NODE_ID, position: 2,
      content: doc('YCCĐ v2'), source_kind: 'program', source_ref: 'CT Toán 12 v2',
    }).execute();
    const submitted = await asCentre(() => service.createOutcomePackage(ADMIN_ID, {
      version: '2026.10.31.2', scope: SUBJECT_SLUG,
      mappings: [{ fromOutcomeId: OUTCOME_ID, toOutcomeId: REVISED_OUTCOME_ID, note: 'Thay văn bản YCCĐ' }],
    }));
    expect(submitted.package.checksum).not.toBe((await service.getOutcomePackage('2026.10.31.1')).package.checksum);
    await approveProgramme('2026.10.31.2');
    const installed = await installProgramme('2026.10.31.2');
    expect(installed.install.previousVersion).toBe('2026.10.31.1');
    const outcomes = await centreDb.selectFrom('learning_outcomes').select(['id', 'content'])
      .where('id', 'in', [OUTCOME_ID, REVISED_OUTCOME_ID]).execute();
    expect(outcomes).toHaveLength(2);
    expect(outcomes.find((r) => r.id === OUTCOME_ID)!.content).toMatchObject(doc('YCCĐ v1'));
    expect(outcomes.find((r) => r.id === REVISED_OUTCOME_ID)!.content).toMatchObject(doc('YCCĐ v2'));
    const previous = await service.getOutcomePackage('2026.10.31.1');
    const latest = await service.getOutcomePackage('2026.10.31.2');
    expect(previous.outcomes).toHaveLength(1);
    expect(previous.outcomes[0]!.content).toMatchObject(doc('YCCĐ v1'));
    expect(latest.mappings).toEqual([expect.objectContaining({
      fromOutcomeId: OUTCOME_ID, toOutcomeId: REVISED_OUTCOME_ID,
    })]);
  });

  it('từ chối phải có lý do, trạng thái terminal không thể công khai hay cài', async () => {
    await submitProgramme('2026.10.31.3');
    await expect(service.reviewOutcomePackage(ADMIN_ID, '2026.10.31.3', false, ' '))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'system_bank.rejection_reason_required' }) });
    const rejected = await service.reviewOutcomePackage(ADMIN_ID, '2026.10.31.3', false, 'Nội dung chưa phù hợp');
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejectionReason).toBe('Nội dung chưa phù hợp');
    await expect(approveProgramme('2026.10.31.3')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'system_bank.package_already_reviewed' }),
    });
    await expect(installProgramme('2026.10.31.3')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'system_bank.package_not_found' }),
    });
  });

  it('gói bị thay đổi sau gửi trượt checksum trước duyệt và không được công bố', async () => {
    const pending = await submitProgramme('2026.10.31.4');
    await bankDb.updateTable('system_outcome_package_outcomes')
      .set({ content: doc('Đã bị sửa ở kho hệ thống') })
      .where('package_id', '=', pending.package.id).execute();
    await expect(approveProgramme('2026.10.31.4')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'system_bank.bad_package' }),
    });
    expect((await service.getOutcomePackageForReview(ADMIN_ID, '2026.10.31.4')).package.status).toBe('pending');
  });

  it('cài gói vào kho trống tạo đủ môn, khối, node, YCCĐ theo snapshot, không gộp ID', async () => {
    await submitProgramme('2026.10.31.9');
    await approveProgramme('2026.10.31.9');
    await centreDb.deleteFrom('subjects').where('id', '=', SUBJECT_ID).execute();
    expect(await centreDb.selectFrom('curricula').select('id').where('id', '=', CURRICULUM_ID).execute()).toHaveLength(0);
    const installed = await installProgramme('2026.10.31.9');
    expect(installed.unchanged).toBe(false);
    const subject = await centreDb.selectFrom('subjects').selectAll().where('slug', '=', SUBJECT_SLUG).executeTakeFirst();
    expect(subject?.name).toBe('Toán 585');
    expect((await centreDb.selectFrom('curricula').select('id').where('id', '=', CURRICULUM_ID).execute())).toHaveLength(1);
    expect((await centreDb.selectFrom('curriculum_nodes').select('id').where('id', '=', NODE_ID).execute())).toHaveLength(1);
    expect((await centreDb.selectFrom('learning_outcomes').select('id').where('id', '=', OUTCOME_ID).execute())).toHaveLength(1);
  });

  it('lỗi ghi YCCĐ ở giữa transaction rollback toàn bộ node và vết cài; xung đột ID cũng không gộp', async () => {
    await submitProgramme('2026.10.31.12');
    await approveProgramme('2026.10.31.12');
    await centreDb.deleteFrom('curriculum_nodes').where('id', '=', NODE_ID).execute();
    await centrePool.query("CREATE FUNCTION fail_programme_install() RETURNS trigger LANGUAGE plpgsql AS $func$ BEGIN RAISE EXCEPTION 'forced install failure'; END $func$");
    await centrePool.query('CREATE TRIGGER fail_programme_install BEFORE INSERT ON learning_outcomes FOR EACH ROW EXECUTE FUNCTION fail_programme_install()');
    try {
      await expect(installProgramme('2026.10.31.12')).rejects.toThrow('forced install failure');
      expect(await centreDb.selectFrom('curriculum_nodes').select('id').where('id', '=', NODE_ID).execute()).toHaveLength(0);
      expect(await centreDb.selectFrom('outcome_package_installs').select('id')
        .where('package_version', '=', '2026.10.31.12').execute()).toHaveLength(0);
    } finally {
      await centrePool.query('DROP TRIGGER IF EXISTS fail_programme_install ON learning_outcomes');
      await centrePool.query('DROP FUNCTION IF EXISTS fail_programme_install()');
    }
    await centreDb.deleteFrom('curricula').where('id', '=', CURRICULUM_ID).execute();
    await centreDb.insertInto('curricula').values({
      id: '01958500-0000-7000-8000-000000000021',
      subject_id: (await centreDb.selectFrom('subjects').select('id').where('slug', '=', SUBJECT_SLUG).executeTakeFirstOrThrow()).id,
      grade: 12,
    }).execute();
    await expect(installProgramme('2026.10.31.12')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'system_bank.curriculum_conflict' }),
    });
    expect(await centreDb.selectFrom('outcome_package_installs').select('id')
      .where('package_version', '=', '2026.10.31.12').execute()).toHaveLength(0);
  });

  it('trung tâm A/B có kho độc lập và cài hai phiên bản khác nhau mà không ghi chéo', async () => {
    const database = 'giaokhoa_test_centre_17_b';
    const role = 'giaokhoa_centre_test_17_b';
    const password = 'centre17testb';
    const adminUrl = clusterUrl('postgres');
    await withClient(adminUrl, async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      await client.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      await client.query(`CREATE ROLE ${quoted(role)} LOGIN PASSWORD '${password}'`);
      await client.query(`CREATE DATABASE ${quoted(database)} OWNER ${quoted(role)}`);
      await client.query(`REVOKE CONNECT ON DATABASE ${quoted(database)} FROM PUBLIC`);
      await client.query(`GRANT CONNECT ON DATABASE ${quoted(database)} TO ${quoted(role)}`);
    });
    const url = clusterUrl(database, role, password);
    let otherDb: CentreDb | undefined;
    try {
      await applySqlFile(url, join(__dirname, '../../../../../packages/db/migrations/centre/20261025163710_baseline/migration.sql'));
      await applySqlFile(url, join(__dirname, '../../../../../packages/db/migrations/centre/20261113160000_outcome_package_install_checksum/migration.sql'));
      const otherPool = new Pool({ connectionString: url });
      otherDb = createCentreKysely(otherPool);
      const otherRepo = new SystemBankRepository(bankConnection.kysely, () => new ServiceUnavailableException('Bank unavailable'));
      const otherCentreRepo = new SystemBankCentreRepository(otherDb);
      const otherTenantDb = {
        withCurrent: async <T>(fn: (tx: never) => Promise<T>) =>
          otherDb!.transaction().execute(fn as never) as Promise<T>,
      };
      const otherService = new SystemBankService(
        otherRepo, otherCentreRepo, bankConnection,
        { requireCapability: async () => {} } as never,
        { ensureSystemContext: async () => ({ id: SYSTEM_ID }), getTenantContext: async () => ({ id: SYSTEM_ID }) } as never,
        otherTenantDb as never, undefined as never, undefined as never,
        undefined as never, { resolveTarget: async () => ({ mode: 'dedicated' }) } as never,
      );
      const aBefore = await centreDb.selectFrom('outcome_package_installs').select('package_version').execute();
      const versionA = (await asCentre(() => service.listInstalledOutcomePackages(ADMIN_ID)))[0]!.packageVersion;
      expect(versionA).toBe('2026.10.31.9');
      const resultB = await tenantAls.run({
        tenantId: '01958500-0000-7000-8000-000000000098',
        spaceSlug: 'trung-tam-b',
      }, () => otherService.installOutcomePackage(ADMIN_ID, '2026.10.31.1'));
      expect(resultB.unchanged).toBe(false);
      expect(resultB.install.packageVersion).toBe('2026.10.31.1');
      const categoryId = '01958500-0000-7000-8000-000000000031';
      const questionId = '01958500-0000-7000-8000-000000000032';
      await otherDb.insertInto('question_categories').values({
        id: categoryId, context_id: SYSTEM_ID, name: 'Ngân hàng câu hỏi B',
      }).execute();
      await otherDb.insertInto('question').values({
        id: questionId, category: categoryId, qtype: 'multichoice',
      }).execute();
      await otherDb.insertInto('question_learning_outcomes').values({
        question_id: questionId, learning_outcome_id: OUTCOME_ID, cognitive_level: 'hieu',
      }).execute();
      const before = await otherDb.selectFrom('learning_outcomes').select('content')
        .where('id', '=', OUTCOME_ID).executeTakeFirstOrThrow();
      expect(before.content).toMatchObject(doc('YCCĐ v1'));
      const resultB2 = await tenantAls.run({
        tenantId: '01958500-0000-7000-8000-000000000098',
        spaceSlug: 'trung-tam-b',
      }, () => otherService.installOutcomePackage(ADMIN_ID, '2026.10.31.2'));
      expect(resultB2.install.previousVersion).toBe('2026.10.31.1');
      expect((await otherDb.selectFrom('learning_outcomes').select('content')
        .where('id', '=', OUTCOME_ID).executeTakeFirstOrThrow()).content).toEqual(before.content);
      expect((await otherDb.selectFrom('learning_outcomes').select('content')
        .where('id', '=', REVISED_OUTCOME_ID).executeTakeFirstOrThrow()).content).toMatchObject(doc('YCCĐ v2'));
      expect(await otherDb.selectFrom('question_learning_outcomes').select('learning_outcome_id')
        .where('question_id', '=', questionId).execute()).toEqual([
          { learning_outcome_id: OUTCOME_ID },
        ]);
      expect((await otherRepo.getPackageItems((await otherRepo.getPackageByVersion('2026.10.31.2'))!.id))
        .mappings).toEqual([expect.objectContaining({
          fromOutcomeId: OUTCOME_ID, toOutcomeId: REVISED_OUTCOME_ID,
        })]);
      expect((await otherDb.selectFrom('outcome_package_installs').select('package_version').execute())
        .map((row) => row.package_version)).toEqual(['2026.10.31.1', '2026.10.31.2']);
      expect(await centreDb.selectFrom('outcome_package_installs').select('package_version').execute()).toEqual(aBefore);

      expect((await asCentre(() => service.listInstalledOutcomePackages(ADMIN_ID)))[0]!.packageVersion).toBe(versionA);
    } finally {
      await otherDb?.destroy();
      await withClient(adminUrl, async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
        await client.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      });
    }
  });

});
