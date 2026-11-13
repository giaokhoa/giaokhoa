import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCentreKysely, type CentreDb } from '../client';
import { buildTestDatabase, dropTestDatabase, withDatabase } from '../test-support/build-test-database';
import { SystemBankCentreRepository } from './system-bank-centre';

const adminUrl =
  process.env.GIAOKHOA_DB_TEST_ADMIN_URL ??
  (process.env.DATABASE_URL ? withDatabase(process.env.DATABASE_URL, 'postgres') : undefined);

const CENTRE_DB = 'giaokhoa_db_g650_centre';
const TENANT_ID = '01965000-0000-7000-8000-000000000201';
const CONTEXT_ID = '01965000-0000-7000-8000-000000000202';
const SUBJECT_ID = '01965000-0000-7000-8000-000000000203';
const CURRICULUM_ID = '01965000-0000-7000-8000-000000000204';
const NODE_ID = '01965000-0000-7000-8000-000000000205';
const OUTCOME_ID = '01965000-0000-7000-8000-000000000206';
const CATEGORY_ID = '01965000-0000-7000-8000-000000000207';
const QUESTION_ID = '01965000-0000-7000-8000-000000000208';
const SOURCE_QUESTION_ID = '01965000-0000-7000-8000-000000000209';
const SOURCE_VERSION_ID = '01965000-0000-7000-8000-000000000210';
const EVENT_ID = '01965000-0000-7000-8000-000000000211';
const ADMIN_ID = '01965000-0000-7000-8000-0000000002ff';

let pool: Pool;
let db: CentreDb;
let repo: SystemBankCentreRepository;

function doc(text: string): { type: string; content: Array<{ type: string; content: Array<{ type: string; text: string }> }> } {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

beforeAll(async () => {
  if (!adminUrl) {
    throw new Error('Thiếu kết nối quản trị cho spec phía trung tâm: đặt GIAOKHOA_DB_TEST_ADMIN_URL hoặc DATABASE_URL.');
  }
  const centreUrl = await buildTestDatabase({ adminUrl, database: CENTRE_DB, store: 'centre' });
  pool = new Pool({ connectionString: centreUrl });
  db = createCentreKysely(pool);
  repo = new SystemBankCentreRepository(db);
  await db.insertInto('tenants').values({ id: TENANT_ID, slug: 'trung-tam-650', name: 'Trung tâm 650', kind: 'centre' }).execute();
  await db
    .insertInto('question_categories')
    .values({ id: CATEGORY_ID, context_id: CONTEXT_ID, name: 'Bank cá nhân' })
    .execute();
  await db.insertInto('question').values({ id: QUESTION_ID, category: CATEGORY_ID, qtype: 'multichoice' }).execute();
}, 300_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
  if (adminUrl) await dropTestDatabase(adminUrl, CENTRE_DB);
});

describe('Repository phía trung tâm của kho ngân hàng hệ thống (issue #650)', () => {
  it('tra slug trung tâm theo tenant id: có tenant thì trả slug, vắng thì trả null', async () => {
    expect(await repo.resolveTenantSlug(TENANT_ID)).toBe('trung-tam-650');
    expect(await repo.resolveTenantSlug('01965000-0000-7000-8000-000000000299')).toBeNull();
  });

  it('ghi dòng truy vết nhập bản chụp giữ nguyên nguồn (câu nguồn, phiên bản nguồn, checksum) rồi lật sang derived', async () => {
    const row = await repo.insertImportRow({
      questionId: QUESTION_ID,
      sourceQuestionId: SOURCE_QUESTION_ID,
      sourceVersionId: SOURCE_VERSION_ID,
      sourceVersionNumber: 3,
      packageChecksum: 'checksum-source-v3',
      importedVersionNumber: 1,
      importedBy: ADMIN_ID,
      kind: 'pristine',
    });
    expect(row).toMatchObject({
      questionId: QUESTION_ID,
      sourceQuestionId: SOURCE_QUESTION_ID,
      sourceVersionId: SOURCE_VERSION_ID,
      sourceVersionNumber: 3,
      packageChecksum: 'checksum-source-v3',
      kind: 'pristine',
    });
    await repo.flipImportToDerived(QUESTION_ID);
    const flipped = await repo.getImportRow(QUESTION_ID);
    expect(flipped?.kind).toBe('derived');
  });

  it('ghi nhận sự kiện: trùng cặp sự kiện + trung tâm là idempotent, danh sách đã ghi nhận đọc theo đúng slug', async () => {
    const first = await repo.insertEventReceipt({ eventId: EVENT_ID, centreSlug: 'trung-tam-650' });
    const again = await repo.insertEventReceipt({ eventId: EVENT_ID, centreSlug: 'trung-tam-650' });
    expect(again.id).toBe(first.id);
    expect(await repo.listEventReceiptEventIds('trung-tam-650')).toContain(EVENT_ID);
    expect(await repo.listEventReceiptEventIds('trung-tam-khac')).not.toContain(EVENT_ID);
  });

  it('chèn môn, chương trình, node và YCCĐ theo id, cài lại không ghi đè nội dung đã có', async () => {
    await db
      .insertInto('subjects')
      .values({ id: SUBJECT_ID, context_id: CONTEXT_ID, name: 'Toán', slug: 'toan-650' })
      .execute();
    const subject = await repo.findSubjectBySlug('toan-650');
    expect(subject?.id).toBe(SUBJECT_ID);
    expect(subject?.contextId).toBe(CONTEXT_ID);

    await repo.upsertCurriculum({ id: CURRICULUM_ID, subjectId: SUBJECT_ID, grade: 12 });
    await repo.upsertCurriculum({ id: CURRICULUM_ID, subjectId: SUBJECT_ID, grade: 12 });
    const curriculum = await repo.findCurriculumBySubjectGrade(SUBJECT_ID, 12);
    expect(curriculum?.id).toBe(CURRICULUM_ID);
    expect(await repo.findCurriculumBySubjectGrade(SUBJECT_ID, 11)).toBeNull();

    await repo.upsertCurriculumNode({
      id: NODE_ID,
      curriculumId: CURRICULUM_ID,
      parentId: null,
      title: 'Hàm số',
      kind: 'topic',
      position: 1,
      durationPeriods: 10,
      durationPercent: null,
    });
    await repo.upsertLearningOutcome({
      id: OUTCOME_ID,
      nodeId: NODE_ID,
      position: 1,
      content: doc('YCCĐ v1'),
      sourceKind: 'program',
      sourceRef: 'CT Toán 12',
    });
    expect(await repo.outcomeExists(OUTCOME_ID)).toBe(true);
    await repo.upsertLearningOutcome({
      id: OUTCOME_ID,
      nodeId: NODE_ID,
      position: 1,
      content: doc('YCCĐ v2'),
      sourceKind: 'program',
      sourceRef: 'CT Toán 12',
    });
    const rows = await db.selectFrom('learning_outcomes').select(['content']).where('id', '=', OUTCOME_ID).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toEqual(doc('YCCĐ v1'));
  });

  it('vết cài gói: phiên bản trước, checksum và retry cùng phiên bản không sửa vết', async () => {
    const first = await repo.recordOutcomePackageInstall({
      packageVersion: '2026.11.02.1',
      packageChecksum: 'checksum-v1',
      previousVersion: null,
      scope: 'all',
      installedBy: ADMIN_ID,
    });
    expect(first.previousVersion).toBeNull();
    expect(first.packageChecksum).toBe('checksum-v1');
    const second = await repo.recordOutcomePackageInstall({
      packageVersion: '2026.11.02.2',
      packageChecksum: 'checksum-v2',
      previousVersion: first.packageVersion,
      scope: 'all',
      installedBy: ADMIN_ID,
    });
    expect(second.previousVersion).toBe('2026.11.02.1');
    expect(second.packageChecksum).toBe('checksum-v2');
    const current = await repo.getOutcomePackageInstall();
    expect(current?.packageVersion).toBe('2026.11.02.2');
    const refreshed = await repo.recordOutcomePackageInstall({
      packageVersion: '2026.11.02.2',
      packageChecksum: 'checksum-v2',
      previousVersion: '2026.11.02.1',
      scope: 'toan-650',
      installedBy: ADMIN_ID,
    });
    expect(refreshed.id).toBe(second.id);
    expect(refreshed.scope).toBe('all');
    expect(refreshed.installedAt).toEqual(second.installedAt);
    expect(refreshed.packageChecksum).toBe(second.packageChecksum);
  });
});
