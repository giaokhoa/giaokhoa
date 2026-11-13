/**
 * Repository của cụm NĂNG LỰC trên Kysely.
 *
 * Vai trò: mọi truy cập tới các bảng năng lực của kho trung tâm
 * (competency_framework, competency dạng cây, các bảng liên kết
 * course/module/template/cohort/plan, learning_plans,
 * competency_plan_review, competency_user_comp,
 * competency_evidence) tập trung ở đây. Repository không chứa luật
 * nghiệp vụ — thang đo, rule points, vòng đời plan/review và giao
 * dịch nhiều bảng nằm ở tầng service phía ứng dụng; repository chỉ
 * nhận handle (instance gốc hoặc transaction đang mở) để phía gọi
 * ghép nhiều thao tác vào một transaction khi cần.
 *
 * Ràng buộc về truy vấn và hình dạng dữ liệu tại biên repository:
 * - Bên trong repository, truy vấn viết trên interface schema sinh
 *   bằng codegen: tên bảng/cột giữ nguyên snake_case của database.
 * - Bên ngoài, repository trả/nhận các hình dạng dòng camelCase như
 *   phía tiêu thụ đang dùng (khớp `$inferSelect`/`$inferInsert` của
 *   repository cũ trước chuyển đổi): cột được chọn bằng danh sách tường minh
 *   có bí danh, giá trị ghi được ánh xạ từng trường ở các hàm
 *   `*InsertValues`/`*UpdateSet` trong file này. Kiểu dòng công
 *   khai khai ngay trong file này, không import từ file schema
 *   bộ máy cũ.
 * - Giá trị `undefined` bị LOẠI khỏi values/set trước khi gọi
 *   builder (quy tắc T-4 đã chốt ở pilot); mọi giá trị where là
 *   tham số bắt buộc.
 * - Cột jsonb khi ghi (`scale_configuration`, `rule_config`) đi
 *   qua helper serialize tường minh + ép kiểu `::jsonb`
 *   ({@link jsonbValue}) — khuôn duy nhất cho mọi giá trị jsonb.
 * - `onConflict`: liên kết course/module dùng khoá phức hợp
 *   `columns([...]).doUpdateSet(...)` chỉ cập nhật `rule_outcome`;
 *   các bảng liên kết template/plan dùng `doNothing()` không đích
 *   (mọi va chạm unique đều bỏ qua như đường cũ trước chuyển đổi).
 */
import { type InsertObject, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import { jsonbValue, jsonbField } from '../jsonb';

/** Handle giao dịch của kho trung tâm — kiểu `Transaction<CentreDB>` của package. */
export type CompetenciesTx = CentreTx;
/** Handle đọc/ghi mà repository nhận: transaction đang mở hoặc chính instance gốc. */
type Db = CentreDb | CentreTx;

/** Một dòng khung năng lực; `scaleConfiguration` là cấu hình thang đo (jsonb không gắn kiểu nghiệp vụ ở tầng repository). */
export interface FrameworkRow {
  id: string;
  shortName: string;
  idNumber: string;
  description: string;
  contextId: string;
  scaleConfiguration: unknown;
  taxonomies: string;
  visible: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Dữ kiện ghi một khung năng lực mới (khớp `$inferInsert` cũ). */
export interface NewFramework {
  id?: string;
  shortName: string;
  idNumber?: string;
  description?: string;
  contextId: string;
  scaleConfiguration?: unknown;
  taxonomies?: string;
  visible?: boolean;
  sortOrder?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Một dòng năng lực trong cây của một khung; `ruleConfig` là cấu hình rule points (jsonb không gắn kiểu ở tầng repository). */
export interface CompetencyRow {
  id: string;
  frameworkId: string;
  shortName: string;
  idNumber: string;
  description: string;
  parentId: string | null;
  path: string;
  depth: number;
  sortOrder: number;
  ruleType: string | null;
  ruleConfig: unknown;
  ruleOutcome: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Dữ kiện ghi một năng lực mới (khớp `$inferInsert` cũ). */
export interface NewCompetency {
  id?: string;
  frameworkId: string;
  shortName: string;
  idNumber?: string;
  description?: string;
  parentId?: string | null;
  path?: string;
  depth?: number;
  sortOrder?: number;
  ruleType?: string | null;
  ruleConfig?: unknown;
  ruleOutcome?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Một dòng liên kết khoá học ↔ năng lực. */
export interface CourseLinkRow {
  id: string;
  courseId: string;
  competencyId: string;
  ruleOutcome: string;
  sortOrder: number;
  createdAt: Date;
}

/** Dữ kiện ghi một liên kết khoá học ↔ năng lực mới. */
export interface NewCourseLink {
  id?: string;
  courseId: string;
  competencyId: string;
  ruleOutcome?: string;
  sortOrder?: number;
  createdAt?: Date;
}

/** Một dòng liên kết course module ↔ năng lực. */
export interface ModuleLinkRow {
  id: string;
  courseModuleId: string;
  competencyId: string;
  ruleOutcome: string;
  sortOrder: number;
  createdAt: Date;
}

/** Dữ kiện ghi một liên kết course module ↔ năng lực mới. */
export interface NewModuleLink {
  id?: string;
  courseModuleId: string;
  competencyId: string;
  ruleOutcome?: string;
  sortOrder?: number;
  createdAt?: Date;
}

/** Một dòng mẫu kế hoạch học tập. */
export interface TemplateRow {
  id: string;
  shortName: string;
  description: string;
  contextId: string;
  dueDate: Date | null;
  visible: boolean;
  status: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Dữ kiện ghi một mẫu kế hoạch học tập mới (khớp `$inferInsert` cũ). */
export interface NewTemplate {
  id?: string;
  shortName: string;
  description?: string;
  contextId: string;
  dueDate?: Date | null;
  visible?: boolean;
  status?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Một dòng kế hoạch học tập của một user. */
export interface PlanRow {
  id: string;
  name: string;
  description: string;
  userId: string;
  templateId: string | null;
  status: number;
  dueDate: Date | null;
  reviewerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Dữ kiện ghi một kế hoạch học tập mới (khớp `$inferInsert` cũ). */
export interface NewPlan {
  id?: string;
  name: string;
  description?: string;
  userId: string;
  templateId?: string | null;
  status?: number;
  dueDate?: Date | null;
  reviewerId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Một dòng lịch sử duyệt của một kế hoạch học tập. */
export interface PlanReviewRow {
  id: string;
  planId: string;
  actorId: string;
  action: string;
  statusFrom: number;
  statusTo: number;
  note: string;
  createdAt: Date;
}

/** Dữ kiện ghi một dòng lịch sử duyệt mới (khớp `$inferInsert` cũ). */
export interface NewPlanReview {
  id?: string;
  planId: string;
  actorId: string;
  action: string;
  statusFrom: number;
  statusTo: number;
  note?: string;
  createdAt?: Date;
}

/** Một dòng vị thế của một user trên một năng lực (usercomp). */
export interface UsercompRow {
  id: string;
  userId: string;
  competencyId: string;
  planId: string | null;
  courseId: string | null;
  status: number;
  proficiency: boolean | null;
  grade: number | null;
  reviewerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Dữ kiện ghi một usercomp mới (khớp `$inferInsert` cũ). */
export interface NewUsercomp {
  id?: string;
  userId: string;
  competencyId: string;
  planId?: string | null;
  courseId?: string | null;
  status?: number;
  proficiency?: boolean | null;
  grade?: number | null;
  reviewerId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Một dòng nhật ký bằng chứng cho một usercomp. */
export interface EvidenceRow {
  id: string;
  userCompetencyId: string;
  contextId: string | null;
  actionUserId: string;
  action: string;
  description: string;
  url: string | null;
  grade: number | null;
  note: string;
  createdAt: Date;
}

/** Dữ kiện ghi một dòng bằng chứng mới (khớp `$inferInsert` cũ). */
export interface NewEvidence {
  id?: string;
  userCompetencyId: string;
  contextId?: string | null;
  actionUserId: string;
  action?: string;
  description?: string;
  url?: string | null;
  grade?: number | null;
  note?: string;
  createdAt?: Date;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng competency_framework (dùng cho cả select lẫn returning). */
const FRAMEWORK_COLUMNS = [
  'id',
  'short_name as shortName',
  'id_number as idNumber',
  'description',
  'context_id as contextId',
  'scale_configuration as scaleConfiguration',
  'taxonomies',
  'visible',
  'sort_order as sortOrder',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng competency. */
const COMPETENCY_COLUMNS = [
  'id',
  'framework_id as frameworkId',
  'short_name as shortName',
  'id_number as idNumber',
  'description',
  'parent_id as parentId',
  'path',
  'depth',
  'sort_order as sortOrder',
  'rule_type as ruleType',
  'rule_config as ruleConfig',
  'rule_outcome as ruleOutcome',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng competency_course_comp. */
const COURSE_LINK_COLUMNS = [
  'id',
  'course_id as courseId',
  'competency_id as competencyId',
  'rule_outcome as ruleOutcome',
  'sort_order as sortOrder',
  'created_at as createdAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng competency_module_comp. */
const MODULE_LINK_COLUMNS = [
  'id',
  'course_module_id as courseModuleId',
  'competency_id as competencyId',
  'rule_outcome as ruleOutcome',
  'sort_order as sortOrder',
  'created_at as createdAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng competency_template. */
const TEMPLATE_COLUMNS = [
  'id',
  'short_name as shortName',
  'description',
  'context_id as contextId',
  'due_date as dueDate',
  'visible',
  'status',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng learning_plans. */
const PLAN_COLUMNS = [
  'id',
  'name',
  'description',
  'user_id as userId',
  'template_id as templateId',
  'status',
  'due_date as dueDate',
  'reviewer_id as reviewerId',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng competency_plan_review. */
const PLAN_REVIEW_COLUMNS = [
  'id',
  'plan_id as planId',
  'actor_id as actorId',
  'action',
  'status_from as statusFrom',
  'status_to as statusTo',
  'note',
  'created_at as createdAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng competency_user_comp. */
const USERCOMP_COLUMNS = [
  'id',
  'user_id as userId',
  'competency_id as competencyId',
  'plan_id as planId',
  'course_id as courseId',
  'status',
  'proficiency',
  'grade',
  'reviewer_id as reviewerId',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng competency_evidence. */
const EVIDENCE_COLUMNS = [
  'id',
  'user_competency_id as userCompetencyId',
  'context_id as contextId',
  'action_user_id as actionUserId',
  'action',
  'description',
  'url',
  'grade',
  'note',
  'created_at as createdAt',
] as const;

/** Ánh xạ dữ kiện ghi khung năng lực sang values insert (snake_case), loại `undefined` (quy tắc T-4); `scale_configuration` qua {@link jsonbField}. */
function frameworkInsertValues(values: NewFramework): InsertObject<CentreDB, 'competency_framework'> {
  return {
    short_name: values.shortName,
    context_id: values.contextId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.idNumber !== undefined ? { id_number: values.idNumber } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
    ...(values.scaleConfiguration !== undefined ? { scale_configuration: jsonbField(values.scaleConfiguration) } : {}),
    ...(values.taxonomies !== undefined ? { taxonomies: values.taxonomies } : {}),
    ...(values.visible !== undefined ? { visible: values.visible } : {}),
    ...(values.sortOrder !== undefined ? { sort_order: values.sortOrder } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi năng lực sang values insert (snake_case), loại `undefined` (quy tắc T-4); `rule_config` qua {@link jsonbField}. */
function competencyInsertValues(values: NewCompetency): InsertObject<CentreDB, 'competency'> {
  return {
    framework_id: values.frameworkId,
    short_name: values.shortName,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.idNumber !== undefined ? { id_number: values.idNumber } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
    ...(values.parentId !== undefined ? { parent_id: values.parentId } : {}),
    ...(values.path !== undefined ? { path: values.path } : {}),
    ...(values.depth !== undefined ? { depth: values.depth } : {}),
    ...(values.sortOrder !== undefined ? { sort_order: values.sortOrder } : {}),
    ...(values.ruleType !== undefined ? { rule_type: values.ruleType } : {}),
    ...(values.ruleConfig !== undefined ? { rule_config: jsonbField(values.ruleConfig) } : {}),
    ...(values.ruleOutcome !== undefined ? { rule_outcome: values.ruleOutcome } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/**
 * Ánh xạ một patch năng lực (hình dạng dòng đầy đủ từng phần như
 * phía tiêu thụ đang truyền) sang set update (snake_case), loại
 * `undefined` từng trường (quy tắc T-4); `rule_config` qua
 * {@link jsonbField}, giữ NULL tường minh khi patch đặt null.
 */
function competencyUpdateSet(patch: Partial<CompetencyRow>): UpdateObject<CentreDB, 'competency'> {
  return {
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.frameworkId !== undefined ? { framework_id: patch.frameworkId } : {}),
    ...(patch.shortName !== undefined ? { short_name: patch.shortName } : {}),
    ...(patch.idNumber !== undefined ? { id_number: patch.idNumber } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.parentId !== undefined ? { parent_id: patch.parentId } : {}),
    ...(patch.path !== undefined ? { path: patch.path } : {}),
    ...(patch.depth !== undefined ? { depth: patch.depth } : {}),
    ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
    ...(patch.ruleType !== undefined ? { rule_type: patch.ruleType } : {}),
    ...(patch.ruleConfig !== undefined ? { rule_config: jsonbField(patch.ruleConfig) } : {}),
    ...(patch.ruleOutcome !== undefined ? { rule_outcome: patch.ruleOutcome } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi liên kết khoá học ↔ năng lực sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function courseLinkInsertValues(values: NewCourseLink): InsertObject<CentreDB, 'competency_course_comp'> {
  return {
    course_id: values.courseId,
    competency_id: values.competencyId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.ruleOutcome !== undefined ? { rule_outcome: values.ruleOutcome } : {}),
    ...(values.sortOrder !== undefined ? { sort_order: values.sortOrder } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi liên kết course module ↔ năng lực sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function moduleLinkInsertValues(values: NewModuleLink): InsertObject<CentreDB, 'competency_module_comp'> {
  return {
    course_module_id: values.courseModuleId,
    competency_id: values.competencyId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.ruleOutcome !== undefined ? { rule_outcome: values.ruleOutcome } : {}),
    ...(values.sortOrder !== undefined ? { sort_order: values.sortOrder } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi mẫu kế hoạch sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function templateInsertValues(values: NewTemplate): InsertObject<CentreDB, 'competency_template'> {
  return {
    short_name: values.shortName,
    context_id: values.contextId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
    ...(values.dueDate !== undefined ? { due_date: values.dueDate } : {}),
    ...(values.visible !== undefined ? { visible: values.visible } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi kế hoạch học tập sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function planInsertValues(values: NewPlan): InsertObject<CentreDB, 'learning_plans'> {
  return {
    name: values.name,
    user_id: values.userId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
    ...(values.templateId !== undefined ? { template_id: values.templateId } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.dueDate !== undefined ? { due_date: values.dueDate } : {}),
    ...(values.reviewerId !== undefined ? { reviewer_id: values.reviewerId } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/** Ánh xạ một patch kế hoạch học tập sang set update (snake_case), loại `undefined` từng trường (quy tắc T-4). */
function planUpdateSet(patch: Partial<PlanRow>): UpdateObject<CentreDB, 'learning_plans'> {
  return {
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.userId !== undefined ? { user_id: patch.userId } : {}),
    ...(patch.templateId !== undefined ? { template_id: patch.templateId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.dueDate !== undefined ? { due_date: patch.dueDate } : {}),
    ...(patch.reviewerId !== undefined ? { reviewer_id: patch.reviewerId } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi một dòng lịch sử duyệt sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function planReviewInsertValues(values: NewPlanReview): InsertObject<CentreDB, 'competency_plan_review'> {
  return {
    plan_id: values.planId,
    actor_id: values.actorId,
    action: values.action,
    status_from: values.statusFrom,
    status_to: values.statusTo,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.note !== undefined ? { note: values.note } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi usercomp sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function usercompInsertValues(values: NewUsercomp): InsertObject<CentreDB, 'competency_user_comp'> {
  return {
    user_id: values.userId,
    competency_id: values.competencyId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.planId !== undefined ? { plan_id: values.planId } : {}),
    ...(values.courseId !== undefined ? { course_id: values.courseId } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.proficiency !== undefined ? { proficiency: values.proficiency } : {}),
    ...(values.grade !== undefined ? { grade: values.grade } : {}),
    ...(values.reviewerId !== undefined ? { reviewer_id: values.reviewerId } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/** Ánh xạ một patch usercomp sang set update (snake_case), loại `undefined` từng trường (quy tắc T-4). */
function usercompUpdateSet(patch: Partial<UsercompRow>): UpdateObject<CentreDB, 'competency_user_comp'> {
  return {
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.userId !== undefined ? { user_id: patch.userId } : {}),
    ...(patch.competencyId !== undefined ? { competency_id: patch.competencyId } : {}),
    ...(patch.planId !== undefined ? { plan_id: patch.planId } : {}),
    ...(patch.courseId !== undefined ? { course_id: patch.courseId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.proficiency !== undefined ? { proficiency: patch.proficiency } : {}),
    ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
    ...(patch.reviewerId !== undefined ? { reviewer_id: patch.reviewerId } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi bằng chứng sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function evidenceInsertValues(values: NewEvidence): InsertObject<CentreDB, 'competency_evidence'> {
  return {
    user_competency_id: values.userCompetencyId,
    action_user_id: values.actionUserId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.contextId !== undefined ? { context_id: values.contextId } : {}),
    ...(values.action !== undefined ? { action: values.action } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
    ...(values.url !== undefined ? { url: values.url } : {}),
    ...(values.grade !== undefined ? { grade: values.grade } : {}),
    ...(values.note !== undefined ? { note: values.note } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
  };
}

/**
 * Kho dữ liệu năng lực: framework, competency (cây), liên kết
 * course/module, template, plan, user competency, evidence và
 * review.
 */
export class CompetenciesRepository {
  constructor(private readonly handle: CentreDb) {}

  /** Instance gốc của repository. */
  private db(): CentreDb {
    return this.handle;
  }

  /** Handle DB gốc — tầng service mở transaction khi cần ghi nguyên tử nhiều bảng. */
  get dbHandle(): CentreDb {
    return this.db();
  }

  /** Mở một transaction trên kho trung tâm và chạy `fn` với handle giao dịch. */
  async transaction<T>(fn: (tx: CompetenciesTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  /**
   * Chèn framework năng lực.
   */
  async insertFramework(v: NewFramework, db: Db = this.db()): Promise<FrameworkRow> {
    const row = await db
      .insertInto('competency_framework')
      .values(frameworkInsertValues(v))
      .returning(FRAMEWORK_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * Lấy framework theo id.
   */
  async getFramework(id: string, db: Db = this.db()): Promise<FrameworkRow | undefined> {
    const row = await db
      .selectFrom('competency_framework')
      .select(FRAMEWORK_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  /**
   * Liệt kê framework.
   */
  async listFrameworks(db: Db = this.db()): Promise<FrameworkRow[]> {
    return db
      .selectFrom('competency_framework')
      .select(FRAMEWORK_COLUMNS)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * Chèn competency.
   */
  async insertCompetency(v: NewCompetency, db: Db = this.db()): Promise<CompetencyRow> {
    const row = await db
      .insertInto('competency')
      .values(competencyInsertValues(v))
      .returning(COMPETENCY_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * Các competency con TRỰC TIẾP của một competency (dùng để kiểm tra rule points).
   */
  async listChildren(parentId: string, db: Db = this.db()): Promise<CompetencyRow[]> {
    return db
      .selectFrom('competency')
      .select(COMPETENCY_COLUMNS)
      .where('parent_id', '=', parentId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * Lấy competency theo id.
   */
  async getCompetency(id: string, db: Db = this.db()): Promise<CompetencyRow | undefined> {
    const row = await db
      .selectFrom('competency')
      .select(COMPETENCY_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  /**
   * Competency trong framework.
   */
  async listCompetencies(frameworkId: string, db: Db = this.db()): Promise<CompetencyRow[]> {
    return db
      .selectFrom('competency')
      .select(COMPETENCY_COLUMNS)
      .where('framework_id', '=', frameworkId)
      .orderBy('path', 'asc')
      .orderBy('sort_order', 'asc')
      .execute();
  }

  /**
   * Cập nhật competency.
   */
  async updateCompetency(id: string, patch: Partial<CompetencyRow>, db: Db = this.db()): Promise<void> {
    await db
      .updateTable('competency')
      .set({ ...competencyUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Liên kết competency với khoá học. Trùng cặp (khoá, năng lực)
   * thì cập nhật `rule_outcome` theo giá trị mới. Phía gọi production
   * luôn truyền ruleOutcome đã kiểm hợp lệ; ca không truyền (chỉ
   * còn ở tầng repository) lấy mặc định của DB là 'nothing' — khớp
   * giá trị đường insert cũng sẽ nhận — để mệnh đề SET không rỗng.
   */
  async insertCourseLink(v: NewCourseLink, db: Db = this.db()): Promise<CourseLinkRow> {
    const row = await db
      .insertInto('competency_course_comp')
      .values(courseLinkInsertValues(v))
      .onConflict((oc) =>
        oc.columns(['course_id', 'competency_id']).doUpdateSet({ rule_outcome: v.ruleOutcome ?? 'nothing' }),
      )
      .returning(COURSE_LINK_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * Liên kết của khoá học.
   */
  async listCourseLinks(courseId: string, db: Db = this.db()): Promise<CourseLinkRow[]> {
    return db
      .selectFrom('competency_course_comp')
      .select(COURSE_LINK_COLUMNS)
      .where('course_id', '=', courseId)
      .execute();
  }

  /**
   * Liên kết competency với course module. Trùng cặp (module, năng
   * lực) thì cập nhật `rule_outcome` như {@link insertCourseLink}.
   */
  async insertModuleLink(v: NewModuleLink, db: Db = this.db()): Promise<ModuleLinkRow> {
    const row = await db
      .insertInto('competency_module_comp')
      .values(moduleLinkInsertValues(v))
      .onConflict((oc) =>
        oc.columns(['course_module_id', 'competency_id']).doUpdateSet({ rule_outcome: v.ruleOutcome ?? 'nothing' }),
      )
      .returning(MODULE_LINK_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * Liên kết của module.
   */
  async listModuleLinks(courseModuleId: string, db: Db = this.db()): Promise<ModuleLinkRow[]> {
    return db
      .selectFrom('competency_module_comp')
      .select(MODULE_LINK_COLUMNS)
      .where('course_module_id', '=', courseModuleId)
      .execute();
  }

  /**
   * Chèn template kế hoạch học tập.
   */
  async insertTemplate(v: NewTemplate, db: Db = this.db()): Promise<TemplateRow> {
    const row = await db
      .insertInto('competency_template')
      .values(templateInsertValues(v))
      .returning(TEMPLATE_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * Lấy template theo id.
   */
  async getTemplate(id: string, db: Db = this.db()): Promise<TemplateRow | undefined> {
    const row = await db
      .selectFrom('competency_template')
      .select(TEMPLATE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  /**
   * Liệt kê template.
   */
  async listTemplates(db: Db = this.db()): Promise<TemplateRow[]> {
    return db
      .selectFrom('competency_template')
      .select(TEMPLATE_COLUMNS)
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * Thêm competency vào template.
   */
  async addTemplateCompetency(templateId: string, competencyId: string, db: Db = this.db()): Promise<void> {
    await db
      .insertInto('competency_template_comp')
      .values({ template_id: templateId, competency_id: competencyId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /**
   * Competency của template.
   *
   * Đọc bằng ĐÚNG handle `db` đã nhận (kể cả transaction đang mở): bản cũ
   * gọi `getCompetency` không truyền `db` nên mỗi lần đọc rơi về handle
   * gốc, ngoài transaction của người gọi. Một truy vấn `where id in (...)`
   * thay cho vòng lặp N+1; thứ tự `sort_order` của template và việc bỏ qua
   * liên kết trỏ tới competency đã xoá được giữ nguyên.
   */
  async listTemplateCompetencies(templateId: string, db: Db = this.db()): Promise<CompetencyRow[]> {
    const links = await db
      .selectFrom('competency_template_comp')
      .select(['competency_id as competencyId'])
      .where('template_id', '=', templateId)
      .orderBy('sort_order', 'asc')
      .execute();
    if (!links.length) return [];
    const rows = await db
      .selectFrom('competency')
      .select(COMPETENCY_COLUMNS)
      .where('id', 'in', links.map((link) => link.competencyId))
      .execute();
    const byId = new Map<string, CompetencyRow>();
    for (const row of rows) byId.set(row.id, row);
    const out: CompetencyRow[] = [];
    for (const link of links) {
      const c = byId.get(link.competencyId);
      if (c) out.push(c);
    }
    return out;
  }

  /**
   * Gắn cohort vào template (để sinh plan hàng loạt).
   */
  async addTemplateCohort(templateId: string, cohortId: string, db: Db = this.db()): Promise<void> {
    await db
      .insertInto('competency_template_cohort')
      .values({ template_id: templateId, cohort_id: cohortId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /**
   * Cohort của template.
   */
  async listTemplateCohorts(templateId: string, db: Db = this.db()): Promise<string[]> {
    const rows = await db
      .selectFrom('competency_template_cohort')
      .select(['cohort_id as cohortId'])
      .where('template_id', '=', templateId)
      .execute();
    return rows.map((r) => r.cohortId);
  }

  /**
   * Chèn learning plan.
   */
  async insertPlan(v: NewPlan, db: Db = this.db()): Promise<PlanRow> {
    const row = await db
      .insertInto('learning_plans')
      .values(planInsertValues(v))
      .returning(PLAN_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * Lấy plan theo id.
   */
  async getPlan(id: string, db: Db = this.db()): Promise<PlanRow | undefined> {
    const row = await db
      .selectFrom('learning_plans')
      .select(PLAN_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  /**
   * Plan của user.
   */
  async listPlansForUser(userId: string, db: Db = this.db()): Promise<PlanRow[]> {
    return db
      .selectFrom('learning_plans')
      .select(PLAN_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * Plan đã sinh từ template cho user (chống trùng).
   */
  async findPlanFromTemplate(userId: string, templateId: string, db: Db = this.db()): Promise<PlanRow | undefined> {
    const row = await db
      .selectFrom('learning_plans')
      .select(PLAN_COLUMNS)
      .where((eb) => eb.and([eb('user_id', '=', userId), eb('template_id', '=', templateId)]))
      .executeTakeFirst();
    return row;
  }

  /**
   * Cập nhật plan (trạng thái, reviewer…).
   */
  async updatePlan(id: string, patch: Partial<PlanRow>, db: Db = this.db()): Promise<void> {
    await db
      .updateTable('learning_plans')
      .set({ ...planUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Thêm competency vào plan.
   */
  async addPlanCompetency(planId: string, competencyId: string, db: Db = this.db()): Promise<void> {
    await db
      .insertInto('competency_plan_comp')
      .values({ plan_id: planId, competency_id: competencyId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /**
   * Competency id trong plan.
   */
  async listPlanCompetencyIds(planId: string, db: Db = this.db()): Promise<string[]> {
    const rows = await db
      .selectFrom('competency_plan_comp')
      .select(['competency_id as competencyId'])
      .where('plan_id', '=', planId)
      .orderBy('sort_order', 'asc')
      .execute();
    return rows.map((r) => r.competencyId);
  }

  /**
   * Ghi một vòng review của plan.
   */
  async insertPlanReview(v: NewPlanReview, db: Db = this.db()): Promise<void> {
    await db.insertInto('competency_plan_review').values(planReviewInsertValues(v)).execute();
  }

  /**
   * Các vòng review của plan.
   */
  async listPlanReviews(planId: string, db: Db = this.db()): Promise<PlanReviewRow[]> {
    return db
      .selectFrom('competency_plan_review')
      .select(PLAN_REVIEW_COLUMNS)
      .where('plan_id', '=', planId)
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * Tìm bản ghi năng lực của user (usercomp) theo user + competency.
   * Phạm vi plan/khoá: NULL là một giá trị khớp tường minh (điều
   * kiện `is null`), không phải "không lọc" — giữ nguyên ngữ nghĩa
   * của đường cũ trước chuyển đổi.
   */
  async findUsercomp(
    userId: string,
    competencyId: string,
    planId: string | null,
    courseId: string | null,
    db: Db = this.db(),
  ): Promise<UsercompRow | undefined> {
    const row = await db
      .selectFrom('competency_user_comp')
      .select(USERCOMP_COLUMNS)
      .where((eb) =>
        eb.and([
          eb('user_id', '=', userId),
          eb('competency_id', '=', competencyId),
          planId === null ? eb('plan_id', 'is', null) : eb('plan_id', '=', planId),
          courseId === null ? eb('course_id', 'is', null) : eb('course_id', '=', courseId),
        ]),
      )
      .executeTakeFirst();
    return row;
  }

  /**
   * Lấy usercomp theo id.
   */
  async getUsercomp(id: string, db: Db = this.db()): Promise<UsercompRow | undefined> {
    const row = await db
      .selectFrom('competency_user_comp')
      .select(USERCOMP_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  /**
   * Chèn usercomp.
   */
  async insertUsercomp(v: NewUsercomp, db: Db = this.db()): Promise<UsercompRow> {
    const row = await db
      .insertInto('competency_user_comp')
      .values(usercompInsertValues(v))
      .returning(USERCOMP_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * Cập nhật usercomp (proficiency, review status, grader).
   */
  async updateUsercomp(id: string, patch: Partial<UsercompRow>, db: Db = this.db()): Promise<void> {
    await db
      .updateTable('competency_user_comp')
      .set({ ...usercompUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Usercomp thuộc các competency của plan.
   */
  async listUsercompsForPlan(planId: string, userId: string, db: Db = this.db()): Promise<UsercompRow[]> {
    return db
      .selectFrom('competency_user_comp')
      .select(USERCOMP_COLUMNS)
      .where((eb) => eb.and([eb('plan_id', '=', planId), eb('user_id', '=', userId)]))
      .execute();
  }

  /**
   * Mọi usercomp của user.
   */
  async listUsercompsForUser(userId: string, db: Db = this.db()): Promise<UsercompRow[]> {
    return db
      .selectFrom('competency_user_comp')
      .select(USERCOMP_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * Ghi một bằng chứng (evidence) cho usercomp.
   */
  async insertEvidence(v: NewEvidence, db: Db = this.db()): Promise<EvidenceRow> {
    const row = await db
      .insertInto('competency_evidence')
      .values(evidenceInsertValues(v))
      .returning(EVIDENCE_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * Bằng chứng của usercomp.
   */
  async listEvidence(userCompetencyId: string, db: Db = this.db()): Promise<EvidenceRow[]> {
    return db
      .selectFrom('competency_evidence')
      .select(EVIDENCE_COLUMNS)
      .where('user_competency_id', '=', userCompetencyId)
      .orderBy('id', 'asc')
      .execute();
  }
}
