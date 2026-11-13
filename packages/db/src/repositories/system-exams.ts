import { sql, type RawBuilder } from 'kysely';
import type { SystemExamPackage } from '@giaokhoa/contracts';
import type { SystemBankDb } from '../client';
import type { Json } from '../types/system-bank-db';

export interface SystemExamVersionRow {
  id: string;
  centreSlug: string;
  sourceExamId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  package: unknown;
  checksum: string;
  submittedBy: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
}

const COLUMNS = [
  'id', 'centre_slug as centreSlug', 'source_exam_id as sourceExamId',
  'source_version_id as sourceVersionId', 'source_version_number as sourceVersionNumber',
  'package', 'checksum', 'submitted_by as submittedBy', 'status',
  'reviewed_by as reviewedBy', 'reviewed_at as reviewedAt',
  'rejection_reason as rejectionReason', 'created_at as createdAt',
] as const;

function jsonb(value: unknown): RawBuilder<Json> {
  return sql<Json>`${JSON.stringify(value)}::jsonb`;
}

export class SystemExamsRepository {
  constructor(
    private readonly handle: SystemBankDb | null,
    private readonly notConfiguredError: () => Error = () => new Error('system_bank.not_configured'),
  ) {}

  private db(): SystemBankDb {
    if (!this.handle) throw this.notConfiguredError();
    return this.handle;
  }

  async submit(input: {
    centreSlug: string; sourceExamId: string; sourceVersionId: string;
    sourceVersionNumber: number; package: SystemExamPackage; checksum: string; submittedBy: string;
  }): Promise<SystemExamVersionRow> {
    return this.db().transaction().execute(async (tx) => {
      const inserted = await tx.insertInto('system_exam_versions').values({
        centre_slug: input.centreSlug, source_exam_id: input.sourceExamId,
        source_version_id: input.sourceVersionId, source_version_number: input.sourceVersionNumber,
        package: jsonb(input.package), checksum: input.checksum, submitted_by: input.submittedBy,
      }).onConflict((oc) => oc.columns(['centre_slug', 'source_exam_id', 'source_version_id']).doNothing())
        .returning(COLUMNS).executeTakeFirst();
      return inserted ?? tx.selectFrom('system_exam_versions').select(COLUMNS)
        .where('centre_slug', '=', input.centreSlug)
        .where('source_exam_id', '=', input.sourceExamId)
        .where('source_version_id', '=', input.sourceVersionId).executeTakeFirstOrThrow();
    });
  }

  async get(id: string): Promise<SystemExamVersionRow | null> {
    return await this.db().selectFrom('system_exam_versions').select(COLUMNS)
      .where('id', '=', id).executeTakeFirst() ?? null;
  }

  async listPublished(): Promise<SystemExamVersionRow[]> {
    return this.db().selectFrom('system_exam_versions').select(COLUMNS)
      .where('status', '=', 'approved').orderBy('created_at', 'desc').execute();
  }

  async listMine(centreSlug: string): Promise<SystemExamVersionRow[]> {
    return this.db().selectFrom('system_exam_versions').select(COLUMNS)
      .where('centre_slug', '=', centreSlug).orderBy('created_at', 'desc').execute();
  }

  async listPending(): Promise<SystemExamVersionRow[]> {
    return this.db().selectFrom('system_exam_versions').select(COLUMNS)
      .where('status', '=', 'pending').orderBy('created_at', 'asc').execute();
  }

  async review(id: string, reviewerId: string, decision: 'approved' | 'rejected', reason?: string): Promise<SystemExamVersionRow | null> {
    return this.db().transaction().execute(async (tx) => {
      const current = await tx.selectFrom('system_exam_versions').select(COLUMNS)
        .where('id', '=', id).forUpdate().executeTakeFirst();
      if (!current || current.status !== 'pending') return current ?? null;
      return tx.updateTable('system_exam_versions').set({
        status: decision, reviewed_by: reviewerId, reviewed_at: new Date(),
        rejection_reason: decision === 'rejected' ? reason ?? null : null,
      }).where('id', '=', id).returning(COLUMNS).executeTakeFirstOrThrow();
    });
  }
}
