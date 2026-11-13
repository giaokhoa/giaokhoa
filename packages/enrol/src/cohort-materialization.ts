import { getCourseContextId } from './contexts';
import { isRoleContextConflictError, SharedDomainError } from './errors';
import { PlanLimitsCore } from './plan-limits';
import { hasRelatedCourseData } from './related-data';
import { ENROL_ASSIGNMENT_COMPONENT, RoleAssignmentCore } from './role-assignment';
import { RoleSeparationCore } from './role-separation';
import { ensureActiveTenantMembership } from './tenant-membership';
import {
  ENROL_COLUMNS,
  USER_ENROLMENT_COLUMNS,
  type EnrolDatabase,
  type EnrolInstanceRow,
  type RoleAssignmentRow,
  type SharedOutboxPort,
  type SharedSurfaceDeps,
  type UserEnrolmentRow,
} from './types';

export const ENROL_ACTIVE = 0;
export const ENROL_SUSPENDED = 1;
export const ENROL_WITHDRAWN = 2;

export const COURSE_COMPLETION_REAGGREGATION_REQUESTED = 'course_completion_reaggregation_requested';

interface UserEnrolmentPatch {
  status?: number;
  timeStart?: Date;
  timeEnd?: Date | null;
  modifierId?: string | null;
}

function isInstanceAssignment(a: RoleAssignmentRow, instance: EnrolInstanceRow): boolean {
  return a.roleId === instance.roleId && a.component === ENROL_ASSIGNMENT_COMPONENT && a.itemId === instance.id;
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current instanceof Error; depth++) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class CohortMaterializationSurface {
  private readonly db: EnrolDatabase;
  private readonly outbox: SharedOutboxPort;
  private readonly planLimits: PlanLimitsCore;
  private readonly roleSeparation: RoleSeparationCore;
  private readonly roleAssignment: RoleAssignmentCore;

  constructor(deps: SharedSurfaceDeps) {
    this.db = deps.db;
    this.outbox = deps.outbox;
    this.planLimits = new PlanLimitsCore(deps.db, deps.runInPlatformScope);
    this.roleSeparation = new RoleSeparationCore(deps.db, deps.runInPlatformScope);
    this.roleAssignment = new RoleAssignmentCore(deps.db, deps.outbox, this.planLimits, this.roleSeparation);
  }

  get roleSeparationChecks(): RoleSeparationCore {
    return this.roleSeparation;
  }

  get roleAssignmentCore(): RoleAssignmentCore {
    return this.roleAssignment;
  }

  get planLimitsCore(): PlanLimitsCore {
    return this.planLimits;
  }

  private async getUserEnrolment(instanceId: string, userId: string): Promise<UserEnrolmentRow | undefined> {
    return this.db
      .selectFrom('user_enrolments')
      .select(USER_ENROLMENT_COLUMNS)
      .where((eb) => eb.and([
        eb('user_enrolments.enrol_id', '=', instanceId),
        eb('user_enrolments.user_id', '=', userId),
      ]))
      .executeTakeFirst();
  }

  private async updateUserEnrolment(handle: EnrolDatabase, id: string, v: UserEnrolmentPatch): Promise<void> {
    await handle
      .updateTable('user_enrolments')
      .set({
        ...(v.status !== undefined ? { status: v.status } : {}),
        ...(v.timeStart !== undefined ? { time_start: v.timeStart } : {}),
        ...(v.timeEnd !== undefined ? { time_end: v.timeEnd } : {}),
        ...(v.modifierId !== undefined ? { modifier_id: v.modifierId } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async enrolUserInternal(
    instance: EnrolInstanceRow,
    userId: string,
    modifierId?: string,
    opts?: { timeStart?: Date; timeEnd?: Date },
  ): Promise<{ userEnrolment: UserEnrolmentRow; isNewEnrolment: boolean }> {
    if (instance.status !== 0) {
      throw new SharedDomainError('enrol.instance_disabled', 'Enrol instance is disabled');
    }
    if (await this.roleSeparation.isLearnerGrantRole(instance.roleId)) {
      await this.roleSeparation.assertLearnerEnrolmentAllowed(userId, instance.courseId);
    }
    const timeStart = opts?.timeStart ?? new Date();
    const timeEnd = opts?.timeEnd ?? (instance.enrolPeriod > 0 ? new Date(timeStart.getTime() + instance.enrolPeriod * 1000) : null);
    const existing = await this.getUserEnrolment(instance.id, userId);
    let ue: UserEnrolmentRow;
    let isNewEnrolment = false;
    if (existing) {
      await this.updateUserEnrolment(this.db, existing.id, { status: ENROL_ACTIVE, timeStart, timeEnd, modifierId });
      ue = (await this.getUserEnrolment(instance.id, userId))!;
    } else {
      try {
        ue = await this.db.transaction().execute(async (trx) => {
          const row = await trx
            .insertInto('user_enrolments')
            .values({
              enrol_id: instance.id,
              user_id: userId,
              status: ENROL_ACTIVE,
              time_start: timeStart,
              time_end: timeEnd,
              ...(modifierId !== undefined ? { modifier_id: modifierId } : {}),
            })
            .returning(USER_ENROLMENT_COLUMNS)
            .executeTakeFirstOrThrow();
          await this.outbox.enqueue(trx, {
            aggregate: 'enrol', type: 'user_enrolled',
            payload: { courseId: instance.courseId, userId, instanceId: instance.id, method: instance.enrol, actorId: modifierId ?? null },
          });
          return row;
        });
        isNewEnrolment = true;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const winner = await this.getUserEnrolment(instance.id, userId);
        if (!winner) throw err;
        await this.updateUserEnrolment(this.db, winner.id, { status: ENROL_ACTIVE, timeStart, timeEnd, modifierId });
        ue = (await this.getUserEnrolment(instance.id, userId))!;
      }
    }
    const courseRow = await this.db
      .selectFrom('course')
      .select('course.tenant_id as tenantId')
      .where('course.id', '=', instance.courseId)
      .executeTakeFirst();
    if (courseRow?.tenantId) await ensureActiveTenantMembership(this.db, courseRow.tenantId, userId);
    if (instance.roleId) {
      const courseCtxId = await getCourseContextId(this.db, instance.courseId);
      await this.roleAssignment.assignRole(userId, instance.roleId, courseCtxId, modifierId, {
        component: ENROL_ASSIGNMENT_COMPONENT, itemId: instance.id,
      });
    }
    if (instance.customInt2) {
      await this.db
        .insertInto('groups_members')
        .values({ group_id: instance.customInt2, user_id: userId, component: 'enrol_cohort', item_id: instance.id })
        .onConflict((oc) => oc.doNothing())
        .execute()
        .catch(() => undefined);
    }
    return { userEnrolment: ue, isNewEnrolment };
  }

  async enrolFromCohortSync(instance: EnrolInstanceRow, userId: string, modifierId?: string): Promise<void> {
    try {
      await this.enrolUserInternal(instance, userId, modifierId);
    } catch (err) {
      if (!isRoleContextConflictError(err)) throw err;
    }
  }

  async unenrolInternal(
    instance: EnrolInstanceRow,
    userId: string,
    modifierId?: string,
  ): Promise<{ withdrawn: boolean }> {
    const ue = await this.getUserEnrolment(instance.id, userId);
    if (!ue) return { withdrawn: false };
    const hasRelated = await hasRelatedCourseData(this.db, instance.courseId, userId);
    await this.db.transaction().execute(async (trx) => {
      if (hasRelated) {
        await this.updateUserEnrolment(trx, ue.id, { status: ENROL_WITHDRAWN, modifierId });
      } else {
        await trx.deleteFrom('user_enrolments').where('id', '=', ue.id).execute();
      }
      await this.outbox.enqueue(trx, {
        aggregate: 'enrol', type: 'user_unenrolled',
        payload: { courseId: instance.courseId, userId, instanceId: instance.id, keptData: hasRelated, actorId: modifierId ?? null },
      });
      await this.outbox.enqueue(trx, {
        aggregate: 'completion', type: COURSE_COMPLETION_REAGGREGATION_REQUESTED,
        payload: { courseId: instance.courseId, userId },
      });
    });
    if (instance.roleId) {
      const assignments = await this.roleAssignment.listAssignments({
        userId, contextId: await getCourseContextId(this.db, instance.courseId),
      });
      for (const a of assignments) {
        if (isInstanceAssignment(a, instance)) {
          await this.roleAssignment.unassignRole(a.id, modifierId, { allowEnrolManaged: true });
        }
      }
    }
    return { withdrawn: hasRelated };
  }

  async isCohortMember(cohortId: string, userId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('cohort_members')
      .select('cohort_members.cohort_id')
      .where((eb) => eb.and([
        eb('cohort_members.cohort_id', '=', cohortId),
        eb('cohort_members.user_id', '=', userId),
      ]))
      .executeTakeFirst();
    return !!row;
  }

  async listCohortInstances(cohortId: string): Promise<EnrolInstanceRow[]> {
    const rows = await this.db
      .selectFrom('enrol')
      .select(ENROL_COLUMNS)
      .where('enrol.enrol', '=', 'cohort')
      .execute();
    return rows.filter((r) => r.customInt1 === cohortId);
  }

  async materializeCohortMemberAdded(payload: { cohortId: string; userId: string }): Promise<void> {
    if (!(await this.isCohortMember(payload.cohortId, payload.userId))) return;
    const instances = await this.listCohortInstances(payload.cohortId);
    for (const instance of instances) {
      if (instance.status !== 0) continue;
      await this.enrolFromCohortSync(instance, payload.userId);
    }
  }

  async materializeCohortMemberRemoved(payload: { cohortId: string; userId: string }): Promise<void> {
    if (await this.isCohortMember(payload.cohortId, payload.userId)) return;
    const instances = await this.listCohortInstances(payload.cohortId);
    for (const instance of instances) {
      const ue = await this.getUserEnrolment(instance.id, payload.userId);
      if (!ue || ue.status === ENROL_WITHDRAWN) continue;
      if (instance.customText1 === 'unenrol') {
        await this.unenrolInternal(instance, payload.userId);
      } else {
        await this.updateUserEnrolment(this.db, ue.id, { status: ENROL_SUSPENDED, modifierId: null });
        await this.outbox.enqueueStandalone({
          aggregate: 'enrol', type: 'user_enrolment_suspended',
          payload: { courseId: instance.courseId, userId: payload.userId, instanceId: instance.id, reason: 'cohort_removed' },
        });
      }
    }
  }
}
