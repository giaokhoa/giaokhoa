import { getContextOrThrow, markContextDirty } from './contexts';
import { SharedDomainError } from './errors';
import { TEACHING_ROLE_ARCHETYPES, type PlanLimitsCore } from './plan-limits';
import type { RoleSeparationCore } from './role-separation';
import {
  ROLE_ASSIGNMENT_COLUMNS,
  ROLE_COLUMNS,
  type EnrolDatabase,
  type RoleAssignmentRow,
  type RoleRow,
  type SharedOutboxPort,
} from './types';

export interface AssignmentSource {
  component: string;
  itemId?: string | null;
}

export const ENROL_ASSIGNMENT_COMPONENT = 'enrol';

export function isEnrolManagedAssignment(assignment: { component?: string | null }): boolean {
  return assignment.component === ENROL_ASSIGNMENT_COMPONENT;
}

export class RoleAssignmentCore {
  constructor(
    private readonly db: EnrolDatabase,
    private readonly outbox: SharedOutboxPort,
    private readonly planLimits: PlanLimitsCore,
    private readonly roleSeparation: RoleSeparationCore,
  ) {}

  async getRoleOrThrow(roleId: string): Promise<RoleRow> {
    const row = await this.db.selectFrom('role').select(ROLE_COLUMNS).where('id', '=', roleId).executeTakeFirst();
    if (!row) throw new SharedDomainError('access.role_not_found', `Role ${roleId} not found`);
    return row;
  }

  async assignRole(
    userId: string,
    roleId: string,
    contextId: string,
    modifierId?: string,
    source?: AssignmentSource,
  ): Promise<RoleAssignmentRow> {
    const roleRow = await this.getRoleOrThrow(roleId);
    await getContextOrThrow(this.db, contextId);
    if ((TEACHING_ROLE_ARCHETYPES as readonly string[]).includes(roleRow.archetype ?? '')) {
      const tenantId = await this.planLimits.tenantIdForContext(contextId);
      if (tenantId) {
        const facts = await this.planLimits.describeUserInTenant(tenantId, userId);
        if (facts.membershipActive && facts.accountActive && !facts.counted) {
          await this.planLimits.assertTenantSlotForNewTeacher(tenantId, userId);
        }
      }
    }
    const component = source?.component ?? '';
    const itemId = source?.itemId ?? null;
    if (
      (TEACHING_ROLE_ARCHETYPES as readonly string[]).includes(roleRow.archetype ?? '')
      && !isEnrolManagedAssignment({ component })
    ) {
      await this.roleSeparation.assertTeachingAssignmentAllowed(userId, contextId);
    }
    const existing = await this.listAssignments({ userId, contextId });
    const alreadyAssigned = existing.some((a) => a.roleId === roleId && a.component === component && (a.itemId ?? null) === itemId);
    const row = await this.insertAssignment({ roleId, userId, contextId, modifierId, component, itemId });
    await markContextDirty(this.db, contextId);
    if (!alreadyAssigned) {
      await this.outbox.enqueueStandalone({
        aggregate: 'access', type: 'role_assigned',
        payload: { assignmentId: row.id, userId, roleId, contextId, actorId: modifierId ?? null, component, itemId },
      });
    }
    return row;
  }

  async unassignRole(assignmentId: string, modifierId?: string, opts?: { allowEnrolManaged?: boolean }): Promise<void> {
    const existing = await this.getAssignment(assignmentId);
    if (existing && isEnrolManagedAssignment(existing) && !opts?.allowEnrolManaged) {
      throw new SharedDomainError(
        'access.assignment_enrol_managed',
        'This role assignment is managed by an enrolment and cannot be removed directly; unenrol the user from the enrolment instance instead',
      );
    }
    await this.db.deleteFrom('role_assignments').where('id', '=', assignmentId).execute();
    if (existing) {
      await markContextDirty(this.db, existing.contextId);
      await this.outbox.enqueueStandalone({
        aggregate: 'access', type: 'role_unassigned',
        payload: { assignmentId, userId: existing.userId, roleId: existing.roleId, contextId: existing.contextId, actorId: modifierId ?? null },
      });
    }
  }

  private async insertAssignment(values: {
    roleId: string;
    userId: string;
    contextId: string;
    modifierId?: string | null;
    component: string;
    itemId: string | null;
  }): Promise<RoleAssignmentRow> {
    const row = await this.db
      .insertInto('role_assignments')
      .values({
        role_id: values.roleId,
        user_id: values.userId,
        context_id: values.contextId,
        ...(values.modifierId !== undefined ? { modifier_id: values.modifierId } : {}),
        component: values.component,
        item_id: values.itemId,
      })
      .onConflict((oc) => oc.doNothing())
      .returning(ROLE_ASSIGNMENT_COLUMNS)
      .executeTakeFirst();
    if (row) return row;
    return this.db
      .selectFrom('role_assignments')
      .select(ROLE_ASSIGNMENT_COLUMNS)
      .where((eb) => eb.and([
        eb('role_assignments.role_id', '=', values.roleId),
        eb('role_assignments.user_id', '=', values.userId),
        eb('role_assignments.context_id', '=', values.contextId),
        eb('role_assignments.component', '=', values.component),
        values.itemId != null
          ? eb('role_assignments.item_id', '=', values.itemId)
          : eb('role_assignments.item_id', 'is', null),
      ]))
      .executeTakeFirstOrThrow();
  }

  async getAssignment(id: string): Promise<RoleAssignmentRow | undefined> {
    return this.db
      .selectFrom('role_assignments')
      .select(ROLE_ASSIGNMENT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listAssignments(filter: { userId?: string; contextId?: string }): Promise<RoleAssignmentRow[]> {
    return this.db
      .selectFrom('role_assignments')
      .select(ROLE_ASSIGNMENT_COLUMNS)
      .where((eb) => {
        const conds = [];
        if (filter.userId !== undefined) conds.push(eb('role_assignments.user_id', '=', filter.userId));
        if (filter.contextId !== undefined) conds.push(eb('role_assignments.context_id', '=', filter.contextId));
        return eb.and(conds);
      })
      .execute();
  }
}
