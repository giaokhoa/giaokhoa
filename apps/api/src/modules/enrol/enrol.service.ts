import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { I18nService } from '@nestjs/i18n';
import { CohortMaterializationSurface } from '@giaokhoa/enrol';
import { type CentreTx } from '@giaokhoa/db';
import { EnrolRepository, type EnrolRow, type UserEnrolmentRow } from '@giaokhoa/db/repositories/enrol';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { isRoleContextConflictError, RoleSeparationService } from '../access/role-separation.service';
import { ENROL_ASSIGNMENT_COMPONENT, RolesService } from '../access/roles.service';
import { delegateToSharedCore } from '../access/translate-shared-error';
import { CoursesService } from '../courses/courses.service';
import { GroupsService } from '../groups/groups.service';
import { MessagingService } from '../messaging/messaging.service';
import { tenantAls } from '../tenants/tenant-als';
import { TenantsService } from '../tenants/tenants.service';

interface EnrolAssignmentRow { id: string; roleId: string; component: string; itemId: string | null }

function enrolAssignmentSource(instance: EnrolRow): { component: string; itemId: string } {
  return { component: ENROL_ASSIGNMENT_COMPONENT, itemId: instance.id };
}

function isInstanceAssignment(a: EnrolAssignmentRow, instance: EnrolRow): boolean {
  return a.roleId === instance.roleId && a.component === ENROL_ASSIGNMENT_COMPONENT && a.itemId === instance.id;
}

export const ENROL_ACTIVE = 0;
export const ENROL_SUSPENDED = 1;
export const ENROL_WITHDRAWN = 2;
export const ENROL_METHODS = ['manual', 'cohort', 'self', 'guest', 'fee'] as const;
export type EnrolMethod = (typeof ENROL_METHODS)[number];

@Injectable()
export class EnrolService implements OnModuleInit {
  private readonly materialization: CohortMaterializationSurface;

  constructor(
    private readonly repo: EnrolRepository,
    private readonly courses: CoursesService,
    private readonly roles: RolesService,
    private readonly evaluator: PermissionEvaluator,
    private readonly groups: GroupsService,
    private readonly outbox: OutboxService,
    private readonly messaging: MessagingService,
    private readonly i18n: I18nService,
    private readonly tenants: TenantsService,
    private readonly roleSeparation: RoleSeparationService,
    private readonly spaceDb: SpaceDatabaseService,
  ) {
    this.materialization = new CohortMaterializationSurface({
      db: spaceDb.routedKysely,
      outbox: {
        enqueue: (tx, input) => this.outbox.enqueueKysely(tx, input),
        enqueueStandalone: (input) => spaceDb.routedKysely.transaction().execute((trx) => this.outbox.enqueueKysely(trx, input)),
      },
      runInPlatformScope: (fn) => {
        const spaceSlug = tenantAls.getStore()?.spaceSlug;
        return tenantAls.run({ platform: true, ...(spaceSlug ? { spaceSlug, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle } : {}) }, fn);
      },
    });
  }

  onModuleInit(): void {
    this.courses.registerEnrolChecker({
      isEnrolled: (courseId, userId, opts) => this.isEnrolled(courseId, userId, opts),
    });
  }

  private async requireManage(actorId: string, courseId: string): Promise<void> {
    await this.evaluator.requireCapability(actorId, 'enrol:manage', await this.courses.courseContextId(courseId));
  }
  private async defaultStudentRoleId(): Promise<string> {
    const roleRow = await this.roles.getRoleByShortname('student');
    if (!roleRow) throw new Error('student role not seeded');
    return roleRow.id;
  }

  private async canManageEnrol(viewerId: string, courseId: string): Promise<boolean> {
    return this.evaluator.hasCapability(viewerId, 'enrol:manage', await this.courses.courseContextId(courseId));
  }

  private hideInstanceKey(instance: EnrolRow): EnrolRow {
    return instance.enrolmentKey ? { ...instance, enrolmentKey: null } : instance;
  }

  async createInstance(actorId: string, courseId: string, input: {
    method: string; name?: string; roleShortname?: string; status?: number; enrolPeriod?: number;
    cohortId?: string; groupId?: string; onCohortLeave?: 'suspend' | 'unenrol';
    cost?: number; currency?: string; paymentAccountId?: string;
    enrolmentKey?: string; sendWelcomeMessage?: boolean; welcomeMessage?: string;
  }): Promise<EnrolRow> {
    await this.courses.getCourse(courseId);
    await this.requireManage(actorId, courseId);
    if (!ENROL_METHODS.includes(input.method as EnrolMethod)) {
      throw new BadRequestException({ message: `Unknown enrol method ${input.method}`, code: 'enrol.unknown_method' });
    }
    if (input.method === 'cohort' && !input.cohortId) {
      throw new BadRequestException({ message: 'A cohort enrol instance requires cohortId', code: 'enrol.cohort_required' });
    }
    let roleId: string | undefined;
    if (input.roleShortname) {
      const roleRow = await this.roles.getRoleByShortname(input.roleShortname);
      if (!roleRow) throw new BadRequestException({ message: `Role ${input.roleShortname} not found`, code: 'enrol.role_not_found' });
      roleId = roleRow.id;
    } else {
      roleId = await this.defaultStudentRoleId();
    }
    if (input.method === 'fee' && (!input.cost || input.cost <= 0 || !input.currency)) {
      throw new BadRequestException({ message: 'A fee enrol instance requires a positive integer cost and a currency', code: 'enrol.fee_config_required' });
    }
    const instance = await this.repo.insertInstance({
      courseId: courseId, enrol: input.method, name: input.name ?? null, roleId,
      status: input.status ?? 0, enrolPeriod: input.enrolPeriod ?? 0,
      customInt1: input.method === 'cohort' ? (input.cohortId ?? null) : null,
      customInt2: input.groupId ?? null,
      customText1: input.onCohortLeave ?? 'suspend',
      cost: input.cost ?? 0, currency: input.currency ?? '', paymentAccountId: input.paymentAccountId ?? null,
      enrolmentKey: input.enrolmentKey ?? null,
      sendWelcomeMessage: input.sendWelcomeMessage ?? (input.method === 'self'),
      welcomeMessage: input.welcomeMessage ?? null,
    });
    await this.outbox.enqueueStandalone({ aggregate: 'enrol', type: 'enrol_instance_created', payload: { instanceId: instance.id, courseId, method: input.method } });
    if (input.method === 'cohort' && input.cohortId) {
      const members = await this.groups.listCohortMembers(input.cohortId);
      for (const m of members) await this.enrolFromCohortSync(instance, m.userId, actorId);
    }
    return instance;
  }
  async ensureClassCohortInstance(courseId: string, cohortId: string, onLeave: 'suspend' | 'unenrol', groupId: string | null): Promise<EnrolRow> {
    const existing = (await this.repo.listInstances(courseId)).find((i) => i.enrol === 'cohort' && i.customInt1 === cohortId);
    if (existing) {
      const patch: Partial<EnrolRow> = {};
      if (existing.customText1 !== onLeave) patch.customText1 = onLeave;
      if (groupId && existing.customInt2 !== groupId) patch.customInt2 = groupId;
      if (Object.keys(patch).length) {
        await this.repo.updateInstance(existing.id, patch);
        return { ...existing, ...patch };
      }
      return existing;
    }
    const instance = await this.repo.insertInstance({
      courseId, enrol: 'cohort', name: null, roleId: await this.defaultStudentRoleId(),
      status: 0, enrolPeriod: 0,
      customInt1: cohortId, customInt2: groupId, customText1: onLeave,
      cost: 0, currency: '', paymentAccountId: null,
      enrolmentKey: null, sendWelcomeMessage: false, welcomeMessage: null,
    });
    const members = await this.groups.listCohortMembers(cohortId);
    for (const m of members) await this.enrolFromCohortSync(instance, m.userId);
    return instance;
  }

  async getInstance(id: string): Promise<EnrolRow> {
    const row = await this.repo.getInstance(id);
    if (!row) throw new NotFoundException({ message: `Enrol instance ${id} not found`, code: 'enrol.instance_not_found' });
    return row;
  }
  async listInstances(courseId: string, viewerId?: string): Promise<EnrolRow[]> {
    const rows = await this.repo.listInstances(courseId);
    if (!viewerId) return rows;
    if (await this.canManageEnrol(viewerId, courseId)) return rows;
    return rows.map((row) => this.hideInstanceKey(row));
  }
  async updateInstance(actorId: string, id: string, input: {
    name?: string; status?: number; enrolPeriod?: number; onCohortLeave?: 'suspend' | 'unenrol'; groupId?: string;
    roleShortname?: string; enrolmentKey?: string | null; sendWelcomeMessage?: boolean; welcomeMessage?: string | null;
  }): Promise<EnrolRow> {
    const instance = await this.getInstance(id);
    await this.requireManage(actorId, instance.courseId);
    const patch: Partial<EnrolRow> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.status !== undefined) patch.status = input.status;
    if (input.enrolPeriod !== undefined) patch.enrolPeriod = input.enrolPeriod;
    if (input.onCohortLeave !== undefined) patch.customText1 = input.onCohortLeave;
    if (input.groupId !== undefined) patch.customInt2 = input.groupId;
    if (input.enrolmentKey !== undefined) patch.enrolmentKey = input.enrolmentKey;
    if (input.sendWelcomeMessage !== undefined) patch.sendWelcomeMessage = input.sendWelcomeMessage;
    if (input.welcomeMessage !== undefined) patch.welcomeMessage = input.welcomeMessage;
    let newRoleId: string | undefined;
    if (input.roleShortname !== undefined) {
      const roleRow = await this.roles.getRoleByShortname(input.roleShortname);
      if (!roleRow) throw new BadRequestException({ message: `Role ${input.roleShortname} not found`, code: 'enrol.role_not_found' });
      newRoleId = roleRow.id;
      patch.roleId = newRoleId;
    }
    if (Object.keys(patch).length) await this.repo.updateInstance(id, patch);
    if (newRoleId && newRoleId !== instance.roleId) {
      await this.reassignEnrolledRoles(instance, newRoleId, actorId);
    }
    return this.getInstance(id);
  }

  private async reassignEnrolledRoles(instance: EnrolRow, newRoleId: string, modifierId: string): Promise<void> {
    const courseCtxId = await this.courses.courseContextId(instance.courseId);
    const enrolments = await this.repo.listUserEnrolmentsForInstance(instance.id);
    for (const ue of enrolments) {
      if (ue.status === ENROL_WITHDRAWN) continue;
      if (instance.roleId) {
        const assignments = await this.roles.listAssignments({ userId: ue.userId, contextId: courseCtxId });
        for (const a of assignments as EnrolAssignmentRow[]) {
          if (isInstanceAssignment(a, instance)) await this.roles.unassignRole(a.id, modifierId, { allowEnrolManaged: true });
        }
      }
      await this.roles.assignRole(ue.userId, newRoleId, courseCtxId, modifierId, enrolAssignmentSource(instance));
    }
  }
  async deleteInstance(actorId: string, id: string): Promise<void> {
    const instance = await this.getInstance(id);
    await this.requireManage(actorId, instance.courseId);
    await this.repo.deleteInstance(id);
  }

  async enrolUserInternal(instance: EnrolRow, userId: string, modifierId?: string, opts?: { timeStart?: Date; timeEnd?: Date }): Promise<UserEnrolmentRow> {
    const { userEnrolment, isNewEnrolment } = await delegateToSharedCore(
      () => this.materialization.enrolUserInternal(instance, userId, modifierId, opts),
    );
    if (isNewEnrolment) await this.maybeSendWelcomeMessage(instance, userId);
    return userEnrolment;
  }

  private async enrolFromCohortSync(instance: EnrolRow, userId: string, modifierId?: string): Promise<void> {
    try {
      await this.enrolUserInternal(instance, userId, modifierId);
    } catch (err) {
      if (!isRoleContextConflictError(err)) throw err;
    }
  }

  private async maybeSendWelcomeMessage(instance: EnrolRow, userId: string): Promise<void> {
    if (instance.enrol !== 'self' && instance.enrol !== 'manual') return;
    if (!instance.sendWelcomeMessage) return;
    try {
      const course = await this.courses.getCourse(instance.courseId);
      const custom = instance.welcomeMessage?.trim();
      const body = custom
        ? custom.replaceAll('{coursename}', course.fullName).replaceAll('{course}', course.fullName)
        : String(this.i18n.t('platform.enrolWelcomeBody', { args: { course: course.fullName } }));
      const subject = String(this.i18n.t('platform.enrolWelcomeSubject', { args: { course: course.fullName } }));
      await this.messaging.notify(userId, 'enrol_welcome', {
        subject, body, contextUrl: `/courses/${instance.courseId}`,
        courseId: instance.courseId,
      });
    } catch {
    }
  }

  async enrolUser(actorId: string, instanceId: string, userId: string, opts?: { timeStart?: string; timeEnd?: string }): Promise<UserEnrolmentRow> {
    const instance = await this.getInstance(instanceId);
    await this.requireManage(actorId, instance.courseId);
    return this.enrolUserInternal(instance, userId, actorId, {
      timeStart: opts?.timeStart ? new Date(opts.timeStart) : undefined,
      timeEnd: opts?.timeEnd ? new Date(opts.timeEnd) : undefined,
    });
  }

  async selfEnrol(userId: string, instanceId: string, enrolmentKey?: string): Promise<UserEnrolmentRow> {
    const instance = await this.getInstance(instanceId);
    if (instance.enrol === 'fee') {
      throw new BadRequestException({ message: 'Fee enrol instance requires a succeeded payment before enrolment is activated', code: 'enrol.payment_required' });
    }
    if (instance.enrol !== 'self') throw new BadRequestException({ message: 'Instance is not a self-enrol instance', code: 'enrol.not_self' });
    const providedKey = enrolmentKey ? enrolmentKey : undefined;
    const courseGroups = await this.groups.groupsForCourseInternal(instance.courseId);
    const matchedGroup = providedKey
      ? courseGroups.find((g) => g.enrolmentKey !== null && g.enrolmentKey !== '' && g.enrolmentKey === providedKey)
      : undefined;
    const instanceKey = instance.enrolmentKey ? instance.enrolmentKey : null;
    if (instanceKey) {
      if (!providedKey) {
        throw new BadRequestException({ message: 'This course requires an enrolment key', code: 'enrol.enrolment_key_required' });
      }
      if (providedKey !== instanceKey && !matchedGroup) {
        throw new BadRequestException({ message: 'Invalid enrolment key', code: 'enrol.invalid_enrolment_key' });
      }
    }
    const ue = await this.enrolUserInternal(instance, userId, userId);
    if (matchedGroup) {
      await this.groups.addMemberInternal(matchedGroup.id, userId, 'enrol_self', instance.id).catch(() => undefined);
    }
    return ue;
  }

  async selfUnenrol(userId: string, instanceId: string): Promise<{ withdrawn: boolean }> {
    const instance = await this.getInstance(instanceId);
    if (instance.enrol !== 'self') {
      throw new BadRequestException({ message: 'You can only unenrol yourself from a self-enrolment instance', code: 'enrol.self_unenrol_not_allowed' });
    }
    const ue = await this.repo.getUserEnrolment(instanceId, userId);
    if (!ue || ue.status === ENROL_WITHDRAWN) {
      throw new NotFoundException({ message: 'User enrolment not found', code: 'enrol.user_not_enrolled' });
    }
    return this.unenrolInternal(instance, userId, userId);
  }

  async activatePaidEnrol(instanceId: string, userId: string): Promise<UserEnrolmentRow> {
    const instance = await this.getInstance(instanceId);
    if (instance.enrol !== 'fee') throw new BadRequestException({ message: 'Instance is not a fee enrol instance', code: 'enrol.not_fee' });
    const existing = await this.repo.getUserEnrolment(instanceId, userId);
    if (existing && existing.status === ENROL_ACTIVE) return existing;
    return this.enrolUserInternal(instance, userId, userId);
  }

  async setSuspended(actorId: string, instanceId: string, userId: string, suspended: boolean, tx?: CentreTx): Promise<UserEnrolmentRow> {
    const instance = await this.getInstance(instanceId);
    await this.requireManage(actorId, instance.courseId);
    const ue = await this.repo.getUserEnrolment(instanceId, userId);
    if (!ue || ue.status === ENROL_WITHDRAWN) throw new NotFoundException({ message: 'User enrolment not found', code: 'enrol.user_not_enrolled' });
    if (!suspended && ue.status !== ENROL_ACTIVE && await this.roleSeparation.isLearnerGrantRole(instance.roleId)) {
      await this.roleSeparation.assertLearnerEnrolmentAllowed(userId, instance.courseId);
    }
    const eventInput = {
      aggregate: 'enrol', type: suspended ? 'user_enrolment_suspended' : 'user_enrolment_reactivated',
      payload: { courseId: instance.courseId, userId, instanceId, actorId },
    };
    if (tx) {
      await this.repo.updateUserEnrolment(ue.id, { status: suspended ? ENROL_SUSPENDED : ENROL_ACTIVE, modifierId: actorId }, tx);
      await this.outbox.enqueueKysely(tx, eventInput);
      return { ...ue, status: suspended ? ENROL_SUSPENDED : ENROL_ACTIVE, modifierId: actorId };
    }
    await this.repo.transaction(async (txKysely: CentreTx) => {
      await this.repo.updateUserEnrolment(ue.id, { status: suspended ? ENROL_SUSPENDED : ENROL_ACTIVE, modifierId: actorId }, txKysely);
      await this.outbox.enqueueKysely(txKysely, eventInput);
    });
    return (await this.repo.getUserEnrolment(instanceId, userId))!;
  }

  async unenrolUser(actorId: string, instanceId: string, userId: string): Promise<{ withdrawn: boolean }> {
    const instance = await this.getInstance(instanceId);
    await this.requireManage(actorId, instance.courseId);
    return this.unenrolInternal(instance, userId, actorId);
  }

  async unenrolInternal(instance: EnrolRow, userId: string, modifierId?: string): Promise<{ withdrawn: boolean }> {
    return delegateToSharedCore(() => this.materialization.unenrolInternal(instance, userId, modifierId));
  }

  async isEnrolled(courseId: string, userId: string, opts?: { onlyActive?: boolean; capability?: string }): Promise<boolean> {
    const instances = await this.repo.listInstances(courseId);
    const now = new Date();
    for (const instance of instances) {
      if (instance.status !== 0) continue;
      const ue = await this.repo.getUserEnrolment(instance.id, userId);
      if (!ue || ue.status === ENROL_WITHDRAWN) continue;
      if (opts?.onlyActive) {
        if (ue.status !== ENROL_ACTIVE) continue;
        if (ue.timeStart > now) continue;
        if (ue.timeEnd && ue.timeEnd < now) continue;
      }
      if (opts?.capability) {
        const ok = await this.evaluator.hasCapability(userId, opts.capability, await this.courses.courseContextId(courseId));
        if (!ok) continue;
      }
      return true;
    }
    return false;
  }

  private async requireListEnrolmentsAccess(viewerId: string, courseId: string): Promise<void> {
    await this.courses.getCourse(courseId);
    if (await this.canManageEnrol(viewerId, courseId)) return;
    if (await this.isEnrolled(courseId, viewerId, { onlyActive: true })) return;
    const assignments = await this.roles.listAssignments({
      userId: viewerId,
      contextId: await this.courses.courseContextId(courseId),
    });
    if (assignments.length) return;
    throw new NotFoundException({ message: `Course ${courseId} not found`, code: 'course.not_found' });
  }

  async listEnrolmentsForCourse(courseId: string, viewerId?: string): Promise<(UserEnrolmentRow & { enrolMethod: string })[]> {
    if (viewerId) await this.requireListEnrolmentsAccess(viewerId, courseId);
    return this.repo.listUserEnrolmentsForCourse(courseId);
  }
  async listEnrolmentsForUser(userId: string): Promise<UserEnrolmentRow[]> {
    return this.repo.listUserEnrolmentsForUser(userId);
  }
  async getUserEnrolment(instanceId: string, userId: string): Promise<UserEnrolmentRow | undefined> {
    return this.repo.getUserEnrolment(instanceId, userId);
  }

  async expireEnrolments(now = new Date()): Promise<string[]> {
    const expired = await this.repo.listExpiredActive(now);
    const flipped: string[] = [];
    for (const ue of expired) {
      const instance = await this.repo.getInstance(ue.enrolId);
      await this.repo.transaction(async (tx) => {
        await this.repo.updateUserEnrolment(ue.id, { status: ENROL_SUSPENDED }, tx);
        await this.outbox.enqueueKysely(tx, {
          aggregate: 'enrol', type: 'user_enrolment_suspended',
          payload: { courseId: instance?.courseId, userId: ue.userId, instanceId: ue.enrolId, reason: 'expired' },
        });
      });
      flipped.push(ue.id);
    }
    return flipped;
  }

  @OnEvent('cohort_member_added')
  async onCohortMemberAdded(payload: { cohortId: string; userId: string }): Promise<void> {
    await delegateToSharedCore(() => this.materialization.materializeCohortMemberAdded(payload));
  }

  @OnEvent('cohort_member_removed')
  async onCohortMemberRemoved(payload: { cohortId: string; userId: string }): Promise<void> {
    await delegateToSharedCore(() => this.materialization.materializeCohortMemberRemoved(payload));
  }
}
