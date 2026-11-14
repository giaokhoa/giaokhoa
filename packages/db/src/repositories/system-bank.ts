import { sql, type InsertObject, type RawBuilder } from 'kysely';
import type { SystemBankPackage } from '@giaokhoa/contracts';
import type { SystemBankDb, SystemBankTx, SystemBankDB } from '../client';
import type { Json } from '../types/system-bank-db';

export type SbTx = SystemBankTx;
export type SbDb = SystemBankDb | SystemBankTx;

export interface SystemQuestionRow {
  id: string;
  qtype: string;
  status: string;
  withdrawnReason: string | null;
  withdrawnBy: string | null;
  withdrawnAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SystemQuestionVersionRow {
  id: string;
  questionId: string;
  version: number;
  checksum: string;
  package: unknown;
  createdAt: Date;
}

export interface SystemQuestionVersionOutcomeRow {
  id: string;
  versionId: string;
  outcomeId: string;
  cognitiveLevel: string;
  createdAt: Date;
}

export interface SystemQuestionImporterRow {
  id: string;
  sourceQuestionId: string;
  centreSlug: string;
  importedAt: Date;
  importedBy: string | null;
}

export interface SystemBankEventRow {
  id: string;
  type: string;
  sourceQuestionId: string | null;
  resourceKind: string | null;
  resourceKey: string | null;
  payload: unknown;
  createdAt: Date;
}

export interface SystemOutcomePackageRow {
  id: string;
  version: string;
  scope: string;
  checksum: string;
  outcomeCount: number;
  createdBy: string | null;
  createdAt: Date;
  status: string;
  centreSlug: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  withdrawnAt: Date | null;
  withdrawnReason: string | null;
}

export interface SystemOutcomePackageCurriculumRow {
  id: string;
  packageId: string;
  curriculumId: string;
  subjectSlug: string;
  subjectName: string | null;
  subjectPosition: number;
  grade: number;
}

export interface SystemOutcomePackageNodeRow {
  id: string;
  packageId: string;
  nodeId: string;
  curriculumId: string;
  parentId: string | null;
  title: string;
  kind: string;
  position: number;
  durationPeriods: number | null;
  durationPercent: number | null;
}

export interface SystemOutcomePackageOutcomeRow {
  id: string;
  packageId: string;
  outcomeId: string;
  nodeId: string;
  position: number;
  content: unknown;
  sourceKind: string;
  sourceRef: string | null;
}

export interface SystemOutcomePackageMappingRow {
  id: string;
  packageId: string;
  fromOutcomeId: string;
  toOutcomeId: string;
  note: string;
}

export class SystemBankNotConfiguredError extends Error {
  readonly code = 'system_bank.not_configured';

  constructor() {
    super('System bank database is not configured');
    this.name = 'SystemBankNotConfiguredError';
  }
}

function jsonbColumn<T>(value: unknown): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

const SYSTEM_QUESTION_COLUMNS = [
  'id',
  'qtype',
  'status',
  'withdrawn_reason as withdrawnReason',
  'withdrawn_by as withdrawnBy',
  'withdrawn_at as withdrawnAt',
  'created_by as createdBy',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const SYSTEM_QUESTION_VERSION_COLUMNS = [
  'id',
  'question_id as questionId',
  'version',
  'checksum',
  'package',
  'created_at as createdAt',
] as const;

const SYSTEM_QUESTION_VERSION_OUTCOME_COLUMNS = [
  'id',
  'version_id as versionId',
  'outcome_id as outcomeId',
  'cognitive_level as cognitiveLevel',
  'created_at as createdAt',
] as const;

const SYSTEM_QUESTION_IMPORTER_COLUMNS = [
  'id',
  'source_question_id as sourceQuestionId',
  'centre_slug as centreSlug',
  'imported_at as importedAt',
  'imported_by as importedBy',
] as const;

const SYSTEM_BANK_EVENT_COLUMNS = [
  'id',
  'type',
  'source_question_id as sourceQuestionId',
  'resource_kind as resourceKind',
  'resource_key as resourceKey',
  'payload',
  'created_at as createdAt',
] as const;

const SYSTEM_OUTCOME_PACKAGE_COLUMNS = [
  'id',
  'version',
  'scope',
  'checksum',
  'outcome_count as outcomeCount',
  'created_by as createdBy',
  'created_at as createdAt',
  'status',
  'centre_slug as centreSlug',
  'reviewed_by as reviewedBy',
  'reviewed_at as reviewedAt',
  'rejection_reason as rejectionReason',
  'withdrawn_at as withdrawnAt',
  'withdrawn_reason as withdrawnReason',
] as const;

const SYSTEM_OUTCOME_PACKAGE_CURRICULUM_COLUMNS = [
  'id',
  'package_id as packageId',
  'curriculum_id as curriculumId',
  'subject_slug as subjectSlug',
  'subject_name as subjectName',
  'subject_position as subjectPosition',
  'grade',
] as const;

const SYSTEM_OUTCOME_PACKAGE_NODE_COLUMNS = [
  'id',
  'package_id as packageId',
  'node_id as nodeId',
  'curriculum_id as curriculumId',
  'parent_id as parentId',
  'title',
  'kind',
  'position',
  'duration_periods as durationPeriods',
  'duration_percent as durationPercent',
] as const;

const SYSTEM_OUTCOME_PACKAGE_OUTCOME_COLUMNS = [
  'id',
  'package_id as packageId',
  'outcome_id as outcomeId',
  'node_id as nodeId',
  'position',
  'content',
  'source_kind as sourceKind',
  'source_ref as sourceRef',
] as const;

const SYSTEM_OUTCOME_PACKAGE_MAPPING_COLUMNS = [
  'id',
  'package_id as packageId',
  'from_outcome_id as fromOutcomeId',
  'to_outcome_id as toOutcomeId',
  'note',
] as const;

export class SystemBankRepository {
  constructor(
    private readonly handle: SystemBankDb | null,
    private readonly notConfiguredError: () => Error = () => new SystemBankNotConfiguredError(),
  ) {}

  private db(): SystemBankDb {
    if (!this.handle) {
      throw this.notConfiguredError();
    }
    return this.handle;
  }

  async createQuestionWithFirstVersion(input: {
    id?: string;
    qtype: string;
    createdBy: string | null;
    package: SystemBankPackage;
    checksum: string;
  }): Promise<{ question: SystemQuestionRow; version: SystemQuestionVersionRow }> {
    return this.db()
      .transaction()
      .execute(async (tx) => {
        const questionValues: InsertObject<SystemBankDB, 'system_questions'> = {
          qtype: input.qtype,
          status: 'published',
          created_by: input.createdBy,
        };
        if (input.id !== undefined) questionValues.id = input.id;
        const [question] = await tx
          .insertInto('system_questions')
          .values(questionValues)
          .returning(SYSTEM_QUESTION_COLUMNS)
          .execute();
        if (!question) throw new Error('system bank: failed to insert system question');
        const [version] = await tx
          .insertInto('system_question_versions')
          .values({
            question_id: question.id,
            version: 1,
            checksum: input.checksum,
            package: jsonbColumn<Json>(input.package),
          })
          .returning(SYSTEM_QUESTION_VERSION_COLUMNS)
          .execute();
        if (!version) throw new Error('system bank: failed to insert system question version');
        if (input.package.outcomes.length > 0) {
          await tx
            .insertInto('system_question_version_outcomes')
            .values(
              input.package.outcomes.map((outcome) => ({
                version_id: version.id,
                outcome_id: outcome.outcomeId,
                cognitive_level: outcome.cognitiveLevel,
              })),
            )
            .execute();
        }
        return { question, version };
      });
  }

  async createVersion(
    questionId: string,
    pkg: SystemBankPackage,
    checksum: string,
  ): Promise<SystemQuestionVersionRow> {
    return this.db()
      .transaction()
      .execute(async (tx) => {
        const latest = await tx
          .selectFrom('system_question_versions')
          .select(['version'])
          .where('question_id', '=', questionId)
          .orderBy('version', 'desc')
          .limit(1)
          .execute();
        const nextVersion = (latest[0]?.version ?? 0) + 1;
        const [version] = await tx
          .insertInto('system_question_versions')
          .values({
            question_id: questionId,
            version: nextVersion,
            checksum,
            package: jsonbColumn<Json>(pkg),
          })
          .returning(SYSTEM_QUESTION_VERSION_COLUMNS)
          .execute();
        if (!version) throw new Error('system bank: failed to insert system question version');
        if (pkg.outcomes.length > 0) {
          await tx
            .insertInto('system_question_version_outcomes')
            .values(
              pkg.outcomes.map((outcome) => ({
                version_id: version.id,
                outcome_id: outcome.outcomeId,
                cognitive_level: outcome.cognitiveLevel,
              })),
            )
            .execute();
        }
        await tx.insertInto('system_bank_events').values({
          type: 'question_version_published',
          source_question_id: questionId,
          payload: jsonbColumn<Json>({
            versionId: version.id,
            versionNumber: version.version,
            checksum: version.checksum,
          }),
        }).execute();
        return version;
      });
  }

  async getQuestion(id: string): Promise<SystemQuestionRow | null> {
    const row = await this.db()
      .selectFrom('system_questions')
      .select(SYSTEM_QUESTION_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async getVersionByNumber(questionId: string, version: number): Promise<SystemQuestionVersionRow | null> {
    const row = await this.db()
      .selectFrom('system_question_versions')
      .select(SYSTEM_QUESTION_VERSION_COLUMNS)
      .where('question_id', '=', questionId)
      .where('version', '=', version)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async listVersions(questionId: string): Promise<SystemQuestionVersionRow[]> {
    return this.db()
      .selectFrom('system_question_versions')
      .select(SYSTEM_QUESTION_VERSION_COLUMNS)
      .where('question_id', '=', questionId)
      .orderBy('version', 'asc')
      .execute();
  }

  async getLatestVersion(questionId: string): Promise<SystemQuestionVersionRow | null> {
    const row = await this.db()
      .selectFrom('system_question_versions')
      .select(SYSTEM_QUESTION_VERSION_COLUMNS)
      .where('question_id', '=', questionId)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async markWithdrawn(
    id: string,
    input: { reason: string; by: string | null },
  ): Promise<{ question: SystemQuestionRow; event: SystemBankEventRow } | null> {
    return this.db().transaction().execute(async (tx) => {
      const withdrawnAt = new Date();
      const question = await tx.updateTable('system_questions').set({
        status: 'withdrawn',
        withdrawn_reason: input.reason,
        withdrawn_by: input.by,
        withdrawn_at: withdrawnAt,
        updated_at: withdrawnAt,
      }).where('id', '=', id).where('status', '=', 'published')
        .returning(SYSTEM_QUESTION_COLUMNS).executeTakeFirst();
      if (!question) return null;
      const event = await tx.insertInto('system_bank_events').values({
        type: 'question_withdrawn',
        source_question_id: id,
        payload: jsonbColumn<Json>({
          reason: input.reason, withdrawnBy: input.by, withdrawnAt: withdrawnAt.toISOString(),
        }),
      }).returning(SYSTEM_BANK_EVENT_COLUMNS).executeTakeFirstOrThrow();
      return { question, event };
    });
  }

  async recordEvent(input: {
    type: string;
    sourceQuestionId: string;
    payload: Record<string, unknown>;
  }): Promise<SystemBankEventRow> {
    const [event] = await this.db()
      .insertInto('system_bank_events')
      .values({
        type: input.type,
        source_question_id: input.sourceQuestionId,
        payload: jsonbColumn<Json>(input.payload),
      })
      .returning(SYSTEM_BANK_EVENT_COLUMNS)
      .execute();
    if (!event) throw new Error('system bank: failed to insert bank event');
    return event;
  }

  async listPublishedQuestionsWithVersions(filters: {
    qtype?: string;
    outcomeId?: string;
    cognitiveLevel?: string;
  }): Promise<
    Array<{
      question: SystemQuestionRow;
      versions: SystemQuestionVersionRow[];
      outcomeLinks: Array<{ versionId: string; outcomeId: string; cognitiveLevel: string }>;
    }>
  > {
    const db = this.db();
    let questionsQuery = db
      .selectFrom('system_questions')
      .select(SYSTEM_QUESTION_COLUMNS)
      .where('status', '=', 'published');
    if (filters.qtype) {
      questionsQuery = questionsQuery.where('qtype', '=', filters.qtype);
    }
    const questions = await questionsQuery.execute();
    if (questions.length === 0) return [];
    const questionIds = questions.map((question) => question.id);
    const versions = await db
      .selectFrom('system_question_versions')
      .select(SYSTEM_QUESTION_VERSION_COLUMNS)
      .where('question_id', 'in', questionIds)
      .execute();
    const versionIds = versions.map((version) => version.id);
    const outcomeLinks: SystemQuestionVersionOutcomeRow[] =
      versionIds.length === 0
        ? []
        : await db
            .selectFrom('system_question_version_outcomes')
            .select(SYSTEM_QUESTION_VERSION_OUTCOME_COLUMNS)
            .where('version_id', 'in', versionIds)
            .execute();
    const versionsByQuestion = new Map<string, SystemQuestionVersionRow[]>();
    for (const version of versions) {
      const list = versionsByQuestion.get(version.questionId) ?? [];
      list.push(version);
      versionsByQuestion.set(version.questionId, list);
    }
    const result = questions
      .map((question) => ({
        question,
        versions: (versionsByQuestion.get(question.id) ?? []).sort((a, b) => a.version - b.version),
        outcomeLinks: outcomeLinks.filter((link) =>
          (versionsByQuestion.get(question.id) ?? []).some((version) => version.id === link.versionId),
        ),
      }))
      .filter((entry) => {
        if (!filters.outcomeId && !filters.cognitiveLevel) return true;
        return entry.outcomeLinks.some(
          (link) =>
            (!filters.outcomeId || link.outcomeId === filters.outcomeId) &&
            (!filters.cognitiveLevel || link.cognitiveLevel === filters.cognitiveLevel),
        );
      });
    return result;
  }

  async listImportedQuestionIds(centreSlug: string): Promise<string[]> {
    const rows = await this.db()
      .selectFrom('system_question_importers')
      .select(['source_question_id as sourceQuestionId'])
      .where('centre_slug', '=', centreSlug)
      .execute();
    return rows.map((row) => row.sourceQuestionId);
  }

  async listResourceEvents(keys: Array<{ kind: 'exam' | 'material' | 'programme'; key: string }>): Promise<SystemBankEventRow[]> {
    if (keys.length === 0) return [];
    const kinds = [...new Set(keys.map((entry) => entry.kind))];
    const resourceKeys = [...new Set(keys.map((entry) => entry.key))];
    const allowed = new Set(keys.map((entry) => `${entry.kind}/${entry.key}`));
    const events = await this.db().selectFrom('system_bank_events')
      .select(SYSTEM_BANK_EVENT_COLUMNS)
      .where('resource_kind', 'in', kinds)
      .where('resource_key', 'in', resourceKeys)
      .orderBy('created_at', 'asc')
      .execute();
    return events.filter((event) => allowed.has(`${event.resourceKind}/${event.resourceKey}`));
  }

  async listExamSourcesForVersions(versionIds: string[]): Promise<Array<{ id: string; centreSlug: string; sourceExamId: string; status: string }>> {
    if (versionIds.length === 0) return [];
    return this.db().selectFrom('system_exam_versions')
      .select(['id', 'centre_slug as centreSlug', 'source_exam_id as sourceExamId', 'status'])
      .where('id', 'in', versionIds).execute();
  }

  async listResourceEventsForScope(kind: 'exam' | 'material' | 'programme', key: string): Promise<SystemBankEventRow[]> {
    return this.listResourceEvents([{ kind, key }]);
  }

  async listEventsForQuestions(sourceQuestionIds: string[]): Promise<SystemBankEventRow[]> {
    if (sourceQuestionIds.length === 0) return [];
    return this.db()
      .selectFrom('system_bank_events')
      .select(SYSTEM_BANK_EVENT_COLUMNS)
      .where('source_question_id', 'in', sourceQuestionIds)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async listImporterSlugs(sourceQuestionId: string): Promise<string[]> {
    const rows = await this.db()
      .selectFrom('system_question_importers')
      .select(['centre_slug as centreSlug'])
      .where('source_question_id', '=', sourceQuestionId)
      .execute();
    return rows.map((row) => row.centreSlug);
  }

  async recordImporter(input: {
    sourceQuestionId: string;
    centreSlug: string;
    importedBy: string | null;
  }): Promise<SystemQuestionImporterRow> {
    const db = this.db();
    const [row] = await db
      .insertInto('system_question_importers')
      .values({
        source_question_id: input.sourceQuestionId,
        centre_slug: input.centreSlug,
        imported_by: input.importedBy,
      })
      .onConflict((oc) => oc.columns(['source_question_id', 'centre_slug']).doNothing())
      .returning(SYSTEM_QUESTION_IMPORTER_COLUMNS)
      .execute();
    if (row) return row;
    const existing = await db
      .selectFrom('system_question_importers')
      .select(SYSTEM_QUESTION_IMPORTER_COLUMNS)
      .where('source_question_id', '=', input.sourceQuestionId)
      .where('centre_slug', '=', input.centreSlug)
      .limit(1)
      .executeTakeFirst();
    if (!existing) throw new Error('system bank: failed to record importer');
    return existing;
  }

  async createPackageWithItems(input: {
    version: string;
    scope: string;
    checksum: string;
    outcomeCount: number;
    createdBy: string | null;
    centreSlug: string | null;
    curricula: Array<{ curriculumId: string; subjectSlug: string; subjectName: string; subjectPosition: number; grade: number }>;
    nodes: Array<{
      nodeId: string;
      curriculumId: string;
      parentId: string | null;
      title: string;
      kind: string;
      position: number;
      durationPeriods: number | null;
      durationPercent: number | null;
    }>;
    outcomes: Array<{
      outcomeId: string;
      nodeId: string;
      position: number;
      content: unknown;
      sourceKind: string;
      sourceRef: string | null;
    }>;
    mappings: Array<{ fromOutcomeId: string; toOutcomeId: string; note: string }>;
  }): Promise<SystemOutcomePackageRow> {
    return this.db()
      .transaction()
      .execute(async (tx) => {
        const [pkg] = await tx
          .insertInto('system_outcome_packages')
          .values({
            version: input.version,
            scope: input.scope,
            checksum: input.checksum,
            outcome_count: input.outcomeCount,
            created_by: input.createdBy,
            centre_slug: input.centreSlug,
            status: 'pending',
          })
          .returning(SYSTEM_OUTCOME_PACKAGE_COLUMNS)
          .execute();
        if (!pkg) throw new Error('system bank: failed to create outcome package');
        if (input.curricula.length > 0) {
          await tx
            .insertInto('system_outcome_package_curricula')
            .values(
              input.curricula.map((curriculum) => ({
                package_id: pkg.id,
                curriculum_id: curriculum.curriculumId,
                subject_slug: curriculum.subjectSlug,
                subject_name: curriculum.subjectName,
                subject_position: curriculum.subjectPosition,
                grade: curriculum.grade,
              })),
            )
            .execute();
        }
        if (input.nodes.length > 0) {
          await tx
            .insertInto('system_outcome_package_nodes')
            .values(
              input.nodes.map((node) => ({
                package_id: pkg.id,
                node_id: node.nodeId,
                curriculum_id: node.curriculumId,
                parent_id: node.parentId,
                title: node.title,
                kind: node.kind,
                position: node.position,
                duration_periods: node.durationPeriods,
                duration_percent: node.durationPercent,
              })),
            )
            .execute();
        }
        if (input.outcomes.length > 0) {
          await tx
            .insertInto('system_outcome_package_outcomes')
            .values(
              input.outcomes.map((outcome) => ({
                package_id: pkg.id,
                outcome_id: outcome.outcomeId,
                node_id: outcome.nodeId,
                position: outcome.position,
                content: jsonbColumn<Json>(outcome.content),
                source_kind: outcome.sourceKind,
                source_ref: outcome.sourceRef,
              })),
            )
            .execute();
        }
        if (input.mappings.length > 0) {
          await tx
            .insertInto('system_outcome_package_mappings')
            .values(
              input.mappings.map((mapping) => ({
                package_id: pkg.id,
                from_outcome_id: mapping.fromOutcomeId,
                to_outcome_id: mapping.toOutcomeId,
                note: mapping.note,
              })),
            )
            .execute();
        }
        return pkg;
      });
  }

  async withdrawPackage(version: string, actorId: string, reason: string): Promise<SystemOutcomePackageRow | null> {
    return this.db().transaction().execute(async (tx) => {
      const row = await tx.selectFrom('system_outcome_packages').select(SYSTEM_OUTCOME_PACKAGE_COLUMNS)
        .where('version', '=', version).forUpdate().executeTakeFirst();
      if (!row || row.status !== 'published') return null;
      const withdrawn = await tx.updateTable('system_outcome_packages').set({
        status: 'withdrawn', withdrawn_at: new Date(), withdrawn_reason: reason,
      }).where('id', '=', row.id).returning(SYSTEM_OUTCOME_PACKAGE_COLUMNS).executeTakeFirstOrThrow();
      await tx.insertInto('system_bank_events').values({
        type: 'programme_withdrawn', resource_kind: 'programme', resource_key: row.scope,
        payload: jsonbColumn<Json>({ version: row.version, reason, withdrawnBy: actorId }),
      }).execute();
      return withdrawn;
    });
  }

  async getPackageByVersion(version: string): Promise<SystemOutcomePackageRow | null> {
    const row = await this.db()
      .selectFrom('system_outcome_packages')
      .select(SYSTEM_OUTCOME_PACKAGE_COLUMNS)
      .where('version', '=', version)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async listPackages(): Promise<SystemOutcomePackageRow[]> {
    return this.db().selectFrom('system_outcome_packages')
      .select(SYSTEM_OUTCOME_PACKAGE_COLUMNS)
      .where('status', '=', 'published')
      .orderBy('created_at', 'desc').execute();
  }

  async listPendingPackages(): Promise<SystemOutcomePackageRow[]> {
    return this.db().selectFrom('system_outcome_packages')
      .select(SYSTEM_OUTCOME_PACKAGE_COLUMNS)
      .where('status', '=', 'pending').orderBy('created_at', 'asc').execute();
  }

  async listCentrePackages(centreSlug: string): Promise<SystemOutcomePackageRow[]> {
    return this.db().selectFrom('system_outcome_packages')
      .select(SYSTEM_OUTCOME_PACKAGE_COLUMNS)
      .where('centre_slug', '=', centreSlug).orderBy('created_at', 'desc').execute();
  }

  async reviewPackage(version: string, actorId: string, approve: boolean, reason: string | null): Promise<SystemOutcomePackageRow | null> {
    return this.db().transaction().execute(async (tx) => {
      const row = await tx.selectFrom('system_outcome_packages')
        .select(SYSTEM_OUTCOME_PACKAGE_COLUMNS).where('version', '=', version)
        .forUpdate().executeTakeFirst();
      if (!row) return null;
      if (row.status !== 'pending') {
        if ((approve && row.status === 'published') || (!approve && row.status === 'rejected')) return row;
        throw new Error('system_bank.package_already_reviewed');
      }
      const reviewed = await tx.updateTable('system_outcome_packages')
        .set({
          status: approve ? 'published' : 'rejected',
          reviewed_by: actorId,
          reviewed_at: new Date(),
          rejection_reason: approve ? null : reason,
        }).where('id', '=', row.id).returning(SYSTEM_OUTCOME_PACKAGE_COLUMNS).executeTakeFirstOrThrow();
      if (approve) {
        await tx.insertInto('system_bank_events').values({
          type: 'programme_version_published', resource_kind: 'programme', resource_key: row.scope,
          payload: jsonbColumn<Json>({ version: row.version, checksum: row.checksum }),
        }).execute();
      }
      return reviewed;
    });
  }

  async getPackageItems(packageId: string): Promise<{
    curricula: SystemOutcomePackageCurriculumRow[];
    nodes: SystemOutcomePackageNodeRow[];
    outcomes: SystemOutcomePackageOutcomeRow[];
    mappings: SystemOutcomePackageMappingRow[];
  }> {
    const db = this.db();
    const [curricula, nodes, outcomes, mappings] = await Promise.all([
      db
        .selectFrom('system_outcome_package_curricula')
        .select(SYSTEM_OUTCOME_PACKAGE_CURRICULUM_COLUMNS)
        .where('package_id', '=', packageId)
        .execute(),
      db
        .selectFrom('system_outcome_package_nodes')
        .select(SYSTEM_OUTCOME_PACKAGE_NODE_COLUMNS)
        .where('package_id', '=', packageId)
        .execute(),
      db
        .selectFrom('system_outcome_package_outcomes')
        .select(SYSTEM_OUTCOME_PACKAGE_OUTCOME_COLUMNS)
        .where('package_id', '=', packageId)
        .execute(),
      db
        .selectFrom('system_outcome_package_mappings')
        .select(SYSTEM_OUTCOME_PACKAGE_MAPPING_COLUMNS)
        .where('package_id', '=', packageId)
        .execute(),
    ]);
    return { curricula, nodes, outcomes, mappings };
  }
}
