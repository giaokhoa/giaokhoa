/**
 * Tích hợp kho ngân hàng hệ thống riêng (#13): mọi chuyển trạng thái
 * duyệt được thực hiện bằng repository Kysely production trên PostgreSQL
 * thật, migration được áp từ rỗng; không giả lập transaction/khóa.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SystemBankPackage } from '@giaokhoa/contracts';
import { createSystemBankKysely, type SystemBankDb } from '../client';
import { buildTestDatabase, dropTestDatabase, withDatabase } from '../test-support/build-test-database';
import { SystemBankRepository } from './system-bank';
import { SystemBankSubmissionsRepository } from './system-bank-submissions';

const adminUrl = process.env.GIAOKHOA_DB_TEST_ADMIN_URL ??
  (process.env.DATABASE_URL ? withDatabase(process.env.DATABASE_URL, 'postgres') : undefined);
const DATABASE = 'giaokhoa_db_g13_bank';
const ACTOR = '01961300-0000-7000-8000-000000000001';
const REVIEWER = '01961300-0000-7000-8000-000000000002';
const SOURCE_ID = '01961300-0000-7000-8000-000000000003';
const VERSION_ID = '01961300-0000-7000-8000-000000000004';

const doc = (text: string) => ({
  type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

function pkg(text: string): SystemBankPackage {
  return {
    questionText: doc(text), generalFeedback: null, stimulusContent: null,
    answers: [
      { answer: doc('A'), isCorrect: true, feedback: null, sortOrder: 0 },
      { answer: doc('B'), isCorrect: false, feedback: null, sortOrder: 1 },
      { answer: doc('C'), isCorrect: false, feedback: null, sortOrder: 2 },
      { answer: doc('D'), isCorrect: false, feedback: null, sortOrder: 3 },
    ],
    answerKey: null, options: null, outcomes: [],
    source: {
      centreSlug: 'centre-a', questionId: SOURCE_ID, versionId: VERSION_ID,
      versionNumber: 1, authorId: ACTOR, sourceKind: 'book', sourceRef: 'Sách Toán',
      license: 'CC BY 4.0',
    },
    media: [],
  };
}

let pool: Pool;
let db: SystemBankDb;
let repo: SystemBankSubmissionsRepository;
let published: SystemBankRepository;

beforeAll(async () => {
  if (!adminUrl) throw new Error('Thiếu DATABASE_URL cho test tích hợp kho ngân hàng (#13).');
  const url = await buildTestDatabase({ adminUrl, database: DATABASE, store: 'system-bank' });
  pool = new Pool({ connectionString: url });
  db = createSystemBankKysely(pool);
  repo = new SystemBankSubmissionsRepository(db);
  published = new SystemBankRepository(db);
}, 300_000);
afterAll(async () => {
  await db?.destroy().catch(() => undefined);
  if (adminUrl) await dropTestDatabase(adminUrl, DATABASE);
});

describe('Hàng chờ công bố câu hỏi chung (#13)', () => {
  it('gửi lặp cùng phiên bản chỉ có một dòng chờ, không phát hành trước khi duyệt', async () => {
    const input = {
      centreSlug: 'centre-a', sourceQuestionId: SOURCE_ID, sourceVersionId: VERSION_ID,
      sourceVersionNumber: 1, qtype: 'multichoice', package: pkg('Câu nguồn'),
      checksum: 'checksum-cau-1', submittedBy: ACTOR,
    };
    const first = await repo.submit(input);
    const again = await repo.submit(input);
    expect(again.id).toBe(first.id);
    expect(first.status).toBe('pending');
    expect((await repo.listPending()).filter((row) => row.id === first.id)).toHaveLength(1);
    expect((await published.listPublishedQuestionsWithVersions({}))).toHaveLength(0);
  });

  it('duyệt nguyên tử vào bản công bố mới, duyệt lại không tạo phiên bản trùng', async () => {
    const pending = (await repo.listPending()).find((row) => row.sourceQuestionId === SOURCE_ID);
    expect(pending).toBeDefined();
    const approved = await repo.approve(pending!.id, REVIEWER);
    expect(approved?.status).toBe('approved');
    expect(approved?.reviewedBy).toBe(REVIEWER);
    expect(approved?.publishedQuestionId).toBeTruthy();
    expect(approved?.publishedVersion).toBe(1);
    const retry = await repo.approve(pending!.id, REVIEWER);
    expect(retry?.publishedQuestionId).toBe(approved?.publishedQuestionId);
    expect(retry?.publishedVersion).toBe(1);
    const versions = await published.listVersions(approved!.publishedQuestionId!);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.package).toEqual(pkg('Câu nguồn'));
    expect(versions[0]!.checksum).toBe('checksum-cau-1');
    expect((await published.listPublishedQuestionsWithVersions({}))
      .map((row) => row.question.id)).toContain(approved!.publishedQuestionId);
  });

  it('bản nguồn v2 duyệt tạo phiên bản mới trên đúng câu, giữ nguyên v1', async () => {
    const v2 = await repo.submit({
      centreSlug: 'centre-a', sourceQuestionId: SOURCE_ID,
      sourceVersionId: '01961300-0000-7000-8000-000000000005',
      sourceVersionNumber: 2, qtype: 'multichoice',
      package: pkg('Câu nguồn sửa'), checksum: 'checksum-cau-2', submittedBy: ACTOR,
    });
    const approved = await repo.approve(v2.id, REVIEWER);
    expect(approved?.publishedVersion).toBe(2);
    const versions = await published.listVersions(approved!.publishedQuestionId!);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0]?.package).toEqual(pkg('Câu nguồn'));
    expect(versions[1]?.package).toEqual(pkg('Câu nguồn sửa'));
    expect(versions[0]?.checksum).toBe('checksum-cau-1');
  });

  it('từ chối bắt buộc có lý do, không có câu công bố và không duyệt lại được', async () => {
    const denied = await repo.submit({
      centreSlug: 'centre-a', sourceQuestionId: '01961300-0000-7000-8000-000000000006',
      sourceVersionId: '01961300-0000-7000-8000-000000000007',
      sourceVersionNumber: 1, qtype: 'essay', package: pkg('Không duyệt'),
      checksum: 'checksum-rejected', submittedBy: ACTOR,
    });
    const row = await repo.reject(denied.id, REVIEWER, 'Nội dung chưa đúng');
    expect(row?.status).toBe('rejected');
    expect(row?.rejectionReason).toBe('Nội dung chưa đúng');
    expect(row?.publishedQuestionId).toBeNull();
    expect((await repo.approve(denied.id, REVIEWER))?.status).toBe('rejected');
    expect((await repo.listPending()).find((r) => r.id === denied.id)).toBeUndefined();
  });

  it('trung tâm khác không thấy lịch sử, không trùng khoá theo định danh nguồn', async () => {
    const mine = await repo.listForCentre('centre-a');
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(await repo.listForCentre('centre-b')).toEqual([]);
    const otherCentre = await repo.submit({
      centreSlug: 'centre-b', sourceQuestionId: SOURCE_ID,
      sourceVersionId: VERSION_ID, sourceVersionNumber: 1,
      qtype: 'multichoice', package: pkg('Câu riêng của B'), checksum: 'centre-b-checksum', submittedBy: ACTOR,
    });
    expect(otherCentre.id).not.toBe(mine[0]!.id);
    expect((await repo.listForCentre('centre-b')).map((r) => r.id)).toEqual([otherCentre.id]);
  });

  it('hai thao tác duyệt đồng thời của cùng câu nguồn không tạo hai danh tính', async () => {
    const sourceQuestionId = '01961300-0000-7000-8000-000000000010';
    const [a, b] = await Promise.all([1, 2].map(async (number) => repo.submit({
      centreSlug: 'centre-a', sourceQuestionId,
      sourceVersionId: number === 1 ? '01961300-0000-7000-8000-000000000011' : '01961300-0000-7000-8000-000000000012',
      sourceVersionNumber: number, qtype: 'multichoice',
      package: pkg(`Phiên bản ${number}`), checksum: `checksum-concurrent-${number}`, submittedBy: ACTOR,
    })));
    const [first, second] = await Promise.all([repo.approve(a.id, REVIEWER), repo.approve(b.id, REVIEWER)]);
    expect(first?.status).toBe('approved');
    expect(second?.status).toBe('approved');
    expect(first?.publishedQuestionId).toBe(second?.publishedQuestionId);
    expect((await published.listVersions(first!.publishedQuestionId!)).length).toBe(2);
  });
});
