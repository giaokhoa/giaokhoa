import { sql, type RawBuilder } from 'kysely';
import type { CentreDb, CentreTx } from '../client';
import type { Json } from '../types/centre-db';


export type CoursesDb = CentreDb | CentreTx;
export type CoursesTx = CentreTx;


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

export interface SectionAnchorRow {
  id: string;
  sectionId: string;
  curriculumId: string | null;
  nodeId: string | null;
  nodeTitle: string;
  createdAt: Date;
}

export interface SectionAnchorOutcomeRow {
  id: string;
  anchorId: string;
  outcomeId: string | null;
  content: string;
  position: number;
  createdAt: Date;
}

export interface SectionBookAnchorRow {
  id: string;
  sectionId: string;
  bookId: string | null;
  bookNodeId: string | null;
  nodeTitle: string;
  createdAt: Date;
}

export interface SectionBookItemRow {
  id: string;
  anchorId: string;
  bookNodeId: string | null;
  title: string;
  position: number;
  createdAt: Date;
}

export interface SectionBookItemOutcomeRow {
  id: string;
  itemId: string;
  outcomeId: string | null;
  content: string;
  position: number;
  createdAt: Date;
}

export interface CourseFormatOptionRow {
  id: string;
  courseId: string;
  format: string;
  sectionId: string | null;
  name: string;
  value: string | null;
}


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

export interface NewSectionAnchor {
  id?: string;
  sectionId: string;
  curriculumId?: string | null;
  nodeId?: string | null;
  nodeTitle: string;
}

export interface NewSectionAnchorOutcome {
  id?: string;
  anchorId: string;
  outcomeId?: string | null;
  content: string;
  position?: number;
}

export interface NewSectionBookAnchor {
  id?: string;
  sectionId: string;
  bookId?: string | null;
  bookNodeId?: string | null;
  nodeTitle: string;
}

export interface NewSectionBookItem {
  id?: string;
  anchorId: string;
  bookNodeId?: string | null;
  title: string;
  position?: number;
}

export interface NewSectionBookItemOutcome {
  id?: string;
  itemId: string;
  outcomeId?: string | null;
  content: string;
  position?: number;
}


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


function jsonbValue<T>(value: T): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

function jsonbField(value: unknown): RawBuilder<Json> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return jsonbValue(value as Json);
}

function categoryInsertValues(v: NewCategory) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    tenant_id: v.tenantId,
    name: v.name,
    ...(v.idNumber !== undefined ? { id_number: v.idNumber } : {}),
    ...(v.description !== undefined ? { description: v.description } : {}),
    ...(v.parent !== undefined ? { parent: v.parent } : {}),
    ...(v.sortOrder !== undefined ? { sort_order: v.sortOrder } : {}),
    ...(v.path !== undefined ? { path: v.path } : {}),
    ...(v.depth !== undefined ? { depth: v.depth } : {}),
    ...(v.visible !== undefined ? { visible: v.visible } : {}),
  };
}

function categoryUpdateValues(v: Partial<NewCategory>) {
  return {
    ...(v.tenantId !== undefined ? { tenant_id: v.tenantId } : {}),
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.idNumber !== undefined ? { id_number: v.idNumber } : {}),
    ...(v.description !== undefined ? { description: v.description } : {}),
    ...(v.parent !== undefined ? { parent: v.parent } : {}),
    ...(v.sortOrder !== undefined ? { sort_order: v.sortOrder } : {}),
    ...(v.path !== undefined ? { path: v.path } : {}),
    ...(v.depth !== undefined ? { depth: v.depth } : {}),
    ...(v.visible !== undefined ? { visible: v.visible } : {}),
  };
}

function courseInsertValues(v: NewCourse) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    tenant_id: v.tenantId,
    category: v.category,
    ...(v.classId !== undefined ? { class_id: v.classId } : {}),
    full_name: v.fullName,
    short_name: v.shortName,
    ...(v.idNumber !== undefined ? { id_number: v.idNumber } : {}),
    ...(v.summary !== undefined ? { summary: v.summary } : {}),
    ...(v.format !== undefined ? { format: v.format } : {}),
    ...(v.visible !== undefined ? { visible: v.visible } : {}),
    ...(v.startDate !== undefined ? { start_date: v.startDate } : {}),
    ...(v.endDate !== undefined ? { end_date: v.endDate } : {}),
    ...(v.groupMode !== undefined ? { group_mode: v.groupMode } : {}),
    ...(v.groupModeForce !== undefined ? { group_mode_force: v.groupModeForce } : {}),
    ...(v.sortOrder !== undefined ? { sort_order: v.sortOrder } : {}),
    ...(v.subjectId !== undefined ? { subject_id: v.subjectId } : {}),
    ...(v.grade !== undefined ? { grade: v.grade } : {}),
    ...(v.isTemplate !== undefined ? { is_template: v.isTemplate } : {}),
  };
}

function courseUpdateValues(v: Partial<NewCourse>) {
  return {
    ...(v.category !== undefined ? { category: v.category } : {}),
    ...(v.classId !== undefined ? { class_id: v.classId } : {}),
    ...(v.fullName !== undefined ? { full_name: v.fullName } : {}),
    ...(v.shortName !== undefined ? { short_name: v.shortName } : {}),
    ...(v.idNumber !== undefined ? { id_number: v.idNumber } : {}),
    ...(v.summary !== undefined ? { summary: v.summary } : {}),
    ...(v.format !== undefined ? { format: v.format } : {}),
    ...(v.visible !== undefined ? { visible: v.visible } : {}),
    ...(v.startDate !== undefined ? { start_date: v.startDate } : {}),
    ...(v.endDate !== undefined ? { end_date: v.endDate } : {}),
    ...(v.groupMode !== undefined ? { group_mode: v.groupMode } : {}),
    ...(v.groupModeForce !== undefined ? { group_mode_force: v.groupModeForce } : {}),
    ...(v.sortOrder !== undefined ? { sort_order: v.sortOrder } : {}),
    ...(v.subjectId !== undefined ? { subject_id: v.subjectId } : {}),
    ...(v.grade !== undefined ? { grade: v.grade } : {}),
    ...(v.isTemplate !== undefined ? { is_template: v.isTemplate } : {}),
  };
}

function sectionInsertValues(v: NewSection) {
  const availability = jsonbField(v.availability);
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    course: v.course,
    ...(v.section !== undefined ? { section: v.section } : {}),
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.summary !== undefined ? { summary: v.summary } : {}),
    ...(v.visible !== undefined ? { visible: v.visible } : {}),
    ...(availability !== undefined ? { availability } : {}),
    ...(v.openAt !== undefined ? { open_at: v.openAt } : {}),
  };
}

function sectionUpdateValues(v: Partial<NewSection>) {
  const availability = jsonbField(v.availability);
  return {
    ...(v.course !== undefined ? { course: v.course } : {}),
    ...(v.section !== undefined ? { section: v.section } : {}),
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.summary !== undefined ? { summary: v.summary } : {}),
    ...(v.visible !== undefined ? { visible: v.visible } : {}),
    ...(availability !== undefined ? { availability } : {}),
    ...(v.openAt !== undefined ? { open_at: v.openAt } : {}),
  };
}

function cmInsertValues(v: NewCm) {
  const availability = jsonbField(v.availability);
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    course: v.course,
    section: v.section,
    component: v.component,
    ...(v.instanceId !== undefined ? { instance_id: v.instanceId } : {}),
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.added !== undefined ? { added: v.added } : {}),
    ...(v.visible !== undefined ? { visible: v.visible } : {}),
    ...(v.groupMode !== undefined ? { group_mode: v.groupMode } : {}),
    ...(availability !== undefined ? { availability } : {}),
    ...(v.completion !== undefined ? { completion: v.completion } : {}),
    ...(v.completionView !== undefined ? { completion_view: v.completionView } : {}),
    ...(v.completionUseGrade !== undefined ? { completion_use_grade: v.completionUseGrade } : {}),
    ...(v.completionManual !== undefined ? { completion_manual: v.completionManual } : {}),
    ...(v.completionExpected !== undefined ? { completion_expected: v.completionExpected } : {}),
    ...(v.openAt !== undefined ? { open_at: v.openAt } : {}),
    ...(v.deletionInProgress !== undefined ? { deletion_in_progress: v.deletionInProgress } : {}),
    ...(v.sortOrder !== undefined ? { sort_order: v.sortOrder } : {}),
  };
}

function cmUpdateValues(v: Partial<NewCm>) {
  const availability = jsonbField(v.availability);
  return {
    ...(v.course !== undefined ? { course: v.course } : {}),
    ...(v.section !== undefined ? { section: v.section } : {}),
    ...(v.component !== undefined ? { component: v.component } : {}),
    ...(v.instanceId !== undefined ? { instance_id: v.instanceId } : {}),
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.added !== undefined ? { added: v.added } : {}),
    ...(v.visible !== undefined ? { visible: v.visible } : {}),
    ...(v.groupMode !== undefined ? { group_mode: v.groupMode } : {}),
    ...(availability !== undefined ? { availability } : {}),
    ...(v.completion !== undefined ? { completion: v.completion } : {}),
    ...(v.completionView !== undefined ? { completion_view: v.completionView } : {}),
    ...(v.completionUseGrade !== undefined ? { completion_use_grade: v.completionUseGrade } : {}),
    ...(v.completionManual !== undefined ? { completion_manual: v.completionManual } : {}),
    ...(v.completionExpected !== undefined ? { completion_expected: v.completionExpected } : {}),
    ...(v.openAt !== undefined ? { open_at: v.openAt } : {}),
    ...(v.deletionInProgress !== undefined ? { deletion_in_progress: v.deletionInProgress } : {}),
    ...(v.sortOrder !== undefined ? { sort_order: v.sortOrder } : {}),
  };
}

function sectionAnchorInsertValues(v: NewSectionAnchor) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    section_id: v.sectionId,
    ...(v.curriculumId !== undefined ? { curriculum_id: v.curriculumId } : {}),
    ...(v.nodeId !== undefined ? { node_id: v.nodeId } : {}),
    node_title: v.nodeTitle,
  };
}

function sectionAnchorOutcomeInsertValues(v: NewSectionAnchorOutcome) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    anchor_id: v.anchorId,
    ...(v.outcomeId !== undefined ? { outcome_id: v.outcomeId } : {}),
    content: v.content,
    ...(v.position !== undefined ? { position: v.position } : {}),
  };
}

function sectionBookAnchorInsertValues(v: NewSectionBookAnchor) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    section_id: v.sectionId,
    ...(v.bookId !== undefined ? { book_id: v.bookId } : {}),
    ...(v.bookNodeId !== undefined ? { book_node_id: v.bookNodeId } : {}),
    node_title: v.nodeTitle,
  };
}

function sectionBookItemInsertValues(v: NewSectionBookItem) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    anchor_id: v.anchorId,
    ...(v.bookNodeId !== undefined ? { book_node_id: v.bookNodeId } : {}),
    title: v.title,
    ...(v.position !== undefined ? { position: v.position } : {}),
  };
}

function sectionBookItemOutcomeInsertValues(v: NewSectionBookItemOutcome) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    item_id: v.itemId,
    ...(v.outcomeId !== undefined ? { outcome_id: v.outcomeId } : {}),
    content: v.content,
    ...(v.position !== undefined ? { position: v.position } : {}),
  };
}

export class CoursesRepository {
  constructor(private readonly handle: CentreDb) {}

  async transaction<T>(fn: (tx: CoursesTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }


  async insertCategory(v: NewCategory, db: CoursesDb = this.handle): Promise<CategoryRow> {
    return db
      .insertInto('course_categories')
      .values(categoryInsertValues(v))
      .returning(CATEGORY_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<CategoryRow>;
  }

  async getCategory(id: string): Promise<CategoryRow | undefined> {
    return this.handle
      .selectFrom('course_categories')
      .select(CATEGORY_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<CategoryRow | undefined>;
  }

  async listCategories(): Promise<CategoryRow[]> {
    return this.handle
      .selectFrom('course_categories')
      .select(CATEGORY_COLUMNS)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute() as Promise<CategoryRow[]>;
  }

  async childrenOf(parent: string): Promise<CategoryRow[]> {
    return this.handle
      .selectFrom('course_categories')
      .select(CATEGORY_COLUMNS)
      .where('parent', '=', parent)
      .orderBy('sort_order', 'asc')
      .execute() as Promise<CategoryRow[]>;
  }

  async subtreeOf(cat: CategoryRow): Promise<CategoryRow[]> {
    return this.handle
      .selectFrom('course_categories')
      .select(CATEGORY_COLUMNS)
      .where((eb) => eb.or([eb('id', '=', cat.id), eb('path', 'like', `${cat.path}/%`)]))
      .execute() as Promise<CategoryRow[]>;
  }

  async updateCategory(id: string, v: Partial<NewCategory>, db: CoursesDb = this.handle): Promise<void> {
    await db
      .updateTable('course_categories')
      .set({ ...categoryUpdateValues(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async updateCategoryPath(id: string, path: string, depth: number): Promise<void> {
    await this.handle
      .updateTable('course_categories')
      .set({ path, depth })
      .where('id', '=', id)
      .execute();
  }

  async deleteCategory(id: string, db: CoursesDb = this.handle): Promise<void> {
    await db.deleteFrom('course_categories').where('id', '=', id).execute();
  }

  async countSiblingCategories(parent: string | null): Promise<number> {
    let query = this.handle.selectFrom('course_categories').select(sql<number>`count(*)::int`.as('n'));
    query = parent === null ? query.where('parent', 'is', null) : query.where('parent', '=', parent);
    const row = await query.executeTakeFirst();
    return row?.n ?? 0;
  }


  async insertCourse(v: NewCourse, db: CoursesDb = this.handle): Promise<CourseRow> {
    return db
      .insertInto('course')
      .values(courseInsertValues(v))
      .returning(COURSE_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<CourseRow>;
  }

  async getCourse(id: string): Promise<CourseRow | undefined> {
    return this.handle
      .selectFrom('course')
      .select(COURSE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<CourseRow | undefined>;
  }

  async getCourseByShortname(shortName: string): Promise<CourseRow | undefined> {
    return this.handle
      .selectFrom('course')
      .select(COURSE_COLUMNS)
      .where('short_name', '=', shortName)
      .executeTakeFirst() as Promise<CourseRow | undefined>;
  }

  async listCourses(categoryId?: string): Promise<CourseRow[]> {
    let query = this.handle
      .selectFrom('course')
      .select(COURSE_COLUMNS)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc');
    if (categoryId !== undefined) query = query.where('category', '=', categoryId);
    return query.execute() as Promise<CourseRow[]>;
  }

  async listCoursesInCategories(categoryIds: string[]): Promise<CourseRow[]> {
    if (!categoryIds.length) return [];
    const rows: CourseRow[] = [];
    for (const id of categoryIds) rows.push(...(await this.listCourses(id)));
    return rows;
  }

  async updateCourse(id: string, v: Partial<NewCourse>, db: CoursesDb = this.handle): Promise<void> {
    await db
      .updateTable('course')
      .set({ ...courseUpdateValues(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteCourse(id: string, db: CoursesDb = this.handle): Promise<void> {
    await db.deleteFrom('course').where('id', '=', id).execute();
  }


  async insertSection(v: NewSection, db: CoursesDb = this.handle): Promise<SectionRow> {
    return db
      .insertInto('course_sections')
      .values(sectionInsertValues(v))
      .returning(SECTION_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<SectionRow>;
  }

  async getSubjectById(id: string): Promise<{ id: string } | undefined> {
    return this.handle.selectFrom('subjects').select('id').where('id', '=', id).executeTakeFirst();
  }

  async shiftSections(tx: CoursesTx, courseId: string, fromSection: number, delta: number): Promise<void> {
    await tx
      .updateTable('course_sections')
      .set({ section: sql<number>`section + ${delta}`, updated_at: new Date() })
      .where('course', '=', courseId)
      .where('section', '>=', fromSection)
      .execute();
  }

  async insertSectionAnchor(v: NewSectionAnchor, db: CoursesDb = this.handle): Promise<SectionAnchorRow> {
    return db
      .insertInto('course_section_anchors')
      .values(sectionAnchorInsertValues(v))
      .returning(ANCHOR_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<SectionAnchorRow>;
  }

  async insertSectionAnchorOutcomes(v: NewSectionAnchorOutcome[], db: CoursesDb = this.handle): Promise<void> {
    if (v.length === 0) return;
    await db.insertInto('course_section_anchor_outcomes').values(v.map(sectionAnchorOutcomeInsertValues)).execute();
  }

  async listAnchorsForSections(sectionIds: string[]): Promise<SectionAnchorRow[]> {
    if (sectionIds.length === 0) return [];
    return this.handle
      .selectFrom('course_section_anchors')
      .select(ANCHOR_COLUMNS)
      .where('section_id', 'in', sectionIds)
      .execute() as Promise<SectionAnchorRow[]>;
  }

  async listAnchorOutcomes(anchorIds: string[]): Promise<SectionAnchorOutcomeRow[]> {
    if (anchorIds.length === 0) return [];
    return this.handle
      .selectFrom('course_section_anchor_outcomes')
      .select(ANCHOR_OUTCOME_COLUMNS)
      .where('anchor_id', 'in', anchorIds)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute() as Promise<SectionAnchorOutcomeRow[]>;
  }

  async insertSectionBookAnchor(v: NewSectionBookAnchor, db: CoursesDb = this.handle): Promise<SectionBookAnchorRow> {
    return db
      .insertInto('course_section_book_anchors')
      .values(sectionBookAnchorInsertValues(v))
      .returning(BOOK_ANCHOR_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<SectionBookAnchorRow>;
  }

  async insertSectionBookItem(v: NewSectionBookItem, db: CoursesDb = this.handle): Promise<SectionBookItemRow> {
    return db
      .insertInto('course_section_book_items')
      .values(sectionBookItemInsertValues(v))
      .returning(BOOK_ITEM_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<SectionBookItemRow>;
  }

  async insertSectionBookItemOutcomes(v: NewSectionBookItemOutcome[], db: CoursesDb = this.handle): Promise<void> {
    if (v.length === 0) return;
    await db.insertInto('course_section_book_item_outcomes').values(v.map(sectionBookItemOutcomeInsertValues)).execute();
  }

  async listBookAnchorsForSections(sectionIds: string[]): Promise<SectionBookAnchorRow[]> {
    if (sectionIds.length === 0) return [];
    return this.handle
      .selectFrom('course_section_book_anchors')
      .select(BOOK_ANCHOR_COLUMNS)
      .where('section_id', 'in', sectionIds)
      .execute() as Promise<SectionBookAnchorRow[]>;
  }

  async listBookItems(anchorIds: string[]): Promise<SectionBookItemRow[]> {
    if (anchorIds.length === 0) return [];
    return this.handle
      .selectFrom('course_section_book_items')
      .select(BOOK_ITEM_COLUMNS)
      .where('anchor_id', 'in', anchorIds)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute() as Promise<SectionBookItemRow[]>;
  }

  async listBookItemOutcomes(itemIds: string[]): Promise<SectionBookItemOutcomeRow[]> {
    if (itemIds.length === 0) return [];
    return this.handle
      .selectFrom('course_section_book_item_outcomes')
      .select(BOOK_ITEM_OUTCOME_COLUMNS)
      .where('item_id', 'in', itemIds)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute() as Promise<SectionBookItemOutcomeRow[]>;
  }

  async getSection(id: string): Promise<SectionRow | undefined> {
    return this.handle
      .selectFrom('course_sections')
      .select(SECTION_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<SectionRow | undefined>;
  }

  async listSections(courseId: string): Promise<SectionRow[]> {
    return this.handle
      .selectFrom('course_sections')
      .select(SECTION_COLUMNS)
      .where('course', '=', courseId)
      .orderBy('section', 'asc')
      .execute() as Promise<SectionRow[]>;
  }

  async updateSection(id: string, v: Partial<NewSection>): Promise<void> {
    await this.handle
      .updateTable('course_sections')
      .set({ ...sectionUpdateValues(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteSection(id: string): Promise<void> {
    await this.handle.deleteFrom('course_sections').where('id', '=', id).execute();
  }


  async insertCm(v: NewCm, db: CoursesDb = this.handle): Promise<CmRow> {
    return db
      .insertInto('course_modules')
      .values(cmInsertValues(v))
      .returning(CM_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<CmRow>;
  }

  async getCm(id: string): Promise<CmRow | undefined> {
    return this.handle
      .selectFrom('course_modules')
      .select(CM_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<CmRow | undefined>;
  }

  async listCms(courseId: string): Promise<CmRow[]> {
    return this.handle
      .selectFrom('course_modules')
      .select(CM_COLUMNS)
      .where('course', '=', courseId)
      .where('deletion_in_progress', '=', false)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute() as Promise<CmRow[]>;
  }

  async listCmsInSection(sectionId: string): Promise<CmRow[]> {
    return this.handle
      .selectFrom('course_modules')
      .select(CM_COLUMNS)
      .where('section', '=', sectionId)
      .where('deletion_in_progress', '=', false)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute() as Promise<CmRow[]>;
  }

  async listTemplateCourses(): Promise<CourseRow[]> {
    return this.handle
      .selectFrom('course')
      .select(COURSE_COLUMNS)
      .where('is_template', '=', true)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute() as Promise<CourseRow[]>;
  }

  async updateCm(id: string, v: Partial<NewCm>): Promise<void> {
    await this.handle.updateTable('course_modules').set(cmUpdateValues(v)).where('id', '=', id).execute();
  }

  async deleteCm(id: string, db: CoursesDb = this.handle): Promise<void> {
    await db.deleteFrom('course_modules').where('id', '=', id).execute();
  }


  async setFormatOption(
    courseId: string,
    format: string,
    name: string,
    value: string | null,
    sectionId: string | null = null,
  ): Promise<void> {
    if (sectionId === null) {
      const existing = await this.handle
        .selectFrom('course_format_options')
        .select(FORMAT_OPTION_COLUMNS)
        .where('course_id', '=', courseId)
        .where('format', '=', format)
        .where('section_id', 'is', null)
        .where('name', '=', name)
        .executeTakeFirst();
      if (existing) {
        await this.handle
          .updateTable('course_format_options')
          .set({ value })
          .where('id', '=', existing.id)
          .execute();
        return;
      }
      await this.handle
        .insertInto('course_format_options')
        .values({ course_id: courseId, format, name, value, section_id: sectionId })
        .execute();
      return;
    }
    await this.handle
      .insertInto('course_format_options')
      .values({ course_id: courseId, format, name, value, section_id: sectionId })
      .onConflict((oc) => oc.columns(['course_id', 'format', 'section_id', 'name']).doUpdateSet({ value }))
      .execute();
  }

  async listFormatOptions(courseId: string): Promise<CourseFormatOptionRow[]> {
    return this.handle
      .selectFrom('course_format_options')
      .select(FORMAT_OPTION_COLUMNS)
      .where('course_id', '=', courseId)
      .execute() as Promise<CourseFormatOptionRow[]>;
  }
}
