import { Injectable, OnModuleInit } from '@nestjs/common';
import { badRequest, forbidden, notFound } from '../../common/http-errors';
import { I18nService } from '@nestjs/i18n';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OutboxService } from '../../infra/events/outbox.service';
import { ContextsService } from '../access/contexts.service';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { RoleSeparationService } from '../access/role-separation.service';
import { AvailabilityService } from '../availability/availability.service';
import { CoursesService, GROUPMODE_SEPARATEGROUPS } from '../courses/courses.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import { TenantsService } from '../tenants/tenants.service';
import { type CentreTx } from '@giaokhoa/db';
import { GroupsRepository, type CohortRow, type GroupRow, type GroupingRow } from '@giaokhoa/db/repositories/groups';

@Injectable()
export class GroupsService implements OnModuleInit {
  constructor(
    private readonly repo: GroupsRepository,
    private readonly courses: CoursesService,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly availability: AvailabilityService,
    private readonly outbox: OutboxService,
    private readonly emitter: EventEmitter2,
    private readonly i18n: I18nService,
    private readonly tenantContext: TenantContextService,
    private readonly tenants: TenantsService,
    private readonly roleSeparation: RoleSeparationService,
  ) {}

  private async cohortTenantId(categoryId?: string): Promise<string> {
    if (categoryId !== undefined) return (await this.courses.getCategory(categoryId)).tenantId;
    return this.tenantContext.currentTenantId() ?? (await this.tenants.fallbackTenantId());
  }

  onModuleInit(): void {
    this.availability.register('group', async (leaf, ctx) => {
      const groupId = String(leaf.id ?? leaf.groupId ?? '');
      const member = groupId ? await this.repo.isMember(groupId, ctx.userId) : false;
      return { available: member, description: this.i18n.t('availability.mustBeInGroup', { args: { groupId } }) };
    });
    this.availability.register('grouping', async (leaf, ctx) => {
      const groupingId = String(leaf.id ?? leaf.groupingId ?? '');
      if (!groupingId) return { available: false, description: this.i18n.t('availability.groupingMissingId') };
      const groups = await this.repo.groupsInGrouping(groupingId);
      for (const g of groups) {
        if (await this.repo.isMember(g.id, ctx.userId)) return { available: true, description: this.i18n.t('availability.inGrouping', { args: { groupingId } }) };
      }
      return { available: false, description: this.i18n.t('availability.mustBeInGrouping', { args: { groupingId } }) };
    });
  }

  private async requireManageGroups(actorId: string, courseId: string): Promise<void> {
    await this.evaluator.requireCapability(actorId, 'course:managegroups', await this.courses.courseContextId(courseId));
  }

  async canManageGroups(actorId: string, courseId: string): Promise<boolean> {
    return this.evaluator.hasCapability(actorId, 'course:managegroups', await this.courses.courseContextId(courseId));
  }

  private hideGroupKey(group: GroupRow): GroupRow {
    return group.enrolmentKey ? { ...group, enrolmentKey: null } : group;
  }

  async createGroup(actorId: string, courseId: string, input: { name: string; idNumber?: string; description?: string; enrolmentKey?: string }): Promise<GroupRow> {
    await this.courses.getCourse(courseId);
    await this.requireManageGroups(actorId, courseId);
    const row = await this.repo.insertGroup({ courseId: courseId, name: input.name, idNumber: input.idNumber ?? '', description: input.description ?? '', enrolmentKey: input.enrolmentKey ?? null });
    await this.outbox.enqueueStandalone({ aggregate: 'group', type: 'group_created', payload: { groupId: row.id, courseId } });
    return row;
  }
  async getGroup(id: string): Promise<GroupRow> {
    const row = await this.repo.getGroup(id);
    if (!row) notFound(`Group ${id} not found`, 'group.not_found');
    return row;
  }
  async updateGroup(actorId: string, id: string, input: { name?: string; idNumber?: string; description?: string; enrolmentKey?: string | null }): Promise<GroupRow> {
    const group = await this.getGroup(id);
    await this.requireManageGroups(actorId, group.courseId);
    const { enrolmentKey, ...rest } = input;
    await this.repo.updateGroup(id, { ...rest, ...(enrolmentKey !== undefined ? { enrolmentKey: enrolmentKey } : {}) });
    return this.getGroup(id);
  }
  async deleteGroup(actorId: string, id: string): Promise<void> {
    const group = await this.getGroup(id);
    await this.requireManageGroups(actorId, group.courseId);
    await this.repo.deleteGroup(id);
    await this.outbox.enqueueStandalone({ aggregate: 'group', type: 'group_deleted', payload: { groupId: id, courseId: group.courseId } });
  }

  async canSeeAllGroups(actorId: string, courseId: string): Promise<boolean> {
    if (await this.evaluator.isSiteAdmin(actorId)) return true;
    const ctxId = await this.courses.courseContextId(courseId);
    if (await this.evaluator.hasCapability(actorId, 'group:accessallgroups', ctxId)) return true;
    return this.evaluator.hasCapability(actorId, 'course:managegroups', ctxId);
  }

  effectiveGroupMode(courseRow: { groupMode: number; groupModeForce: boolean }, cmGroupMode?: number): number {
    if (courseRow.groupModeForce) return courseRow.groupMode;
    return cmGroupMode !== undefined && cmGroupMode !== 0 ? cmGroupMode : courseRow.groupMode;
  }

  async visibleGroupsFor(actorId: string, courseId: string, cmGroupMode?: number): Promise<GroupRow[]> {
    const courseRow = await this.courses.getCourse(courseId);
    const all = await this.repo.listGroups(courseId);
    const effectiveMode = this.effectiveGroupMode(courseRow, cmGroupMode);
    if (effectiveMode !== GROUPMODE_SEPARATEGROUPS) return all;
    if (await this.canSeeAllGroups(actorId, courseId)) return all;
    return this.repo.groupsOfUser(courseId, actorId);
  }

  async listGroups(actorId: string, courseId: string): Promise<GroupRow[]> {
    await this.courses.assertCourseAccess(actorId, courseId).catch(async () => {
      await this.requireManageGroups(actorId, courseId);
    });
    const groups = await this.visibleGroupsFor(actorId, courseId);
    if (await this.canManageGroups(actorId, courseId)) return groups;
    return groups.map((g) => this.hideGroupKey(g));
  }

  async groupsForCourseInternal(courseId: string): Promise<GroupRow[]> {
    return this.repo.listGroups(courseId);
  }

  async addMember(actorId: string, groupId: string, userId: string): Promise<void> {
    const group = await this.getGroup(groupId);
    await this.requireManageGroups(actorId, group.courseId);
    if (!(await this.courses.isActivelyEnrolled(group.courseId, userId))) {
      badRequest('User is not actively enrolled in this course', 'group.member_not_enrolled');
    }
    await this.repo.addMember(groupId, userId);
    await this.outbox.enqueueStandalone({ aggregate: 'group', type: 'group_member_added', payload: { groupId, courseId: group.courseId, userId } });
  }
  async removeMember(actorId: string, groupId: string, userId: string): Promise<void> {
    const group = await this.getGroup(groupId);
    await this.requireManageGroups(actorId, group.courseId);
    await this.repo.removeMember(groupId, userId);
    await this.outbox.enqueueStandalone({ aggregate: 'group', type: 'group_member_removed', payload: { groupId, courseId: group.courseId, userId } });
  }

  async listMembers(actorId: string, groupId: string): Promise<{ userId: string; timeAdded: Date }[]> {
    const group = await this.getGroup(groupId);
    const visible = await this.visibleGroupsFor(actorId, group.courseId);
    if (!visible.some((g) => g.id === groupId)) {
      forbidden('Separate groups: you cannot see members of a group you are not in', 'group.separate_groups_denied');
    }
    const rows = await this.repo.listMembers(groupId);
    return rows.map((r) => ({ userId: r.userId, timeAdded: r.timeAdded }));
  }

  async listVisibleMembers(actorId: string, courseId: string): Promise<{ groupId: string; userId: string }[]> {
    const visible = await this.visibleGroupsFor(actorId, courseId);
    const rows = await this.repo.listMembersOfGroups(visible.map((g) => g.id));
    return rows.map((r) => ({ groupId: r.groupId, userId: r.userId }));
  }

  async groupsOfUser(courseId: string, userId: string): Promise<GroupRow[]> { return this.repo.groupsOfUser(courseId, userId); }
  async isMember(groupId: string, userId: string): Promise<boolean> { return this.repo.isMember(groupId, userId); }
  async addMemberInternal(groupId: string, userId: string, component = '', itemId: string | null = null): Promise<void> {
    await this.repo.addMember(groupId, userId, component, itemId);
  }

  async createGroupInternal(courseId: string, name: string): Promise<GroupRow> {
    const existing = (await this.repo.listGroups(courseId)).find((g) => g.name === name);
    if (existing) return existing;
    return this.repo.insertGroup({ courseId, name, idNumber: '', description: '', enrolmentKey: null });
  }
  async removeMemberInternal(groupId: string, userId: string): Promise<void> { await this.repo.removeMember(groupId, userId); }

  async createGrouping(actorId: string, courseId: string, input: { name: string; idNumber?: string; description?: string }): Promise<GroupingRow> {
    await this.courses.getCourse(courseId);
    await this.requireManageGroups(actorId, courseId);
    const row = await this.repo.insertGrouping({ courseId: courseId, name: input.name, idNumber: input.idNumber ?? '', description: input.description ?? '' });
    await this.outbox.enqueueStandalone({ aggregate: 'grouping', type: 'grouping_created', payload: { groupingId: row.id, courseId } });
    return row;
  }
  async getGrouping(id: string): Promise<GroupingRow> {
    const row = await this.repo.getGrouping(id);
    if (!row) notFound(`Grouping ${id} not found`, 'group.grouping_not_found');
    return row;
  }
  async listGroupings(courseId: string, actorId?: string): Promise<GroupingRow[]> {
    const all = await this.repo.listGroupings(courseId);
    if (!actorId || !all.length) return all;
    await this.courses.assertCourseAccess(actorId, courseId).catch(async () => {
      await this.requireManageGroups(actorId, courseId);
    });
    const visible = await this.visibleGroupsFor(actorId, courseId);
    if (visible.length === (await this.repo.listGroups(courseId)).length) return all;
    const visibleIds = new Set(visible.map((g) => g.id));
    const kept: GroupingRow[] = [];
    for (const grouping of all) {
      const groups = await this.repo.groupsInGrouping(grouping.id);
      if (groups.some((g) => visibleIds.has(g.id))) kept.push(grouping);
    }
    return kept;
  }
  async deleteGrouping(actorId: string, id: string): Promise<void> {
    const grouping = await this.getGrouping(id);
    await this.requireManageGroups(actorId, grouping.courseId);
    await this.repo.deleteGrouping(id);
  }
  async addGroupToGrouping(actorId: string, groupingId: string, groupId: string): Promise<void> {
    const grouping = await this.getGrouping(groupingId);
    const group = await this.getGroup(groupId);
    if (group.courseId !== grouping.courseId) forbidden('Group and grouping are in different courses', 'group.course_mismatch');
    await this.requireManageGroups(actorId, grouping.courseId);
    await this.repo.addGroupToGrouping(groupingId, groupId);
  }
  async groupsInGrouping(groupingId: string, actorId?: string): Promise<GroupRow[]> {
    const groups = await this.repo.groupsInGrouping(groupingId);
    if (!actorId || !groups.length) return groups;
    const courseId = groups[0]!.courseId;
    const visible = await this.visibleGroupsFor(actorId, courseId);
    const visibleIds = new Set(visible.map((g) => g.id));
    const scoped = groups.filter((g) => visibleIds.has(g.id));
    if (await this.canManageGroups(actorId, courseId)) return scoped;
    return scoped.map((g) => this.hideGroupKey(g));
  }

  private async cohortContextId(input: { contextLevel?: number; categoryId?: string }, tenantId: string): Promise<string> {
    if (input.categoryId !== undefined) {
      const ctx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSECAT, input.categoryId);
      if (!ctx) notFound(`No context for category ${input.categoryId}`, 'cohort.category_context_missing');
      return ctx.id;
    }
    return (await this.contexts.ensureTenantContext(tenantId)).id;
  }

  async createCohort(actorId: string, input: { name: string; idNumber?: string; description?: string; categoryId?: string; visible?: boolean }): Promise<CohortRow> {
    const tenantId = await this.cohortTenantId(input.categoryId);
    const contextId = await this.cohortContextId(input, tenantId);
    await this.evaluator.requireCapability(actorId, 'cohort:manage', contextId);
    const row = await this.repo.insertCohort({
      tenantId,
      name: input.name, idNumber: input.idNumber ?? '', description: input.description ?? '',
      contextId, visible: input.visible ?? true,
    });
    await this.outbox.enqueueStandalone({ aggregate: 'cohort', type: 'cohort_created', payload: { cohortId: row.id }, tenantId });
    return row;
  }
  async getCohort(id: string, actorId?: string): Promise<CohortRow> {
    const row = await this.repo.getCohort(id);
    const active = this.tenantContext.currentTenantId();
    if (!row || (active !== undefined && row.tenantId !== active)) {
      notFound(`Cohort ${id} not found`, 'cohort.not_found');
    }
    if (actorId !== undefined) await this.requireCohortViewer(actorId, row);
    return row;
  }
  async listCohorts(actorId: string): Promise<CohortRow[]> {
    const all = await this.repo.listCohorts();
    const active = this.tenantContext.currentTenantId();
    const scoped = active ? all.filter((c) => c.tenantId === active) : all;
    const out: CohortRow[] = [];
    for (const row of scoped) {
      const canView = await this.evaluator.hasCapability(actorId, 'cohort:view', row.contextId);
      const canManage = canView ? false : await this.evaluator.hasCapability(actorId, 'cohort:manage', row.contextId);
      if (canView || canManage) out.push(row);
    }
    return out;
  }
  async updateCohort(actorId: string, id: string, input: { name?: string; idNumber?: string; description?: string; visible?: boolean }): Promise<CohortRow> {
    const cohortRow = await this.getCohort(id);
    await this.evaluator.requireCapability(actorId, 'cohort:manage', cohortRow.contextId);
    await this.repo.updateCohort(id, input);
    return this.getCohort(id);
  }
  async deleteCohort(actorId: string, id: string): Promise<void> {
    const cohortRow = await this.getCohort(id);
    await this.evaluator.requireCapability(actorId, 'cohort:manage', cohortRow.contextId);
    await this.repo.deleteCohort(id);
  }
  async listCohortMembers(cohortId: string, actorId?: string): Promise<{ userId: string; timeAdded: Date }[]> {
    const cohortRow = await this.getCohort(cohortId);
    if (actorId !== undefined) await this.requireCohortViewer(actorId, cohortRow);
    const rows = await this.repo.listCohortMembers(cohortId);
    return rows.map((r) => ({ userId: r.userId, timeAdded: r.timeAdded }));
  }
  private async requireCohortViewer(actorId: string, cohortRow: CohortRow): Promise<void> {
    const canView = await this.evaluator.hasCapability(actorId, 'cohort:view', cohortRow.contextId);
    const canManage = canView ? false : await this.evaluator.hasCapability(actorId, 'cohort:manage', cohortRow.contextId);
    if (!canView && !canManage) notFound(`Cohort ${cohortRow.id} not found`, 'cohort.not_found');
  }
  async isCohortMember(cohortId: string, userId: string): Promise<boolean> { return this.repo.isCohortMember(cohortId, userId); }

  async addCohortMember(actorId: string, cohortId: string, userId: string): Promise<void> {
    const cohortRow = await this.getCohort(cohortId);
    await this.evaluator.requireCapability(actorId, 'cohort:manage', cohortRow.contextId);
    await this.roleSeparation.assertCohortMembershipAllowed(userId, cohortId);
    const added = await this.repo.addCohortMember(cohortId, userId);
    if (!added) return;
    await this.outbox.enqueueStandalone({ aggregate: 'cohort', type: 'cohort_member_added', payload: { cohortId, userId } });
    await this.emitter.emitAsync('cohort_member_added', { cohortId, userId });
  }
  async removeCohortMember(actorId: string, cohortId: string, userId: string): Promise<void> {
    const cohortRow = await this.getCohort(cohortId);
    await this.evaluator.requireCapability(actorId, 'cohort:manage', cohortRow.contextId);
    const removed = await this.repo.removeCohortMember(cohortId, userId);
    if (!removed) return;
    await this.outbox.enqueueStandalone({ aggregate: 'cohort', type: 'cohort_member_removed', payload: { cohortId, userId } });
    await this.emitCohortMemberRemoved(cohortId, userId);
  }

  async emitCohortMemberRemoved(cohortId: string, userId: string): Promise<void> {
    await this.emitter.emitAsync('cohort_member_removed', { cohortId, userId });
  }
  async addCohortMemberInternal(cohortId: string, userId: string): Promise<void> {
    await this.getCohort(cohortId);
    await this.roleSeparation.assertCohortMembershipAllowed(userId, cohortId);
    const added = await this.repo.addCohortMember(cohortId, userId);
    if (!added) return;
    await this.outbox.enqueueStandalone({ aggregate: 'cohort', type: 'cohort_member_added', payload: { cohortId, userId } });
    await this.emitter.emitAsync('cohort_member_added', { cohortId, userId });
  }
  async removeCohortMemberInternal(cohortId: string, userId: string, tx?: CentreTx): Promise<boolean> {
    await this.getCohort(cohortId);
    if (tx) {
      const removed = await this.repo.removeCohortMember(cohortId, userId, tx);
      if (!removed) return false;
      await this.outbox.enqueueKysely(tx, { aggregate: 'cohort', type: 'cohort_member_removed', payload: { cohortId, userId } });
      return true;
    }
    const removed = await this.repo.removeCohortMember(cohortId, userId);
    if (!removed) return false;
    await this.outbox.enqueueStandalone({ aggregate: 'cohort', type: 'cohort_member_removed', payload: { cohortId, userId } });
    await this.emitCohortMemberRemoved(cohortId, userId);
    return true;
  }
}
