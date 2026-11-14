import { sql, type InsertObject, type RawBuilder, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { JsonValue } from '../types/centre-db';
import { applyDefined } from './mapping';

export type CompetenciesTx = CentreTx;
type Db = CentreDb | CentreTx;

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

export interface CourseLinkRow {
  id: string;
  courseId: string;
  competencyId: string;
  ruleOutcome: string;
  sortOrder: number;
  createdAt: Date;
}

export interface NewCourseLink {
  id?: string;
  courseId: string;
  competencyId: string;
  ruleOutcome?: string;
  sortOrder?: number;
  createdAt?: Date;
}

export interface ModuleLinkRow {
  id: string;
  courseModuleId: string;
  competencyId: string;
  ruleOutcome: string;
  sortOrder: number;
  createdAt: Date;
}

export interface NewModuleLink {
  id?: string;
  courseModuleId: string;
  competencyId: string;
  ruleOutcome?: string;
  sortOrder?: number;
  createdAt?: Date;
}

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

function jsonbValue<T>(value: T): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

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

const COURSE_LINK_COLUMNS = [
  'id',
  'course_id as courseId',
  'competency_id as competencyId',
  'rule_outcome as ruleOutcome',
  'sort_order as sortOrder',
  'created_at as createdAt',
] as const;

const MODULE_LINK_COLUMNS = [
  'id',
  'course_module_id as courseModuleId',
  'competency_id as competencyId',
  'rule_outcome as ruleOutcome',
  'sort_order as sortOrder',
  'created_at as createdAt',
] as const;

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

function frameworkInsertValues(values: NewFramework): InsertObject<CentreDB, 'competency_framework'> {
  const row: InsertObject<CentreDB, 'competency_framework'> = {
    short_name: values.shortName,
    context_id: values.contextId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['idNumber', 'id_number'],
    ['description', 'description'],
    ['scaleConfiguration', 'scale_configuration', (value) => jsonbValue<JsonValue>(value as JsonValue)],
    ['taxonomies', 'taxonomies'],
    ['visible', 'visible'],
    ['sortOrder', 'sort_order'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function competencyInsertValues(values: NewCompetency): InsertObject<CentreDB, 'competency'> {
  const row: InsertObject<CentreDB, 'competency'> = {
    framework_id: values.frameworkId,
    short_name: values.shortName,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['idNumber', 'id_number'],
    ['description', 'description'],
    ['parentId', 'parent_id'],
    ['path', 'path'],
    ['depth', 'depth'],
    ['sortOrder', 'sort_order'],
    ['ruleType', 'rule_type'],
    ['ruleConfig', 'rule_config', (value) => (value === null ? null : jsonbValue<JsonValue>(value as JsonValue))],
    ['ruleOutcome', 'rule_outcome'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function competencyUpdateSet(patch: Partial<CompetencyRow>): UpdateObject<CentreDB, 'competency'> {
  const set: UpdateObject<CentreDB, 'competency'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['frameworkId', 'framework_id'],
    ['shortName', 'short_name'],
    ['idNumber', 'id_number'],
    ['description', 'description'],
    ['parentId', 'parent_id'],
    ['path', 'path'],
    ['depth', 'depth'],
    ['sortOrder', 'sort_order'],
    ['ruleType', 'rule_type'],
    ['ruleConfig', 'rule_config', (value) => (value === null ? null : jsonbValue<JsonValue>(value as JsonValue))],
    ['ruleOutcome', 'rule_outcome'],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

function courseLinkInsertValues(values: NewCourseLink): InsertObject<CentreDB, 'competency_course_comp'> {
  const row: InsertObject<CentreDB, 'competency_course_comp'> = {
    course_id: values.courseId,
    competency_id: values.competencyId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['ruleOutcome', 'rule_outcome'],
    ['sortOrder', 'sort_order'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function moduleLinkInsertValues(values: NewModuleLink): InsertObject<CentreDB, 'competency_module_comp'> {
  const row: InsertObject<CentreDB, 'competency_module_comp'> = {
    course_module_id: values.courseModuleId,
    competency_id: values.competencyId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['ruleOutcome', 'rule_outcome'],
    ['sortOrder', 'sort_order'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function templateInsertValues(values: NewTemplate): InsertObject<CentreDB, 'competency_template'> {
  const row: InsertObject<CentreDB, 'competency_template'> = {
    short_name: values.shortName,
    context_id: values.contextId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['description', 'description'],
    ['dueDate', 'due_date'],
    ['visible', 'visible'],
    ['status', 'status'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function planInsertValues(values: NewPlan): InsertObject<CentreDB, 'learning_plans'> {
  const row: InsertObject<CentreDB, 'learning_plans'> = {
    name: values.name,
    user_id: values.userId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['description', 'description'],
    ['templateId', 'template_id'],
    ['status', 'status'],
    ['dueDate', 'due_date'],
    ['reviewerId', 'reviewer_id'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function planUpdateSet(patch: Partial<PlanRow>): UpdateObject<CentreDB, 'learning_plans'> {
  const set: UpdateObject<CentreDB, 'learning_plans'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['name', 'name'],
    ['description', 'description'],
    ['userId', 'user_id'],
    ['templateId', 'template_id'],
    ['status', 'status'],
    ['dueDate', 'due_date'],
    ['reviewerId', 'reviewer_id'],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

function planReviewInsertValues(values: NewPlanReview): InsertObject<CentreDB, 'competency_plan_review'> {
  const row: InsertObject<CentreDB, 'competency_plan_review'> = {
    plan_id: values.planId,
    actor_id: values.actorId,
    action: values.action,
    status_from: values.statusFrom,
    status_to: values.statusTo,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['note', 'note'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function usercompInsertValues(values: NewUsercomp): InsertObject<CentreDB, 'competency_user_comp'> {
  const row: InsertObject<CentreDB, 'competency_user_comp'> = {
    user_id: values.userId,
    competency_id: values.competencyId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['planId', 'plan_id'],
    ['courseId', 'course_id'],
    ['status', 'status'],
    ['proficiency', 'proficiency'],
    ['grade', 'grade'],
    ['reviewerId', 'reviewer_id'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function usercompUpdateSet(patch: Partial<UsercompRow>): UpdateObject<CentreDB, 'competency_user_comp'> {
  const set: UpdateObject<CentreDB, 'competency_user_comp'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['userId', 'user_id'],
    ['competencyId', 'competency_id'],
    ['planId', 'plan_id'],
    ['courseId', 'course_id'],
    ['status', 'status'],
    ['proficiency', 'proficiency'],
    ['grade', 'grade'],
    ['reviewerId', 'reviewer_id'],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

function evidenceInsertValues(values: NewEvidence): InsertObject<CentreDB, 'competency_evidence'> {
  const row: InsertObject<CentreDB, 'competency_evidence'> = {
    user_competency_id: values.userCompetencyId,
    action_user_id: values.actionUserId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['contextId', 'context_id'],
    ['action', 'action'],
    ['description', 'description'],
    ['url', 'url'],
    ['grade', 'grade'],
    ['note', 'note'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

export class CompetenciesRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CentreDb {
    return this.handle;
  }

  get dbHandle(): CentreDb {
    return this.db();
  }

  async transaction<T>(fn: (tx: CompetenciesTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async insertFramework(v: NewFramework, db: Db = this.db()): Promise<FrameworkRow> {
    const rows = await db
      .insertInto('competency_framework')
      .values(frameworkInsertValues(v))
      .returning(FRAMEWORK_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getFramework(id: string, db: Db = this.db()): Promise<FrameworkRow | undefined> {
    const row = await db
      .selectFrom('competency_framework')
      .select(FRAMEWORK_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async listFrameworks(db: Db = this.db()): Promise<FrameworkRow[]> {
    return db
      .selectFrom('competency_framework')
      .select(FRAMEWORK_COLUMNS)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async insertCompetency(v: NewCompetency, db: Db = this.db()): Promise<CompetencyRow> {
    const rows = await db
      .insertInto('competency')
      .values(competencyInsertValues(v))
      .returning(COMPETENCY_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listChildren(parentId: string, db: Db = this.db()): Promise<CompetencyRow[]> {
    return db
      .selectFrom('competency')
      .select(COMPETENCY_COLUMNS)
      .where('parent_id', '=', parentId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async getCompetency(id: string, db: Db = this.db()): Promise<CompetencyRow | undefined> {
    const row = await db
      .selectFrom('competency')
      .select(COMPETENCY_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async listCompetencies(frameworkId: string, db: Db = this.db()): Promise<CompetencyRow[]> {
    return db
      .selectFrom('competency')
      .select(COMPETENCY_COLUMNS)
      .where('framework_id', '=', frameworkId)
      .orderBy('path', 'asc')
      .orderBy('sort_order', 'asc')
      .execute();
  }

  async updateCompetency(id: string, patch: Partial<CompetencyRow>, db: Db = this.db()): Promise<void> {
    await db
      .updateTable('competency')
      .set({ ...competencyUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async insertCourseLink(v: NewCourseLink, db: Db = this.db()): Promise<CourseLinkRow> {
    const rows = await db
      .insertInto('competency_course_comp')
      .values(courseLinkInsertValues(v))
      .onConflict((oc) =>
        oc.columns(['course_id', 'competency_id']).doUpdateSet({ rule_outcome: v.ruleOutcome ?? 'nothing' }),
      )
      .returning(COURSE_LINK_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listCourseLinks(courseId: string, db: Db = this.db()): Promise<CourseLinkRow[]> {
    return db
      .selectFrom('competency_course_comp')
      .select(COURSE_LINK_COLUMNS)
      .where('course_id', '=', courseId)
      .execute();
  }

  async insertModuleLink(v: NewModuleLink, db: Db = this.db()): Promise<ModuleLinkRow> {
    const rows = await db
      .insertInto('competency_module_comp')
      .values(moduleLinkInsertValues(v))
      .onConflict((oc) =>
        oc.columns(['course_module_id', 'competency_id']).doUpdateSet({ rule_outcome: v.ruleOutcome ?? 'nothing' }),
      )
      .returning(MODULE_LINK_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listModuleLinks(courseModuleId: string, db: Db = this.db()): Promise<ModuleLinkRow[]> {
    return db
      .selectFrom('competency_module_comp')
      .select(MODULE_LINK_COLUMNS)
      .where('course_module_id', '=', courseModuleId)
      .execute();
  }

  async insertTemplate(v: NewTemplate, db: Db = this.db()): Promise<TemplateRow> {
    const rows = await db
      .insertInto('competency_template')
      .values(templateInsertValues(v))
      .returning(TEMPLATE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getTemplate(id: string, db: Db = this.db()): Promise<TemplateRow | undefined> {
    const row = await db
      .selectFrom('competency_template')
      .select(TEMPLATE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async listTemplates(db: Db = this.db()): Promise<TemplateRow[]> {
    return db
      .selectFrom('competency_template')
      .select(TEMPLATE_COLUMNS)
      .orderBy('id', 'asc')
      .execute();
  }

  async addTemplateCompetency(templateId: string, competencyId: string, db: Db = this.db()): Promise<void> {
    await db
      .insertInto('competency_template_comp')
      .values({ template_id: templateId, competency_id: competencyId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  async listTemplateCompetencies(templateId: string, db: Db = this.db()): Promise<CompetencyRow[]> {
    const links = await db
      .selectFrom('competency_template_comp')
      .select(['competency_id as competencyId'])
      .where('template_id', '=', templateId)
      .orderBy('sort_order', 'asc')
      .execute();
    const out: CompetencyRow[] = [];
    for (const link of links) {
      const c = await this.getCompetency(link.competencyId);
      if (c) out.push(c);
    }
    return out;
  }

  async addTemplateCohort(templateId: string, cohortId: string, db: Db = this.db()): Promise<void> {
    await db
      .insertInto('competency_template_cohort')
      .values({ template_id: templateId, cohort_id: cohortId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  async listTemplateCohorts(templateId: string, db: Db = this.db()): Promise<string[]> {
    const rows = await db
      .selectFrom('competency_template_cohort')
      .select(['cohort_id as cohortId'])
      .where('template_id', '=', templateId)
      .execute();
    return rows.map((r) => r.cohortId);
  }

  async insertPlan(v: NewPlan, db: Db = this.db()): Promise<PlanRow> {
    const rows = await db
      .insertInto('learning_plans')
      .values(planInsertValues(v))
      .returning(PLAN_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getPlan(id: string, db: Db = this.db()): Promise<PlanRow | undefined> {
    const row = await db
      .selectFrom('learning_plans')
      .select(PLAN_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async listPlansForUser(userId: string, db: Db = this.db()): Promise<PlanRow[]> {
    return db
      .selectFrom('learning_plans')
      .select(PLAN_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute();
  }

  async findPlanFromTemplate(userId: string, templateId: string, db: Db = this.db()): Promise<PlanRow | undefined> {
    const row = await db
      .selectFrom('learning_plans')
      .select(PLAN_COLUMNS)
      .where((eb) => eb.and([eb('user_id', '=', userId), eb('template_id', '=', templateId)]))
      .executeTakeFirst();
    return row;
  }

  async updatePlan(id: string, patch: Partial<PlanRow>, db: Db = this.db()): Promise<void> {
    await db
      .updateTable('learning_plans')
      .set({ ...planUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async addPlanCompetency(planId: string, competencyId: string, db: Db = this.db()): Promise<void> {
    await db
      .insertInto('competency_plan_comp')
      .values({ plan_id: planId, competency_id: competencyId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  async listPlanCompetencyIds(planId: string, db: Db = this.db()): Promise<string[]> {
    const rows = await db
      .selectFrom('competency_plan_comp')
      .select(['competency_id as competencyId'])
      .where('plan_id', '=', planId)
      .orderBy('sort_order', 'asc')
      .execute();
    return rows.map((r) => r.competencyId);
  }

  async insertPlanReview(v: NewPlanReview, db: Db = this.db()): Promise<void> {
    await db.insertInto('competency_plan_review').values(planReviewInsertValues(v)).execute();
  }

  async listPlanReviews(planId: string, db: Db = this.db()): Promise<PlanReviewRow[]> {
    return db
      .selectFrom('competency_plan_review')
      .select(PLAN_REVIEW_COLUMNS)
      .where('plan_id', '=', planId)
      .orderBy('id', 'asc')
      .execute();
  }

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

  async getUsercomp(id: string, db: Db = this.db()): Promise<UsercompRow | undefined> {
    const row = await db
      .selectFrom('competency_user_comp')
      .select(USERCOMP_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async insertUsercomp(v: NewUsercomp, db: Db = this.db()): Promise<UsercompRow> {
    const rows = await db
      .insertInto('competency_user_comp')
      .values(usercompInsertValues(v))
      .returning(USERCOMP_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async updateUsercomp(id: string, patch: Partial<UsercompRow>, db: Db = this.db()): Promise<void> {
    await db
      .updateTable('competency_user_comp')
      .set({ ...usercompUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async listUsercompsForPlan(planId: string, userId: string, db: Db = this.db()): Promise<UsercompRow[]> {
    return db
      .selectFrom('competency_user_comp')
      .select(USERCOMP_COLUMNS)
      .where((eb) => eb.and([eb('plan_id', '=', planId), eb('user_id', '=', userId)]))
      .execute();
  }

  async listUsercompsForUser(userId: string, db: Db = this.db()): Promise<UsercompRow[]> {
    return db
      .selectFrom('competency_user_comp')
      .select(USERCOMP_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute();
  }

  async insertEvidence(v: NewEvidence, db: Db = this.db()): Promise<EvidenceRow> {
    const rows = await db
      .insertInto('competency_evidence')
      .values(evidenceInsertValues(v))
      .returning(EVIDENCE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listEvidence(userCompetencyId: string, db: Db = this.db()): Promise<EvidenceRow[]> {
    return db
      .selectFrom('competency_evidence')
      .select(EVIDENCE_COLUMNS)
      .where('user_competency_id', '=', userCompetencyId)
      .orderBy('id', 'asc')
      .execute();
  }
}
