/**
 * Repository của KHO HỌC LIỆU trên Kysely.
 *
 * Vai trò: mọi truy cập tới bảng content_bank_content của kho
 * trung tâm tập trung ở đây, cộng các truy vấn chỉ-đọc cohort (tổ
 * chuyên môn — bảng cohort/cohort_members của cụm groups) phục vụ
 * scope org của kho học liệu. Repository không chứa luật nghiệp
 * vụ — gác quyền xem/duyệt nằm ở tầng service phía ứng dụng.
 *
 * Ràng buộc về truy vấn và hình dạng dữ liệu tại biên repository:
 * - Bên trong repository, truy vấn viết trên interface schema sinh
 *   bằng codegen: tên bảng/cột giữ nguyên snake_case của database.
 * - Bên ngoài, repository trả/nhận các hình dạng dòng camelCase như
 *   phía tiêu thụ đang dùng (khớp `$inferSelect`/`$inferInsert` của
 *   repository cũ trước chuyển đổi): cột được chọn bằng danh sách tường minh
 *   có bí danh, giá trị ghi được ánh xạ từng trường ở các hàm
 *   `*InsertValues`/`*UpdateSet` trong file này.
 * - Giá trị `undefined` bị LOẠI khỏi values/set trước khi gọi
 *   builder (quy tắc T-4 đã chốt ở pilot); bộ lọc động của
 *   `listFiltered` ghép bằng các lần `.where(...)` xâu chuỗi trên
 *   cùng một builder giữ trong biến (khuôn T-13 đã chốt) thay cho
 *   mảng điều kiện + `and(...conds)` của bộ máy cũ.
 * - Cột jsonb khi ghi (`config_data`, `outcome_ids`, `keywords`,
 *   `review_checklist`) đi qua helper serialize tường minh + ép
 *   kiểu `::jsonb` ({@link jsonbValue}).
 * - Cột `size_bytes` là bigint: codegen sinh kiểu `Int8` (đọc ra
 *   là `string` — thử nghiệm T-7 đã chốt: không bật parser toàn
 *   cục), trong khi hợp đồng dòng phía tiêu thụ giữ `number` như
 *   thời bộ máy cũ (`mode: 'number'`). Repository vì vậy chuyển đổi
 *   tường minh tại biên: đọc `string → number`, ghi `number`
 *   nguyên trạng (kiểu ghi của `Int8` nhận number).
 * - Hình chiếu toàn bảng của cohort trong `listCohortsForUser`
 *   (điểm cùng họ với thử nghiệm T-14): bộ máy cũ chọn
 *   `select({ cohort })` rồi bóc `.cohort`; ở đây chọn tường minh
 *   từng cột của bảng cohort qua join — kết quả trả ra là chính
 *   các dòng cohort, hình dạng không đổi.
 */
import { type InsertObject, type UpdateObject } from 'kysely';
import type { CentreDb, CentreDB } from '../client';
import { jsonbValue, jsonbField } from '../jsonb';

/** Một dòng học liệu trong kho; các cột jsonb giữ `unknown` như hình dạng `$inferSelect` cũ (bộ máy cũ không gắn `$type`). */
export interface ContentRow {
  id: string;
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

/** Dữ kiện ghi một học liệu mới (khớp `$inferInsert` cũ). */
export interface NewContent {
  id?: string;
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

/** Một dòng cohort (tổ chuyên môn). */
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

/** Bộ lọc của Kho học liệu (scope/metadata/trạng thái duyệt) — mọi trường đều tuỳ chọn. */
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

/** Danh sách cột tường minh có bí danh camelCase cho bảng content_bank_content (dùng cho cả select lẫn returning). */
const CONTENT_COLUMNS = [
  'id',
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

/** Danh sách cột tường minh có bí danh camelCase cho bảng cohort. */
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

/** Dòng thô ở biên select: giống {@link ContentRow} nhưng `sizeBytes` còn là chuỗi int8 thô từ driver. */
type ContentRowRaw = Omit<ContentRow, 'sizeBytes'> & { sizeBytes: string | null };

/**
 * Chuyển một dòng thô thành dòng công khai: `size_bytes` int8 đọc
 * ra là `string` (T-7) trong khi hợp đồng cũ là `number` — chuyển
 * đổi tường minh tại biên repository, không bật parser toàn cục.
 */
function toContentRow(row: ContentRowRaw): ContentRow {
  return { ...row, sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes) };
}

/** Ánh xạ dữ kiện ghi học liệu sang values insert (snake_case), loại `undefined` (quy tắc T-4); các cột jsonb qua {@link jsonbField}. */
function contentInsertValues(values: NewContent): InsertObject<CentreDB, 'content_bank_content'> {
  return {
    name: values.name,
    context_id: values.contextId,
    creator_id: values.creatorId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.contentType !== undefined ? { content_type: values.contentType } : {}),
    ...(values.visibility !== undefined ? { visibility: values.visibility } : {}),
    ...(values.fileId !== undefined ? { file_id: values.fileId } : {}),
    ...(values.configData !== undefined ? { config_data: jsonbField(values.configData) } : {}),
    ...(values.resourceType !== undefined ? { resource_type: values.resourceType } : {}),
    ...(values.scope !== undefined ? { scope: values.scope } : {}),
    ...(values.spaceId !== undefined ? { space_id: values.spaceId } : {}),
    ...(values.subjectId !== undefined ? { subject_id: values.subjectId } : {}),
    ...(values.grade !== undefined ? { grade: values.grade } : {}),
    ...(values.level !== undefined ? { level: values.level } : {}),
    ...(values.curriculumNodeId !== undefined ? { curriculum_node_id: values.curriculumNodeId } : {}),
    ...(values.outcomeIds !== undefined ? { outcome_ids: jsonbField(values.outcomeIds) } : {}),
    ...(values.questionCategoryId !== undefined ? { question_category_id: values.questionCategoryId } : {}),
    ...(values.externalUrl !== undefined ? { external_url: values.externalUrl } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
    ...(values.keywords !== undefined ? { keywords: jsonbField(values.keywords) } : {}),
    ...(values.targetAudience !== undefined ? { target_audience: values.targetAudience } : {}),
    ...(values.lessonPosition !== undefined ? { lesson_position: values.lessonPosition } : {}),
    ...(values.techFormat !== undefined ? { tech_format: values.techFormat } : {}),
    ...(values.sizeBytes !== undefined ? { size_bytes: values.sizeBytes } : {}),
    ...(values.durationSeconds !== undefined ? { duration_seconds: values.durationSeconds } : {}),
    ...(values.language !== undefined ? { language: values.language } : {}),
    ...(values.originalAuthor !== undefined ? { original_author: values.originalAuthor } : {}),
    ...(values.sourceKind !== undefined ? { source_kind: values.sourceKind } : {}),
    ...(values.sourceCitation !== undefined ? { source_citation: values.sourceCitation } : {}),
    ...(values.license !== undefined ? { license: values.license } : {}),
    ...(values.derivedFromId !== undefined ? { derived_from_id: values.derivedFromId } : {}),
    ...(values.reviewStatus !== undefined ? { review_status: values.reviewStatus } : {}),
    ...(values.reviewedBy !== undefined ? { reviewed_by: values.reviewedBy } : {}),
    ...(values.reviewedAt !== undefined ? { reviewed_at: values.reviewedAt } : {}),
    ...(values.reviewNote !== undefined ? { review_note: values.reviewNote } : {}),
    ...(values.reviewChecklist !== undefined ? { review_checklist: jsonbField(values.reviewChecklist) } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/** Ánh xạ một patch học liệu (hình dạng dòng từng phần) sang set update (snake_case), loại `undefined` từng trường; các cột jsonb qua {@link jsonbField}. */
function contentUpdateSet(patch: Partial<ContentRow>): UpdateObject<CentreDB, 'content_bank_content'> {
  return {
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.contentType !== undefined ? { content_type: patch.contentType } : {}),
    ...(patch.contextId !== undefined ? { context_id: patch.contextId } : {}),
    ...(patch.creatorId !== undefined ? { creator_id: patch.creatorId } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    ...(patch.fileId !== undefined ? { file_id: patch.fileId } : {}),
    ...(patch.configData !== undefined ? { config_data: jsonbField(patch.configData) } : {}),
    ...(patch.resourceType !== undefined ? { resource_type: patch.resourceType } : {}),
    ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
    ...(patch.spaceId !== undefined ? { space_id: patch.spaceId } : {}),
    ...(patch.subjectId !== undefined ? { subject_id: patch.subjectId } : {}),
    ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
    ...(patch.level !== undefined ? { level: patch.level } : {}),
    ...(patch.curriculumNodeId !== undefined ? { curriculum_node_id: patch.curriculumNodeId } : {}),
    ...(patch.outcomeIds !== undefined ? { outcome_ids: jsonbField(patch.outcomeIds) } : {}),
    ...(patch.questionCategoryId !== undefined ? { question_category_id: patch.questionCategoryId } : {}),
    ...(patch.externalUrl !== undefined ? { external_url: patch.externalUrl } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.keywords !== undefined ? { keywords: jsonbField(patch.keywords) } : {}),
    ...(patch.targetAudience !== undefined ? { target_audience: patch.targetAudience } : {}),
    ...(patch.lessonPosition !== undefined ? { lesson_position: patch.lessonPosition } : {}),
    ...(patch.techFormat !== undefined ? { tech_format: patch.techFormat } : {}),
    ...(patch.sizeBytes !== undefined ? { size_bytes: patch.sizeBytes } : {}),
    ...(patch.durationSeconds !== undefined ? { duration_seconds: patch.durationSeconds } : {}),
    ...(patch.language !== undefined ? { language: patch.language } : {}),
    ...(patch.originalAuthor !== undefined ? { original_author: patch.originalAuthor } : {}),
    ...(patch.sourceKind !== undefined ? { source_kind: patch.sourceKind } : {}),
    ...(patch.sourceCitation !== undefined ? { source_citation: patch.sourceCitation } : {}),
    ...(patch.license !== undefined ? { license: patch.license } : {}),
    ...(patch.derivedFromId !== undefined ? { derived_from_id: patch.derivedFromId } : {}),
    ...(patch.reviewStatus !== undefined ? { review_status: patch.reviewStatus } : {}),
    ...(patch.reviewedBy !== undefined ? { reviewed_by: patch.reviewedBy } : {}),
    ...(patch.reviewedAt !== undefined ? { reviewed_at: patch.reviewedAt } : {}),
    ...(patch.reviewNote !== undefined ? { review_note: patch.reviewNote } : {}),
    ...(patch.reviewChecklist !== undefined ? { review_checklist: jsonbField(patch.reviewChecklist) } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
  };
}

/** Kho dữ liệu content_bank_content + truy vấn cohort (tổ chuyên môn) phục vụ scope org của Kho học liệu. */
export class ContentBankRepository {
  constructor(private readonly handle: CentreDb) {}

  /** Instance gốc của repository. */
  private db(): CentreDb {
    return this.handle;
  }

  /** Handle DB gốc (giữ hợp đồng cũ của repository — tầng service hiện không mở transaction qua handle này). */
  get dbHandle(): CentreDb {
    return this.db();
  }

  /** Chèn một học liệu. */
  async insert(v: NewContent): Promise<ContentRow> {
    const row = await this.db()
      .insertInto('content_bank_content')
      .values(contentInsertValues(v))
      .returning(CONTENT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toContentRow(row as ContentRowRaw);
  }

  /** Lấy một học liệu theo id. */
  async get(id: string): Promise<ContentRow | undefined> {
    const row = await this.db()
      .selectFrom('content_bank_content')
      .select(CONTENT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toContentRow(row as ContentRowRaw) : undefined;
  }

  /** Toàn bộ học liệu trong kho. */
  async list(): Promise<ContentRow[]> {
    const rows = await this.db()
      .selectFrom('content_bank_content')
      .select(CONTENT_COLUMNS)
      .execute();
    return rows.map((row) => toContentRow(row as ContentRowRaw));
  }

  /** Học liệu neo ở một context. */
  async listByContext(contextId: string): Promise<ContentRow[]> {
    const rows = await this.db()
      .selectFrom('content_bank_content')
      .select(CONTENT_COLUMNS)
      .where('context_id', '=', contextId)
      .execute();
    return rows.map((row) => toContentRow(row as ContentRowRaw));
  }

  /** Liệt kê theo bộ lọc của Kho học liệu (scope/metadata/trạng thái duyệt), mới nhất trước. Việc gác quyền xem nằm ở service. */
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

  /** Cập nhật một học liệu (đã lọc trường ở tầng service). */
  async update(id: string, v: Partial<ContentRow>): Promise<void> {
    await this.db()
      .updateTable('content_bank_content')
      .set({ ...contentUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Xoá một học liệu. */
  async remove(id: string): Promise<void> {
    await this.db().deleteFrom('content_bank_content').where('id', '=', id).execute();
  }

  // --- cohort (tổ chuyên môn) -------------------------------------------------

  /** Lấy một cohort theo id. */
  async getCohort(id: string): Promise<CohortRow | undefined> {
    const row = await this.db()
      .selectFrom('cohort')
      .select(COHORT_COLUMNS)
      .where('cohort.id', '=', id)
      .executeTakeFirst();
    return row;
  }

  /** Toàn bộ cohort. */
  async listAllCohorts(): Promise<CohortRow[]> {
    return this.db().selectFrom('cohort').select(COHORT_COLUMNS).execute();
  }

  /** Các cohort mà một user là thành viên (chọn tường minh từng cột của cohort qua join — tương đương hình chiếu `{ cohort }` cũ, xem ghi chú T-14 ở đầu file). */
  async listCohortsForUser(userId: string): Promise<CohortRow[]> {
    return this.db()
      .selectFrom('cohort_members')
      .innerJoin('cohort', 'cohort.id', 'cohort_members.cohort_id')
      .select(COHORT_COLUMNS)
      .where('cohort_members.user_id', '=', userId)
      .execute();
  }

  /** User có phải thành viên của cohort hay không. */
  async isCohortMember(cohortId: string, userId: string): Promise<boolean> {
    const row = await this.db()
      .selectFrom('cohort_members')
      .select(['cohort_members.cohort_id as cohortId'])
      .where((eb) => eb.and([eb('cohort_members.cohort_id', '=', cohortId), eb('cohort_members.user_id', '=', userId)]))
      .executeTakeFirst();
    return !!row;
  }
}
