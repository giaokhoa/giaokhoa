import { sql, type InsertObject, type RawBuilder, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { LearningOutcomeDoc } from '../jsonb-types';
import type { JsonValue } from '../types/centre-db';
import { applyDefined } from './mapping';

export type CurriculumTx = CentreTx;
type Db = CentreDb | CentreTx;

export interface SubjectRow {
  id: string;
  contextId: string;
  name: string;
  slug: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSubject {
  id?: string;
  contextId: string;
  name: string;
  slug: string;
  position?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CurriculumRow {
  id: string;
  subjectId: string;
  grade: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCurriculum {
  id?: string;
  subjectId: string;
  grade: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CurriculumNodeRow {
  id: string;
  curriculumId: string;
  parentId: string | null;
  title: string;
  kind: string;
  position: number;
  durationPeriods: number | null;
  durationPercent: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCurriculumNode {
  id?: string;
  curriculumId: string;
  parentId?: string | null;
  title: string;
  kind?: string;
  position?: number;
  durationPeriods?: number | null;
  durationPercent?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LearningOutcomeRow {
  id: string;
  tenantId: string | null;
  nodeId: string;
  content: LearningOutcomeDoc;
  position: number;
  sourceKind: string;
  sourceRef: string | null;
  derivedFromId: string | null;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewLearningOutcome {
  id?: string;
  tenantId?: string | null;
  nodeId: string;
  content: LearningOutcomeDoc;
  position?: number;
  sourceKind?: string;
  sourceRef?: string | null;
  derivedFromId?: string | null;
  retiredAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProgramRecordRow {
  id: string;
  datasetKey: string;
  recordId: string;
  subjectId: string;
  curriculumId: string;
  nodeId: string;
  contentHash: string;
  source: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProgramRecord {
  id?: string;
  datasetKey: string;
  recordId: string;
  subjectId: string;
  curriculumId: string;
  nodeId: string;
  contentHash: string;
  source: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

function jsonbValue<T>(value: T): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

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

const CURRICULUM_NODE_COLUMNS = [
  'id',
  'curriculum_id as curriculumId',
  'parent_id as parentId',
  'title',
  'kind',
  'position',
  'duration_periods as durationPeriods',
  'duration_percent as durationPercent',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const LEARNING_OUTCOME_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'node_id as nodeId',
  'content',
  'position',
  'source_kind as sourceKind',
  'source_ref as sourceRef',
  'derived_from_id as derivedFromId',
  'retired_at as retiredAt',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const PROGRAM_RECORD_COLUMNS = [
  'id',
  'dataset_key as datasetKey',
  'record_id as recordId',
  'subject_id as subjectId',
  'curriculum_id as curriculumId',
  'node_id as nodeId',
  'content_hash as contentHash',
  'source',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

function subjectInsertValues(values: NewSubject): InsertObject<CentreDB, 'subjects'> {
  const row: InsertObject<CentreDB, 'subjects'> = {
    context_id: values.contextId,
    name: values.name,
    slug: values.slug,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['position', 'position'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function subjectUpdateSet(patch: Partial<NewSubject>): UpdateObject<CentreDB, 'subjects'> {
  const set: UpdateObject<CentreDB, 'subjects'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['contextId', 'context_id'],
    ['name', 'name'],
    ['slug', 'slug'],
    ['position', 'position'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

function curriculumInsertValues(values: NewCurriculum): InsertObject<CentreDB, 'curricula'> {
  const row: InsertObject<CentreDB, 'curricula'> = {
    subject_id: values.subjectId,
    grade: values.grade,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function curriculumUpdateSet(patch: Partial<NewCurriculum>): UpdateObject<CentreDB, 'curricula'> {
  const set: UpdateObject<CentreDB, 'curricula'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['subjectId', 'subject_id'],
    ['grade', 'grade'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

function curriculumNodeInsertValues(values: NewCurriculumNode): InsertObject<CentreDB, 'curriculum_nodes'> {
  const row: InsertObject<CentreDB, 'curriculum_nodes'> = {
    curriculum_id: values.curriculumId,
    title: values.title,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['parentId', 'parent_id'],
    ['kind', 'kind'],
    ['position', 'position'],
    ['durationPeriods', 'duration_periods'],
    ['durationPercent', 'duration_percent'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function curriculumNodeUpdateSet(patch: Partial<NewCurriculumNode>): UpdateObject<CentreDB, 'curriculum_nodes'> {
  const set: UpdateObject<CentreDB, 'curriculum_nodes'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['curriculumId', 'curriculum_id'],
    ['parentId', 'parent_id'],
    ['title', 'title'],
    ['kind', 'kind'],
    ['position', 'position'],
    ['durationPeriods', 'duration_periods'],
    ['durationPercent', 'duration_percent'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

function learningOutcomeInsertValues(values: NewLearningOutcome): InsertObject<CentreDB, 'learning_outcomes'> {
  const row: InsertObject<CentreDB, 'learning_outcomes'> = {
    node_id: values.nodeId,
    content: jsonbValue(values.content),
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['tenantId', 'tenant_id'],
    ['position', 'position'],
    ['sourceKind', 'source_kind'],
    ['sourceRef', 'source_ref'],
    ['derivedFromId', 'derived_from_id'],
    ['retiredAt', 'retired_at'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function learningOutcomeUpdateSet(patch: Partial<NewLearningOutcome>): UpdateObject<CentreDB, 'learning_outcomes'> {
  const set: UpdateObject<CentreDB, 'learning_outcomes'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['tenantId', 'tenant_id'],
    ['nodeId', 'node_id'],
    ['content', 'content', (value) => jsonbValue(value)],
    ['position', 'position'],
    ['sourceKind', 'source_kind'],
    ['sourceRef', 'source_ref'],
    ['derivedFromId', 'derived_from_id'],
    ['retiredAt', 'retired_at'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

function programRecordInsertValues(values: NewProgramRecord): InsertObject<CentreDB, 'curriculum_program_records'> {
  const row: InsertObject<CentreDB, 'curriculum_program_records'> = {
    dataset_key: values.datasetKey,
    record_id: values.recordId,
    subject_id: values.subjectId,
    curriculum_id: values.curriculumId,
    node_id: values.nodeId,
    content_hash: values.contentHash,
    source: jsonbValue<JsonValue>(values.source as JsonValue),
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function programRecordUpdateSet(patch: Partial<NewProgramRecord>): UpdateObject<CentreDB, 'curriculum_program_records'> {
  const set: UpdateObject<CentreDB, 'curriculum_program_records'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['datasetKey', 'dataset_key'],
    ['recordId', 'record_id'],
    ['subjectId', 'subject_id'],
    ['curriculumId', 'curriculum_id'],
    ['nodeId', 'node_id'],
    ['contentHash', 'content_hash'],
    ['source', 'source', (value) => jsonbValue<JsonValue>(value as JsonValue)],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

export class CurriculumRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CentreDb {
    return this.handle;
  }

  get dbHandle(): CentreDb {
    return this.db();
  }

  async transaction<T>(fn: (tx: CurriculumTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }


  async insertSubject(v: NewSubject, db: Db = this.db()): Promise<SubjectRow> {
    const rows = await db
      .insertInto('subjects')
      .values(subjectInsertValues(v))
      .returning(SUBJECT_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getSubjectBySlug(slug: string, db: Db = this.db()): Promise<SubjectRow | undefined> {
    const row = await db
      .selectFrom('subjects')
      .select(SUBJECT_COLUMNS)
      .where('slug', '=', slug)
      .executeTakeFirst();
    return row;
  }

  async getSubject(id: string, db: Db = this.db()): Promise<SubjectRow | undefined> {
    const row = await db
      .selectFrom('subjects')
      .select(SUBJECT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async listSubjects(contextId: string, db: Db = this.db()): Promise<SubjectRow[]> {
    return db
      .selectFrom('subjects')
      .select(SUBJECT_COLUMNS)
      .where('context_id', '=', contextId)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  async updateSubject(id: string, v: Partial<NewSubject>, db: Db = this.db()): Promise<void> {
    await db
      .updateTable('subjects')
      .set({ ...subjectUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteSubject(id: string, db: Db = this.db()): Promise<void> {
    await db.deleteFrom('subjects').where('id', '=', id).execute();
  }


  async insertCurriculum(v: NewCurriculum, db: Db = this.db()): Promise<CurriculumRow> {
    const rows = await db
      .insertInto('curricula')
      .values(curriculumInsertValues(v))
      .returning(CURRICULUM_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getCurriculum(id: string, db: Db = this.db()): Promise<CurriculumRow | undefined> {
    const row = await db
      .selectFrom('curricula')
      .select(CURRICULUM_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async listCurricula(subjectId: string, db: Db = this.db()): Promise<CurriculumRow[]> {
    return db
      .selectFrom('curricula')
      .select(CURRICULUM_COLUMNS)
      .where('subject_id', '=', subjectId)
      .orderBy('grade', 'asc')
      .execute();
  }

  async updateCurriculum(id: string, v: Partial<NewCurriculum>, db: Db = this.db()): Promise<void> {
    await db
      .updateTable('curricula')
      .set({ ...curriculumUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteCurriculum(id: string, db: Db = this.db()): Promise<void> {
    await db.deleteFrom('curricula').where('id', '=', id).execute();
  }


  async insertNode(v: NewCurriculumNode, db: Db = this.db()): Promise<CurriculumNodeRow> {
    const rows = await db
      .insertInto('curriculum_nodes')
      .values(curriculumNodeInsertValues(v))
      .returning(CURRICULUM_NODE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getNode(id: string, db: Db = this.db()): Promise<CurriculumNodeRow | undefined> {
    const row = await db
      .selectFrom('curriculum_nodes')
      .select(CURRICULUM_NODE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async listNodes(curriculumId: string, db: Db = this.db()): Promise<CurriculumNodeRow[]> {
    return db
      .selectFrom('curriculum_nodes')
      .select(CURRICULUM_NODE_COLUMNS)
      .where('curriculum_id', '=', curriculumId)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  async updateNode(id: string, v: Partial<NewCurriculumNode>, db: Db = this.db()): Promise<void> {
    await db
      .updateTable('curriculum_nodes')
      .set({ ...curriculumNodeUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteNode(id: string, db: Db = this.db()): Promise<void> {
    await db.deleteFrom('curriculum_nodes').where('id', '=', id).execute();
  }


  async insertOutcome(v: NewLearningOutcome, db: Db = this.db()): Promise<LearningOutcomeRow> {
    const rows = await db
      .insertInto('learning_outcomes')
      .values(learningOutcomeInsertValues(v))
      .returning(LEARNING_OUTCOME_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getOutcome(id: string, db: Db = this.db()): Promise<LearningOutcomeRow | undefined> {
    const row = await db
      .selectFrom('learning_outcomes')
      .select(LEARNING_OUTCOME_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async listOutcomes(
    nodeId: string,
    opts?: { includeRetired?: boolean },
    db: Db = this.db(),
  ): Promise<LearningOutcomeRow[]> {
    return db
      .selectFrom('learning_outcomes')
      .select(LEARNING_OUTCOME_COLUMNS)
      .where((eb) =>
        eb.and([
          eb('node_id', '=', nodeId),
          ...(opts?.includeRetired ? [] : [eb('retired_at', 'is', null)]),
        ]),
      )
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  async listOutcomesForNodes(
    nodeIds: string[],
    opts?: { includeRetired?: boolean },
    db: Db = this.db(),
  ): Promise<LearningOutcomeRow[]> {
    if (nodeIds.length === 0) return [];
    return db
      .selectFrom('learning_outcomes')
      .select(LEARNING_OUTCOME_COLUMNS)
      .where((eb) =>
        eb.and([
          eb('node_id', 'in', nodeIds),
          ...(opts?.includeRetired ? [] : [eb('retired_at', 'is', null)]),
        ]),
      )
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  async listDatasetManagedOutcomes(nodeId: string, db: Db = this.db()): Promise<LearningOutcomeRow[]> {
    return db
      .selectFrom('learning_outcomes')
      .select(LEARNING_OUTCOME_COLUMNS)
      .where((eb) =>
        eb.and([
          eb('node_id', '=', nodeId),
          eb('source_kind', '=', 'program'),
          sql<boolean>`learning_outcomes.source_ref is not null`,
        ]),
      )
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  async countOutcomeLinks(
    outcomeIds: string[],
    db: Db = this.db(),
  ): Promise<Map<string, { questions: number; bookMappings: number }>> {
    const out = new Map<string, { questions: number; bookMappings: number }>();
    if (outcomeIds.length === 0) return out;
    const linkRows = await db
      .selectFrom('question_learning_outcomes')
      .select([
        'question_learning_outcomes.learning_outcome_id as outcomeId',
        sql<number>`count(*)::int`.as('n'),
      ])
      .where('question_learning_outcomes.learning_outcome_id', 'in', outcomeIds)
      .groupBy('question_learning_outcomes.learning_outcome_id')
      .execute();
    for (const row of linkRows) {
      out.set(row.outcomeId, { questions: row.n, bookMappings: 0 });
    }
    const mappingRows = await db
      .selectFrom('book_mappings')
      .select([
        'book_mappings.learning_outcome_id as outcomeId',
        sql<number>`count(*)::int`.as('n'),
      ])
      .where('book_mappings.learning_outcome_id', 'in', outcomeIds)
      .groupBy('book_mappings.learning_outcome_id')
      .execute();
    for (const row of mappingRows) {
      if (row.outcomeId === null) continue;
      const entry = out.get(row.outcomeId) ?? { questions: 0, bookMappings: 0 };
      entry.bookMappings = row.n;
      out.set(row.outcomeId, entry);
    }
    return out;
  }

  async countRetiredOutcomesForDataset(datasetKey: string, db: Db = this.db()): Promise<number> {
    const row = await db
      .selectFrom('learning_outcomes')
      .innerJoin('curriculum_program_records', 'curriculum_program_records.node_id', 'learning_outcomes.node_id')
      .select(sql<number>`count(*)::int`.as('n'))
      .where((eb) =>
        eb.and([
          eb('curriculum_program_records.dataset_key', '=', datasetKey),
          eb('learning_outcomes.source_kind', '=', 'program'),
          sql<boolean>`learning_outcomes.source_ref is not null`,
          sql<boolean>`learning_outcomes.retired_at is not null`,
        ]),
      )
      .executeTakeFirst();
    return row?.n ?? 0;
  }

  async updateOutcome(id: string, v: Partial<NewLearningOutcome>, db: Db = this.db()): Promise<void> {
    await db
      .updateTable('learning_outcomes')
      .set({ ...learningOutcomeUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async countGuardedReferences(
    nodeIds: string[],
    outcomeIds: string[],
    db: Db = this.db(),
  ): Promise<{ bookMappings: number; examMatrixCells: number; questionOutcomes: number }> {
    let bookMappingsCount = 0;
    if (nodeIds.length > 0 || outcomeIds.length > 0) {
      const row = await db
        .selectFrom('book_mappings')
        .select(sql<number>`count(*)::int`.as('n'))
        .where((eb) => {
          const conditions = [
            ...(nodeIds.length > 0 ? [eb('book_mappings.curriculum_node_id', 'in', nodeIds)] : []),
            ...(outcomeIds.length > 0 ? [eb('book_mappings.learning_outcome_id', 'in', outcomeIds)] : []),
          ];
          return conditions.length === 1 ? conditions[0]! : eb.or(conditions);
        })
        .executeTakeFirst();
      bookMappingsCount = row?.n ?? 0;
    }
    let examMatrixCellsCount = 0;
    let questionOutcomesCount = 0;
    if (nodeIds.length > 0) {
      const cells = await db
        .selectFrom('exam_matrix_cells')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('exam_matrix_cells.curriculum_node_id', 'in', nodeIds)
        .executeTakeFirst();
      examMatrixCellsCount = cells?.n ?? 0;
    }
    if (outcomeIds.length > 0) {
      const links = await db
        .selectFrom('question_learning_outcomes')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('question_learning_outcomes.learning_outcome_id', 'in', outcomeIds)
        .executeTakeFirst();
      questionOutcomesCount = links?.n ?? 0;
    }
    return { bookMappings: bookMappingsCount, examMatrixCells: examMatrixCellsCount, questionOutcomes: questionOutcomesCount };
  }

  async searchOutcomes(
    input: { query: string; subjectId?: string; grade?: number; limit: number },
    db: Db = this.db(),
  ): Promise<{
    outcome: LearningOutcomeRow;
    nodeTitle: string;
    grade: number;
    subjectId: string;
    subjectName: string;
    subjectContextId: string;
  }[]> {
    const rows = await db
      .selectFrom('learning_outcomes')
      .innerJoin('curriculum_nodes', 'curriculum_nodes.id', 'learning_outcomes.node_id')
      .innerJoin('curricula', 'curricula.id', 'curriculum_nodes.curriculum_id')
      .innerJoin('subjects', 'subjects.id', 'curricula.subject_id')
      .select([
        'learning_outcomes.id as outcomeId',
        'learning_outcomes.tenant_id as outcomeTenantId',
        'learning_outcomes.node_id as outcomeNodeId',
        'learning_outcomes.content as outcomeContent',
        'learning_outcomes.position as outcomePosition',
        'learning_outcomes.source_kind as outcomeSourceKind',
        'learning_outcomes.source_ref as outcomeSourceRef',
        'learning_outcomes.derived_from_id as outcomeDerivedFromId',
        'learning_outcomes.retired_at as outcomeRetiredAt',
        'learning_outcomes.created_at as outcomeCreatedAt',
        'learning_outcomes.updated_at as outcomeUpdatedAt',
        'curriculum_nodes.title as nodeTitle',
        'curricula.grade as grade',
        'subjects.id as subjectId',
        'subjects.name as subjectName',
        'subjects.context_id as subjectContextId',
      ])
      .where((eb) =>
        eb.and([
          sql<boolean>`learning_outcomes.content::text ILIKE ${`%${input.query}%`}`,
          eb('learning_outcomes.retired_at', 'is', null),
          ...(input.subjectId ? [eb('subjects.id', '=', input.subjectId)] : []),
          ...(input.grade !== undefined ? [eb('curricula.grade', '=', input.grade)] : []),
        ]),
      )
      .orderBy('subjects.position', 'asc')
      .orderBy('curricula.grade', 'asc')
      .orderBy('curriculum_nodes.position', 'asc')
      .orderBy('learning_outcomes.position', 'asc')
      .limit(input.limit)
      .execute();
    return rows.map((row) => ({
      outcome: {
        id: row.outcomeId,
        tenantId: row.outcomeTenantId,
        nodeId: row.outcomeNodeId,
        content: row.outcomeContent,
        position: row.outcomePosition,
        sourceKind: row.outcomeSourceKind,
        sourceRef: row.outcomeSourceRef,
        derivedFromId: row.outcomeDerivedFromId,
        retiredAt: row.outcomeRetiredAt,
        createdAt: row.outcomeCreatedAt,
        updatedAt: row.outcomeUpdatedAt,
      },
      nodeTitle: row.nodeTitle,
      grade: row.grade,
      subjectId: row.subjectId,
      subjectName: row.subjectName,
      subjectContextId: row.subjectContextId,
    }));
  }

  async countReadyQuestionsForOutcome(
    outcomeId: string,
    db: Db = this.db(),
  ): Promise<{ cognitiveLevel: string; qtype: string; count: number }[]> {
    return db
      .selectFrom('question_learning_outcomes')
      .innerJoin('question', 'question.id', 'question_learning_outcomes.question_id')
      .innerJoin('question_bank_entries', 'question_bank_entries.question_id', 'question.id')
      .select([
        'question_learning_outcomes.cognitive_level as cognitiveLevel',
        'question.qtype as qtype',
        sql<number>`count(distinct question_learning_outcomes.question_id)::int`.as('count'),
      ])
      .where(
        sql<boolean>`question_learning_outcomes.learning_outcome_id = ${outcomeId} and question_bank_entries.status = 'ready'`,
      )
      .groupBy(['question_learning_outcomes.cognitive_level', 'question.qtype'])
      .orderBy('question_learning_outcomes.cognitive_level', 'asc')
      .orderBy('question.qtype', 'asc')
      .execute();
  }

  async deleteOutcome(id: string, db: Db = this.db()): Promise<void> {
    await db.deleteFrom('learning_outcomes').where('id', '=', id).execute();
  }


  async countProgramRecords(db: Db = this.db()): Promise<number> {
    const row = await db
      .selectFrom('curriculum_program_records')
      .select(sql<number>`count(*)::int`.as('n'))
      .executeTakeFirst();
    return row?.n ?? 0;
  }

  async getProgramRecord(datasetKey: string, recordId: string, db: Db = this.db()): Promise<ProgramRecordRow | undefined> {
    const row = await db
      .selectFrom('curriculum_program_records')
      .select(PROGRAM_RECORD_COLUMNS)
      .where((eb) => eb.and([eb('dataset_key', '=', datasetKey), eb('record_id', '=', recordId)]))
      .executeTakeFirst();
    return row;
  }

  async getProgramRecordByNodeId(nodeId: string, db: Db = this.db()): Promise<ProgramRecordRow | undefined> {
    const row = await db
      .selectFrom('curriculum_program_records')
      .select(PROGRAM_RECORD_COLUMNS)
      .where('node_id', '=', nodeId)
      .executeTakeFirst();
    return row;
  }

  async listProgramRecords(datasetKey: string, db: Db = this.db()): Promise<ProgramRecordRow[]> {
    return db
      .selectFrom('curriculum_program_records')
      .select(PROGRAM_RECORD_COLUMNS)
      .where('dataset_key', '=', datasetKey)
      .orderBy('record_id', 'asc')
      .execute();
  }

  async insertProgramRecord(v: NewProgramRecord, db: Db = this.db()): Promise<ProgramRecordRow> {
    const rows = await db
      .insertInto('curriculum_program_records')
      .values(programRecordInsertValues(v))
      .returning(PROGRAM_RECORD_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async updateProgramRecord(id: string, v: Partial<NewProgramRecord>, db: Db = this.db()): Promise<void> {
    await db
      .updateTable('curriculum_program_records')
      .set({ ...programRecordUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async listProgramRecordsBySubject(subjectId: string, db: Db = this.db()): Promise<ProgramRecordRow[]> {
    return db
      .selectFrom('curriculum_program_records')
      .select(PROGRAM_RECORD_COLUMNS)
      .where('subject_id', '=', subjectId)
      .orderBy('record_id', 'asc')
      .execute();
  }
}
