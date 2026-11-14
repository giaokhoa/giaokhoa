import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { badRequest, forbidden, notFound } from '../../common/http-errors';
import { I18nService } from '@nestjs/i18n';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { sql, type CentreTx } from '@giaokhoa/db';
import { CompletionRepository, type CourseCompletionRow } from '@giaokhoa/db/repositories/completion';
import { OutboxService, type OutboxEventInput } from '../../infra/events/outbox.service';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { RolesService } from '../access/roles.service';
import { AvailabilityService } from '../availability/availability.service';
import { CoursesService } from '../courses/courses.service';
import { ENROL_WITHDRAWN, EnrolService } from '../enrol/enrol.service';
import { tenantAls } from '../tenants/tenant-als';
import { backgroundJobContext, backgroundJobId } from '../../db/routing/background-job-context';

export const COMPLETION_INCOMPLETE = 0;
export const COMPLETION_COMPLETE = 1;
export const COMPLETION_COMPLETE_PASS = 2;
export const COMPLETION_COMPLETE_FAIL = 3;
export const COMPLETION_QUEUE = 'completion-recalculate';
export const AGGREGATION_ALL = 1;
export const AGGREGATION_ANY = 2;

@Injectable()
export class CompletionService implements OnModuleInit {
  private readonly logger = new Logger(CompletionService.name);
  private gradeEvaluator?: (cmId: string, userId: string) => Promise<number | null>;
  private courseGradeChecker?: (courseId: string, userId: string) => Promise<boolean>;

  registerGradeEvaluator(fn: (cmId: string, userId: string) => Promise<number | null>): void {
    this.gradeEvaluator = fn;
  }

  private readonly cmCompletionHooks: ((e: { cmId: string; courseId: string; userId: string; state: number }) => Promise<void>)[] = [];
  private readonly courseCompletionHooks: ((e: { courseId: string; userId: string }) => Promise<void>)[] = [];
  registerCmCompletionHook(fn: (e: { cmId: string; courseId: string; userId: string; state: number }) => Promise<void>): void {
    this.cmCompletionHooks.push(fn);
  }
  registerCourseCompletionHook(fn: (e: { courseId: string; userId: string }) => Promise<void>): void {
    this.courseCompletionHooks.push(fn);
  }
  private async fireCmCompletion(cmId: string, courseId: string, userId: string, state: number): Promise<void> {
    if (state === COMPLETION_INCOMPLETE) return;
    for (const hook of this.cmCompletionHooks) {
      await hook({ cmId, courseId, userId, state }).catch((err) => this.logger.warn(`cm completion hook failed: ${String(err)}`));
    }
  }
  registerCourseGradeChecker(fn: (courseId: string, userId: string) => Promise<boolean>): void {
    this.courseGradeChecker = fn;
  }

  constructor(
    private readonly repo: CompletionRepository,
    private readonly courses: CoursesService,
    private readonly enrol: EnrolService,
    private readonly roles: RolesService,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly availability: AvailabilityService,
    private readonly outbox: OutboxService,
    private readonly i18n: I18nService,
    @InjectQueue(COMPLETION_QUEUE) private readonly recalcQueue: Queue,
  ) {}

  private async enqueueOutboxInTx(tx: CentreTx, input: OutboxEventInput): Promise<void> {
    const tenantId = input.tenantId ?? tenantAls.getStore()?.tenantId ?? null;
    const payload = tenantId && input.payload['tenantId'] === undefined
      ? { ...input.payload, tenantId }
      : input.payload;
    await tx
      .insertInto('outbox_events')
      .values({
        aggregate: input.aggregate,
        type: input.type,
        payload: sql`${JSON.stringify(payload)}::jsonb`,
        tenant_id: tenantId,
      })
      .execute();
  }

  onModuleInit(): void {
    this.availability.register('completion', async (leaf, ctx) => {
      const cmId = String(leaf.id ?? leaf.cmid ?? leaf.cm ?? '');
      if (!cmId) return { available: false, description: this.i18n.t('availability.completionMissingCm') };
      const row = await this.repo.getCmCompletion(cmId, ctx.userId);
      const state = Number(leaf.state ?? COMPLETION_COMPLETE);
      const available = !!row && row.completionState >= state && row.completionState !== COMPLETION_INCOMPLETE;
      return { available, description: this.i18n.t('availability.activityMustComplete', { args: { cmId } }) };
    });
  }


  async computeCmState(cmId: string, userId: string): Promise<number> {
    const cm = await this.courses.getCm(cmId);
    const row = await this.repo.getCmCompletion(cmId, userId);
    if (cm.completion === 0) return row?.completionState ?? COMPLETION_INCOMPLETE;
    if (cm.completionManual || cm.completion === 1) {
      return row?.completionState ?? COMPLETION_INCOMPLETE;
    }
    let gradeState: number | null = null;
    if (cm.completionUseGrade) {
      gradeState = this.gradeEvaluator ? await this.gradeEvaluator(cmId, userId) : null;
      if (gradeState === null) return COMPLETION_INCOMPLETE;
      if (gradeState === COMPLETION_COMPLETE_FAIL) return COMPLETION_COMPLETE_FAIL;
    }
    if (cm.completionView && !row?.viewed) return COMPLETION_INCOMPLETE;
    if (cm.completionExpected && new Date() < cm.completionExpected) return COMPLETION_INCOMPLETE;
    if (gradeState !== null) return gradeState;
    const anyCriterion = cm.completionView || !!cm.completionExpected;
    return anyCriterion ? COMPLETION_COMPLETE : (row?.completionState ?? COMPLETION_INCOMPLETE);
  }

  async refreshGradeCompletion(cmId: string, userId: string): Promise<void> {
    const cm = await this.courses.getCm(cmId).catch(() => undefined);
    if (!cm || cm.completion === 0 || !cm.completionUseGrade) return;
    const state = await this.computeCmState(cmId, userId);
    const existing = await this.repo.getCmCompletion(cmId, userId);
    if (existing && existing.completionState === state) return;
    await this.repo.transaction(async (tx) => {
      await this.repo.upsertCmCompletion({
        courseModuleId: cmId, userId: userId, completionState: state,
        viewed: existing?.viewed ?? false, overrideBy: existing?.overrideBy ?? null,
      }, tx);
      await this.enqueueOutboxInTx(tx, {
        aggregate: 'completion', type: 'cm_completion_changed',
        payload: { cmId, courseId: cm.course, userId, state, via: 'grade' },
      });
    });
    await this.fireCmCompletion(cmId, cm.course, userId, state);
    await this.reaggregateCourseCompletion(userId, cm.course);
  }

  private async refreshCmState(cmId: string, userId: string): Promise<number> {
    const state = await this.computeCmState(cmId, userId);
    const cm = await this.courses.getCm(cmId).catch(() => undefined);
    if (cm && cm.completion !== 0) {
      const existing = await this.repo.getCmCompletion(cmId, userId);
      if (!cm.completionManual) {
        await this.repo.upsertCmCompletion({ courseModuleId: cmId, userId: userId, completionState: state, viewed: existing?.viewed ?? false, overrideBy: existing?.overrideBy ?? null });
      }
    }
    return state;
  }

  @OnEvent('cm_viewed')
  async onCmViewed(payload: { cmId: string; courseId: string; userId: string }): Promise<void> {
    const cm = await this.courses.getCm(payload.cmId).catch(() => undefined);
    if (!cm || cm.completion === 0) return;
    const existing = await this.repo.getCmCompletion(payload.cmId, payload.userId);
    await this.repo.upsertCmCompletion({
      courseModuleId: payload.cmId, userId: payload.userId,
      completionState: existing?.completionState ?? COMPLETION_INCOMPLETE,
      viewed: true, overrideBy: existing?.overrideBy ?? null,
    });
    const state = await this.refreshCmState(payload.cmId, payload.userId);
    await this.fireCmCompletion(payload.cmId, payload.courseId, payload.userId, state);
    await this.reaggregateCourseCompletion(payload.userId, payload.courseId);
  }

  @OnEvent('cm_deleted')
  async onCmDeleted(payload: { cmId: string; courseId: string }): Promise<void> {
    const removed = await this.repo.deleteCmCompletionsForCm(payload.cmId);
    if (removed) this.logger.log(`cm_deleted: removed ${removed} completion record(s) for cm ${payload.cmId}`);
  }

  async getCmCompletion(cmId: string, userId: string): Promise<{ cmId: string; userId: string; state: number; viewed: boolean }> {
    const row = await this.repo.getCmCompletion(cmId, userId);
    const state = await this.computeCmState(cmId, userId).catch(() => row?.completionState ?? 0);
    return { cmId, userId, state: row && row.completionState !== COMPLETION_INCOMPLETE ? row.completionState : state, viewed: row?.viewed ?? false };
  }

  async listCmCompletionsForCourse(courseId: string, userId: string): Promise<{ cmId: string; state: number; viewed: boolean }[]> {
    const cms = await this.courses.listCms(courseId);
    const rows = await this.repo.listCmCompletionsForUser(userId, cms.map((c) => c.id));
    return cms.map((cm) => {
      const row = rows.find((r) => r.courseModuleId === cm.id);
      return { cmId: cm.id, state: row?.completionState ?? COMPLETION_INCOMPLETE, viewed: row?.viewed ?? false };
    });
  }

  async markManual(actorId: string, cmId: string, targetUserId: string, complete: boolean): Promise<{ cmId: string; userId: string; state: number }> {
    const cm = await this.courses.getCm(cmId);
    if (cm.completion === 0) badRequest('Completion tracking is not enabled for this activity', 'completion.not_enabled');
    if (!cm.completionManual && cm.completion !== 1) {
      badRequest('This activity does not use manual completion', 'completion.not_manual');
    }
    if (actorId !== targetUserId) {
      await this.evaluator.requireCapability(actorId, 'completion:markothers', await this.courses.courseContextId(cm.course));
    } else {
      await this.courses.assertCourseAccess(actorId, cm.course);
    }
    const existing = await this.repo.getCmCompletion(cmId, targetUserId);
    const state = complete ? COMPLETION_COMPLETE : COMPLETION_INCOMPLETE;
    await this.repo.transaction(async (tx) => {
      await this.repo.upsertCmCompletion({
        courseModuleId: cmId, userId: targetUserId, completionState: state,
        viewed: existing?.viewed ?? false, overrideBy: actorId !== targetUserId ? actorId : null,
      }, tx);
      await this.enqueueOutboxInTx(tx, {
        aggregate: 'completion', type: 'cm_completion_changed',
        payload: { cmId, courseId: cm.course, userId: targetUserId, state, manual: true },
      });
    });
    await this.fireCmCompletion(cmId, cm.course, targetUserId, state);
    await this.reaggregateCourseCompletion(targetUserId, cm.course);
    return { cmId, userId: targetUserId, state };
  }


  async setCriteria(actorId: string, courseId: string, input: {
    method?: number;
    criteria: {
      criteriaType: string; moduleInstance?: string; date?: string;
      courseInstance?: string; enrolPeriodDays?: number; roleId?: string;
    }[];
  }): Promise<{ method: number; criteria: unknown[] }> {
    await this.courses.getCourse(courseId);
    await this.evaluator.requireCapability(actorId, 'completion:manage', await this.courses.courseContextId(courseId));
    const method = input.method ?? AGGREGATION_ALL;
    if (![AGGREGATION_ALL, AGGREGATION_ANY].includes(method)) {
      badRequest(`Unknown aggregation method ${method}`, 'completion.bad_method');
    }
    for (const c of input.criteria) {
      if (!['module', 'date', 'grade', 'self', 'course', 'duration', 'role', 'unenrol'].includes(c.criteriaType)) {
        badRequest(`Unknown criteria type ${c.criteriaType}`, 'completion.bad_criteria_type');
      }
      if (c.criteriaType === 'module' && !c.moduleInstance) {
        badRequest('Module criteria require moduleInstance (a cm id)', 'completion.criteria_cm_required');
      }
      if (c.criteriaType === 'date' && !c.date) {
        badRequest('Date criteria require a date', 'completion.criteria_date_required');
      }
      if (c.criteriaType === 'course') {
        if (!c.courseInstance) {
          badRequest('Course criteria require courseInstance (the prerequisite course id)', 'completion.criteria_course_required');
        }
        if (c.courseInstance === courseId) {
          badRequest('A course cannot be its own completion prerequisite', 'completion.criteria_course_self_reference');
        }
        await this.courses.getCourse(c.courseInstance).catch(() => {
          badRequest(`Prerequisite course ${c.courseInstance} does not exist`, 'completion.criteria_course_not_found');
        });
      }
      if (c.criteriaType === 'duration' && (c.enrolPeriodDays === undefined || c.enrolPeriodDays === null)) {
        badRequest('Duration criteria require enrolPeriodDays (days after enrolment)', 'completion.criteria_duration_required');
      }
      if (c.criteriaType === 'role') {
        if (!c.roleId) {
          badRequest('Role criteria require roleId (the role allowed to mark completion)', 'completion.criteria_role_required');
        }
        await this.roles.getRole(c.roleId).catch(() => {
          badRequest(`Role ${c.roleId} does not exist`, 'completion.criteria_role_not_found');
        });
      }
    }
    const existing = await this.repo.listCriteria(courseId);
    const hadData = (await this.repo.listCourseCompletions(courseId)).length > 0;
    for (const old of existing) await this.repo.deleteCriteria(old.id);
    let sortOrder = 0;
    for (const c of input.criteria) {
      await this.repo.insertCriteria({
        course: courseId, criteriaType: c.criteriaType,
        moduleInstance: c.moduleInstance ?? null,
        date: c.date ? new Date(c.date) : null,
        courseInstance: c.courseInstance ?? null,
        enrolPeriodDays: c.enrolPeriodDays ?? null,
        roleId: c.roleId ?? null,
        sortOrder: sortOrder++,
      });
    }
    await this.repo.setSettings(courseId, method);
    if (hadData || existing.length) {
      const completions = await this.repo.listCourseCompletions(courseId);
      for (const cc of completions) {
        await this.repo.upsertCourseCompletion({ ...cc, reAggregate: new Date() });
      }


      await this.recalcQueue.add('recalculate', { courseId, ...backgroundJobContext() }, { jobId: backgroundJobId(`completion-recalc-${courseId}-${randomUUID()}`), attempts: 3 });
      await this.outbox.enqueueStandalone({ aggregate: 'completion', type: 'completion_criteria_changed', payload: { courseId, reAggregate: true } });
    }
    return { method, criteria: await this.repo.listCriteria(courseId) };
  }

  async getCriteria(actorId: string, courseId: string): Promise<{ method: number; criteria: unknown[] }> {
    await this.courses.assertCourseAccess(actorId, courseId);
    const settings = await this.repo.getSettings(courseId);
    return { method: settings.method, criteria: await this.repo.listCriteria(courseId) };
  }

  async evaluateCriteria(courseId: string, userId: string, now = new Date()): Promise<{ results: boolean[]; complete: boolean; method: number }> {
    const criteria = await this.repo.listCriteria(courseId);
    const { method } = await this.repo.getSettings(courseId);
    const manualIds = criteria.filter((c) => c.criteriaType === 'self' || c.criteriaType === 'role').map((c) => c.id);
    const marks = manualIds.length ? await this.repo.listCritComplForUser(manualIds, userId) : [];
    const markedCriteria = new Set(marks.map((m) => m.criteriaId));
    const needsEnrolments = criteria.some((c) => c.criteriaType === 'duration');
    const enrolments = needsEnrolments ? await this.enrol.listEnrolmentsForCourse(courseId) : [];
    const enrolAnchor = enrolments
      .filter((e) => e.userId === userId && e.status !== ENROL_WITHDRAWN)
      .reduce<Date | null>((min, e) => (min === null || e.timeStart < min ? e.timeStart : min), null);
    const results: boolean[] = [];
    for (const c of criteria) {
      if (c.criteriaType === 'module' && c.moduleInstance) {
        const row = await this.repo.getCmCompletion(c.moduleInstance, userId);
        results.push(!!row && row.completionState !== COMPLETION_INCOMPLETE);
      } else if (c.criteriaType === 'date' && c.date) {
        results.push(now >= c.date);
      } else if (c.criteriaType === 'grade') {
        results.push(this.courseGradeChecker ? await this.courseGradeChecker(courseId, userId) : false);
      } else if (c.criteriaType === 'self' || c.criteriaType === 'role') {
        results.push(markedCriteria.has(c.id));
      } else if (c.criteriaType === 'course' && c.courseInstance) {
        const prereq = await this.repo.getCourseCompletion(userId, c.courseInstance);
        results.push(prereq?.status === 'complete');
      } else if (c.criteriaType === 'duration' && c.enrolPeriodDays !== null && c.enrolPeriodDays !== undefined) {
        results.push(!!enrolAnchor && enrolAnchor.getTime() + c.enrolPeriodDays * 86_400_000 <= now.getTime());
      } else if (c.criteriaType === 'unenrol') {
        results.push(!(await this.enrol.isEnrolled(courseId, userId)));
      } else {
        results.push(false);
      }
    }
    const complete = criteria.length === 0 ? false
      : method === AGGREGATION_ANY ? results.some(Boolean) : results.every(Boolean);
    return { results, complete, method };
  }

  async reaggregateCourseCompletion(userId: string, courseId: string): Promise<CourseCompletionRow> {
    const existing = await this.repo.getCourseCompletion(userId, courseId);
    const { complete } = await this.evaluateCriteria(courseId, userId);
    const criteria = await this.repo.listCriteria(courseId);
    let status = existing?.status ?? 'not_started';
    if (complete) status = 'complete';
    else if (criteria.length && (existing?.timeStarted || (await this.hasStarted(userId, courseId)))) status = 'in_progress';
    const row = await this.repo.upsertCourseCompletion({
      userId: userId, course: courseId, status,
      timeEnrolled: existing?.timeEnrolled ?? new Date(),
      timeStarted: status === 'not_started' ? null : (existing?.timeStarted ?? new Date()),
      timeCompleted: complete ? (existing?.timeCompleted ?? new Date()) : null,
    });
    if (complete && existing?.status !== 'complete') {
      await this.outbox.enqueueStandalone({
        aggregate: 'completion', type: 'course_completed',
        payload: { courseId, userId, actorId: userId },
      });
      for (const hook of this.courseCompletionHooks) {
        await hook({ courseId, userId }).catch((err) => this.logger.warn(`course completion hook failed: ${String(err)}`));
      }
      const dependentIds = await this.repo.listDependentCourseIds(courseId);
      for (const dependentId of dependentIds) {
        if (dependentId === courseId) continue;
        await this.recalculateCourse(dependentId)
          .catch((err) => this.logger.warn(`dependent course reaggregation failed for ${dependentId}: ${String(err)}`));
      }
    }
    return row;
  }


  async markSelfCompletion(actorId: string, courseId: string, complete: boolean): Promise<{ courseId: string; userId: string; complete: boolean; status: string }> {
    await this.courses.getCourse(courseId);
    await this.courses.assertCourseAccess(actorId, courseId);
    const selfCriteria = (await this.repo.listCriteria(courseId)).filter((c) => c.criteriaType === 'self');
    if (!selfCriteria.length) {
      badRequest('This course has no self completion criterion', 'completion.no_self_criterion');
    }
    for (const c of selfCriteria) {
      if (complete) await this.repo.upsertCritCompl({ criteriaId: c.id, userId: actorId, markedBy: actorId });
      else await this.repo.deleteCritCompl(c.id, actorId);
    }
    const row = await this.reaggregateCourseCompletion(actorId, courseId);
    return { courseId, userId: actorId, complete, status: row.status };
  }

  async markCriterionByRole(actorId: string, courseId: string, criteriaId: string, targetUserId: string, complete: boolean): Promise<{ courseId: string; criteriaId: string; userId: string; complete: boolean; status: string }> {
    await this.courses.getCourse(courseId);
    const criterion = await this.repo.getCriteria(criteriaId);
    if (!criterion || criterion.course !== courseId || criterion.criteriaType !== 'role' || !criterion.roleId) {
      badRequest('Criterion is not a role criterion of this course', 'completion.criteria_not_role');
    }
    const contextId = await this.courses.courseContextId(courseId);
    const courseContext = await this.contexts.getContext(contextId);
    const pathIds = (await this.contexts.getPathContexts(courseContext)).map((c) => c.id);
    const assignments = await this.roles.listAssignmentsInContexts(actorId, pathIds);
    if (!assignments.some((a) => a.roleId === criterion.roleId)) {
      forbidden('Only holders of the role named by this criterion may mark completion', 'completion.role_marker_forbidden');
    }
    if (complete) await this.repo.upsertCritCompl({ criteriaId, userId: targetUserId, markedBy: actorId });
    else await this.repo.deleteCritCompl(criteriaId, targetUserId);
    const row = await this.reaggregateCourseCompletion(targetUserId, courseId);
    return { courseId, criteriaId, userId: targetUserId, complete, status: row.status };
  }
  private async hasStarted(userId: string, courseId: string): Promise<boolean> {
    const cms = await this.courses.listCms(courseId);
    return this.repo.hasAnyCmCompletion(userId, cms.map((c) => c.id));
  }

  async recalculateCourse(courseId: string): Promise<{ courseId: string; users: number }> {
    const enrolments = await this.enrol.listEnrolmentsForCourse(courseId);
    const userIds = [...new Set(enrolments.map((e) => e.userId))];
    for (const cc of await this.repo.listCourseCompletions(courseId)) {
      if (!userIds.includes(cc.userId)) userIds.push(cc.userId);
    }
    for (const userId of userIds) await this.reaggregateCourseCompletion(userId, courseId);
    return { courseId, users: userIds.length };
  }

  async getCourseCompletion(userId: string, courseId: string): Promise<CourseCompletionRow> {
    const existing = await this.repo.getCourseCompletion(userId, courseId);
    if (existing) return existing;
    return this.reaggregateCourseCompletion(userId, courseId);
  }
  async listCourseCompletions(courseId: string): Promise<CourseCompletionRow[]> {
    return this.repo.listCourseCompletions(courseId);
  }

  async requireCompletionManage(actorId: string, courseId: string): Promise<void> {
    await this.evaluator.requireCapability(actorId, 'completion:manage', await this.courses.courseContextId(courseId));
  }
  notFound(): never { notFound('Completion record not found', 'completion.not_found'); }
  forbidden(msg: string): never { forbidden(msg, 'completion.forbidden'); }
}
