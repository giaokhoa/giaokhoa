/**
 * Hàng chờ câu hỏi do trung tâm gửi nằm hoàn toàn trong kho ngân hàng.
 * Gói và dấu vết nguồn được chụp tại thời điểm gửi, không giữ FK xuyên kho.
 * Duyệt dùng một giao dịch và khoá theo câu nguồn: retry hoặc hai người duyệt
 * cùng lúc chỉ tạo đúng một bản công bố, các phiên bản trước bất biến.
 */
import { sql, type RawBuilder } from 'kysely';
import type { SystemBankPackage } from '@giaokhoa/contracts';
import type { SystemBankDb } from '../client';
import type { Json } from '../types/system-bank-db';

/** Dòng hàng chờ; phần package chỉ được đưa tới người có quyền duyệt. */
export interface SystemQuestionSubmissionRow {
  id: string;
  centreSlug: string;
  sourceQuestionId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  qtype: string;
  package: unknown;
  checksum: string;
  submittedBy: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  publishedQuestionId: string | null;
  publishedVersion: number | null;
  createdAt: Date;
}

const COLUMNS = [
  'id', 'centre_slug as centreSlug',
  'source_question_id as sourceQuestionId',
  'source_version_id as sourceVersionId',
  'source_version_number as sourceVersionNumber',
  'qtype', 'package', 'checksum', 'submitted_by as submittedBy',
  'status', 'reviewed_by as reviewedBy', 'reviewed_at as reviewedAt',
  'rejection_reason as rejectionReason',
  'published_question_id as publishedQuestionId',
  'published_version as publishedVersion', 'created_at as createdAt',
] as const;

/** Đóng gói jsonb theo chuỗi để driver PostgreSQL không đổi mảng thành SQL array. */
function jsonb(value: unknown): RawBuilder<Json> {
  return sql<Json>`${JSON.stringify(value)}::jsonb`;
}

export class SystemBankSubmissionsRepository {
  constructor(
    private readonly handle: SystemBankDb | null,
    private readonly notConfiguredError: () => Error = () => new Error('system_bank.not_configured'),
  ) {}

  /** Kho ngân hàng không cấu hình thì không thể gửi/duyệt, nhưng ứng dụng vẫn khởi động. */
  private db(): SystemBankDb {
    if (!this.handle) throw this.notConfiguredError();
    return this.handle;
  }

  /**
   * Tạo bản chụp một lần theo phiên bản nguồn, trả lại chính bản cũ khi retry.
   * Giao dịch kho ngân hàng không đụng tới kết nối của trung tâm.
   */
  async submit(input: {
    centreSlug: string; sourceQuestionId: string; sourceVersionId: string;
    sourceVersionNumber: number; qtype: string; package: SystemBankPackage;
    checksum: string; submittedBy: string;
  }): Promise<SystemQuestionSubmissionRow> {
    return this.db().transaction().execute(async (tx) => {
      const inserted = await tx.insertInto('system_question_submissions').values({
        centre_slug: input.centreSlug,
        source_question_id: input.sourceQuestionId,
        source_version_id: input.sourceVersionId,
        source_version_number: input.sourceVersionNumber,
        qtype: input.qtype,
        package: jsonb(input.package),
        checksum: input.checksum,
        submitted_by: input.submittedBy,
      }).onConflict((oc) => oc.columns(['centre_slug', 'source_question_id', 'source_version_id']).doNothing())
        .returning(COLUMNS).executeTakeFirst();
      if (inserted) return inserted;
      const existing = await tx.selectFrom('system_question_submissions').select(COLUMNS)
        .where('centre_slug', '=', input.centreSlug)
        .where('source_question_id', '=', input.sourceQuestionId)
        .where('source_version_id', '=', input.sourceVersionId)
        .executeTakeFirstOrThrow();
      return existing;
    });
  }

  /** Một trung tâm chỉ xem lịch sử của chính mình. */
  async listForCentre(centreSlug: string, db: SystemBankDb = this.db()): Promise<SystemQuestionSubmissionRow[]> {
    return db.selectFrom('system_question_submissions').select(COLUMNS)
      .where('centre_slug', '=', centreSlug).orderBy('created_at', 'desc').execute();
  }

  /** Hàng chờ của biên tập viên, không trả các dòng từ chối/duyệt. */
  async listPending(db: SystemBankDb = this.db()): Promise<SystemQuestionSubmissionRow[]> {
    return db.selectFrom('system_question_submissions').select(COLUMNS)
      .where('status', '=', 'pending').orderBy('created_at', 'asc').execute();
  }

  /** Dòng đầy đủ để người duyệt kiểm tra trước khi ra quyết định. */
  async get(id: string, db: SystemBankDb = this.db()): Promise<SystemQuestionSubmissionRow | null> {
    return await db.selectFrom('system_question_submissions').select(COLUMNS)
      .where('id', '=', id).executeTakeFirst() ?? null;
  }

  /** Từ chối có lý do, chỉ chuyển trạng thái pending một lần. */
  async reject(id: string, reviewerId: string, reason: string): Promise<SystemQuestionSubmissionRow | null> {
    return this.db().transaction().execute(async (tx) => {
      const current = await tx.selectFrom('system_question_submissions').select(COLUMNS)
        .where('id', '=', id).forUpdate().executeTakeFirst();
      if (!current || current.status !== 'pending') return current ?? null;
      return await tx.updateTable('system_question_submissions').set({
        status: 'rejected', reviewed_by: reviewerId,
        reviewed_at: new Date(), rejection_reason: reason,
      }).where('id', '=', id).returning(COLUMNS).executeTakeFirstOrThrow();
    });
  }

  /**
   * Khoá hàng chờ và khoá định danh câu nguồn trong MỘT giao dịch.
   * Lượt duyệt đầu tạo danh tính câu + version 1; lượt duyệt của bản nguồn
   * mới nối version vào chính danh tính ấy. Retry trên hàng đã duyệt chỉ đọc,
   * kể cả khi chạy đồng thời và kể cả khi trung tâm đã xoá câu gốc.
   */
  async approve(id: string, reviewerId: string): Promise<SystemQuestionSubmissionRow | null> {
    return this.db().transaction().execute(async (tx) => {
      const current = await tx.selectFrom('system_question_submissions').select(COLUMNS)
        .where('id', '=', id).forUpdate().executeTakeFirst();
      if (!current || current.status !== 'pending') return current ?? null;

      // Khoá xuyên hàng gửi để hai phiên bản của cùng câu không cùng tạo danh tính mới.
      await sql`select pg_advisory_xact_lock(hashtextextended(${current.centreSlug} || ':' || ${current.sourceQuestionId}, 0))`.execute(tx);
      const prior = await tx.selectFrom('system_question_submissions')
        .select(['published_question_id as publishedQuestionId'])
        .where('centre_slug', '=', current.centreSlug)
        .where('source_question_id', '=', current.sourceQuestionId)
        .where('status', '=', 'approved')
        .orderBy('created_at', 'desc').executeTakeFirst();

      const pkg = current.package as SystemBankPackage;
      let questionId: string;
      let nextVersion: number;
      if (prior?.publishedQuestionId) {
        questionId = prior.publishedQuestionId;
        const existing = await tx.selectFrom('system_questions')
          .select(['status', 'qtype']).where('id', '=', questionId).forUpdate().executeTakeFirstOrThrow();
        if (existing.status !== 'published' || existing.qtype !== current.qtype) {
          throw new Error('system_bank.submission_source_conflict');
        }
        const latest = await tx.selectFrom('system_question_versions').select('version')
          .where('question_id', '=', questionId).orderBy('version', 'desc').limit(1).executeTakeFirst();
        nextVersion = (latest?.version ?? 0) + 1;
      } else {
        const question = await tx.insertInto('system_questions').values({
          qtype: current.qtype, status: 'published', created_by: reviewerId,
        }).returning('id').executeTakeFirstOrThrow();
        questionId = question.id;
        nextVersion = 1;
      }
      const version = await tx.insertInto('system_question_versions').values({
        question_id: questionId, version: nextVersion,
        checksum: current.checksum, package: jsonb(pkg),
      }).returning('id').executeTakeFirstOrThrow();
      if (pkg.outcomes.length) {
        await tx.insertInto('system_question_version_outcomes').values(
          pkg.outcomes.map((outcome) => ({
            version_id: version.id, outcome_id: outcome.outcomeId, cognitive_level: outcome.cognitiveLevel,
          })),
        ).execute();
      }
      return tx.updateTable('system_question_submissions').set({
        status: 'approved', reviewed_by: reviewerId, reviewed_at: new Date(),
        published_question_id: questionId, published_version: nextVersion,
      }).where('id', '=', id).returning(COLUMNS).executeTakeFirstOrThrow();
    });
  }
}
