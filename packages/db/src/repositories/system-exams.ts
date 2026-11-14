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
  withdrawnAt: Date | null;
  withdrawnReason: string | null;
  createdAt: Date;
}

const COLUMNS = [
  'id', 'centre_slug as centreSlug', 'source_exam_id as sourceExamId',
  'source_version_id as sourceVersionId', 'source_version_number as sourceVersionNumber',
  'package', 'checksum', 'submitted_by as submittedBy', 'status',
  'reviewed_by as reviewedBy', 'reviewed_at as reviewedAt',
  'rejection_reason as rejectionReason', 'withdrawn_at as withdrawnAt',
  'withdrawn_reason as withdrawnReason', 'created_at as createdAt',
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
      const withdrawn = await tx.selectFrom('system_exam_versions').select('id')
        .where('centre_slug', '=', input.centreSlug)
        .where('source_exam_id', '=', input.sourceExamId)
        .where('status', '=', 'withdrawn').executeTakeFirst();
      if (withdrawn) throw new Error('system_exam.source_withdrawn');
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

  async listApprovedSourceVersions(centreSlug: string, sourceExamId: string): Promise<SystemExamVersionRow[]> {
    return this.db().selectFrom('system_exam_versions').select(COLUMNS)
      .where('centre_slug', '=', centreSlug).where('source_exam_id', '=', sourceExamId)
      .where('status', '=', 'approved').orderBy('source_version_number', 'desc').execute();
  }

  async withdrawSource(id: string, reason: string): Promise<SystemExamVersionRow | null> {
    return this.db().transaction().execute(async (tx) => {
      const row = await tx.selectFrom('system_exam_versions').select(COLUMNS)
        .where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row || row.status !== 'approved') return null;
      const at = new Date();
      await tx.updateTable('system_exam_versions').set({
        status: 'withdrawn', withdrawn_at: at, withdrawn_reason: reason,
      }).where('centre_slug', '=', row.centreSlug)
        .where('source_exam_id', '=', row.sourceExamId).where('status', '=', 'approved').execute();
      await tx.insertInto('system_bank_events').values({
        type: 'exam_withdrawn', resource_kind: 'exam',
        resource_key: `${row.centreSlug}/${row.sourceExamId}`,
        payload: jsonb({ sourceExamId: row.sourceExamId, reason }),
      }).execute();
      return tx.selectFrom('system_exam_versions').select(COLUMNS)
        .where('id', '=', id).executeTakeFirstOrThrow();
    });
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
      const updated = await tx.updateTable('system_exam_versions').set({
        status: decision, reviewed_by: reviewerId, reviewed_at: new Date(),
        rejection_reason: decision === 'rejected' ? reason ?? null : null,
      }).where('id', '=', id).returning(COLUMNS).executeTakeFirstOrThrow();
      if (decision === 'approved') {
        await tx.insertInto('system_bank_events').values({
          type: 'exam_version_published', resource_kind: 'exam',
          resource_key: `${current.centreSlug}/${current.sourceExamId}`,
          payload: jsonb({ versionId: current.id, versionNumber: current.sourceVersionNumber, checksum: current.checksum }),
        }).execute();
      }
      return updated;
    });
  }
}
