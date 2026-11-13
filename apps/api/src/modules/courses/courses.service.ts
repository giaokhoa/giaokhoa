import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql, type CentreTx, type ExamVariant } from '@giaokhoa/db';
import {
  CoursesRepository, type CategoryRow, type CmRow, type CourseFormatOptionRow, type CourseRow, type SectionRow,
} from '@giaokhoa/db/repositories/courses';
import { OutboxService } from '../../infra/events/outbox.service';
import { ContextsService } from '../access/contexts.service';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { PlanLimitsService } from '../access/plan-limits.service';
import { AvailabilityService, type AvailabilityContext } from '../availability/availability.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import { TenantsService } from '../tenants/tenants.service';

export const GROUPMODE_NOGROUPS = 0;
export const GROUPMODE_SEPARATEGROUPS = 1;
export const GROUPMODE_VISIBLEGROUPS = 2;
export const COURSE_COMPONENT = 'core_course';
export const COURSE_AREA = 'course';

export type CategoryDeleteMode = 'moveup' | 'recursive';

export type CourseItemStatus = 'draft' | 'open' | 'scheduled';

export function courseItemStatus(visible: boolean, openAt: Date | null, now: Date = new Date()): CourseItemStatus {
  if (!visible) return 'draft';
  if (openAt && openAt.getTime() > now.getTime()) return 'scheduled';
  return 'open';
}

export const QUIZ_COMPONENT_NAME = 'mod_quiz';

export interface EnrolChecker {
  isEnrolled(courseId: string, userId: string, opts?: { onlyActive?: boolean }): Promise<boolean>;
}

export interface CourseClassHook {
  resolveClass(classId: string, tenantId: string): Promise<{ classId: string; contextId: string }>;
  onCourseCreated(course: CourseRow): Promise<void>;
}

export interface CurriculumFrameUnit {
  nodeId: string;
  title: string;
  kind: string;
  outcomes: { outcomeId: string; content: string }[];
}

export interface CurriculumFrameProvider {
  getFrameUnits(actorId: string, curriculumId: string): Promise<CurriculumFrameUnit[]>;
}

export interface BookFrameUnit {
  chapterNodeId: string;
  title: string;
  items: { lessonNodeId: string; title: string; outcomes: { outcomeId: string; content: string }[] }[];
}

export interface BookFrameProvider {
  getBookFrameUnits(actorId: string, bookId: string): Promise<BookFrameUnit[]>;
}

export interface SectionFrameView {
  nodeId: string | null;
  nodeTitle: string;
  outcomes: { outcomeId: string | null; content: string }[];
}

export interface SectionBookFrameView {
  nodeId: string | null;
  bookId: string | null;
  nodeTitle: string;
  items: { nodeId: string | null; title: string; outcomes: { outcomeId: string | null; content: string }[] }[];
}

export interface CourseContentView {
  course: CourseRow;
  contextId: string;
  customFields: { shortName: string; value: string | null }[];
  sections: (SectionRow & {
    availabilityResult?: { available: boolean; visible: boolean; failedDescriptions: string[] };
    status?: CourseItemStatus;
    frame?: SectionFrameView | null;
    modules: (CmRow & { status?: CourseItemStatus; contextId?: string; availabilityResult?: { available: boolean; visible: boolean; failedDescriptions: string[] } })[];
    bookFrame?: SectionBookFrameView | null;
  })[];
}

@Injectable()
export class CoursesService {
  private enrolChecker?: EnrolChecker;
  private gradeProvider?: (userId: string, courseId: string) => Promise<Record<string, number>>;
  private frameProvider?: CurriculumFrameProvider;
  private bookFrameProvider?: BookFrameProvider;

  registerCurriculumFrameProvider(provider: CurriculumFrameProvider): void {
    this.frameProvider = provider;
  }

  registerBookFrameProvider(provider: BookFrameProvider): void {
    this.bookFrameProvider = provider;
  }

  registerGradeProvider(fn: (userId: string, courseId: string) => Promise<Record<string, number>>): void {
    this.gradeProvider = fn;
  }
  async gradesForAvailability(userId: string, courseId: string): Promise<Record<string, number> | undefined> {
    return this.gradeProvider ? this.gradeProvider(userId, courseId) : undefined;
  }

  constructor(
    private readonly repo: CoursesRepository,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly customFields: CustomFieldsService,
    private readonly availability: AvailabilityService,
    private readonly outbox: OutboxService,
    private readonly emitter: EventEmitter2,
    private readonly tenantContext: TenantContextService,
    private readonly tenants: TenantsService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  private async effectiveTenantId(): Promise<string> {
    return this.tenantContext.currentTenantId() ?? (await this.tenants.fallbackTenantId());
  }

  private tenantHidden(rowTenantId: string): boolean {
    const active = this.tenantContext.currentTenantId();
    return active !== undefined && rowTenantId !== active;
  }

  registerEnrolChecker(checker: EnrolChecker): void { this.enrolChecker = checker; }

  private classHook?: CourseClassHook;
  registerClassHook(hook: CourseClassHook): void { this.classHook = hook; }

  async isActivelyEnrolled(courseId: string, userId: string): Promise<boolean> {
    if (!this.enrolChecker) return false;
    return this.enrolChecker.isEnrolled(courseId, userId, { onlyActive: true });
  }

  async categoryContextId(categoryId: string): Promise<string> {
    const ctx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSECAT, categoryId);
    if (!ctx) throw new NotFoundException({ message: `No context for category ${categoryId}`, code: 'course.category_context_missing' });
    return ctx.id;
  }
  async courseContextId(courseId: string): Promise<string> {
    const ctx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSE, courseId);
    if (!ctx) throw new NotFoundException({ message: `No context for course ${courseId}`, code: 'course.context_missing' });
    return ctx.id;
  }
  async cmContextId(cmId: string): Promise<string | undefined> {
    return (await this.contexts.getByLevelInstance(CONTEXT_LEVELS.MODULE, cmId))?.id;
  }

  async createCategory(actorId: string, input: { name: string; idNumber?: string; description?: string; parent?: string; visible?: boolean }): Promise<CategoryRow> {
    const parent = input.parent ?? null;
    let parentCtxId: string;
    let tenantId: string;
    if (parent === null) {
      tenantId = await this.effectiveTenantId();
      parentCtxId = (await this.contexts.ensureTenantContext(tenantId)).id;
    } else {
      const parentCat = await this.getCategory(parent);
      tenantId = parentCat.tenantId;
      parentCtxId = await this.categoryContextId(parentCat.id);
    }
    await this.evaluator.requireCapability(actorId, 'category:manage', parentCtxId);
    const sortOrder = await this.repo.countSiblingCategories(parent);
    const cat = await this.repo.insertCategory({
      tenantId,
      name: input.name, idNumber: input.idNumber ?? null, description: input.description ?? '',
      parent, sortOrder, visible: input.visible ?? true, path: '', depth: 1,
    });
    const parentRow = parent === null ? null : await this.getCategory(parent);
    const path = parentRow ? `${parentRow.path}/${cat.id}` : `/${cat.id}`;
    const depth = parentRow ? parentRow.depth + 1 : 1;
    await this.repo.updateCategoryPath(cat.id, path, depth);
    await this.contexts.createContext(CONTEXT_LEVELS.COURSECAT, cat.id, parentCtxId);
    await this.outbox.enqueueStandalone({ aggregate: 'course_category', type: 'category_created', payload: { categoryId: cat.id, parent, actorId } });
    return { ...cat, path, depth };
  }

  async getCategory(id: string): Promise<CategoryRow> {
    const row = await this.repo.getCategory(id);
    if (!row || this.tenantHidden(row.tenantId)) throw new NotFoundException({ message: `Category ${id} not found`, code: 'course.category_not_found' });
    return row;
  }
  async listCategories(): Promise<CategoryRow[]> {
    const all = await this.repo.listCategories();
    const active = this.tenantContext.currentTenantId();
    return active ? all.filter((c) => c.tenantId === active) : all;
  }

  async categoryTree(): Promise<(CategoryRow & { children: unknown[] })[]> {
    const all = await this.listCategories();
    const byId = new Map<string, CategoryRow & { children: unknown[] }>(all.map((c) => [c.id, { ...c, children: [] }]));
    const roots: (CategoryRow & { children: unknown[] })[] = [];
    for (const c of byId.values()) {
      if (c.parent !== null && byId.has(c.parent)) (byId.get(c.parent)!.children as unknown[]).push(c);
      else roots.push(c);
    }
    return roots;
  }

  async updateCategory(actorId: string, id: string, input: { name?: string; idNumber?: string; description?: string; visible?: boolean; parent?: string }): Promise<CategoryRow> {
    const cat = await this.getCategory(id);
    await this.evaluator.requireCapability(actorId, 'category:manage', await this.categoryContextId(id));
    if (input.parent !== undefined && input.parent !== cat.parent) {
      await this.moveCategory(cat, input.parent, actorId);
    }
    const patch: Partial<CategoryRow> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.idNumber !== undefined) patch.idNumber = input.idNumber;
    if (input.description !== undefined) patch.description = input.description;
    if (input.visible !== undefined) patch.visible = input.visible;
    if (Object.keys(patch).length) await this.repo.updateCategory(id, patch);
    await this.outbox.enqueueStandalone({ aggregate: 'course_category', type: 'category_updated', payload: { categoryId: id, actorId } });
    return this.getCategory(id);
  }

  private async moveCategory(cat: CategoryRow, newParent: string | null, actorId?: string): Promise<void> {
    if (newParent === cat.id) throw new BadRequestException({ message: 'A category cannot be its own parent', code: 'course.category_cycle' });
    const subtree = await this.repo.subtreeOf(cat);
    if (subtree.some((c) => c.id === newParent)) {
      throw new BadRequestException({ message: 'A category cannot be moved under its own descendant', code: 'course.category_cycle' });
    }
    const newParentRow = newParent === null ? null : await this.getCategory(newParent);
    const oldPath = cat.path;
    const newPath = newParentRow ? `${newParentRow.path}/${cat.id}` : `/${cat.id}`;
    const depthDelta = (newParentRow ? newParentRow.depth + 1 : 1) - cat.depth;
    for (const c of subtree) {
      await this.repo.updateCategoryPath(c.id, newPath + c.path.slice(oldPath.length), c.depth + depthDelta);
    }
    await this.repo.updateCategory(cat.id, { parent: newParent });
    const ctxId = await this.categoryContextId(cat.id);
    const newParentCtxId = newParentRow ? await this.categoryContextId(newParentRow.id) : (await this.contexts.ensureTenantContext(cat.tenantId)).id;
    await this.contexts.reparentContext(ctxId, newParentCtxId);
    await this.outbox.enqueueStandalone({ aggregate: 'course_category', type: 'category_moved', payload: { categoryId: cat.id, fromParent: cat.parent, toParent: newParent, actorId: actorId ?? null } });
  }

  async deleteCategory(actorId: string, id: string, mode?: CategoryDeleteMode): Promise<{ deleted: true; mode: CategoryDeleteMode | 'empty' }> {
    const cat = await this.getCategory(id);
    await this.evaluator.requireCapability(actorId, 'category:manage', await this.categoryContextId(id));
    const children = await this.repo.childrenOf(id);
    const coursesHere = await this.repo.listCourses(id);
    if ((children.length || coursesHere.length) && !mode) {
      throw new BadRequestException({
        message: 'Category is not empty: pass mode=moveup (move contents to the parent category) or mode=recursive (delete contents)',
        code: 'course.category_not_empty',
      });
    }
    const effectiveMode: CategoryDeleteMode | 'empty' = mode ?? 'empty';
    if (mode === 'moveup' && cat.parent === null && coursesHere.length) {
      throw new BadRequestException({ message: 'Cannot move courses up from a top-level category (no parent category)', code: 'course.category_moveup_no_parent' });
    }
    if (mode === 'moveup') {
      for (const child of children) await this.moveCategory(child, cat.parent, actorId);
      for (const c of coursesHere) {
        await this.repo.updateCourse(c.id, { category: cat.parent! });
        const courseCtx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSE, c.id);
        if (courseCtx) await this.contexts.reparentContext(courseCtx.id, await this.categoryContextId(cat.parent!));
      }
    } else if (mode === 'recursive') {
      const subtree = await this.repo.subtreeOf(cat);
      for (const sub of subtree) {
        for (const c of await this.repo.listCourses(sub.id)) await this.deleteCourseInternal(c, actorId);
      }
      for (const sub of subtree.sort((a, b) => b.depth - a.depth)) {
        if (sub.id !== id) {
          await this.contexts.deleteByLevelInstance(CONTEXT_LEVELS.COURSECAT, sub.id);
          await this.repo.deleteCategory(sub.id);
        }
      }
    }
    await this.contexts.deleteByLevelInstance(CONTEXT_LEVELS.COURSECAT, id);
    await this.repo.deleteCategory(id);
    await this.outbox.enqueueStandalone({ aggregate: 'course_category', type: 'category_deleted', payload: { categoryId: id, mode: effectiveMode, actorId } });
    return { deleted: true, mode: effectiveMode };
  }

  async createCourse(actorId: string, input: {
    fullName: string; shortName: string; category: string; idNumber?: string; summary?: string;
    format?: string; visible?: boolean; startDate?: string; endDate?: string; groupMode?: number; groupModeForce?: boolean;
    subjectId?: string | null; grade?: number | null;
    classId?: string | null;
    formatOptions?: Record<string, string>; customFields?: Record<string, string>;
  }): Promise<CourseRow> {
    const category = await this.getCategory(input.category);
    const categoryCtxId = await this.categoryContextId(category.id);
    let classRef: { classId: string; contextId: string } | undefined;
    if (input.classId) {
      if (!this.classHook) {
        throw new BadRequestException({ message: 'Class-aware course creation is unavailable', code: 'course.class_unavailable' });
      }
      classRef = await this.classHook.resolveClass(input.classId, category.tenantId);
      await this.evaluator.requireCapability(actorId, 'course:create', classRef.contextId);
    } else {
      throw new BadRequestException({ message: 'A course must belong to a class: classId is required', code: 'course.class_required' });
    }
    if (input.subjectId != null) await this.assertSubjectExists(input.subjectId);
    await this.planLimits.assertTeacherCourseSlotForNewCourse(category.tenantId, classRef.classId);
    const shortName = input.shortName.trim();
    if (await this.repo.getCourseByShortname(shortName)) {
      throw new ConflictException({ message: `Course shortName ${shortName} is taken`, code: 'course.shortname_taken' });
    }
    if (input.startDate && input.endDate && new Date(input.endDate) < new Date(input.startDate)) {
      throw new BadRequestException({ message: 'Course end date is before its start date', code: 'course.invalid_dates' });
    }
    if (input.customFields) await this.customFields.validateValuesForInstance(COURSE_COMPONENT, COURSE_AREA, input.customFields);
    const siblings = await this.repo.listCourses(category.id);
    const created = await this.repo.transaction(async (tx) => {
      const row = await this.repo.insertCourse({
        tenantId: category.tenantId,
        category: category.id, fullName: input.fullName, shortName,
        idNumber: input.idNumber ?? '', summary: input.summary ?? '',
        format: input.format ?? 'topics', visible: input.visible ?? true,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        groupMode: input.groupMode ?? GROUPMODE_NOGROUPS, groupModeForce: input.groupModeForce ?? false, sortOrder: siblings.length,
        subjectId: input.subjectId ?? null, grade: input.grade ?? null,
        classId: classRef?.classId ?? null,
      }, tx);
      await this.outbox.enqueueKysely(tx, { aggregate: 'course', type: 'course_created', payload: { courseId: row.id, categoryId: category.id, actorId }, tenantId: category.tenantId });
      return row;
    });
    await this.contexts.createContext(CONTEXT_LEVELS.COURSE, created.id, classRef?.contextId ?? categoryCtxId);
    await this.repo.insertSection({ course: created.id, section: 0, name: null, summary: '', visible: true });
    if (classRef) await this.classHook!.onCourseCreated(created);
    if (input.formatOptions) {
      for (const [name, value] of Object.entries(input.formatOptions)) {
        await this.repo.setFormatOption(created.id, created.format, name, value);
      }
    }
    if (input.customFields) await this.customFields.setValuesForInstance(COURSE_COMPONENT, COURSE_AREA, created.id, input.customFields);
    return created;
  }

  private async assertSubjectExists(subjectId: string): Promise<void> {
    if (!(await this.repo.getSubjectById(subjectId))) {
      throw new BadRequestException({ message: `Subject ${subjectId} not found`, code: 'course.subject_not_found' });
    }
  }

  async getCourseTenantId(id: string): Promise<string | undefined> {
    const row = await this.repo.getCourse(id);
    return row?.tenantId;
  }

  async getCourse(id: string): Promise<CourseRow> {
    const row = await this.repo.getCourse(id);
    if (!row || this.tenantHidden(row.tenantId)) throw new NotFoundException({ message: `Course ${id} not found`, code: 'course.not_found' });
    return row;
  }
  async listCourses(categoryId?: string): Promise<CourseRow[]> {
    const active = this.tenantContext.currentTenantId();
    return (await this.repo.listCourses(categoryId)).filter((c) => !c.isTemplate && (!active || c.tenantId === active));
  }

  async listCoursesFor(actorId: string, categoryId?: string): Promise<CourseRow[]> {
    const rows = await this.listCourses(categoryId);
    if (await this.evaluator.isSiteAdmin(actorId)) return rows;
    const out: CourseRow[] = [];
    for (const c of rows) {
      if (c.visible || (await this.evaluator.hasCapability(actorId, 'course:viewhiddencourses', await this.courseContextId(c.id)))) out.push(c);
    }
    return out;
  }

  async categoryTreeFor(actorId: string): Promise<(CategoryRow & { children: unknown[] })[]> {
    const tree = await this.categoryTree();
    if (await this.evaluator.isSiteAdmin(actorId)) return tree;
    type Node = CategoryRow & { children: unknown[] };
    const prune = async (nodes: Node[]): Promise<Node[]> => {
      const out: Node[] = [];
      for (const n of nodes) {
        const children = await prune(n.children as Node[]);
        if (n.visible || (await this.evaluator.hasCapability(actorId, 'course:viewhiddencourses', await this.categoryContextId(n.id)))) {
          out.push({ ...n, children });
        }
      }
      return out;
    };
    return prune(tree);
  }

  async listTemplates(actorId: string): Promise<CourseRow[]> {
    if (!(await this.evaluator.isSiteAdmin(actorId))) {
      const categories = await this.repo.listCategories();
      let canCreate = false;
      for (const cat of categories) {
        const ctx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSECAT, cat.id);
        if (ctx && (await this.evaluator.hasCapability(actorId, 'course:create', ctx.id))) { canCreate = true; break; }
      }
      if (!canCreate) return [];
    }
    return this.repo.listTemplateCourses();
  }
  async getFormatOptions(courseId: string): Promise<CourseFormatOptionRow[]> {
    return this.repo.listFormatOptions(courseId);
  }
  async getCourseCustomFields(courseId: string): Promise<{ shortName: string; value: string | null }[]> {
    const values = await this.customFields.getValuesForInstance(COURSE_COMPONENT, COURSE_AREA, courseId);
    return values.map((v) => ({ shortName: v.field.shortName, value: v.value }));
  }

  async updateCourse(actorId: string, id: string, input: {
    fullName?: string; shortName?: string; category?: string; idNumber?: string; summary?: string;
    format?: string; visible?: boolean; startDate?: string | null; endDate?: string | null; groupMode?: number; groupModeForce?: boolean;
    subjectId?: string | null; grade?: number | null; isTemplate?: boolean;
    formatOptions?: Record<string, string>; customFields?: Record<string, string>;
  }): Promise<CourseRow> {
    const existing = await this.getCourse(id);
    await this.evaluator.requireCapability(actorId, 'course:update', await this.courseContextId(id));
    if (input.isTemplate === false && !existing.classId) {
      throw new BadRequestException({ message: 'A course without a class can only exist as a template', code: 'course.class_required' });
    }
    if (input.shortName !== undefined && input.shortName.trim() !== existing.shortName) {
      if (await this.repo.getCourseByShortname(input.shortName.trim())) {
        throw new ConflictException({ message: `Course shortName ${input.shortName} is taken`, code: 'course.shortname_taken' });
      }
    }
    if (input.customFields) await this.customFields.validateValuesForInstance(COURSE_COMPONENT, COURSE_AREA, input.customFields);
    const patch: Partial<CourseRow> = {};
    if (input.fullName !== undefined) patch.fullName = input.fullName;
    if (input.shortName !== undefined) patch.shortName = input.shortName.trim();
    if (input.idNumber !== undefined) patch.idNumber = input.idNumber;
    if (input.summary !== undefined) patch.summary = input.summary;
    if (input.format !== undefined) patch.format = input.format;
    if (input.visible !== undefined) patch.visible = input.visible;
    if (input.startDate !== undefined) patch.startDate = input.startDate ? new Date(input.startDate) : null;
    if (input.endDate !== undefined) patch.endDate = input.endDate ? new Date(input.endDate) : null;
    if (input.groupMode !== undefined) patch.groupMode = input.groupMode;
    if (input.groupModeForce !== undefined) patch.groupModeForce = input.groupModeForce;
    if (input.subjectId !== undefined) {
      if (input.subjectId !== null) await this.assertSubjectExists(input.subjectId);
      patch.subjectId = input.subjectId;
    }
    if (input.grade !== undefined) patch.grade = input.grade;
    if (input.isTemplate !== undefined) patch.isTemplate = input.isTemplate;
    if (input.category !== undefined && input.category !== existing.category) {
      const newCategory = await this.getCategory(input.category);
      patch.category = newCategory.id;
    }
    if (Object.keys(patch).length) await this.repo.updateCourse(id, patch);
    if (patch.category !== undefined) {
      const courseCtx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSE, id);
      if (courseCtx) await this.contexts.reparentContext(courseCtx.id, await this.categoryContextId(patch.category));
    }
    if (input.formatOptions) {
      const fmt = input.format ?? existing.format;
      for (const [name, value] of Object.entries(input.formatOptions)) await this.repo.setFormatOption(id, fmt, name, value);
    }
    if (input.customFields) await this.customFields.setValuesForInstance(COURSE_COMPONENT, COURSE_AREA, id, input.customFields);
    await this.outbox.enqueueStandalone({ aggregate: 'course', type: 'course_updated', payload: { courseId: id, actorId } });
    return this.getCourse(id);
  }

  async deleteCourse(actorId: string, id: string): Promise<void> {
    const courseRow = await this.getCourse(id);
    await this.evaluator.requireCapability(actorId, 'course:delete', await this.courseContextId(id));
    await this.deleteCourseInternal(courseRow, actorId);
  }

  private async deleteCourseInternal(courseRow: CourseRow, actorId?: string): Promise<void> {
    const cms = await this.repo.listCms(courseRow.id);
    for (const cm of cms) await this.emitCmDeleted(cm, actorId);
    await this.contexts.deleteByLevelInstance(CONTEXT_LEVELS.COURSE, courseRow.id);
    await this.repo.deleteCourse(courseRow.id);
    await this.outbox.enqueueStandalone({ aggregate: 'course', type: 'course_deleted', payload: { courseId: courseRow.id, actorId: actorId ?? null } });
  }

  async assertCourseAccess(userId: string, courseId: string): Promise<CourseRow> {
    const courseRow = await this.getCourse(courseId);
    if (await this.evaluator.isSiteAdmin(userId)) return courseRow;
    const ctxId = await this.courseContextId(courseId);
    if (!courseRow.visible && !(await this.evaluator.hasCapability(userId, 'course:viewhiddencourses', ctxId))) {
      throw new ForbiddenException({ message: 'Course is hidden', code: 'course.hidden' });
    }
    if (this.enrolChecker && (await this.enrolChecker.isEnrolled(courseId, userId, { onlyActive: true }))) return courseRow;
    if (await this.evaluator.hasCapabilityFromRealAssignment(userId, 'course:view', ctxId, { excludeArchetypes: ['student'] })) return courseRow;
    throw new ForbiddenException({ message: 'User is not enrolled in this course (or the enrolment is not active)', code: 'course.not_enrolled' });
  }

  async canViewHiddenActivities(userId: string, courseId: string): Promise<boolean> {
    if (await this.evaluator.isSiteAdmin(userId)) return true;
    return this.evaluator.hasCapability(userId, 'course:viewhiddenactivities', await this.courseContextId(courseId));
  }

  async createSection(actorId: string, courseId: string, input: { name?: string; summary?: string; visible?: boolean; availability?: unknown; openAt?: string | null }): Promise<SectionRow> {
    await this.getCourse(courseId);
    await this.evaluator.requireCapability(actorId, 'course:update', await this.courseContextId(courseId));
    if (input.availability !== undefined) this.availability.parse(input.availability);
    const existing = await this.repo.listSections(courseId);
    const nextNumber = existing.length ? Math.max(...existing.map((s) => s.section)) + 1 : 0;
    return this.repo.insertSection({
      course: courseId, section: nextNumber, name: input.name ?? null,
      summary: input.summary ?? '', visible: input.visible ?? true,
      availability: (input.availability ?? null) as never,
      openAt: input.openAt ? new Date(input.openAt) : null,
    });
  }
  async getSection(id: string): Promise<SectionRow> {
    const row = await this.repo.getSection(id);
    if (!row) throw new NotFoundException({ message: `Section ${id} not found`, code: 'course.section_not_found' });
    return row;
  }
  async listSections(courseId: string): Promise<SectionRow[]> { return this.repo.listSections(courseId); }
  async updateSection(actorId: string, id: string, input: { name?: string; summary?: string; visible?: boolean; availability?: unknown; openAt?: string | null }): Promise<SectionRow> {
    const section = await this.getSection(id);
    await this.evaluator.requireCapability(actorId, 'course:update', await this.courseContextId(section.course));
    if (input.availability !== undefined) this.availability.parse(input.availability);
    const patch: Partial<SectionRow> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.summary !== undefined) patch.summary = input.summary;
    if (input.visible !== undefined) patch.visible = input.visible;
    if (input.availability !== undefined) patch.availability = input.availability as never;
    if (input.openAt !== undefined) patch.openAt = input.openAt ? new Date(input.openAt) : null;
    if (Object.keys(patch).length) await this.repo.updateSection(id, patch);
    return this.getSection(id);
  }
  async deleteSection(actorId: string, id: string): Promise<void> {
    const section = await this.getSection(id);
    await this.evaluator.requireCapability(actorId, 'course:update', await this.courseContextId(section.course));
    const cms = await this.repo.listCmsInSection(id);
    for (const cm of cms) await this.deleteCmInternal(cm, actorId);
    await this.repo.deleteSection(id);
  }

  async createCm(actorId: string, courseId: string, input: {
    sectionId: string; component: string; instanceId?: string; name?: string; visible?: boolean; groupMode?: number;
    availability?: unknown; completion?: number; completionView?: boolean; completionUseGrade?: boolean;
    completionManual?: boolean; completionExpected?: string; openAt?: string | null;
  }): Promise<CmRow> {
    const courseRow = await this.getCourse(courseId);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courseContextId(courseId));
    const section = await this.getSection(input.sectionId);
    if (section.course !== courseId) throw new BadRequestException({ message: 'Section does not belong to this course', code: 'course.section_course_mismatch' });
    if (input.availability !== undefined) this.availability.parse(input.availability);
    const siblings = await this.repo.listCmsInSection(section.id);
    const sortOrder = siblings.length ? Math.max(...siblings.map((c) => c.sortOrder)) + 1 : 0;
    const cm = await this.repo.insertCm({
      course: courseId, section: section.id, component: input.component, instanceId: input.instanceId ?? null,
      name: input.name ?? '', visible: input.visible ?? true, groupMode: input.groupMode ?? 0,
      availability: (input.availability ?? null) as never,
      completion: input.completion ?? (input.completionManual ? 1 : 0),
      completionView: input.completionView ?? false, completionUseGrade: input.completionUseGrade ?? false,
      completionManual: input.completionManual ?? false,
      completionExpected: input.completionExpected ? new Date(input.completionExpected) : null,
      openAt: input.openAt ? new Date(input.openAt) : null,
      sortOrder,
    });
    const courseCtxId = await this.courseContextId(courseId);
    await this.contexts.createContext(CONTEXT_LEVELS.MODULE, cm.id, courseCtxId);
    await this.outbox.enqueueStandalone({ aggregate: 'course_module', type: 'cm_created', payload: { cmId: cm.id, courseId, component: cm.component, instanceId: cm.instanceId, actorId } });
    void courseRow;
    return cm;
  }
  async getCm(id: string): Promise<CmRow> {
    const row = await this.repo.getCm(id);
    if (!row) throw new NotFoundException({ message: `Course module ${id} not found`, code: 'course.cm_not_found' });
    return row;
  }
  async listCms(courseId: string): Promise<CmRow[]> { return this.repo.listCms(courseId); }
  async updateCm(actorId: string, id: string, input: {
    name?: string; visible?: boolean; groupMode?: number; availability?: unknown; completion?: number;
    completionView?: boolean; completionUseGrade?: boolean; completionManual?: boolean; completionExpected?: string | null; openAt?: string | null; sectionId?: string;
  }): Promise<CmRow> {
    const cm = await this.getCm(id);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courseContextId(cm.course));
    if (input.availability !== undefined) this.availability.parse(input.availability);
    const patch: Partial<CmRow> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.visible !== undefined) patch.visible = input.visible;
    if (input.groupMode !== undefined) patch.groupMode = input.groupMode;
    if (input.availability !== undefined) patch.availability = input.availability as never;
    if (input.completion !== undefined) patch.completion = input.completion;
    if (input.completionView !== undefined) patch.completionView = input.completionView;
    if (input.completionUseGrade !== undefined) patch.completionUseGrade = input.completionUseGrade;
    if (input.completionManual !== undefined) patch.completionManual = input.completionManual;
    if (input.completionExpected !== undefined) patch.completionExpected = input.completionExpected ? new Date(input.completionExpected) : null;
    if (input.openAt !== undefined) patch.openAt = input.openAt ? new Date(input.openAt) : null;
    if (input.sectionId !== undefined) {
      const section = await this.getSection(input.sectionId);
      if (section.course !== cm.course) throw new BadRequestException({ message: 'Section does not belong to this course', code: 'course.section_course_mismatch' });
      patch.section = section.id;
    }
    if (Object.keys(patch).length) await this.repo.updateCm(id, patch);
    await this.outbox.enqueueStandalone({ aggregate: 'course_module', type: 'cm_updated', payload: { cmId: id, courseId: cm.course, actorId } });
    return this.getCm(id);
  }

  private async emitCmDeleted(cm: CmRow, actorId?: string): Promise<void> {
    const contextId = await this.cmContextId(cm.id);
    await this.outbox.enqueueStandalone({
      aggregate: 'course_module', type: 'cm_deleted',
      payload: { cmId: cm.id, courseId: cm.course, contextId: contextId ?? null, component: cm.component, instanceId: cm.instanceId, actorId: actorId ?? null },
    });
    await this.emitter.emitAsync('cm_deleted', { cmId: cm.id, courseId: cm.course, contextId: contextId ?? null, component: cm.component, instanceId: cm.instanceId });
    if (contextId) await this.contexts.deleteContext(contextId);
  }

  private async deleteCmInternal(cm: CmRow, actorId?: string): Promise<void> {
    await this.emitCmDeleted(cm, actorId);
    await this.repo.deleteCm(cm.id);
  }
  async deleteCm(actorId: string, id: string): Promise<void> {
    const cm = await this.getCm(id);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courseContextId(cm.course));
    await this.deleteCmInternal(cm, actorId);
  }

  async recordCmView(userId: string, cmId: string): Promise<CmRow> {
    const cm = await this.getCm(cmId);
    await this.assertCourseAccess(userId, cm.course);
    const access = await this.checkCmAccess(userId, cm);
    if (!access.available) throw new ForbiddenException({ message: 'This activity is not available to you yet', code: 'availability.not_available' });
    await this.outbox.enqueueStandalone({ aggregate: 'course_module', type: 'cm_viewed', payload: { cmId, courseId: cm.course, userId, actorId: userId } });
    await this.emitter.emitAsync('cm_viewed', { cmId, courseId: cm.course, userId });
    return cm;
  }

  async checkCmAccess(userId: string, cm: CmRow, grades?: Record<string, number>): Promise<{ available: boolean; visible: boolean; failedDescriptions: string[] }> {
    const resolvedGrades = grades ?? (this.gradeProvider ? await this.gradesForAvailability(userId, cm.course) : undefined);
    const ctx: AvailabilityContext = { userId, courseId: cm.course, grades: resolvedGrades };
    const section = await this.repo.getSection(cm.section);
    if (section?.availability) {
      const s = await this.availability.evaluate(section.availability, ctx);
      if (!s.available) return { available: false, visible: s.visible, failedDescriptions: s.failedDescriptions };
    }
    if (section?.openAt && section.openAt.getTime() > Date.now()) {
      const canSeeHidden = await this.canViewHiddenActivities(userId, cm.course);
      if (!canSeeHidden) return { available: false, visible: false, failedDescriptions: [] };
    }
    if (cm.openAt && cm.openAt.getTime() > Date.now()) {
      const canSeeHidden = await this.canViewHiddenActivities(userId, cm.course);
      if (!canSeeHidden) return { available: false, visible: false, failedDescriptions: [] };
    }
    if (!cm.visible) {
      const canSeeHidden = await this.canViewHiddenActivities(userId, cm.course);
      if (!canSeeHidden) return { available: false, visible: false, failedDescriptions: [] };
    }
    if (section && !section.visible) {
      const canSeeHidden = await this.canViewHiddenActivities(userId, cm.course);
      if (!canSeeHidden) return { available: false, visible: false, failedDescriptions: [] };
    }
    const r = await this.availability.evaluate(cm.availability, ctx);
    return { available: r.available, visible: r.visible, failedDescriptions: r.failedDescriptions };
  }

  async checkSectionAccess(userId: string, section: SectionRow, grades?: Record<string, number>): Promise<{ available: boolean; visible: boolean; failedDescriptions: string[] }> {
    if (!section.visible && !(await this.canViewHiddenActivities(userId, section.course))) {
      return { available: false, visible: false, failedDescriptions: [] };
    }
    if (section.openAt && section.openAt.getTime() > Date.now() && !(await this.canViewHiddenActivities(userId, section.course))) {
      return { available: false, visible: false, failedDescriptions: [] };
    }
    const resolvedGrades = grades ?? (this.gradeProvider ? await this.gradesForAvailability(userId, section.course) : undefined);
    const r = await this.availability.evaluate(section.availability, { userId, courseId: section.course, grades: resolvedGrades });
    return { available: r.available, visible: r.visible, failedDescriptions: r.failedDescriptions };
  }

  async applyCurriculumFrame(actorId: string, courseId: string, input: {
    curriculumId: string; nodeIds: string[]; insertAtSection?: number;
  }): Promise<(SectionRow & { frame: SectionFrameView })[]> {
    await this.getCourse(courseId);
    await this.evaluator.requireCapability(actorId, 'course:update', await this.courseContextId(courseId));
    if (!this.frameProvider) {
      throw new BadRequestException({ message: 'Curriculum frame provider is not registered', code: 'course.frame_provider_missing' });
    }
    const units = await this.frameProvider.getFrameUnits(actorId, input.curriculumId);
    const wanted = new Set(input.nodeIds);
    const selected = units.filter((u) => wanted.has(u.nodeId));
    if (selected.length !== wanted.size) {
      const found = new Set(selected.map((u) => u.nodeId));
      const missing = input.nodeIds.filter((id) => !found.has(id));
      throw new BadRequestException({
        message: `Frame nodes not selectable in this curriculum: ${missing.join(', ')}`,
        code: 'course.frame_node_not_selectable',
      });
    }
    const existing = await this.repo.listSections(courseId);
    const existingAnchors = await this.repo.listAnchorsForSections(existing.map((s) => s.id));
    const alreadyApplied = new Set(
      existingAnchors.filter((a) => a.curriculumId === input.curriculumId).map((a) => a.nodeId),
    );
    const fresh = selected.filter((u) => !alreadyApplied.has(u.nodeId));
    if (fresh.length === 0) return [];
    const maxSection = existing.length ? Math.max(...existing.map((s) => s.section)) : -1;
    const insertAt = input.insertAtSection ?? maxSection + 1;
    if (insertAt > maxSection + 1) {
      throw new BadRequestException({
        message: `insertAtSection ${insertAt} is beyond the end of the outline`,
        code: 'course.frame_insert_beyond_end',
      });
    }
    const count = fresh.length;
    const created: (SectionRow & { frame: SectionFrameView })[] = [];
    await this.repo.transaction(async (tx) => {
      const handle = tx;
      if (input.insertAtSection !== undefined && insertAt <= maxSection) {
        await this.repo.shiftSections(handle, courseId, insertAt, 100000);
        await this.repo.shiftSections(handle, courseId, insertAt + 100000, count - 100000);
      }
      for (const [i, unit] of fresh.entries()) {
        const section = await this.repo.insertSection({
          course: courseId, section: insertAt + i, name: unit.title, summary: '', visible: true,
        }, handle);
        const anchor = await this.repo.insertSectionAnchor({
          sectionId: section.id, nodeId: unit.nodeId, curriculumId: input.curriculumId, nodeTitle: unit.title,
        }, handle);
        await this.repo.insertSectionAnchorOutcomes(
          unit.outcomes.map((o, j) => ({ anchorId: anchor.id, outcomeId: o.outcomeId, content: o.content, position: j + 1 })),
          handle,
        );
        created.push({
          ...section,
          frame: {
            nodeId: unit.nodeId, nodeTitle: unit.title,
            outcomes: unit.outcomes.map((o) => ({ outcomeId: o.outcomeId, content: o.content })),
          },
        });
      }
    });
    return created;
  }

  private shiftDate(d: Date | null, deltaMs: number): Date | null {
    if (!d || deltaMs === 0) return d;
    return new Date(d.getTime() + deltaMs);
  }

  private shiftAvailability(node: unknown, deltaMs: number): unknown {
    if (deltaMs === 0 || node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n) => this.shiftAvailability(n, deltaMs));
    const rec = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = this.shiftAvailability(v, deltaMs);
    if (rec.type === 'date') {
      if (typeof rec.time === 'number') out.time = rec.time + Math.round(deltaMs / 1000);
      else if (typeof rec.time === 'string') {
        const parsed = Date.parse(rec.time);
        if (!Number.isNaN(parsed)) out.time = new Date(parsed + deltaMs).toISOString();
      }
    }
    return out;
  }

  private async assertCanCopyFrom(actorId: string, sourceCourseId: string): Promise<CourseRow> {
    const source = await this.getCourse(sourceCourseId);
    try {
      await this.assertCourseAccess(actorId, sourceCourseId);
      return source;
    } catch {
      const ctxId = await this.courseContextId(sourceCourseId);
      if (await this.evaluator.hasCapability(actorId, 'course:update', ctxId)) return source;
      throw new ForbiddenException({ message: 'User cannot access the source course content', code: 'course.copy_source_denied' });
    }
  }

  private async copyCmRow(
    tx: CentreTx, source: CmRow, targetCourseId: string, targetSectionId: string,
    deltaMs: number, cmMap: Map<string, string>,
  ): Promise<CmRow> {
    let instanceId = source.instanceId;
    if (source.component === QUIZ_COMPONENT_NAME && source.instanceId) {
      const pin = await tx.selectFrom('exam_pins').selectAll().where('id', '=', source.instanceId).executeTakeFirst();
      if (pin) {
        const newPin = await tx.insertInto('exam_pins').values({
          exam_id: pin.exam_id, exam_version_id: pin.exam_version_id, course_id: targetCourseId, cm_id: null,
          name: pin.name, intro: pin.intro,
          time_open: this.shiftDate(pin.time_open, deltaMs), time_close: this.shiftDate(pin.time_close, deltaMs),
          time_limit: pin.time_limit, attempts_allowed: pin.attempts_allowed, grade_method: pin.grade_method,
          shuffle_answers: pin.shuffle_answers,
          password_hash: pin.password_hash, subnet: pin.subnet,
          review_attempt: pin.review_attempt, review_correctness: pin.review_correctness,
          review_marks: pin.review_marks, review_specific_feedback: pin.review_specific_feedback,
          review_general_feedback: pin.review_general_feedback, review_right_answer: pin.review_right_answer,
          review_overall_feedback: pin.review_overall_feedback,
          preset: pin.preset, version_mode: pin.version_mode, late_entry_minutes: pin.late_entry_minutes, monitor_events: pin.monitor_events,
          variant_count: pin.variant_count, variants: sql<ExamVariant[]>`${JSON.stringify(pin.variants)}::jsonb`,
          results_published_at: null, created_by: pin.created_by,
        }).returning('id').executeTakeFirstOrThrow();
        instanceId = newPin.id;
      }
    }
    const newCm = await this.repo.insertCm({
      course: targetCourseId, section: targetSectionId, component: source.component, instanceId,
      name: source.name, visible: source.visible, groupMode: source.groupMode,
      availability: source.availability ? this.shiftAvailability(source.availability, deltaMs) : null,
      completion: source.completion, completionView: source.completionView,
      completionUseGrade: source.completionUseGrade, completionManual: source.completionManual,
      completionExpected: this.shiftDate(source.completionExpected, deltaMs),
      openAt: this.shiftDate(source.openAt, deltaMs),
      sortOrder: source.sortOrder,
    }, tx);
    cmMap.set(source.id, newCm.id);
    if (source.component === QUIZ_COMPONENT_NAME && instanceId && instanceId !== source.instanceId) {
      await tx.updateTable('exam_pins').set({ cm_id: newCm.id }).where('id', '=', instanceId).execute();
    }
    await this.contexts.createContext(CONTEXT_LEVELS.MODULE, newCm.id, await this.courseContextId(targetCourseId));
    return newCm;
  }

  private async copySectionRow(
    tx: CentreTx, source: SectionRow, targetCourseId: string, targetNumber: number,
    deltaMs: number, cmMap: Map<string, string>,
  ): Promise<SectionRow> {
    const newSection = await this.repo.insertSection({
      course: targetCourseId, section: targetNumber, name: source.name, summary: source.summary,
      visible: source.visible,
      availability: source.availability ? this.shiftAvailability(source.availability, deltaMs) : null,
      openAt: this.shiftDate(source.openAt, deltaMs),
    }, tx);
    const anchors = await this.repo.listAnchorsForSections([source.id]);
    const anchor = anchors[0];
    if (anchor) {
      const outcomes = await this.repo.listAnchorOutcomes([anchor.id]);
      const newAnchor = await this.repo.insertSectionAnchor({
        sectionId: newSection.id, nodeId: anchor.nodeId, curriculumId: anchor.curriculumId, nodeTitle: anchor.nodeTitle,
      }, tx);
      if (outcomes.length) {
        await this.repo.insertSectionAnchorOutcomes(outcomes.map((o) => ({
          anchorId: newAnchor.id, outcomeId: o.outcomeId, content: o.content, position: o.position,
        })), tx);
      }
    }
    const cms = await this.repo.listCmsInSection(source.id);
    for (const cm of cms) await this.copyCmRow(tx, cm, targetCourseId, newSection.id, deltaMs, cmMap);
    return newSection;
  }

  private async copyGradeStructure(
    tx: CentreTx, sourceCourseId: string, targetCourseId: string, cmMap: Map<string, string>, deltaMs = 0,
  ): Promise<void> {
    const sourceItems = await tx.selectFrom('grade_items').selectAll().where('course_id', '=', sourceCourseId).execute();
    for (const item of sourceItems) {
      let itemInstance = item.item_instance;
      if (item.item_type === 'mod') {
        itemInstance = item.item_instance ? cmMap.get(item.item_instance) ?? null : null;
        if (!itemInstance) continue;
      }
      await tx.insertInto('grade_items').values({
        course_id: targetCourseId,
        item_name: item.item_name, item_type: item.item_type, item_module: item.item_module, item_instance: itemInstance,
        grade_type: item.grade_type, grade_max: item.grade_max, grade_min: item.grade_min, grade_pass: item.grade_pass,
        id_number: item.id_number, multiplicator: item.multiplicator,
        plus_factor: item.plus_factor, hidden: item.hidden, locked: item.locked, sort_order: item.sort_order,
        posting_policy: item.posting_policy,
      }).execute();
    }
    const settings = await tx.selectFrom('course_completion_settings').selectAll().where('course', '=', sourceCourseId).executeTakeFirst();
    if (settings) {
      await tx.insertInto('course_completion_settings').values({ course: targetCourseId, method: settings.method }).onConflict((oc) => oc.doNothing()).execute();
    }
    const criteria = await tx.selectFrom('course_completion_criteria').selectAll().where('course', '=', sourceCourseId).execute();
    for (const c of criteria) {
      await tx.insertInto('course_completion_criteria').values({
        course: targetCourseId, criteria_type: c.criteria_type,
        module_instance: c.module_instance ? cmMap.get(c.module_instance) ?? null : null,
        date: this.shiftDate(c.date, deltaMs), course_instance: c.course_instance === sourceCourseId ? targetCourseId : c.course_instance,
        enrol_period_days: c.enrol_period_days, role_id: c.role_id, sort_order: c.sort_order,
      }).execute();
    }
  }

  async duplicateCourse(actorId: string, sourceCourseId: string, input: {
    fullName: string; shortName: string; category?: string; startDate?: string;
    classId?: string | null;
  }): Promise<CourseRow> {
    const source = await this.assertCanCopyFrom(actorId, sourceCourseId);
    const targetCategory = input.category ? await this.getCategory(input.category) : await this.getCategory(source.category);
    const categoryCtxId = await this.categoryContextId(targetCategory.id);
    const targetClassId = input.classId !== undefined ? input.classId : source.classId;
    let classRef: { classId: string; contextId: string } | undefined;
    if (targetClassId) {
      if (!this.classHook) {
        throw new BadRequestException({ message: 'Class-aware course creation is unavailable', code: 'course.class_unavailable' });
      }
      classRef = await this.classHook.resolveClass(targetClassId, targetCategory.tenantId);
      await this.evaluator.requireCapability(actorId, 'course:create', classRef.contextId);
    } else {
      throw new BadRequestException({ message: 'A duplicated course must belong to a class: classId is required', code: 'course.class_required' });
    }
    const shortName = input.shortName.trim();
    if (await this.repo.getCourseByShortname(shortName)) {
      throw new ConflictException({ message: `Course shortName ${shortName} is taken`, code: 'course.shortname_taken' });
    }
    const newStart = input.startDate ? new Date(input.startDate) : null;
    const deltaMs = newStart && source.startDate ? newStart.getTime() - source.startDate.getTime() : 0;
    const startDate = newStart ?? source.startDate;
    const endDate = this.shiftDate(source.endDate, deltaMs);
    if (startDate && endDate && endDate < startDate) {
      throw new BadRequestException({ message: 'Course end date is before its start date', code: 'course.invalid_dates' });
    }
    const siblings = await this.repo.listCourses(targetCategory.id);
    const created = await this.repo.transaction(async (tx) => {
      const row = await this.repo.insertCourse({
        tenantId: targetCategory.tenantId,
        category: targetCategory.id, fullName: input.fullName, shortName,
        idNumber: '', summary: source.summary,
        format: source.format, visible: false,
        startDate, endDate,
        groupMode: source.groupMode, groupModeForce: source.groupModeForce, sortOrder: siblings.length,
        subjectId: source.subjectId, grade: source.grade, isTemplate: false,
        classId: classRef?.classId ?? null,
      }, tx);
      await this.outbox.enqueueKysely(tx, { aggregate: 'course', type: 'course_created', payload: { courseId: row.id, categoryId: targetCategory.id, actorId, duplicatedFrom: sourceCourseId }, tenantId: targetCategory.tenantId });
      await this.outbox.enqueueKysely(tx, { aggregate: 'course', type: 'course_duplicated', payload: { courseId: row.id, sourceCourseId, actorId }, tenantId: targetCategory.tenantId });
      return row;
    });
    await this.contexts.createContext(CONTEXT_LEVELS.COURSE, created.id, classRef?.contextId ?? categoryCtxId);
    if (classRef) await this.classHook!.onCourseCreated(created);
    const cmMap = new Map<string, string>();
    await this.repo.transaction(async (tx) => {
      const sourceSections = await this.repo.listSections(sourceCourseId);
      const ordered = [...sourceSections].sort((a, b) => a.section - b.section);
      if (!ordered.some((s) => s.section === 0)) {
        await this.repo.insertSection({ course: created.id, section: 0, name: null, summary: '', visible: true }, tx);
      }
      for (const s of ordered) {
        await this.copySectionRow(tx, s, created.id, s.section, deltaMs, cmMap);
      }
      await this.copyGradeStructure(tx, sourceCourseId, created.id, cmMap, deltaMs);
      const sectionMap = new Map<string, string>();
      const newSections = await tx.selectFrom('course_sections').selectAll().where('course', '=', created.id).execute();
      for (const s of ordered) {
        const match = newSections.find((n) => n.section === s.section);
        if (match) sectionMap.set(s.id, match.id);
      }
      const options = await this.repo.listFormatOptions(sourceCourseId);
      for (const opt of options) {
        await tx.insertInto('course_format_options').values({
          course_id: created.id, format: opt.format,
          section_id: opt.sectionId ? sectionMap.get(opt.sectionId) ?? null : null,
          name: opt.name, value: opt.value,
        }).execute();
      }
    });
    const sourceFields = await this.getCourseCustomFields(sourceCourseId);
    if (sourceFields.length) {
      const values: Record<string, string> = {};
      for (const f of sourceFields) if (f.value !== null) values[f.shortName] = f.value;
      if (Object.keys(values).length) {
        await this.customFields.setValuesForInstance(COURSE_COMPONENT, COURSE_AREA, created.id, values);
      }
    }
    return this.getCourse(created.id);
  }

  async copyCourseContent(actorId: string, targetCourseId: string, input: {
    sourceCourseId: string; sectionIds?: string[]; moduleIds?: string[];
  }): Promise<{ sections: SectionRow[]; modules: CmRow[] }> {
    await this.getCourse(targetCourseId);
    await this.evaluator.requireCapability(actorId, 'course:update', await this.courseContextId(targetCourseId));
    await this.assertCanCopyFrom(actorId, input.sourceCourseId);
    const sectionIds = input.sectionIds ?? [];
    const moduleIds = input.moduleIds ?? [];
    if (!sectionIds.length && !moduleIds.length) {
      throw new BadRequestException({ message: 'Nothing selected to copy', code: 'course.copy_nothing_selected' });
    }
    const sourceSections = await this.repo.listSections(input.sourceCourseId);
    const selectedSections = sourceSections.filter((s) => sectionIds.includes(s.id));
    if (selectedSections.length !== new Set(sectionIds).size) {
      throw new BadRequestException({ message: 'Some sections do not belong to the source course', code: 'course.copy_section_mismatch' });
    }
    const sourceCms = await this.repo.listCms(input.sourceCourseId);
    const selectedCms = sourceCms.filter((c) => moduleIds.includes(c.id));
    if (selectedCms.length !== new Set(moduleIds).size) {
      throw new BadRequestException({ message: 'Some modules do not belong to the source course', code: 'course.copy_module_mismatch' });
    }
    const copiedSectionIds = new Set(selectedSections.map((s) => s.id));
    const looseCms = selectedCms.filter((c) => !copiedSectionIds.has(c.section));
    const cmMap = new Map<string, string>();
    const createdSections: SectionRow[] = [];
    const createdCms: CmRow[] = [];
    await this.repo.transaction(async (tx) => {
      const existing = await this.repo.listSections(targetCourseId);
      let nextNumber = existing.length ? Math.max(...existing.map((s) => s.section)) + 1 : 0;
      for (const s of [...selectedSections].sort((a, b) => a.section - b.section)) {
        const created = await this.copySectionRow(tx, s, targetCourseId, nextNumber++, 0, cmMap);
        createdSections.push(created);
      }
      const groups = new Map<string, CmRow[]>();
      for (const cm of looseCms) {
        const list = groups.get(cm.section) ?? [];
        list.push(cm);
        groups.set(cm.section, list);
      }
      for (const [sourceSectionId, cms] of groups) {
        const sourceSection = sourceSections.find((s) => s.id === sourceSectionId);
        if (!sourceSection) continue;
        const newSection = await this.repo.insertSection({
          course: targetCourseId, section: nextNumber++, name: sourceSection.name, summary: sourceSection.summary,
          visible: sourceSection.visible, availability: sourceSection.availability, openAt: sourceSection.openAt,
        }, tx);
        createdSections.push(newSection);
        for (const cm of cms) {
          createdCms.push(await this.copyCmRow(tx, cm, targetCourseId, newSection.id, 0, cmMap));
        }
      }
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'course', type: 'course_content_imported',
      payload: { courseId: targetCourseId, sourceCourseId: input.sourceCourseId, actorId, sections: createdSections.length, modules: createdCms.length },
    });
    return { sections: createdSections, modules: createdCms };
  }

  async duplicateSection(actorId: string, sectionId: string): Promise<SectionRow> {
    const section = await this.getSection(sectionId);
    await this.evaluator.requireCapability(actorId, 'course:update', await this.courseContextId(section.course));
    const cmMap = new Map<string, string>();
    let created!: SectionRow;
    await this.repo.transaction(async (tx) => {
      const handle = tx;
      await this.repo.shiftSections(handle, section.course, section.section + 1, 100000);
      await this.repo.shiftSections(handle, section.course, section.section + 1 + 100000, 1 - 100000);
      created = await this.copySectionRow(tx, section, section.course, section.section + 1, 0, cmMap);
      for (const [oldCmId, newCmId] of cmMap) {
        const items = await tx.selectFrom('grade_items').selectAll()
          .where('course_id', '=', section.course)
          .where('item_type', '=', 'mod')
          .where('item_instance', '=', oldCmId)
          .execute();
        for (const item of items) {
          await tx.insertInto('grade_items').values({
            course_id: section.course, item_name: item.item_name,
            item_type: item.item_type, item_module: item.item_module, item_instance: newCmId,
            grade_type: item.grade_type, grade_max: item.grade_max, grade_min: item.grade_min, grade_pass: item.grade_pass,
            id_number: null, multiplicator: item.multiplicator, plus_factor: item.plus_factor, hidden: item.hidden, locked: item.locked,
            sort_order: item.sort_order, posting_policy: item.posting_policy,
          }).execute();
        }
      }
    });
    return created;
  }

  async duplicateCm(actorId: string, cmId: string): Promise<CmRow> {
    const cm = await this.getCm(cmId);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courseContextId(cm.course));
    const cmMap = new Map<string, string>();
    let created!: CmRow;
    await this.repo.transaction(async (tx) => {
      await tx.updateTable('course_modules')
        .set({ sort_order: sql<number>`sort_order + 1` })
        .where('section', '=', cm.section)
        .where('sort_order', '>', cm.sortOrder)
        .execute();
      created = await this.copyCmRow(tx, { ...cm, sortOrder: cm.sortOrder + 1 }, cm.course, cm.section, 0, cmMap);
      const items = await tx.selectFrom('grade_items').selectAll()
        .where('course_id', '=', cm.course)
        .where('item_type', '=', 'mod')
        .where('item_instance', '=', cm.id)
        .execute();
      for (const item of items) {
        await tx.insertInto('grade_items').values({
          course_id: cm.course, item_name: item.item_name,
          item_type: item.item_type, item_module: item.item_module, item_instance: created.id,
          grade_type: item.grade_type, grade_max: item.grade_max, grade_min: item.grade_min, grade_pass: item.grade_pass,
          id_number: null, multiplicator: item.multiplicator, plus_factor: item.plus_factor, hidden: item.hidden, locked: item.locked,
          sort_order: item.sort_order, posting_policy: item.posting_policy,
        }).execute();
      }
    });
    return created;
  }

  async reorderSections(actorId: string, courseId: string, sectionIds: string[]): Promise<SectionRow[]> {
    await this.getCourse(courseId);
    await this.evaluator.requireCapability(actorId, 'course:update', await this.courseContextId(courseId));
    const existing = await this.repo.listSections(courseId);
    const existingIds = new Set(existing.map((s) => s.id));
    if (sectionIds.length !== existing.length || !sectionIds.every((id) => existingIds.has(id))) {
      throw new BadRequestException({ message: 'Reorder list must contain every section of the course exactly once', code: 'course.reorder_sections_mismatch' });
    }
    await this.repo.transaction(async (tx) => {
      const handle = tx;
      await this.repo.shiftSections(handle, courseId, 0, 100000);
      for (const [i, id] of sectionIds.entries()) {
        await tx.updateTable('course_sections').set({ section: i, updated_at: new Date() }).where('id', '=', id).execute();
      }
    });
    return this.repo.listSections(courseId);
  }

  async reorderModules(actorId: string, sectionId: string, moduleIds: string[]): Promise<CmRow[]> {
    const section = await this.getSection(sectionId);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courseContextId(section.course));
    const existing = await this.repo.listCmsInSection(sectionId);
    const existingIds = new Set(existing.map((c) => c.id));
    if (moduleIds.length !== existing.length || !moduleIds.every((id) => existingIds.has(id))) {
      throw new BadRequestException({ message: 'Reorder list must contain every module of the section exactly once', code: 'course.reorder_modules_mismatch' });
    }
    await this.repo.transaction(async (tx) => {
      for (const [i, id] of moduleIds.entries()) {
        await tx.updateTable('course_modules').set({ sort_order: i }).where('id', '=', id).execute();
      }
    });
    return this.repo.listCmsInSection(sectionId);
  }

  async applyBookFrame(actorId: string, courseId: string, input: {
    bookId: string; chapterNodeIds: string[]; insertAtSection?: number;
  }): Promise<(SectionRow & { bookFrame: SectionBookFrameView })[]> {
    await this.getCourse(courseId);
    await this.evaluator.requireCapability(actorId, 'course:update', await this.courseContextId(courseId));
    if (!this.bookFrameProvider) {
      throw new BadRequestException({ message: 'Book frame provider is not registered', code: 'course.book_frame_provider_missing' });
    }
    const units = await this.bookFrameProvider.getBookFrameUnits(actorId, input.bookId);
    const wanted = new Set(input.chapterNodeIds);
    const selected = units.filter((u) => wanted.has(u.chapterNodeId));
    if (selected.length !== wanted.size) {
      const found = new Set(selected.map((u) => u.chapterNodeId));
      const missing = input.chapterNodeIds.filter((id) => !found.has(id));
      throw new BadRequestException({
        message: `Book chapters not selectable in this book: ${missing.join(', ')}`,
        code: 'course.book_chapter_not_selectable',
      });
    }
    const existing = await this.repo.listSections(courseId);
    const maxSection = existing.length ? Math.max(...existing.map((s) => s.section)) : -1;
    const insertAt = input.insertAtSection ?? maxSection + 1;
    if (insertAt > maxSection + 1) {
      throw new BadRequestException({
        message: `insertAtSection ${insertAt} is beyond the end of the outline`,
        code: 'course.book_frame_insert_beyond_end',
      });
    }
    const count = selected.length;
    const created: (SectionRow & { bookFrame: SectionBookFrameView })[] = [];
    await this.repo.transaction(async (tx) => {
      const handle = tx;
      if (input.insertAtSection !== undefined && insertAt <= maxSection) {
        await this.repo.shiftSections(handle, courseId, insertAt, 100000);
        await this.repo.shiftSections(handle, courseId, insertAt + 100000, count - 100000);
      }
      for (const [i, unit] of selected.entries()) {
        const section = await this.repo.insertSection({
          course: courseId, section: insertAt + i, name: unit.title, summary: '', visible: true,
        }, handle);
        const anchor = await this.repo.insertSectionBookAnchor({
          sectionId: section.id, bookNodeId: unit.chapterNodeId, bookId: input.bookId, nodeTitle: unit.title,
        }, handle);
        const items: SectionBookFrameView['items'] = [];
        for (const [j, item] of unit.items.entries()) {
          const itemRow = await this.repo.insertSectionBookItem({
            anchorId: anchor.id, bookNodeId: item.lessonNodeId, title: item.title, position: j + 1,
          }, handle);
          await this.repo.insertSectionBookItemOutcomes(
            item.outcomes.map((o, k) => ({ itemId: itemRow.id, outcomeId: o.outcomeId, content: o.content, position: k + 1 })),
            handle,
          );
          items.push({
            nodeId: item.lessonNodeId, title: item.title,
            outcomes: item.outcomes.map((o) => ({ outcomeId: o.outcomeId, content: o.content })),
          });
        }
        created.push({
          ...section,
          bookFrame: { nodeId: unit.chapterNodeId, bookId: input.bookId, nodeTitle: unit.title, items },
        });
      }
    });
    return created;
  }

  async getCourseContent(userId: string, courseId: string): Promise<CourseContentView> {
    const courseRow = await this.assertCourseAccess(userId, courseId);
    const sections = await this.repo.listSections(courseId);
    const cms = await this.repo.listCms(courseId);
    const anchors = await this.repo.listAnchorsForSections(sections.map((s) => s.id));
    const anchorOutcomes = await this.repo.listAnchorOutcomes(anchors.map((a) => a.id));
    const frameBySection = new Map<string, SectionFrameView>();
    for (const anchor of anchors) {
      frameBySection.set(anchor.sectionId, {
        nodeId: anchor.nodeId, nodeTitle: anchor.nodeTitle,
        outcomes: anchorOutcomes.filter((o) => o.anchorId === anchor.id)
          .map((o) => ({ outcomeId: o.outcomeId, content: o.content })),
      });
    }
    const bookAnchors = await this.repo.listBookAnchorsForSections(sections.map((s) => s.id));
    const bookItems = await this.repo.listBookItems(bookAnchors.map((a) => a.id));
    const bookItemOutcomes = await this.repo.listBookItemOutcomes(bookItems.map((i) => i.id));
    const bookFrameBySection = new Map<string, SectionBookFrameView>();
    for (const anchor of bookAnchors) {
      bookFrameBySection.set(anchor.sectionId, {
        nodeId: anchor.bookNodeId, bookId: anchor.bookId, nodeTitle: anchor.nodeTitle,
        items: bookItems.filter((i) => i.anchorId === anchor.id).map((i) => ({
          nodeId: i.bookNodeId, title: i.title,
          outcomes: bookItemOutcomes.filter((o) => o.itemId === i.id)
            .map((o) => ({ outcomeId: o.outcomeId, content: o.content })),
        })),
      });
    }
    const canSeeHidden = await this.canViewHiddenActivities(userId, courseId);
    const grades = this.gradeProvider ? await this.gradesForAvailability(userId, courseId) : undefined;
    const now = new Date();
    const outSections: CourseContentView['sections'] = [];
    for (const section of sections) {
      const sAccess = await this.checkSectionAccess(userId, section, grades);
      if (!sAccess.visible && !canSeeHidden) continue;
      const modules: CourseContentView['sections'][number]['modules'] = [];
      for (const cm of cms.filter((c) => c.section === section.id)) {
        const access = await this.checkCmAccess(userId, cm, grades);
        if (!access.visible && !canSeeHidden) continue;
        modules.push({ ...cm, status: courseItemStatus(cm.visible, cm.openAt, now), contextId: await this.cmContextId(cm.id), availabilityResult: access });
      }
      outSections.push({ ...section, status: courseItemStatus(section.visible, section.openAt, now), availabilityResult: sAccess, frame: frameBySection.get(section.id) ?? null, bookFrame: bookFrameBySection.get(section.id) ?? null, modules });
    }
    return {
      course: courseRow,
      contextId: await this.courseContextId(courseId),
      customFields: await this.getCourseCustomFields(courseId),
      sections: outSections,
    };
  }
}
