import { Injectable } from '@nestjs/common';
import { badRequest, notFound } from '../../common/http-errors';
import type { UserListStatus, UserWithAssignmentsListResponse } from '@giaokhoa/contracts';
import { OutboxService } from '../../infra/events/outbox.service';
import { AccessRepository, type AssignmentListRow, type RoleRow } from '@giaokhoa/db/repositories/access';
import { ContextsService } from './contexts.service';
import { CAPABILITY_DEFINITIONS, DEFAULT_ROLES } from './domain/capabilities';
import { CAP_ALLOW, CAP_INHERIT, CAP_PREVENT, CAP_PROHIBIT } from './domain/permission';
import { PlanLimitsService, TEACHING_ROLE_ARCHETYPES } from './plan-limits.service';
import { RoleSeparationService } from './role-separation.service';
import type { CentreTx } from '@giaokhoa/db';

const VALID_PERMISSIONS = [CAP_PROHIBIT, CAP_PREVENT, CAP_INHERIT, CAP_ALLOW];

export interface AssignmentSource {
  component: string;
  itemId?: string | null;
}

export const ENROL_ASSIGNMENT_COMPONENT = 'enrol';

export interface RoleListItem extends RoleRow {
  userCount: number;
  overrideCount: number;
  readOverrideCount: number;
  writeOverrideCount: number;
  resourceCount: number;
}

export interface RoleCapabilityMatrixItem {
  id: string;
  name: string;
  userCount: number;
  overrides: { capability: string; permission: number }[];
}

export function isEnrolManagedAssignment(assignment: { component?: string | null }): boolean {
  return assignment.component === ENROL_ASSIGNMENT_COMPONENT;
}

@Injectable()
export class RolesService {
  constructor(
    private readonly repo: AccessRepository,
    private readonly contexts: ContextsService,
    private readonly outbox: OutboxService,
    private readonly planLimits: PlanLimitsService,
    private readonly roleSeparation: RoleSeparationService,
  ) {}

  async seedDefaults(): Promise<void> {
    const system = await this.contexts.ensureSystemContext();
    for (const def of CAPABILITY_DEFINITIONS) await this.repo.upsertCapability(def);
    const registryNames = CAPABILITY_DEFINITIONS.map((c) => c.name);
    await this.repo.deleteRoleCapabilitiesNotIn(registryNames);
    await this.repo.deleteCapabilitiesNotIn(registryNames);
    for (const def of DEFAULT_ROLES) {
      let roleRow = await this.repo.getRoleByShortname(def.shortName);
      if (!roleRow) roleRow = await this.repo.insertRole({ ...def, description: '' });
      await this.repo.deleteRoleCapabilitiesAtContext(roleRow.id, system.id, CAPABILITY_DEFINITIONS.map((c) => c.name));
      for (const capDef of CAPABILITY_DEFINITIONS) {
        const perm = capDef.archetypes[def.archetype];
        if (perm !== undefined) {
          await this.repo.upsertRoleCapability({ contextId: system.id, roleId: roleRow.id, capability: capDef.name, permission: perm });
        }
      }
    }
  }

  async createRole(input: { name: string; shortName: string; description?: string; archetype?: string }): Promise<RoleRow> {
    const shortName = input.shortName.trim().toLowerCase();
    if (await this.repo.getRoleByShortname(shortName)) {
      badRequest(`Role shortName ${shortName} already exists`, 'access.role_shortname_taken');
    }
    const roles = await this.repo.listRoles();
    return this.repo.insertRole({ name: input.name, shortName, description: input.description ?? '', archetype: input.archetype, sortOrder: roles.length + 1 });
  }
  async listRoles(): Promise<RoleListItem[]> {
    const [roles, userCounts, aggregates] = await Promise.all([
      this.repo.listRoles(),
      this.repo.countDistinctUsersByRole(),
      this.repo.getRoleOverrideAggregates(),
    ]);
    const userCountByRole = new Map(userCounts.map((row) => [row.roleId, row.userCount]));
    const aggregateByRole = new Map(aggregates.map((row) => [row.roleId, row]));
    return roles.map((roleRow) => {
      const aggregate = aggregateByRole.get(roleRow.id);
      return {
        ...roleRow,
        userCount: userCountByRole.get(roleRow.id) ?? 0,
        overrideCount: aggregate?.overrideCount ?? 0,
        readOverrideCount: aggregate?.readOverrideCount ?? 0,
        writeOverrideCount: aggregate?.writeOverrideCount ?? 0,
        resourceCount: aggregate?.resourceCount ?? 0,
      };
    });
  }
  async getRole(id: string): Promise<RoleRow> {
    const row = await this.repo.getRoleById(id);
    if (!row) notFound(`Role ${id} not found`, 'access.role_not_found');
    return row;
  }
  async getRoleByShortname(shortName: string): Promise<RoleRow | undefined> { return this.repo.getRoleByShortname(shortName); }
  async updateRole(id: string, input: { name?: string; description?: string }): Promise<RoleRow> {
    await this.getRole(id);
    await this.repo.updateRole(id, input);
    return this.getRole(id);
  }
  async deleteRole(id: string): Promise<void> {
    const roleRow = await this.getRole(id);
    if (roleRow.archetype) {
      badRequest(`Role ${roleRow.shortName} is a built-in archetype role and cannot be deleted`, 'access.role_archetype_delete_forbidden');
    }
    const assignments = await this.repo.listAssignmentsByRole(id);
    if (assignments.length > 0) {
      badRequest(`Role ${roleRow.shortName} is still held by ${assignments.length} assignment(s) and cannot be deleted`, 'access.role_has_assignments');
    }
    const overrides = await this.repo.listRoleCapabilities(id);
    const contextIds = [...new Set([...assignments.map((a) => a.contextId), ...overrides.map((o) => o.contextId)])];
    await this.repo.deleteRole(id);
    for (const contextId of contextIds) await this.contexts.markContextDirty(contextId);
  }

  async assignRole(userId: string, roleId: string, contextId: string, modifierId?: string, source?: AssignmentSource, tx?: CentreTx): Promise<unknown> {
    const roleRow = await this.getRole(roleId);
    await this.contexts.getContext(contextId, tx);
    if ((TEACHING_ROLE_ARCHETYPES as readonly string[]).includes(roleRow.archetype ?? '')) {
      const tenantId = await this.planLimits.tenantIdForContext(contextId, tx);
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
    const existing = await this.repo.listAssignments({ userId, contextId }, tx);
    const alreadyAssigned = existing.some((a) => a.roleId === roleId && a.component === component && (a.itemId ?? null) === itemId);
    const row = await this.repo.insertAssignment({ roleId: roleId, userId: userId, contextId: contextId, modifierId: modifierId, component, itemId }, tx);
    await this.contexts.markContextDirty(contextId, tx);
    if (!alreadyAssigned) {
      const event = {
        aggregate: 'access', type: 'role_assigned',
        payload: { assignmentId: (row as { id: string }).id, userId, roleId, contextId, actorId: modifierId ?? null, component, itemId },
      } as const;
      if (tx) await this.outbox.enqueueKysely(tx, event);
      else await this.outbox.enqueueStandalone(event);
    }
    return row;
  }
  async unassignRole(assignmentId: string, modifierId?: string, opts?: { allowEnrolManaged?: boolean }): Promise<void> {
    const existing = await this.repo.getAssignment(assignmentId);
    if (existing && isEnrolManagedAssignment(existing) && !opts?.allowEnrolManaged) {
      badRequest('This role assignment is managed by an enrolment and cannot be removed directly; unenrol the user from the enrolment instance instead', 'access.assignment_enrol_managed');
    }
    await this.repo.deleteAssignment(assignmentId);
    if (existing) {
      await this.contexts.markContextDirty(existing.contextId);
      await this.outbox.enqueueStandalone({
        aggregate: 'access', type: 'role_unassigned',
        payload: { assignmentId, userId: existing.userId, roleId: existing.roleId, contextId: existing.contextId, actorId: modifierId ?? null },
      });
    }
  }
  async listAssignments(filter: { userId?: string; contextId?: string }, tx?: CentreTx): Promise<unknown[]> {
    return this.repo.listAssignments(filter, tx);
  }
  async listAssignmentsPage(
    filter: { userId?: string; contextId?: string; roleId?: string; search?: string },
    page: number,
    pageSize: number,
  ): Promise<{ assignments: AssignmentListRow[]; total: number; page: number; pageSize: number }> {
    const { rows, total } = await this.repo.listAssignmentsPage(filter, page, pageSize);
    return { assignments: rows, total, page, pageSize };
  }
  async listUsersWithAssignmentsPage(
    filter: { search?: string; roleId?: string; status?: UserListStatus },
    page: number,
    pageSize: number,
  ): Promise<UserWithAssignmentsListResponse> {
    const { rows, total } = await this.repo.listUsersWithAssignmentsPage(filter, page, pageSize);
    return {
      users: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      total,
      page,
      pageSize,
    };
  }
  async listAssignmentsInContexts(userId: string, contextIds: string[]): Promise<{ roleId: string; contextId: string }[]> {
    return this.repo.getAssignmentsForUserInContexts(userId, contextIds);
  }

  async setCapabilityOverride(roleId: string, capability: string, contextId: string, permission: number, modifierId?: string, tx?: CentreTx): Promise<void> {
    if (!VALID_PERMISSIONS.includes(permission)) {
      badRequest(`Invalid permission ${permission}`, 'access.invalid_permission');
    }
    await this.getRole(roleId);
    await this.contexts.getContext(contextId, tx);
    if (permission === CAP_INHERIT) {
      await this.repo.deleteRoleCapability(contextId, roleId, capability, tx);
    } else {
      await this.repo.upsertRoleCapability({ contextId: contextId, roleId: roleId, capability, permission, modifierId: modifierId }, tx);
    }
    await this.contexts.markContextDirty(contextId, tx);
  }
  async replaceRoleCapabilities(
    roleId: string,
    contextId: string,
    overrides: { capability: string; permission: number }[],
    modifierId?: string,
  ): Promise<{ capability: string; permission: number }[]> {
    await this.getRole(roleId);
    await this.contexts.getContext(contextId);
    const seen = new Set<string>();
    for (const entry of overrides) {
      if (seen.has(entry.capability)) {
        badRequest(`Capability ${entry.capability} appears more than once in the submitted matrix`, 'access.duplicate_capability_override');
      }
      seen.add(entry.capability);
      if (!VALID_PERMISSIONS.includes(entry.permission)) {
        badRequest(`Invalid permission ${entry.permission}`, 'access.invalid_permission');
      }
    }
    const catalog = new Set((await this.repo.listCapabilities()).map((row) => row.name));
    for (const entry of overrides) {
      if (!catalog.has(entry.capability)) {
        badRequest(`Unknown capability ${entry.capability}`, 'access.unknown_capability');
      }
    }
    const effective = overrides.filter((entry) => entry.permission !== CAP_INHERIT);
    await this.repo.transaction(async (tx) => {
      await this.repo.deleteRoleCapabilitiesInContext(roleId, contextId, tx);
      for (const entry of effective) {
        await this.repo.upsertRoleCapability({ contextId, roleId, capability: entry.capability, permission: entry.permission, modifierId }, tx);
      }
      await this.contexts.markContextDirty(contextId, tx);
    });
    const saved = await this.repo.listRoleCapabilitiesAtContext(roleId, contextId);
    return saved
      .map((row) => ({ capability: row.capability, permission: row.permission }))
      .sort((a, b) => a.capability.localeCompare(b.capability));
  }
  async listRoleCapabilities(roleId: string): Promise<unknown[]> {
    await this.getRole(roleId);
    return this.repo.listRoleCapabilities(roleId);
  }
  async getCapabilityMatrix(contextId: string): Promise<{ contextId: string; roles: RoleCapabilityMatrixItem[] }> {
    await this.contexts.getContext(contextId);
    const [roles, userCounts, overrideRows] = await Promise.all([
      this.repo.listRoles(),
      this.repo.countDistinctUsersByRole(),
      this.repo.listAllRoleCapabilitiesAtContext(contextId),
    ]);
    const userCountByRole = new Map(userCounts.map((row) => [row.roleId, row.userCount]));
    const overridesByRole = new Map<string, { capability: string; permission: number }[]>();
    for (const row of overrideRows) {
      const list = overridesByRole.get(row.roleId) ?? [];
      list.push({ capability: row.capability, permission: row.permission });
      overridesByRole.set(row.roleId, list);
    }
    return {
      contextId,
      roles: roles.map((roleRow) => ({
        id: roleRow.id,
        name: roleRow.name,
        userCount: userCountByRole.get(roleRow.id) ?? 0,
        overrides: overridesByRole.get(roleRow.id) ?? [],
      })),
    };
  }
  async listCapabilities(): Promise<unknown[]> { return this.repo.listCapabilities(); }
}
