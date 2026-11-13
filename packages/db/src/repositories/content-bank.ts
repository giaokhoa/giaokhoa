import { sql, type InsertObject, type RawBuilder, type UpdateObject } from 'kysely';
import type { CentreDb, CentreDB } from '../client';
import type { JsonValue } from '../types/centre-db';

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
  if (values.id !== undefined) row.id = values.id;
  if (values.tenantId !== undefined) row.tenant_id = values.tenantId;
  if (values.contentType !== undefined) row.content_type = values.contentType;
  if (values.visibility !== undefined) row.visibility = values.visibility;
  if (values.fileId !== undefined) row.file_id = values.fileId;
  if (values.configData !== undefined) row.config_data = values.configData === null ? null : jsonbValue<JsonValue>(values.configData as JsonValue);
  if (values.resourceType !== undefined) row.resource_type = values.resourceType;
  if (values.scope !== undefined) row.scope = values.scope;
  if (values.spaceId !== undefined) row.space_id = values.spaceId;
  if (values.subjectId !== undefined) row.subject_id = values.subjectId;
  if (values.grade !== undefined) row.grade = values.grade;
  if (values.level !== undefined) row.level = values.level;
  if (values.curriculumNodeId !== undefined) row.curriculum_node_id = values.curriculumNodeId;
  if (values.outcomeIds !== undefined) row.outcome_ids = values.outcomeIds === null ? null : jsonbValue<JsonValue>(values.outcomeIds as JsonValue);
  if (values.questionCategoryId !== undefined) row.question_category_id = values.questionCategoryId;
  if (values.externalUrl !== undefined) row.external_url = values.externalUrl;
  if (values.description !== undefined) row.description = values.description;
  if (values.keywords !== undefined) row.keywords = values.keywords === null ? null : jsonbValue<JsonValue>(values.keywords as JsonValue);
  if (values.targetAudience !== undefined) row.target_audience = values.targetAudience;
  if (values.lessonPosition !== undefined) row.lesson_position = values.lessonPosition;
  if (values.techFormat !== undefined) row.tech_format = values.techFormat;
  if (values.sizeBytes !== undefined) row.size_bytes = values.sizeBytes;
  if (values.durationSeconds !== undefined) row.duration_seconds = values.durationSeconds;
  if (values.language !== undefined) row.language = values.language;
  if (values.originalAuthor !== undefined) row.original_author = values.originalAuthor;
  if (values.sourceKind !== undefined) row.source_kind = values.sourceKind;
  if (values.sourceCitation !== undefined) row.source_citation = values.sourceCitation;
  if (values.license !== undefined) row.license = values.license;
  if (values.derivedFromId !== undefined) row.derived_from_id = values.derivedFromId;
  if (values.reviewStatus !== undefined) row.review_status = values.reviewStatus;
  if (values.reviewedBy !== undefined) row.reviewed_by = values.reviewedBy;
  if (values.reviewedAt !== undefined) row.reviewed_at = values.reviewedAt;
  if (values.reviewNote !== undefined) row.review_note = values.reviewNote;
  if (values.reviewChecklist !== undefined) row.review_checklist = values.reviewChecklist === null ? null : jsonbValue<JsonValue>(values.reviewChecklist as JsonValue);
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function contentUpdateSet(patch: Partial<ContentRow>): UpdateObject<CentreDB, 'content_bank_content'> {
  const set: UpdateObject<CentreDB, 'content_bank_content'> = {};
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.contentType !== undefined) set.content_type = patch.contentType;
  if (patch.contextId !== undefined) set.context_id = patch.contextId;
  if (patch.creatorId !== undefined) set.creator_id = patch.creatorId;
  if (patch.visibility !== undefined) set.visibility = patch.visibility;
  if (patch.fileId !== undefined) set.file_id = patch.fileId;
  if (patch.configData !== undefined) set.config_data = patch.configData === null ? null : jsonbValue<JsonValue>(patch.configData as JsonValue);
  if (patch.resourceType !== undefined) set.resource_type = patch.resourceType;
  if (patch.scope !== undefined) set.scope = patch.scope;
  if (patch.spaceId !== undefined) set.space_id = patch.spaceId;
  if (patch.subjectId !== undefined) set.subject_id = patch.subjectId;
  if (patch.grade !== undefined) set.grade = patch.grade;
  if (patch.level !== undefined) set.level = patch.level;
  if (patch.curriculumNodeId !== undefined) set.curriculum_node_id = patch.curriculumNodeId;
  if (patch.outcomeIds !== undefined) set.outcome_ids = patch.outcomeIds === null ? null : jsonbValue<JsonValue>(patch.outcomeIds as JsonValue);
  if (patch.questionCategoryId !== undefined) set.question_category_id = patch.questionCategoryId;
  if (patch.externalUrl !== undefined) set.external_url = patch.externalUrl;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.keywords !== undefined) set.keywords = patch.keywords === null ? null : jsonbValue<JsonValue>(patch.keywords as JsonValue);
  if (patch.targetAudience !== undefined) set.target_audience = patch.targetAudience;
  if (patch.lessonPosition !== undefined) set.lesson_position = patch.lessonPosition;
  if (patch.techFormat !== undefined) set.tech_format = patch.techFormat;
  if (patch.sizeBytes !== undefined) set.size_bytes = patch.sizeBytes;
  if (patch.durationSeconds !== undefined) set.duration_seconds = patch.durationSeconds;
  if (patch.language !== undefined) set.language = patch.language;
  if (patch.originalAuthor !== undefined) set.original_author = patch.originalAuthor;
  if (patch.sourceKind !== undefined) set.source_kind = patch.sourceKind;
  if (patch.sourceCitation !== undefined) set.source_citation = patch.sourceCitation;
  if (patch.license !== undefined) set.license = patch.license;
  if (patch.derivedFromId !== undefined) set.derived_from_id = patch.derivedFromId;
  if (patch.reviewStatus !== undefined) set.review_status = patch.reviewStatus;
  if (patch.reviewedBy !== undefined) set.reviewed_by = patch.reviewedBy;
  if (patch.reviewedAt !== undefined) set.reviewed_at = patch.reviewedAt;
  if (patch.reviewNote !== undefined) set.review_note = patch.reviewNote;
  if (patch.reviewChecklist !== undefined) set.review_checklist = patch.reviewChecklist === null ? null : jsonbValue<JsonValue>(patch.reviewChecklist as JsonValue);
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
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
