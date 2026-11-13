import { sql, type InsertObject, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { Json } from '../types/centre-db';
import { jsonbValue, jsonbField } from '../jsonb';

/**
 * Kho dữ liệu khoá học trên Kysely: quản lý cây danh mục, khoá học, section, course module, neo khung chương trình/SGK của section và tuỳ chọn định dạng.
 *
 * Ràng buộc về truy vấn và hình dạng dữ liệu tại biên repository:
 * - Cột đọc khai tường minh kèm bí danh camelCase
 *   (`'tenant_id as tenantId'`) dùng chung cho select và returning —
 *   KHÔNG bật CamelCasePlugin (một nguồn sự thật là database thật).
 * - Ghi qua hàm ánh xạ Insert/Update loại `undefined` tường minh
 *   từng trường (thử nghiệm T-4): `undefined` = không ghi/không đổi, `null` = ghi NULL — hai nghĩa không được lẫn.
 * - Mọi ghi jsonb (`availability` của section/cm) đi qua
 *   `jsonbValue` (xâu hoá tường minh + `::jsonb`); `null` của cột jsonb nullable giữ nguyên là SQL NULL.
 * - Khoá chính `uuidv7()` do database sinh (phụ lục U của kế
 *   hoạch): insert bỏ qua `id` (trừ khi phía gọi truyền tường minh) và lấy id qua `returning`.
 * - Điểm mở giao dịch của repository là `transaction(fn)`; các
 *   phương thức nhận handle tuỳ chọn (`CoursesDb` = handle thường hoặc handle giao dịch) để phía gọi lồng thao tác vào giao dịch của mình.
 *
 * Các kiểu dòng `*Row` ở biên repository dùng camelCase; trường jsonb `availability` giữ kiểu `unknown` vì nội dung không có lược đồ xác định.
 */

/** Handle kho trung tâm mà repository chấp nhận: thường hoặc trong giao dịch. */
export type CoursesDb = CentreDb | CentreTx;
/** Handle giao dịch kho trung tâm (tham số bắt buộc của các thao tác đa bước). */
export type CoursesTx = CentreTx;

// Kiểu dòng công khai: tên thuộc tính camelCase ánh xạ từ cột PostgreSQL.

/** Dòng `course_categories` (bảng này không có cột `created_at`). */
export interface CategoryRow {
  id: string;
  tenantId: string;
  name: string;
  idNumber: string | null;
  description: string;
  parent: string | null;
  sortOrder: number;
  path: string;
  depth: number;
  visible: boolean;
  updatedAt: Date;
}

/** Dòng `course`. */
export interface CourseRow {
  id: string;
  tenantId: string;
  category: string;
  classId: string | null;
  fullName: string;
  shortName: string;
  idNumber: string;
  summary: string;
  format: string;
  visible: boolean;
  startDate: Date | null;
  endDate: Date | null;
  groupMode: number;
  groupModeForce: boolean;
  sortOrder: number;
  subjectId: string | null;
  grade: number | null;
  isTemplate: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Dòng `course_sections`; `availability` là cây JSON giữ kiểu `unknown` như hợp đồng cũ. */
export interface SectionRow {
  id: string;
  course: string;
  section: number;
  name: string | null;
  summary: string;
  visible: boolean;
  availability: unknown;
  openAt: Date | null;
  updatedAt: Date;
}

/** Dòng `course_modules`; `availability` giữ kiểu `unknown` như hợp đồng cũ. */
export interface CmRow {
  id: string;
  course: string;
  section: string;
  component: string;
  instanceId: string | null;
  name: string;
  added: Date;
  visible: boolean;
  groupMode: number;
  availability: unknown;
  completion: number;
  completionView: boolean;
  completionUseGrade: boolean;
  completionManual: boolean;
  completionExpected: Date | null;
  openAt: Date | null;
  deletionInProgress: boolean;
  sortOrder: number;
}

/** Dòng `course_section_anchors` (neo khung chương trình chụp trên section). */
export interface SectionAnchorRow {
  id: string;
  sectionId: string;
  curriculumId: string | null;
  nodeId: string | null;
  nodeTitle: string;
  createdAt: Date;
}

/** Dòng `course_section_anchor_outcomes` (YCCĐ chụp kèm một neo khung). */
export interface SectionAnchorOutcomeRow {
  id: string;
  anchorId: string;
  outcomeId: string | null;
  content: string;
  position: number;
  createdAt: Date;
}

/** Dòng `course_section_book_anchors` (neo khung SGK chụp trên section). */
export interface SectionBookAnchorRow {
  id: string;
  sectionId: string;
  bookId: string | null;
  bookNodeId: string | null;
  nodeTitle: string;
  createdAt: Date;
}

/** Dòng `course_section_book_items` (mục bài SGK chụp trong một neo). */
export interface SectionBookItemRow {
  id: string;
  anchorId: string;
  bookNodeId: string | null;
  title: string;
  position: number;
  createdAt: Date;
}

/** Dòng `course_section_book_item_outcomes` (YCCĐ chụp kèm một mục bài SGK). */
export interface SectionBookItemOutcomeRow {
  id: string;
  itemId: string;
  outcomeId: string | null;
  content: string;
  position: number;
  createdAt: Date;
}

/** Dòng `course_format_options`. */
export interface CourseFormatOptionRow {
  id: string;
  courseId: string;
  format: string;
  sectionId: string | null;
  name: string;
  value: string | null;
}

// ---------------------------------------------------------------------------
// Kiểu ghi vào (khớp `$inferInsert` của repository cũ)
// ---------------------------------------------------------------------------

/** Giá trị chèn `course_categories`. */
export interface NewCategory {
  id?: string;
  tenantId: string;
  name: string;
  idNumber?: string | null;
  description?: string;
  parent?: string | null;
  sortOrder?: number;
  path?: string;
  depth?: number;
  visible?: boolean;
}

/** Giá trị chèn `course`. */
export interface NewCourse {
  id?: string;
  tenantId: string;
  category: string;
  classId?: string | null;
  fullName: string;
  shortName: string;
  idNumber?: string;
  summary?: string;
  format?: string;
  visible?: boolean;
  startDate?: Date | null;
  endDate?: Date | null;
  groupMode?: number;
  groupModeForce?: boolean;
  sortOrder?: number;
  subjectId?: string | null;
  grade?: number | null;
  isTemplate?: boolean;
}

/** Giá trị chèn `course_sections`. */
export interface NewSection {
  id?: string;
  course: string;
  section?: number;
  name?: string | null;
  summary?: string;
  visible?: boolean;
  availability?: unknown;
  openAt?: Date | null;
}

/** Giá trị chèn `course_modules`. */
export interface NewCm {
  id?: string;
  course: string;
  section: string;
  component: string;
  instanceId?: string | null;
  name?: string;
  added?: Date;
  visible?: boolean;
  groupMode?: number;
  availability?: unknown;
  completion?: number;
  completionView?: boolean;
  completionUseGrade?: boolean;
  completionManual?: boolean;
  completionExpected?: Date | null;
  openAt?: Date | null;
  deletionInProgress?: boolean;
  sortOrder?: number;
}

/** Giá trị chèn `course_section_anchors`. */
export interface NewSectionAnchor {
  id?: string;
  sectionId: string;
  curriculumId?: string | null;
  nodeId?: string | null;
  nodeTitle: string;
}

/** Giá trị chèn `course_section_anchor_outcomes`. */
export interface NewSectionAnchorOutcome {
  id?: string;
  anchorId: string;
  outcomeId?: string | null;
  content: string;
  position?: number;
}

/** Giá trị chèn `course_section_book_anchors`. */
export interface NewSectionBookAnchor {
  id?: string;
  sectionId: string;
  bookId?: string | null;
  bookNodeId?: string | null;
  nodeTitle: string;
}

/** Giá trị chèn `course_section_book_items`. */
export interface NewSectionBookItem {
  id?: string;
  anchorId: string;
  bookNodeId?: string | null;
  title: string;
  position?: number;
}

/** Giá trị chèn `course_section_book_item_outcomes`. */
export interface NewSectionBookItemOutcome {
  id?: string;
  itemId: string;
  outcomeId?: string | null;
  content: string;
  position?: number;
}

// ---------------------------------------------------------------------------
// Danh sách cột đọc (dùng chung cho select và returning)
// ---------------------------------------------------------------------------

const CATEGORY_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'name',
  'id_number as idNumber',
  'description',
  'parent',
  'sort_order as sortOrder',
  'path',
  'depth',
  'visible',
  'updated_at as updatedAt',
] as const;

const COURSE_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'category',
  'class_id as classId',
  'full_name as fullName',
  'short_name as shortName',
  'id_number as idNumber',
  'summary',
  'format',
  'visible',
  'start_date as startDate',
  'end_date as endDate',
  'group_mode as groupMode',
  'group_mode_force as groupModeForce',
  'sort_order as sortOrder',
  'subject_id as subjectId',
  'grade',
  'is_template as isTemplate',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const SECTION_COLUMNS = [
  'id',
  'course',
  'section',
  'name',
  'summary',
  'visible',
  'availability',
  'open_at as openAt',
  'updated_at as updatedAt',
] as const;

const CM_COLUMNS = [
  'id',
  'course',
  'section',
  'component',
  'instance_id as instanceId',
  'name',
  'added',
  'visible',
  'group_mode as groupMode',
  'availability',
  'completion',
  'completion_view as completionView',
  'completion_use_grade as completionUseGrade',
  'completion_manual as completionManual',
  'completion_expected as completionExpected',
  'open_at as openAt',
  'deletion_in_progress as deletionInProgress',
  'sort_order as sortOrder',
] as const;

const ANCHOR_COLUMNS = [
  'id',
  'section_id as sectionId',
  'curriculum_id as curriculumId',
  'node_id as nodeId',
  'node_title as nodeTitle',
  'created_at as createdAt',
] as const;

const ANCHOR_OUTCOME_COLUMNS = [
  'id',
  'anchor_id as anchorId',
  'outcome_id as outcomeId',
  'content',
  'position',
  'created_at as createdAt',
] as const;

const BOOK_ANCHOR_COLUMNS = [
  'id',
  'section_id as sectionId',
  'book_id as bookId',
  'book_node_id as bookNodeId',
  'node_title as nodeTitle',
  'created_at as createdAt',
] as const;

const BOOK_ITEM_COLUMNS = [
  'id',
  'anchor_id as anchorId',
  'book_node_id as bookNodeId',
  'title',
  'position',
  'created_at as createdAt',
] as const;

const BOOK_ITEM_OUTCOME_COLUMNS = [
  'id',
  'item_id as itemId',
  'outcome_id as outcomeId',
  'content',
  'position',
  'created_at as createdAt',
] as const;

const FORMAT_OPTION_COLUMNS = [
  'id',
  'course_id as courseId',
  'format',
  'section_id as sectionId',
  'name',
  'value',
] as const;

// ---------------------------------------------------------------------------
// Ánh xạ ghi: loại `undefined` tường minh từng trường (T-4); cột jsonb nullable phân biệt ba trạng thái — `undefined` bỏ qua, `null` ghi SQL NULL, giá trị thì xâu hoá qua `jsonbValue`.
// ---------------------------------------------------------------------------

function categoryInsertValues(values: NewCategory): InsertObject<CentreDB, 'course_categories'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    tenant_id: values.tenantId,
    name: values.name,
    ...(values.idNumber !== undefined ? { id_number: values.idNumber } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
    ...(values.parent !== undefined ? { parent: values.parent } : {}),
    ...(values.sortOrder !== undefined ? { sort_order: values.sortOrder } : {}),
    ...(values.path !== undefined ? { path: values.path } : {}),
    ...(values.depth !== undefined ? { depth: values.depth } : {}),
    ...(values.visible !== undefined ? { visible: values.visible } : {}),
  };
}

function categoryUpdateSet(patch: Partial<NewCategory>): UpdateObject<CentreDB, 'course_categories'> {
  return {
    ...(patch.tenantId !== undefined ? { tenant_id: patch.tenantId } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.idNumber !== undefined ? { id_number: patch.idNumber } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.parent !== undefined ? { parent: patch.parent } : {}),
    ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
    ...(patch.path !== undefined ? { path: patch.path } : {}),
    ...(patch.depth !== undefined ? { depth: patch.depth } : {}),
    ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
  };
}

function courseInsertValues(values: NewCourse): InsertObject<CentreDB, 'course'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    tenant_id: values.tenantId,
    category: values.category,
    ...(values.classId !== undefined ? { class_id: values.classId } : {}),
    full_name: values.fullName,
    short_name: values.shortName,
    ...(values.idNumber !== undefined ? { id_number: values.idNumber } : {}),
    ...(values.summary !== undefined ? { summary: values.summary } : {}),
    ...(values.format !== undefined ? { format: values.format } : {}),
    ...(values.visible !== undefined ? { visible: values.visible } : {}),
    ...(values.startDate !== undefined ? { start_date: values.startDate } : {}),
    ...(values.endDate !== undefined ? { end_date: values.endDate } : {}),
    ...(values.groupMode !== undefined ? { group_mode: values.groupMode } : {}),
    ...(values.groupModeForce !== undefined ? { group_mode_force: values.groupModeForce } : {}),
    ...(values.sortOrder !== undefined ? { sort_order: values.sortOrder } : {}),
    ...(values.subjectId !== undefined ? { subject_id: values.subjectId } : {}),
    ...(values.grade !== undefined ? { grade: values.grade } : {}),
    ...(values.isTemplate !== undefined ? { is_template: values.isTemplate } : {}),
  };
}

function courseUpdateSet(patch: Partial<NewCourse>): UpdateObject<CentreDB, 'course'> {
  return {
    ...(patch.category !== undefined ? { category: patch.category } : {}),
    ...(patch.classId !== undefined ? { class_id: patch.classId } : {}),
    ...(patch.fullName !== undefined ? { full_name: patch.fullName } : {}),
    ...(patch.shortName !== undefined ? { short_name: patch.shortName } : {}),
    ...(patch.idNumber !== undefined ? { id_number: patch.idNumber } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.format !== undefined ? { format: patch.format } : {}),
    ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
    ...(patch.startDate !== undefined ? { start_date: patch.startDate } : {}),
    ...(patch.endDate !== undefined ? { end_date: patch.endDate } : {}),
    ...(patch.groupMode !== undefined ? { group_mode: patch.groupMode } : {}),
    ...(patch.groupModeForce !== undefined ? { group_mode_force: patch.groupModeForce } : {}),
    ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
    ...(patch.subjectId !== undefined ? { subject_id: patch.subjectId } : {}),
    ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
    ...(patch.isTemplate !== undefined ? { is_template: patch.isTemplate } : {}),
  };
}

function sectionInsertValues(values: NewSection): InsertObject<CentreDB, 'course_sections'> {
  const availability = jsonbField(values.availability);
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    course: values.course,
    ...(values.section !== undefined ? { section: values.section } : {}),
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.summary !== undefined ? { summary: values.summary } : {}),
    ...(values.visible !== undefined ? { visible: values.visible } : {}),
    ...(availability !== undefined ? { availability } : {}),
    ...(values.openAt !== undefined ? { open_at: values.openAt } : {}),
  };
}

function sectionUpdateSet(patch: Partial<NewSection>): UpdateObject<CentreDB, 'course_sections'> {
  const availability = jsonbField(patch.availability);
  return {
    ...(patch.course !== undefined ? { course: patch.course } : {}),
    ...(patch.section !== undefined ? { section: patch.section } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
    ...(availability !== undefined ? { availability } : {}),
    ...(patch.openAt !== undefined ? { open_at: patch.openAt } : {}),
  };
}

function cmInsertValues(values: NewCm): InsertObject<CentreDB, 'course_modules'> {
  const availability = jsonbField(values.availability);
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    course: values.course,
    section: values.section,
    component: values.component,
    ...(values.instanceId !== undefined ? { instance_id: values.instanceId } : {}),
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.added !== undefined ? { added: values.added } : {}),
    ...(values.visible !== undefined ? { visible: values.visible } : {}),
    ...(values.groupMode !== undefined ? { group_mode: values.groupMode } : {}),
    ...(availability !== undefined ? { availability } : {}),
    ...(values.completion !== undefined ? { completion: values.completion } : {}),
    ...(values.completionView !== undefined ? { completion_view: values.completionView } : {}),
    ...(values.completionUseGrade !== undefined ? { completion_use_grade: values.completionUseGrade } : {}),
    ...(values.completionManual !== undefined ? { completion_manual: values.completionManual } : {}),
    ...(values.completionExpected !== undefined ? { completion_expected: values.completionExpected } : {}),
    ...(values.openAt !== undefined ? { open_at: values.openAt } : {}),
    ...(values.deletionInProgress !== undefined ? { deletion_in_progress: values.deletionInProgress } : {}),
    ...(values.sortOrder !== undefined ? { sort_order: values.sortOrder } : {}),
  };
}

function cmUpdateSet(patch: Partial<NewCm>): UpdateObject<CentreDB, 'course_modules'> {
  const availability = jsonbField(patch.availability);
  return {
    ...(patch.course !== undefined ? { course: patch.course } : {}),
    ...(patch.section !== undefined ? { section: patch.section } : {}),
    ...(patch.component !== undefined ? { component: patch.component } : {}),
    ...(patch.instanceId !== undefined ? { instance_id: patch.instanceId } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.added !== undefined ? { added: patch.added } : {}),
    ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
    ...(patch.groupMode !== undefined ? { group_mode: patch.groupMode } : {}),
    ...(availability !== undefined ? { availability } : {}),
    ...(patch.completion !== undefined ? { completion: patch.completion } : {}),
    ...(patch.completionView !== undefined ? { completion_view: patch.completionView } : {}),
    ...(patch.completionUseGrade !== undefined ? { completion_use_grade: patch.completionUseGrade } : {}),
    ...(patch.completionManual !== undefined ? { completion_manual: patch.completionManual } : {}),
    ...(patch.completionExpected !== undefined ? { completion_expected: patch.completionExpected } : {}),
    ...(patch.openAt !== undefined ? { open_at: patch.openAt } : {}),
    ...(patch.deletionInProgress !== undefined ? { deletion_in_progress: patch.deletionInProgress } : {}),
    ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
  };
}

function sectionAnchorInsertValues(values: NewSectionAnchor): InsertObject<CentreDB, 'course_section_anchors'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    section_id: values.sectionId,
    ...(values.curriculumId !== undefined ? { curriculum_id: values.curriculumId } : {}),
    ...(values.nodeId !== undefined ? { node_id: values.nodeId } : {}),
    node_title: values.nodeTitle,
  };
}

function sectionAnchorOutcomeInsertValues(values: NewSectionAnchorOutcome): InsertObject<CentreDB, 'course_section_anchor_outcomes'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    anchor_id: values.anchorId,
    ...(values.outcomeId !== undefined ? { outcome_id: values.outcomeId } : {}),
    content: values.content,
    ...(values.position !== undefined ? { position: values.position } : {}),
  };
}

function sectionBookAnchorInsertValues(values: NewSectionBookAnchor): InsertObject<CentreDB, 'course_section_book_anchors'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    section_id: values.sectionId,
    ...(values.bookId !== undefined ? { book_id: values.bookId } : {}),
    ...(values.bookNodeId !== undefined ? { book_node_id: values.bookNodeId } : {}),
    node_title: values.nodeTitle,
  };
}

function sectionBookItemInsertValues(values: NewSectionBookItem): InsertObject<CentreDB, 'course_section_book_items'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    anchor_id: values.anchorId,
    ...(values.bookNodeId !== undefined ? { book_node_id: values.bookNodeId } : {}),
    title: values.title,
    ...(values.position !== undefined ? { position: values.position } : {}),
  };
}

function sectionBookItemOutcomeInsertValues(values: NewSectionBookItemOutcome): InsertObject<CentreDB, 'course_section_book_item_outcomes'> {
  return {
    ...(values.id !== undefined ? { id: values.id } : {}),
    item_id: values.itemId,
    ...(values.outcomeId !== undefined ? { outcome_id: values.outcomeId } : {}),
    content: values.content,
    ...(values.position !== undefined ? { position: values.position } : {}),
  };
}

/**
 * Kho dữ liệu khoá học: category (cây có path vật chất hoá), course,
 * section, course module (cm) và format options.
 */
export class CoursesRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CoursesDb {
    return this.handle;
  }

  /** Mở một transaction trên kho trung tâm. */
  async transaction<T>(fn: (tx: CoursesTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }

  // danh mục

  /** Chèn category. */
  async insertCategory(v: NewCategory, db: CoursesDb = this.db()): Promise<CategoryRow> {
    return db
      .insertInto('course_categories')
      .values(categoryInsertValues(v))
      .returning(CATEGORY_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Lấy category theo id. */
  async getCategory(id: string, db: CoursesDb = this.db()): Promise<CategoryRow | undefined> {
    return db
      .selectFrom('course_categories')
      .select(CATEGORY_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Liệt kê mọi category. */
  async listCategories(db: CoursesDb = this.db()): Promise<CategoryRow[]> {
    return db
      .selectFrom('course_categories')
      .select(CATEGORY_COLUMNS)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Các category con trực tiếp của một category. */
  async childrenOf(parent: string, db: CoursesDb = this.db()): Promise<CategoryRow[]> {
    return db
      .selectFrom('course_categories')
      .select(CATEGORY_COLUMNS)
      .where('parent', '=', parent)
      .orderBy('sort_order', 'asc')
      .execute();
  }

  /** Category và mọi con cháu qua tiền tố path (path có dạng như /1/4/9). */
  async subtreeOf(cat: CategoryRow, db: CoursesDb = this.db()): Promise<CategoryRow[]> {
    return db
      .selectFrom('course_categories')
      .select(CATEGORY_COLUMNS)
      .where((eb) => eb.or([eb('id', '=', cat.id), eb('path', 'like', `${cat.path}/%`)]))
      .execute();
  }

  /** Cập nhật category. */
  async updateCategory(id: string, v: Partial<NewCategory>, db: CoursesDb = this.db()): Promise<void> {
    await db
      .updateTable('course_categories')
      .set({ ...categoryUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Viết lại path/depth khi di chuyển category. */
  async updateCategoryPath(id: string, path: string, depth: number, db: CoursesDb = this.db()): Promise<void> {
    await db
      .updateTable('course_categories')
      .set({ path, depth })
      .where('id', '=', id)
      .execute();
  }

  /** Xoá category. */
  async deleteCategory(id: string, db: CoursesDb = this.db()): Promise<void> {
    await db.deleteFrom('course_categories').where('id', '=', id).execute();
  }

  /** Số category anh em (phục vụ sortOrder). */
  async countSiblingCategories(parent: string | null, db: CoursesDb = this.db()): Promise<number> {
    let query = db.selectFrom('course_categories').select(sql<number>`count(*)::int`.as('n'));
    query = parent === null ? query.where('parent', 'is', null) : query.where('parent', '=', parent);
    const row = await query.executeTakeFirst();
    return row?.n ?? 0;
  }

  // khoá học

  /** Chèn khoá học. */
  async insertCourse(v: NewCourse, db: CoursesDb = this.db()): Promise<CourseRow> {
    return db
      .insertInto('course')
      .values(courseInsertValues(v))
      .returning(COURSE_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Lấy khoá học theo id. */
  async getCourse(id: string, db: CoursesDb = this.db()): Promise<CourseRow | undefined> {
    return db
      .selectFrom('course')
      .select(COURSE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Lấy khoá học theo shortName duy nhất. */
  async getCourseByShortname(shortName: string, db: CoursesDb = this.db()): Promise<CourseRow | undefined> {
    return db
      .selectFrom('course')
      .select(COURSE_COLUMNS)
      .where('short_name', '=', shortName)
      .executeTakeFirst();
  }

  /** Liệt kê khoá học. */
  async listCourses(categoryId?: string, db: CoursesDb = this.db()): Promise<CourseRow[]> {
    let query = db
      .selectFrom('course')
      .select(COURSE_COLUMNS)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc');
    if (categoryId !== undefined) query = query.where('category', '=', categoryId);
    return query.execute();
  }

  /**
   * Khoá học thuộc các category cho trước.
   *
   * Một truy vấn `where category in (...)` thay cho vòng lặp N+1 gọi
   * `listCourses` từng category; thứ tự trả về giữ nguyên như vòng lặp
   * cũ: nhóm theo thứ tự `categoryIds` đầu vào, trong mỗi nhóm theo
   * (`sort_order`, `id`) như `listCourses` (sắp xếp ổn định nên thứ tự
   * trong nhóm không đổi).
   */
  async listCoursesInCategories(categoryIds: string[], db: CoursesDb = this.db()): Promise<CourseRow[]> {
    if (!categoryIds.length) return [];
    const rows = (await db
      .selectFrom('course')
      .select(COURSE_COLUMNS)
      .where('category', 'in', categoryIds)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute()) as CourseRow[];
    const order = new Map(categoryIds.map((id, i) => [id, i]));
    return rows.sort((a, b) => (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0));
  }

  /** Cập nhật khoá học. */
  async updateCourse(id: string, v: Partial<NewCourse>, db: CoursesDb = this.db()): Promise<void> {
    await db
      .updateTable('course')
      .set({ ...courseUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Xoá khoá học. */
  async deleteCourse(id: string, db: CoursesDb = this.db()): Promise<void> {
    await db.deleteFrom('course').where('id', '=', id).execute();
  }

  // phần

  /** Chèn section. */
  async insertSection(v: NewSection, db: CoursesDb = this.db()): Promise<SectionRow> {
    return db
      .insertInto('course_sections')
      .values(sectionInsertValues(v))
      .returning(SECTION_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Lấy môn học theo id (đối chiếu neo môn × khối của khoá — K0a). */
  async getSubjectById(id: string, db: CoursesDb = this.db()): Promise<{ id: string } | undefined> {
    return db.selectFrom('subjects').select('id').where('id', '=', id).executeTakeFirst();
  }

  /**
   * Dịch số thứ tự của các section từ `fromSection` trở đi trong một
   * khoá (phục vụ chèn khung tại vị trí): cộng `delta` vào số section —
   * lượt chèn chạy hai pass qua vùng đệm lớn để không vi phạm unique
   * (course, section) giữa chừng.
   */
  async shiftSections(tx: CoursesTx, courseId: string, fromSection: number, delta: number): Promise<void> {
    await tx
      .updateTable('course_sections')
      .set({ section: sql<number>`section + ${delta}`, updated_at: new Date() })
      .where('course', '=', courseId)
      .where('section', '>=', fromSection)
      .execute();
  }

  /** Ghi neo khung cho một section vừa tạo từ khung chương trình. */
  async insertSectionAnchor(v: NewSectionAnchor, db: CoursesDb = this.db()): Promise<SectionAnchorRow> {
    return db
      .insertInto('course_section_anchors')
      .values(sectionAnchorInsertValues(v))
      .returning(ANCHOR_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Ghi các YCCĐ chụp kèm một neo khung (đúng thứ tự position truyền vào). */
  async insertSectionAnchorOutcomes(v: NewSectionAnchorOutcome[], db: CoursesDb = this.db()): Promise<void> {
    if (v.length === 0) return;
    await db.insertInto('course_section_anchor_outcomes').values(v.map(sectionAnchorOutcomeInsertValues)).execute();
  }

  /** Toàn bộ neo khung của nhiều section (dựng khung hiển thị trong nội dung khoá). */
  async listAnchorsForSections(sectionIds: string[], db: CoursesDb = this.db()): Promise<SectionAnchorRow[]> {
    if (sectionIds.length === 0) return [];
    return db
      .selectFrom('course_section_anchors')
      .select(ANCHOR_COLUMNS)
      .where('section_id', 'in', sectionIds)
      .execute();
  }

  /** Toàn bộ YCCĐ chụp của nhiều neo khung, theo position. */
  async listAnchorOutcomes(anchorIds: string[], db: CoursesDb = this.db()): Promise<SectionAnchorOutcomeRow[]> {
    if (anchorIds.length === 0) return [];
    return db
      .selectFrom('course_section_anchor_outcomes')
      .select(ANCHOR_OUTCOME_COLUMNS)
      .where('anchor_id', 'in', anchorIds)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  /** Ghi neo khung SGK cho một section vừa tạo từ khung sách (K0b). */
  async insertSectionBookAnchor(v: NewSectionBookAnchor, db: CoursesDb = this.db()): Promise<SectionBookAnchorRow> {
    return db
      .insertInto('course_section_book_anchors')
      .values(sectionBookAnchorInsertValues(v))
      .returning(BOOK_ANCHOR_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Ghi một mục bài SGK chụp trong một neo khung SGK. */
  async insertSectionBookItem(v: NewSectionBookItem, db: CoursesDb = this.db()): Promise<SectionBookItemRow> {
    return db
      .insertInto('course_section_book_items')
      .values(sectionBookItemInsertValues(v))
      .returning(BOOK_ITEM_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Ghi các YCCĐ chụp kèm một mục bài SGK (đúng thứ tự position truyền vào). */
  async insertSectionBookItemOutcomes(v: NewSectionBookItemOutcome[], db: CoursesDb = this.db()): Promise<void> {
    if (v.length === 0) return;
    await db.insertInto('course_section_book_item_outcomes').values(v.map(sectionBookItemOutcomeInsertValues)).execute();
  }

  /** Toàn bộ neo khung SGK của nhiều section (dựng khung SGK hiển thị trong nội dung khoá). */
  async listBookAnchorsForSections(sectionIds: string[], db: CoursesDb = this.db()): Promise<SectionBookAnchorRow[]> {
    if (sectionIds.length === 0) return [];
    return db
      .selectFrom('course_section_book_anchors')
      .select(BOOK_ANCHOR_COLUMNS)
      .where('section_id', 'in', sectionIds)
      .execute();
  }

  /** Toàn bộ mục bài SGK chụp của nhiều neo, theo position. */
  async listBookItems(anchorIds: string[], db: CoursesDb = this.db()): Promise<SectionBookItemRow[]> {
    if (anchorIds.length === 0) return [];
    return db
      .selectFrom('course_section_book_items')
      .select(BOOK_ITEM_COLUMNS)
      .where('anchor_id', 'in', anchorIds)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  /** Toàn bộ YCCĐ chụp của nhiều mục bài SGK, theo position. */
  async listBookItemOutcomes(itemIds: string[], db: CoursesDb = this.db()): Promise<SectionBookItemOutcomeRow[]> {
    if (itemIds.length === 0) return [];
    return db
      .selectFrom('course_section_book_item_outcomes')
      .select(BOOK_ITEM_OUTCOME_COLUMNS)
      .where('item_id', 'in', itemIds)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  /** Lấy section theo id. */
  async getSection(id: string, db: CoursesDb = this.db()): Promise<SectionRow | undefined> {
    return db
      .selectFrom('course_sections')
      .select(SECTION_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Liệt kê section của khoá học theo thứ tự. */
  async listSections(courseId: string, db: CoursesDb = this.db()): Promise<SectionRow[]> {
    return db
      .selectFrom('course_sections')
      .select(SECTION_COLUMNS)
      .where('course', '=', courseId)
      .orderBy('section', 'asc')
      .execute();
  }

  /** Cập nhật section (tên, summary, availability JSON). */
  async updateSection(id: string, v: Partial<NewSection>, db: CoursesDb = this.db()): Promise<void> {
    await db
      .updateTable('course_sections')
      .set({ ...sectionUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Xoá section. */
  async deleteSection(id: string, db: CoursesDb = this.db()): Promise<void> {
    await db.deleteFrom('course_sections').where('id', '=', id).execute();
  }

  // mô-đun của khoá học

  /** Chèn course module. */
  async insertCm(v: NewCm, db: CoursesDb = this.db()): Promise<CmRow> {
    return db
      .insertInto('course_modules')
      .values(cmInsertValues(v))
      .returning(CM_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Lấy cm theo id. */
  async getCm(id: string, db: CoursesDb = this.db()): Promise<CmRow | undefined> {
    return db
      .selectFrom('course_modules')
      .select(CM_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /**
   * Liệt kê mọi cm của khoá học theo thứ tự outline (K1: `sortOrder`
   * tường minh, id uuidv7 làm khoá phụ giữ nguyên thứ tự tạo cho dữ
   * liệu cũ mọi sortOrder đều bằng 0).
   */
  async listCms(courseId: string, db: CoursesDb = this.db()): Promise<CmRow[]> {
    return db
      .selectFrom('course_modules')
      .select(CM_COLUMNS)
      .where('course', '=', courseId)
      .where('deletion_in_progress', '=', false)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Cm trong một section theo thứ tự outline (K1). */
  async listCmsInSection(sectionId: string, db: CoursesDb = this.db()): Promise<CmRow[]> {
    return db
      .selectFrom('course_modules')
      .select(CM_COLUMNS)
      .where('section', '=', sectionId)
      .where('deletion_in_progress', '=', false)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * Khoá mẫu tổ/trường (K1): các khoá `is_template` — danh sách nguồn
   * của đường 5 trong wizard tạo khoá.
   */
  async listTemplateCourses(db: CoursesDb = this.db()): Promise<CourseRow[]> {
    return db
      .selectFrom('course')
      .select(COURSE_COLUMNS)
      .where('is_template', '=', true)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Cập nhật cm. */
  async updateCm(id: string, v: Partial<NewCm>, db: CoursesDb = this.db()): Promise<void> {
    await db.updateTable('course_modules').set(cmUpdateSet(v)).where('id', '=', id).execute();
  }

  /** Xoá cm. */
  async deleteCm(id: string, db: CoursesDb = this.db()): Promise<void> {
    await db.deleteFrom('course_modules').where('id', '=', id).execute();
  }

  // tuỳ chọn định dạng

  /** Ghi một tuỳ chọn định dạng khoá học (format option). */
  async setFormatOption(
    courseId: string,
    format: string,
    name: string,
    value: string | null,
    sectionId: string | null = null,
    db: CoursesDb = this.db(),
  ): Promise<void> {
    if (sectionId === null) {
      // sectionId NULL không tham gia unique conflict (NULL luôn khác
      // nhau trong PostgreSQL) nên upsert thủ công cho tuỳ chọn cấp
      // khoá học.
      const existing = await db
        .selectFrom('course_format_options')
        .select(FORMAT_OPTION_COLUMNS)
        .where('course_id', '=', courseId)
        .where('format', '=', format)
        .where('section_id', 'is', null)
        .where('name', '=', name)
        .executeTakeFirst();
      if (existing) {
        await db
          .updateTable('course_format_options')
          .set({ value })
          .where('id', '=', existing.id)
          .execute();
        return;
      }
      await db
        .insertInto('course_format_options')
        .values({ course_id: courseId, format, name, value, section_id: sectionId })
        .execute();
      return;
    }
    await db
      .insertInto('course_format_options')
      .values({ course_id: courseId, format, name, value, section_id: sectionId })
      .onConflict((oc) => oc.columns(['course_id', 'format', 'section_id', 'name']).doUpdateSet({ value }))
      .execute();
  }

  /** Đọc các tuỳ chọn định dạng của khoá học. */
  async listFormatOptions(courseId: string, db: CoursesDb = this.db()): Promise<CourseFormatOptionRow[]> {
    return db
      .selectFrom('course_format_options')
      .select(FORMAT_OPTION_COLUMNS)
      .where('course_id', '=', courseId)
      .execute();
  }
}
