import {
  sql,
  type ExpressionBuilder,
  type Insertable,
  type InsertObject,
  type RawBuilder,
  type Updateable,
} from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { JsonValue } from '../types/centre-db';
import { applyDefined } from './mapping';
import type { UserListStatus } from '@giaokhoa/contracts';


export type AccessDb = CentreDb | CentreTx;
export type AccessTx = CentreTx;


export interface ContextRow {
  id: string;
  contextLevel: number;
  instanceId: string | null;
  path: string;
  depth: number;
  locked: boolean;
  version: number;
}

export interface CapabilityRow {
  id: string;
  name: string;
  capType: string;
  contextLevel: number;
  component: string;
  riskBitmask: number;
}

export interface RoleRow {
  id: string;
  name: string;
  shortName: string;
  description: string;
  sortOrder: number;
  archetype: string | null;
}

export interface AssignmentRow {
  id: string;
  roleId: string;
  userId: string;
  contextId: string;
  updatedAt: Date;
  modifierId: string | null;
  component: string;
  itemId: string | null;
}

export type AssignmentListRow = AssignmentRow & {
  userName: string | null;
  userEmail: string | null;
};

export interface RoleCapabilityRow {
  id: string;
  contextId: string;
  roleId: string;
  capability: string;
  permission: number;
  updatedAt: Date;
  modifierId: string | null;
}

export interface UserWithAssignmentsAssignmentRow {
  id: string;
  roleId: string;
  roleName: string;
  contextId: string;
  contextLevel: number;
  component: string;
}

export interface UserWithAssignmentsRow {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  suspended: boolean;
  deleted: boolean;
  createdAt: Date;
  assignments: UserWithAssignmentsAssignmentRow[];
}


export interface NewContext {
  contextLevel: number;
  instanceId: string | null;
  path: string;
  depth: number;
}

export interface NewRole {
  name: string;
  shortName: string;
  description?: string;
  archetype?: string | null;
  sortOrder?: number;
}

export interface NewAssignment {
  roleId: string;
  userId: string;
  contextId: string;
  modifierId?: string | null;
  component?: string;
  itemId?: string | null;
}

export interface NewRoleCapability {
  contextId: string;
  roleId: string;
  capability: string;
  permission: number;
  modifierId?: string | null;
}


const CONTEXT_COLUMNS = [
  'id',
  'context_level as contextLevel',
  'instance_id as instanceId',
  'path',
  'depth',
  'locked',
  'version',
] as const;

const CAPABILITY_COLUMNS = [
  'id',
  'name',
  'cap_type as capType',
  'context_level as contextLevel',
  'component',
  'risk_bitmask as riskBitmask',
] as const;

const ROLE_COLUMNS = [
  'id',
  'name',
  'short_name as shortName',
  'description',
  'sort_order as sortOrder',
  'archetype',
] as const;

const ASSIGNMENT_COLUMNS = [
  'id',
  'role_id as roleId',
  'user_id as userId',
  'context_id as contextId',
  'updated_at as updatedAt',
  'modifier_id as modifierId',
  'component',
  'item_id as itemId',
] as const;

const ROLE_CAPABILITY_COLUMNS = [
  'id',
  'context_id as contextId',
  'role_id as roleId',
  'capability',
  'permission',
  'updated_at as updatedAt',
  'modifier_id as modifierId',
] as const;


function contextInsertValues(v: NewContext): Insertable<CentreDB['context']> {
  return {
    context_level: v.contextLevel,
    instance_id: v.instanceId,
    path: v.path,
    depth: v.depth,
  };
}

function roleInsertValues(v: NewRole): Insertable<CentreDB['role']> {
  const row: Insertable<CentreDB['role']> = {
    name: v.name,
    short_name: v.shortName,
  };
  applyDefined(row, v, [
    ['description', 'description'],
    ['archetype', 'archetype'],
    ['sortOrder', 'sort_order'],
  ]);
  return row;
}

function roleUpdateValues(v: Partial<NewRole>): Updateable<CentreDB['role']> {
  const set: Updateable<CentreDB['role']> = {};
  applyDefined(set, v, [
    ['name', 'name'],
    ['shortName', 'short_name'],
    ['description', 'description'],
    ['archetype', 'archetype'],
    ['sortOrder', 'sort_order'],
  ]);
  return set;
}

function assignmentInsertValues(v: NewAssignment): Insertable<CentreDB['role_assignments']> {
  const row: Insertable<CentreDB['role_assignments']> = {
    role_id: v.roleId,
    user_id: v.userId,
    context_id: v.contextId,
  };
  applyDefined(row, v, [
    ['modifierId', 'modifier_id'],
    ['component', 'component'],
    ['itemId', 'item_id'],
  ]);
  return row;
}

function roleCapabilityInsertValues(v: NewRoleCapability): Insertable<CentreDB['role_capabilities']> {
  const row: Insertable<CentreDB['role_capabilities']> = {
    context_id: v.contextId,
    role_id: v.roleId,
    capability: v.capability,
    permission: v.permission,
  };
  if (v.modifierId !== undefined) row.modifier_id = v.modifierId;
  return row;
}

function jsonbValue(value: unknown): RawBuilder<JsonValue> {
  return sql<JsonValue>`${JSON.stringify(value)}::jsonb`;
}


export class AccessRepository {
  constructor(private readonly handle: CentreDb) {}

  async transaction<T>(fn: (tx: AccessTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }


  async insertContext(values: NewContext, tx?: AccessDb): Promise<ContextRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('context')
      .values(contextInsertValues(values))
      .returning(CONTEXT_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<ContextRow>;
  }

  async updateContextPath(id: string, path: string, depth: number, tx?: AccessDb): Promise<void> {
    const db = tx ?? this.handle;
    await db.updateTable('context').set({ path, depth }).where('id', '=', id).execute();
  }

  async getContextById(id: string, tx?: AccessDb): Promise<ContextRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('context')
      .select(CONTEXT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<ContextRow | undefined>;
  }

  async getContextByLevelInstance(contextLevel: number, instanceId: string | null, tx?: AccessDb): Promise<ContextRow | undefined> {
    const db = tx ?? this.handle;
    let query = db
      .selectFrom('context')
      .select(CONTEXT_COLUMNS)
      .where('context_level', '=', contextLevel);
    query = instanceId === null
      ? query.where('instance_id', 'is', null)
      : query.where('instance_id', '=', instanceId);
    return query.executeTakeFirst() as Promise<ContextRow | undefined>;
  }

  async getContextsByLevelInstances(contextLevel: number, instanceIds: string[]): Promise<ContextRow[]> {
    if (instanceIds.length === 0) return [];
    return this.handle
      .selectFrom('context')
      .select(CONTEXT_COLUMNS)
      .where('context_level', '=', contextLevel)
      .where('instance_id', 'in', instanceIds)
      .execute() as Promise<ContextRow[]>;
  }

  async getContextsByIds(ids: string[]): Promise<ContextRow[]> {
    if (ids.length === 0) return [];
    return this.handle
      .selectFrom('context')
      .select(CONTEXT_COLUMNS)
      .where('id', 'in', ids)
      .execute() as Promise<ContextRow[]>;
  }

  async listContexts(): Promise<ContextRow[]> {
    return this.handle
      .selectFrom('context')
      .select(CONTEXT_COLUMNS)
      .orderBy('path')
      .execute() as Promise<ContextRow[]>;
  }

  async deleteContext(id: string): Promise<void> {
    await this.handle.deleteFrom('context').where('id', '=', id).execute();
  }

  async bumpContextVersions(pathPrefix: string, tx?: AccessDb): Promise<void> {
    const db = tx ?? this.handle;
    await db
      .updateTable('context')
      .set({ version: sql<number>`version + 1` })
      .where((eb) => eb.or([
        eb('path', '=', pathPrefix),
        eb('path', 'like', `${pathPrefix}/%`),
      ]))
      .execute();
  }


  async getTenantGateInfo(tenantId: string): Promise<{ kind: string; status: string } | undefined> {
    return this.handle
      .selectFrom('tenants')
      .select(['kind', 'status'])
      .where('id', '=', tenantId)
      .executeTakeFirst();
  }

  async getMembershipStatus(tenantId: string, userId: string): Promise<string | undefined> {
    const row = await this.handle
      .selectFrom('tenant_memberships')
      .select(['status'])
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row?.status;
  }

  async getTenantGateInfos(tenantIds: string[]): Promise<{ id: string; kind: string; status: string }[]> {
    if (tenantIds.length === 0) return [];
    return this.handle
      .selectFrom('tenants')
      .select(['id', 'kind', 'status'])
      .where('id', 'in', tenantIds)
      .execute();
  }

  async getMembershipStatuses(tenantIds: string[], userId: string): Promise<{ tenantId: string; status: string }[]> {
    if (tenantIds.length === 0) return [];
    return this.handle
      .selectFrom('tenant_memberships')
      .select(['tenant_id as tenantId', 'status'])
      .where('tenant_id', 'in', tenantIds)
      .where('user_id', '=', userId)
      .execute();
  }


  async upsertCapability(def: { name: string; capType: string; contextLevel: number; component: string }): Promise<void> {
    await this.handle
      .insertInto('capabilities')
      .values({ name: def.name, cap_type: def.capType, context_level: def.contextLevel, component: def.component })
      .onConflict((oc) => oc.column('name').doUpdateSet({
        cap_type: def.capType,
        context_level: def.contextLevel,
        component: def.component,
      }))
      .execute();
  }

  async listCapabilities(): Promise<CapabilityRow[]> {
    return this.handle
      .selectFrom('capabilities')
      .select(CAPABILITY_COLUMNS)
      .orderBy('name')
      .execute() as Promise<CapabilityRow[]>;
  }

  async deleteCapabilitiesNotIn(names: string[]): Promise<void> {
    await this.handle.deleteFrom('capabilities').where('name', 'not in', names).execute();
  }

  async deleteRoleCapabilitiesNotIn(capabilityNames: string[]): Promise<void> {
    await this.handle.deleteFrom('role_capabilities').where('capability', 'not in', capabilityNames).execute();
  }


  async insertRole(values: NewRole, tx?: AccessDb): Promise<RoleRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('role')
      .values(roleInsertValues(values))
      .returning(ROLE_COLUMNS)
      .executeTakeFirstOrThrow() as Promise<RoleRow>;
  }

  async getRoleById(id: string): Promise<RoleRow | undefined> {
    return this.handle
      .selectFrom('role')
      .select(ROLE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<RoleRow | undefined>;
  }

  async getRoleByShortname(shortName: string): Promise<RoleRow | undefined> {
    return this.handle
      .selectFrom('role')
      .select(ROLE_COLUMNS)
      .where('short_name', '=', shortName)
      .executeTakeFirst() as Promise<RoleRow | undefined>;
  }

  async listRoles(): Promise<RoleRow[]> {
    return this.handle
      .selectFrom('role')
      .select(ROLE_COLUMNS)
      .orderBy('sort_order')
      .execute() as Promise<RoleRow[]>;
  }

  async countDistinctUsersByRole(): Promise<{ roleId: string; userCount: number }[]> {
    return this.handle
      .selectFrom('role_assignments')
      .select([
        'role_id as roleId',
        sql<number>`count(distinct role_assignments.user_id)::int`.as('userCount'),
      ])
      .groupBy('role_id')
      .execute();
  }

  async getRoleOverrideAggregates(): Promise<{ roleId: string; overrideCount: number; readOverrideCount: number; writeOverrideCount: number; resourceCount: number }[]> {
    return this.handle
      .selectFrom('role_capabilities')
      .leftJoin('capabilities', 'capabilities.name', 'role_capabilities.capability')
      .select([
        'role_capabilities.role_id as roleId',
        sql<number>`count(*)::int`.as('overrideCount'),
        sql<number>`coalesce(sum(case when capabilities.cap_type = 'read' then 1 else 0 end), 0)::int`.as('readOverrideCount'),
        sql<number>`coalesce(sum(case when capabilities.cap_type = 'write' then 1 else 0 end), 0)::int`.as('writeOverrideCount'),
        sql<number>`count(distinct split_part(role_capabilities.capability, ':', 1))::int`.as('resourceCount'),
      ])
      .groupBy('role_capabilities.role_id')
      .execute();
  }

  async updateRole(id: string, values: Partial<NewRole>): Promise<void> {
    await this.handle
      .updateTable('role')
      .set(roleUpdateValues(values))
      .where('id', '=', id)
      .execute();
  }

  async deleteRole(id: string): Promise<void> {
    await this.handle.deleteFrom('role_assignments').where('role_id', '=', id).execute();
    await this.handle.deleteFrom('role_capabilities').where('role_id', '=', id).execute();
    await this.handle.deleteFrom('role').where('id', '=', id).execute();
  }


  private findAssignmentByTuple(db: AccessDb, values: NewAssignment): Promise<AssignmentRow | undefined> {
    return db
      .selectFrom('role_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .where((eb) => eb.and([
        eb('role_id', '=', values.roleId),
        eb('user_id', '=', values.userId),
        eb('context_id', '=', values.contextId),
        eb('component', '=', values.component ?? ''),
        ...(values.itemId != null
          ? [eb('item_id', '=', values.itemId)]
          : [eb('item_id', 'is', null)]),
      ]))
      .executeTakeFirst() as Promise<AssignmentRow | undefined>;
  }

  async insertAssignment(values: NewAssignment, tx?: AccessDb): Promise<AssignmentRow> {
    const db = tx ?? this.handle;
    const preExisting = await this.findAssignmentByTuple(db, values);
    if (preExisting) return preExisting;
    const row = await db
      .insertInto('role_assignments')
      .values(assignmentInsertValues(values))
      .onConflict((oc) => oc.doNothing())
      .returning(ASSIGNMENT_COLUMNS)
      .executeTakeFirst();
    if (row) return row as AssignmentRow;
    const existing = await this.findAssignmentByTuple(db, values);
    return existing! as AssignmentRow;
  }

  async deleteAssignment(id: string): Promise<void> {
    await this.handle.deleteFrom('role_assignments').where('id', '=', id).execute();
  }

  async getAssignment(id: string): Promise<AssignmentRow | undefined> {
    return this.handle
      .selectFrom('role_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst() as Promise<AssignmentRow | undefined>;
  }

  async listAssignmentsByRole(roleId: string): Promise<AssignmentRow[]> {
    return this.handle
      .selectFrom('role_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .where('role_id', '=', roleId)
      .execute() as Promise<AssignmentRow[]>;
  }

  async listAssignments(filter: { userId?: string; contextId?: string }, tx?: AccessDb): Promise<AssignmentRow[]> {
    const db = tx ?? this.handle;
    let query = db.selectFrom('role_assignments').select(ASSIGNMENT_COLUMNS);
    if (filter.userId !== undefined) query = query.where('user_id', '=', filter.userId);
    if (filter.contextId !== undefined) query = query.where('context_id', '=', filter.contextId);
    return query.execute() as Promise<AssignmentRow[]>;
  }

  async listAssignmentsPage(
    filter: { userId?: string; contextId?: string; roleId?: string; search?: string },
    page: number,
    pageSize: number,
  ): Promise<{ rows: AssignmentListRow[]; total: number }> {
    const filtered = () => {
      let query = this.handle
        .selectFrom('role_assignments')
        .leftJoin('users', 'users.id', 'role_assignments.user_id');
      if (filter.userId !== undefined) query = query.where('role_assignments.user_id', '=', filter.userId);
      if (filter.contextId !== undefined) query = query.where('role_assignments.context_id', '=', filter.contextId);
      if (filter.roleId !== undefined) query = query.where('role_assignments.role_id', '=', filter.roleId);
      if (filter.search) {
        const pattern = `%${filter.search}%`;
        query = query.where((eb) => eb.or([
          eb('users.first_name', 'ilike', pattern),
          eb('users.last_name', 'ilike', pattern),
          eb('users.email', 'ilike', pattern),
          eb('users.username', 'ilike', pattern),
          sql<boolean>`users.first_name || ' ' || users.last_name ilike ${pattern}`,
        ]));
      }
      return query;
    };
    const rows = await (filtered()
      .select([
        'role_assignments.id as id',
        'role_assignments.role_id as roleId',
        'role_assignments.user_id as userId',
        'role_assignments.context_id as contextId',
        'role_assignments.component as component',
        'role_assignments.item_id as itemId',
        'role_assignments.modifier_id as modifierId',
        'role_assignments.updated_at as updatedAt',
        sql<string | null>`case when users.id is null then null when trim(users.first_name || ' ' || users.last_name) = '' then users.username else trim(users.first_name || ' ' || users.last_name) end`.as('userName'),
        'users.email as userEmail',
      ])
      .orderBy('role_assignments.id')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute() as Promise<AssignmentListRow[]>);
    const count = await filtered()
      .select(sql<number>`count(*)::int`.as('n'))
      .executeTakeFirst();
    return { rows, total: count?.n ?? 0 };
  }

  async listUsersWithAssignmentsPage(
    filter: { search?: string; roleId?: string; status?: UserListStatus },
    page: number,
    pageSize: number,
  ): Promise<{ rows: UserWithAssignmentsRow[]; total: number }> {
    const applyConditions = (eb: ExpressionBuilder<CentreDB, 'users'>) => {
      const conds = [eb('deleted', '=', filter.status === 'deleted')];
      if (filter.status === 'active') conds.push(eb('suspended', '=', false));
      if (filter.status === 'suspended') conds.push(eb('suspended', '=', true));
      if (filter.roleId !== undefined) {
        const roleId = filter.roleId;
        conds.push(eb.exists(
          eb.selectFrom('role_assignments')
            .select(sql`1`.as('one'))
            .where('role_assignments.user_id', '=', eb.ref('users.id'))
            .where('role_assignments.role_id', '=', roleId),
        ));
      }
      if (filter.search) {
        const pattern = `%${filter.search}%`;
        conds.push(eb.or([
          eb('first_name', 'ilike', pattern),
          eb('last_name', 'ilike', pattern),
          eb('email', 'ilike', pattern),
          eb('username', 'ilike', pattern),
          sql<boolean>`first_name || ' ' || last_name ilike ${pattern}`,
        ]));
      }
      return eb.and(conds);
    };
    const count = await this.handle
      .selectFrom('users')
      .select(sql<number>`count(*)::int`.as('n'))
      .where((eb) => applyConditions(eb))
      .executeTakeFirst();
    const total = count?.n ?? 0;
    const userRows = await this.handle
      .selectFrom('users')
      .select([
        'id',
        'username',
        'first_name as firstName',
        'last_name as lastName',
        'email',
        'suspended',
        'deleted',
        'created_at as createdAt',
      ])
      .where((eb) => applyConditions(eb))
      .orderBy('id')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();
    if (userRows.length === 0) return { rows: [], total };
    const assignmentRows = await this.handle
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .innerJoin('context', 'context.id', 'role_assignments.context_id')
      .select([
        'role_assignments.id as id',
        'role_assignments.user_id as userId',
        'role_assignments.role_id as roleId',
        'role.name as roleName',
        'role_assignments.context_id as contextId',
        'context.context_level as contextLevel',
        'role_assignments.component as component',
      ])
      .where('role_assignments.user_id', 'in', userRows.map((row) => row.id))
      .orderBy('role_assignments.id')
      .execute();
    const assignmentsByUser = new Map<string, UserWithAssignmentsAssignmentRow[]>();
    for (const row of assignmentRows) {
      const entry: UserWithAssignmentsAssignmentRow = {
        id: row.id,
        roleId: row.roleId,
        roleName: row.roleName,
        contextId: row.contextId,
        contextLevel: row.contextLevel,
        component: row.component,
      };
      const entries = assignmentsByUser.get(row.userId);
      if (entries) entries.push(entry);
      else assignmentsByUser.set(row.userId, [entry]);
    }
    return {
      rows: userRows.map((row) => ({ ...row, assignments: assignmentsByUser.get(row.id) ?? [] })),
      total,
    };
  }

  async getAssignmentsForUserInContexts(userId: string, contextIds: string[]): Promise<AssignmentRow[]> {
    if (contextIds.length === 0) return [];
    return this.handle
      .selectFrom('role_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .where('user_id', '=', userId)
      .where('context_id', 'in', contextIds)
      .execute() as Promise<AssignmentRow[]>;
  }


  async upsertRoleCapability(values: NewRoleCapability, tx?: AccessDb): Promise<void> {
    const db = tx ?? this.handle;
    await db
      .insertInto('role_capabilities')
      .values(roleCapabilityInsertValues(values))
      .onConflict((oc) => oc.columns(['context_id', 'role_id', 'capability']).doUpdateSet({
        permission: values.permission,
        updated_at: new Date(),
      }))
      .execute();
  }

  async deleteRoleCapability(contextId: string, roleId: string, capability: string, tx?: AccessDb): Promise<void> {
    const db = tx ?? this.handle;
    await db
      .deleteFrom('role_capabilities')
      .where('context_id', '=', contextId)
      .where('role_id', '=', roleId)
      .where('capability', '=', capability)
      .execute();
  }

  async getOverridesForRoles(roleIds: string[], capability: string, contextIds: string[]): Promise<RoleCapabilityRow[]> {
    if (roleIds.length === 0 || contextIds.length === 0) return [];
    return this.handle
      .selectFrom('role_capabilities')
      .select(ROLE_CAPABILITY_COLUMNS)
      .where('role_id', 'in', roleIds)
      .where('capability', '=', capability)
      .where('context_id', 'in', contextIds)
      .execute() as Promise<RoleCapabilityRow[]>;
  }

  async getOverridesForRolesInContexts(roleIds: string[], contextIds: string[]): Promise<RoleCapabilityRow[]> {
    if (roleIds.length === 0 || contextIds.length === 0) return [];
    return this.handle
      .selectFrom('role_capabilities')
      .select(ROLE_CAPABILITY_COLUMNS)
      .where('role_id', 'in', roleIds)
      .where('context_id', 'in', contextIds)
      .execute() as Promise<RoleCapabilityRow[]>;
  }

  async deleteRoleCapabilitiesAtContext(roleId: string, contextId: string, capabilityNames: string[]): Promise<void> {
    await this.handle
      .deleteFrom('role_capabilities')
      .where('role_id', '=', roleId)
      .where('context_id', '=', contextId)
      .where('capability', 'in', capabilityNames)
      .execute();
  }

  async listRoleCapabilities(roleId: string): Promise<RoleCapabilityRow[]> {
    return this.handle
      .selectFrom('role_capabilities')
      .select(ROLE_CAPABILITY_COLUMNS)
      .where('role_id', '=', roleId)
      .execute() as Promise<RoleCapabilityRow[]>;
  }

  async listRoleCapabilitiesAtContext(roleId: string, contextId: string, tx?: AccessDb): Promise<RoleCapabilityRow[]> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('role_capabilities')
      .select(ROLE_CAPABILITY_COLUMNS)
      .where('role_id', '=', roleId)
      .where('context_id', '=', contextId)
      .execute() as Promise<RoleCapabilityRow[]>;
  }

  async listAllRoleCapabilitiesAtContext(contextId: string): Promise<RoleCapabilityRow[]> {
    return this.handle
      .selectFrom('role_capabilities')
      .select(ROLE_CAPABILITY_COLUMNS)
      .where('context_id', '=', contextId)
      .orderBy('capability')
      .execute() as Promise<RoleCapabilityRow[]>;
  }

  async deleteRoleCapabilitiesInContext(roleId: string, contextId: string, tx?: AccessDb): Promise<void> {
    const db = tx ?? this.handle;
    await db
      .deleteFrom('role_capabilities')
      .where('role_id', '=', roleId)
      .where('context_id', '=', contextId)
      .execute();
  }


  async getConfigValue(key: string): Promise<unknown> {
    const row = await this.handle
      .selectFrom('config')
      .select(['value'])
      .where('key', '=', key)
      .executeTakeFirst();
    return row?.value as unknown;
  }

  async setConfigValue(key: string, value: unknown): Promise<void> {
    const row: InsertObject<CentreDB, 'config'> = { key, value: jsonbValue(value) };
    await this.handle
      .insertInto('config')
      .values(row)
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: jsonbValue(value), updated_at: new Date() }))
      .execute();
  }
}
