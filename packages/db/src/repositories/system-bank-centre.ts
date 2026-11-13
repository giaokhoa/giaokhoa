import { sql, type RawBuilder } from 'kysely';
import type { CentreDb, CentreTx } from '../client';
import type { LearningOutcomeDoc } from '../jsonb-types';

export type SbCentreTx = CentreTx;
export type SbCentreDb = CentreDb | CentreTx;

export interface SystemQuestionImportRow {
  questionId: string;
  sourceQuestionId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  packageChecksum: string;
  importedVersionNumber: number;
  importedAt: Date;
  importedBy: string | null;
  kind: string;
}

export interface SystemBankEventReceiptRow {
  id: string;
  eventId: string;
  centreSlug: string;
  receivedAt: Date;
}

export interface OutcomePackageInstallRow {
  id: string;
  packageVersion: string;
  packageChecksum: string;
  previousVersion: string | null;
  scope: string;
  installedAt: Date;
  installedBy: string | null;
}

export interface SystemBankSubjectRow {
  id: string;
  contextId: string;
  name: string;
  slug: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SystemBankCurriculumRow {
  id: string;
  subjectId: string;
  grade: number;
  createdAt: Date;
  updatedAt: Date;
}

function jsonbColumn<T>(value: unknown): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

const SYSTEM_QUESTION_IMPORT_COLUMNS = [
  'question_id as questionId',
  'source_question_id as sourceQuestionId',
  'source_version_id as sourceVersionId',
  'source_version_number as sourceVersionNumber',
  'package_checksum as packageChecksum',
  'imported_version_number as importedVersionNumber',
  'imported_at as importedAt',
  'imported_by as importedBy',
  'kind',
] as const;

const SYSTEM_BANK_EVENT_RECEIPT_COLUMNS = [
  'id',
  'event_id as eventId',
  'centre_slug as centreSlug',
  'received_at as receivedAt',
] as const;

const OUTCOME_PACKAGE_INSTALL_COLUMNS = [
  'id',
  'package_version as packageVersion',
  'package_checksum as packageChecksum',
  'previous_version as previousVersion',
  'scope',
  'installed_at as installedAt',
  'installed_by as installedBy',
] as const;

const SUBJECT_COLUMNS = [
  'id',
  'context_id as contextId',
  'name',
  'slug',
  'position',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const CURRICULUM_COLUMNS = [
  'id',
  'subject_id as subjectId',
  'grade',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

export class SystemBankCentreRepository {
  constructor(private readonly db: CentreDb) {}

  async resolveTenantSlug(tenantId: string): Promise<string | null> {
    const rows = await this.db
      .selectFrom('tenants')
      .select(['slug'])
      .where('id', '=', tenantId)
      .limit(1)
      .execute();
    return rows[0]?.slug ?? null;
  }

  async outcomeExists(outcomeId: string): Promise<boolean> {
    const rows = await this.db
      .selectFrom('learning_outcomes')
      .select(['id'])
      .where('id', '=', outcomeId)
      .limit(1)
      .execute();
    return rows.length > 0;
  }

  async insertImportRow(
    input: {
      questionId: string;
      sourceQuestionId: string;
      sourceVersionId: string;
      sourceVersionNumber: number;
      packageChecksum: string;
      importedVersionNumber: number;
      importedBy: string | null;
      kind: 'pristine' | 'derived';
    },
    tx?: SbCentreDb,
  ): Promise<SystemQuestionImportRow> {
    const handle = tx ?? this.db;
    const [row] = await handle
      .insertInto('system_question_imports')
      .values({
        question_id: input.questionId,
        source_question_id: input.sourceQuestionId,
        source_version_id: input.sourceVersionId,
        source_version_number: input.sourceVersionNumber,
        package_checksum: input.packageChecksum,
        imported_version_number: input.importedVersionNumber,
        imported_by: input.importedBy,
        kind: input.kind,
      })
      .returning(SYSTEM_QUESTION_IMPORT_COLUMNS)
      .execute();
    if (!row) throw new Error('system bank: failed to insert question import row');
    return row;
  }

  async getImportRow(questionId: string, tx?: SbCentreDb): Promise<SystemQuestionImportRow | null> {
    const handle = tx ?? this.db;
    const row = await handle
      .selectFrom('system_question_imports')
      .select(SYSTEM_QUESTION_IMPORT_COLUMNS)
      .where('question_id', '=', questionId)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async flipImportToDerived(questionId: string, tx?: SbCentreDb): Promise<void> {
    const handle = tx ?? this.db;
    await handle
      .updateTable('system_question_imports')
      .set({ kind: 'derived' })
      .where('question_id', '=', questionId)
      .where('kind', '=', 'pristine')
      .execute();
  }

  async insertEventReceipt(input: {
    eventId: string;
    centreSlug: string;
  }): Promise<SystemBankEventReceiptRow> {
    const [row] = await this.db
      .insertInto('system_bank_event_receipts')
      .values({ event_id: input.eventId, centre_slug: input.centreSlug })
      .onConflict((oc) => oc.columns(['event_id', 'centre_slug']).doNothing())
      .returning(SYSTEM_BANK_EVENT_RECEIPT_COLUMNS)
      .execute();
    if (row) return row;
    const existing = await this.db
      .selectFrom('system_bank_event_receipts')
      .select(SYSTEM_BANK_EVENT_RECEIPT_COLUMNS)
      .where('event_id', '=', input.eventId)
      .where('centre_slug', '=', input.centreSlug)
      .limit(1)
      .executeTakeFirst();
    if (!existing) throw new Error('system bank: failed to record event receipt');
    return existing;
  }

  async listEventReceiptEventIds(centreSlug: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('system_bank_event_receipts')
      .select(['event_id as eventId'])
      .where('centre_slug', '=', centreSlug)
      .execute();
    return rows.map((row) => row.eventId);
  }

  async getOutcomePackageInstall(scope?: string, tx?: SbCentreDb): Promise<OutcomePackageInstallRow | null> {
    let query = (tx ?? this.db)
      .selectFrom('outcome_package_installs')
      .select(OUTCOME_PACKAGE_INSTALL_COLUMNS);
    if (scope) query = query.where('scope', '=', scope);
    const row = await query.orderBy('installed_at', 'desc').limit(1).executeTakeFirst();
    return row ?? null;
  }

  async listOutcomePackageInstalls(): Promise<OutcomePackageInstallRow[]> {
    return this.db.selectFrom('outcome_package_installs')
      .select(OUTCOME_PACKAGE_INSTALL_COLUMNS)
      .orderBy('installed_at', 'desc').execute();
  }

  async getOutcomePackageInstallByVersion(version: string, tx?: SbCentreDb): Promise<OutcomePackageInstallRow | null> {
    return (await (tx ?? this.db).selectFrom('outcome_package_installs')
      .select(OUTCOME_PACKAGE_INSTALL_COLUMNS).where('package_version', '=', version)
      .executeTakeFirst()) ?? null;
  }

  async insertSubject(input: { contextId: string; name: string; slug: string; position: number }, tx: SbCentreDb): Promise<SystemBankSubjectRow> {
    const [row] = await tx.insertInto('subjects')
      .values({ context_id: input.contextId, name: input.name, slug: input.slug, position: input.position })
      .returning(SUBJECT_COLUMNS).execute();
    if (!row) throw new Error('system bank: failed to install subject');
    return row;
  }

  async findSubjectBySlug(slug: string, tx?: SbCentreDb): Promise<SystemBankSubjectRow | null> {
    const row = await (tx ?? this.db)
      .selectFrom('subjects')
      .select(SUBJECT_COLUMNS)
      .where('slug', '=', slug)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async findCurriculumBySubjectGrade(subjectId: string, grade: number, tx?: SbCentreDb): Promise<SystemBankCurriculumRow | null> {
    const row = await (tx ?? this.db)
      .selectFrom('curricula')
      .select(CURRICULUM_COLUMNS)
      .where('subject_id', '=', subjectId)
      .where('grade', '=', grade)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async upsertCurriculum(input: { id: string; subjectId: string; grade: number }, tx?: SbCentreDb): Promise<void> {
    await (tx ?? this.db)
      .insertInto('curricula')
      .values({ id: input.id, subject_id: input.subjectId, grade: input.grade })
      .onConflict((oc) =>
        oc.column('id').doNothing(),
      )
      .execute();
  }

  async upsertCurriculumNode(input: {
    id: string;
    curriculumId: string;
    parentId: string | null;
    title: string;
    kind: string;
    position: number;
    durationPeriods: number | null;
    durationPercent: number | null;
  }, tx?: SbCentreDb): Promise<void> {
    await (tx ?? this.db)
      .insertInto('curriculum_nodes')
      .values({
        id: input.id,
        curriculum_id: input.curriculumId,
        parent_id: input.parentId,
        title: input.title,
        kind: input.kind,
        position: input.position,
        duration_periods: input.durationPeriods,
        duration_percent: input.durationPercent,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }

  async upsertLearningOutcome(input: {
    id: string;
    nodeId: string;
    position: number;
    content: unknown;
    sourceKind: string;
    sourceRef: string | null;
  }, tx?: SbCentreDb): Promise<void> {
    await (tx ?? this.db)
      .insertInto('learning_outcomes')
      .values({
        id: input.id,
        node_id: input.nodeId,
        position: input.position,
        content: jsonbColumn<LearningOutcomeDoc>(input.content),
        source_kind: input.sourceKind,
        source_ref: input.sourceRef,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }

  async recordOutcomePackageInstall(input: {
    packageVersion: string;
    packageChecksum: string;
    previousVersion: string | null;
    scope: string;
    installedBy: string | null;
  }, tx?: SbCentreDb): Promise<OutcomePackageInstallRow> {
    const [row] = await (tx ?? this.db)
      .insertInto('outcome_package_installs')
      .values({
        package_version: input.packageVersion,
        package_checksum: input.packageChecksum,
        previous_version: input.previousVersion,
        scope: input.scope,
        installed_by: input.installedBy,
      })
      .onConflict((oc) => oc.column('package_version').doNothing())
      .returning(OUTCOME_PACKAGE_INSTALL_COLUMNS)
      .execute();
    if (row) return row;
    const existing = await this.getOutcomePackageInstallByVersion(input.packageVersion, tx);
    if (!existing) throw new Error('system bank: failed to record outcome package install');
    return existing;
  }
}
