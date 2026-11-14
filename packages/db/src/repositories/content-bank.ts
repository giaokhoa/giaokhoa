import { sql, type InsertObject, type RawBuilder, type UpdateObject } from 'kysely';
import type { CentreDb, CentreDB } from '../client';
import type { JsonValue } from '../types/centre-db';
import { applyDefined } from './mapping';

export interface ContentRow {
  id: string;
  tenantId: string;
  name: string;
  contentType: string;
  contextId: string;
  creatorId: string;
  visibility: string;
  fileId: string | null;
  configData: unknown;
  resourceType: string;
  scope: string;
  spaceId: string | null;
  subjectId: string | null;
  grade: number | null;
  level: string | null;
  curriculumNodeId: string | null;
  outcomeIds: unknown;
  questionCategoryId: string | null;
  externalUrl: string | null;
  description: string | null;
  keywords: unknown;
  targetAudience: string | null;
  lessonPosition: string | null;
  techFormat: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  language: string;
  originalAuthor: string | null;
  sourceKind: string | null;
  sourceCitation: string | null;
  license: string | null;
  derivedFromId: string | null;
  reviewStatus: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  reviewChecklist: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewContent {
  id?: string;
  tenantId?: string;
  name: string;
  contentType?: string;
  contextId: string;
  creatorId: string;
  visibility?: string;
  fileId?: string | null;
  configData?: unknown;
  resourceType?: string;
  scope?: string;
  spaceId?: string | null;
  subjectId?: string | null;
  grade?: number | null;
  level?: string | null;
  curriculumNodeId?: string | null;
  outcomeIds?: unknown;
  questionCategoryId?: string | null;
  externalUrl?: string | null;
  description?: string | null;
  keywords?: unknown;
  targetAudience?: string | null;
  lessonPosition?: string | null;
  techFormat?: string | null;
  sizeBytes?: number | null;
  durationSeconds?: number | null;
  language?: string;
  originalAuthor?: string | null;
  sourceKind?: string | null;
  sourceCitation?: string | null;
  license?: string | null;
  derivedFromId?: string | null;
  reviewStatus?: string;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  reviewNote?: string | null;
  reviewChecklist?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CohortRow {
  id: string;
  tenantId: string;
  name: string;
  idNumber: string;
  description: string;
  contextId: string;
  component: string;
  visible: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentFilters {
  scope?: string;
  spaceId?: string;
  creatorId?: string;
  subjectId?: string;
  grade?: number;
  level?: string;
  curriculumNodeId?: string;
  resourceType?: string;
  reviewStatus?: string;
}

function jsonbValue<T>(value: T): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

const CONTENT_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'name',
  'content_type as contentType',
  'context_id as contextId',
  'creator_id as creatorId',
  'visibility',
  'file_id as fileId',
  'config_data as configData',
  'resource_type as resourceType',
  'scope',
  'space_id as spaceId',
  'subject_id as subjectId',
  'grade',
  'level',
  'curriculum_node_id as curriculumNodeId',
  'outcome_ids as outcomeIds',
  'question_category_id as questionCategoryId',
  'external_url as externalUrl',
  'description',
  'keywords',
  'target_audience as targetAudience',
  'lesson_position as lessonPosition',
  'tech_format as techFormat',
  'size_bytes as sizeBytes',
  'duration_seconds as durationSeconds',
  'language',
  'original_author as originalAuthor',
  'source_kind as sourceKind',
  'source_citation as sourceCitation',
  'license',
  'derived_from_id as derivedFromId',
  'review_status as reviewStatus',
  'reviewed_by as reviewedBy',
  'reviewed_at as reviewedAt',
  'review_note as reviewNote',
  'review_checklist as reviewChecklist',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const COHORT_COLUMNS = [
  'cohort.id as id',
  'cohort.tenant_id as tenantId',
  'cohort.name as name',
  'cohort.id_number as idNumber',
  'cohort.description as description',
  'cohort.context_id as contextId',
  'cohort.component as component',
  'cohort.visible as visible',
  'cohort.created_at as createdAt',
  'cohort.updated_at as updatedAt',
] as const;

type ContentRowRaw = Omit<ContentRow, 'sizeBytes'> & { sizeBytes: string | null };

function toContentRow(row: ContentRowRaw): ContentRow {
  return { ...row, sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes) };
}

function contentInsertValues(values: NewContent): InsertObject<CentreDB, 'content_bank_content'> {
  const row: InsertObject<CentreDB, 'content_bank_content'> = {
    name: values.name,
    context_id: values.contextId,
    creator_id: values.creatorId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['tenantId', 'tenant_id'],
    ['contentType', 'content_type'],
    ['visibility', 'visibility'],
    ['fileId', 'file_id'],
    ['configData', 'config_data', (value) => (value === null ? null : jsonbValue<JsonValue>(value as JsonValue))],
    ['resourceType', 'resource_type'],
    ['scope', 'scope'],
    ['spaceId', 'space_id'],
    ['subjectId', 'subject_id'],
    ['grade', 'grade'],
    ['level', 'level'],
    ['curriculumNodeId', 'curriculum_node_id'],
    ['outcomeIds', 'outcome_ids', (value) => (value === null ? null : jsonbValue<JsonValue>(value as JsonValue))],
    ['questionCategoryId', 'question_category_id'],
    ['externalUrl', 'external_url'],
    ['description', 'description'],
    ['keywords', 'keywords', (value) => (value === null ? null : jsonbValue<JsonValue>(value as JsonValue))],
    ['targetAudience', 'target_audience'],
    ['lessonPosition', 'lesson_position'],
    ['techFormat', 'tech_format'],
    ['sizeBytes', 'size_bytes'],
    ['durationSeconds', 'duration_seconds'],
    ['language', 'language'],
    ['originalAuthor', 'original_author'],
    ['sourceKind', 'source_kind'],
    ['sourceCitation', 'source_citation'],
    ['license', 'license'],
    ['derivedFromId', 'derived_from_id'],
    ['reviewStatus', 'review_status'],
    ['reviewedBy', 'reviewed_by'],
    ['reviewedAt', 'reviewed_at'],
    ['reviewNote', 'review_note'],
    ['reviewChecklist', 'review_checklist', (value) => (value === null ? null : jsonbValue<JsonValue>(value as JsonValue))],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function contentUpdateSet(patch: Partial<ContentRow>): UpdateObject<CentreDB, 'content_bank_content'> {
  const set: UpdateObject<CentreDB, 'content_bank_content'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['name', 'name'],
    ['contentType', 'content_type'],
    ['contextId', 'context_id'],
    ['creatorId', 'creator_id'],
    ['visibility', 'visibility'],
    ['fileId', 'file_id'],
    ['configData', 'config_data', (value) => (value === null ? null : jsonbValue<JsonValue>(value as JsonValue))],
    ['resourceType', 'resource_type'],
    ['scope', 'scope'],
    ['spaceId', 'space_id'],
    ['subjectId', 'subject_id'],
    ['grade', 'grade'],
    ['level', 'level'],
    ['curriculumNodeId', 'curriculum_node_id'],
    ['outcomeIds', 'outcome_ids', (value) => (value === null ? null : jsonbValue<JsonValue>(value as JsonValue))],
    ['questionCategoryId', 'question_category_id'],
    ['externalUrl', 'external_url'],
    ['description', 'description'],
    ['keywords', 'keywords', (value) => (value === null ? null : jsonbValue<JsonValue>(value as JsonValue))],
    ['targetAudience', 'target_audience'],
    ['lessonPosition', 'lesson_position'],
    ['techFormat', 'tech_format'],
    ['sizeBytes', 'size_bytes'],
    ['durationSeconds', 'duration_seconds'],
    ['language', 'language'],
    ['originalAuthor', 'original_author'],
    ['sourceKind', 'source_kind'],
    ['sourceCitation', 'source_citation'],
    ['license', 'license'],
    ['derivedFromId', 'derived_from_id'],
    ['reviewStatus', 'review_status'],
    ['reviewedBy', 'reviewed_by'],
    ['reviewedAt', 'reviewed_at'],
    ['reviewNote', 'review_note'],
    ['reviewChecklist', 'review_checklist', (value) => (value === null ? null : jsonbValue<JsonValue>(value as JsonValue))],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

export class ContentBankRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CentreDb {
    return this.handle;
  }

  get dbHandle(): CentreDb {
    return this.db();
  }

  async insert(v: NewContent): Promise<ContentRow> {
    const rows = await this.db()
      .insertInto('content_bank_content')
      .values(contentInsertValues(v))
      .returning(CONTENT_COLUMNS)
      .execute();
    return toContentRow(rows[0]! as ContentRowRaw);
  }

  async get(id: string): Promise<ContentRow | undefined> {
    const row = await this.db()
      .selectFrom('content_bank_content')
      .select(CONTENT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toContentRow(row as ContentRowRaw) : undefined;
  }

  async list(): Promise<ContentRow[]> {
    const rows = await this.db()
      .selectFrom('content_bank_content')
      .select(CONTENT_COLUMNS)
      .execute();
    return rows.map((row) => toContentRow(row as ContentRowRaw));
  }

  async listByContext(contextId: string): Promise<ContentRow[]> {
    const rows = await this.db()
      .selectFrom('content_bank_content')
      .select(CONTENT_COLUMNS)
      .where('context_id', '=', contextId)
      .execute();
    return rows.map((row) => toContentRow(row as ContentRowRaw));
  }

  async listFiltered(f: ContentFilters): Promise<ContentRow[]> {
    let query = this.db().selectFrom('content_bank_content').select(CONTENT_COLUMNS);
    if (f.scope) query = query.where('scope', '=', f.scope);
    if (f.spaceId) query = query.where('space_id', '=', f.spaceId);
    if (f.creatorId) query = query.where('creator_id', '=', f.creatorId);
    if (f.subjectId) query = query.where('subject_id', '=', f.subjectId);
    if (f.grade) query = query.where('grade', '=', f.grade);
    if (f.level) query = query.where('level', '=', f.level);
    if (f.curriculumNodeId) query = query.where('curriculum_node_id', '=', f.curriculumNodeId);
    if (f.resourceType) query = query.where('resource_type', '=', f.resourceType);
    if (f.reviewStatus) query = query.where('review_status', '=', f.reviewStatus);
    const rows = await query.orderBy('updated_at', 'desc').execute();
    return rows.map((row) => toContentRow(row as ContentRowRaw));
  }

  async update(id: string, v: Partial<ContentRow>): Promise<void> {
    await this.db()
      .updateTable('content_bank_content')
      .set({ ...contentUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async remove(id: string): Promise<void> {
    await this.db().deleteFrom('content_bank_content').where('id', '=', id).execute();
  }


  async getCohort(id: string): Promise<CohortRow | undefined> {
    const row = await this.db()
      .selectFrom('cohort')
      .select(COHORT_COLUMNS)
      .where('cohort.id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async listAllCohorts(): Promise<CohortRow[]> {
    return this.db().selectFrom('cohort').select(COHORT_COLUMNS).execute();
  }

  async listCohortsForUser(userId: string): Promise<CohortRow[]> {
    return this.db()
      .selectFrom('cohort_members')
      .innerJoin('cohort', 'cohort.id', 'cohort_members.cohort_id')
      .select(COHORT_COLUMNS)
      .where('cohort_members.user_id', '=', userId)
      .execute();
  }

  async isCohortMember(cohortId: string, userId: string): Promise<boolean> {
    const row = await this.db()
      .selectFrom('cohort_members')
      .select(['cohort_members.cohort_id as cohortId'])
      .where((eb) => eb.and([eb('cohort_members.cohort_id', '=', cohortId), eb('cohort_members.user_id', '=', userId)]))
      .executeTakeFirst();
    return !!row;
  }
}
