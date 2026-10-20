import { ClientError } from '@giaokhoa/application/common/client-error';
import type {
  AuthorizationContext,
  AuthorizationContextKind,
  AuthorizationRepository,
  ContextRef,
  ContextWithRoleInput,
  PermissionEffect,
  RoleAssignmentInput,
} from '@giaokhoa/application/authorization/repository';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { users } from '../schema/auth.generated.js';
import {
  authzCapabilities,
  authzContexts,
  authzRoleAssignments,
  authzRolePermissions,
  authzRoles,
} from '../schema/authorization.js';
import type { Database } from '../types.js';

function contextRecord(row: typeof authzContexts.$inferSelect): AuthorizationContext {
  return {
    id: row.id,
    kind: row.kind as AuthorizationContextKind,
    resourceKey: row.resourceKey,
    parentId: row.parentId,
  };
}

function invalidRole() {
  return new ClientError(
    'invalid',
    'authorization_role_invalid',
    'Vai trò không hợp lệ tại context',
  );
}

export class PostgresAuthorizationRepository implements AuthorizationRepository {
  constructor(private readonly db: Database) {}

  async findContext(ref: ContextRef) {
    const [row] = await this.db
      .select()
      .from(authzContexts)
      .where(and(eq(authzContexts.kind, ref.kind), eq(authzContexts.resourceKey, ref.resourceKey)))
      .limit(1);
    return row ? contextRecord(row) : undefined;
  }

  async findContextById(id: string) {
    const [row] = await this.db
      .select()
      .from(authzContexts)
      .where(eq(authzContexts.id, id))
      .limit(1);
    return row ? contextRecord(row) : undefined;
  }

  async findPermissions(actorId: string, capability: string, contextIds: string[]) {
    if (contextIds.length === 0) return [];
    const [actor] = await this.db
      .select({ role: users.role, banned: users.banned })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    if (!actor || actor.banned) return [];
    if (actor.role !== 'user' && actor.role !== 'teacher' && actor.role !== 'admin') return [];

    const scoped = await this.db
      .select({ contextId: authzRoleAssignments.contextId, effect: authzRolePermissions.effect })
      .from(authzRoleAssignments)
      .innerJoin(authzRoles, eq(authzRoleAssignments.roleId, authzRoles.id))
      .innerJoin(authzRolePermissions, eq(authzRolePermissions.roleId, authzRoles.id))
      .innerJoin(authzCapabilities, eq(authzRolePermissions.capabilityId, authzCapabilities.id))
      .where(
        and(
          eq(authzRoleAssignments.userId, actorId),
          inArray(authzRoleAssignments.contextId, contextIds),
          isNull(authzRoleAssignments.revokedAt),
          eq(authzCapabilities.key, capability),
        ),
      );

    const grants = scoped.map((row) => ({
      contextId: row.contextId,
      effect: row.effect as PermissionEffect,
    }));
    const [systemContext] = await this.db
      .select({ id: authzContexts.id })
      .from(authzContexts)
      .where(
        and(
          eq(authzContexts.kind, 'system'),
          eq(authzContexts.resourceKey, 'giaokhoa'),
          inArray(authzContexts.id, contextIds),
        ),
      )
      .limit(1);
    if (!systemContext) return grants;

    const system = await this.db
      .select({ effect: authzRolePermissions.effect })
      .from(authzRoles)
      .innerJoin(authzRolePermissions, eq(authzRolePermissions.roleId, authzRoles.id))
      .innerJoin(authzCapabilities, eq(authzRolePermissions.capabilityId, authzCapabilities.id))
      .where(
        and(eq(authzRoles.key, `system:${actor.role}`), eq(authzCapabilities.key, capability)),
      );
    return [
      ...grants,
      ...system.map((row) => ({
        contextId: systemContext.id,
        effect: row.effect as PermissionEffect,
      })),
    ];
  }

  async createContextWithRole(input: ContextWithRoleInput) {
    if (input.context.kind !== 'class')
      throw new ClientError(
        'invalid',
        'authorization_context_invalid',
        'Phase 1 chỉ materialize Class context',
      );

    return this.db.transaction(async (tx) => {
      const [parent] = await tx
        .select()
        .from(authzContexts)
        .where(eq(authzContexts.id, input.context.parentId))
        .limit(1);
      if (!parent || parent.kind !== 'system' || parent.resourceKey !== 'giaokhoa')
        throw new ClientError(
          'invalid',
          'authorization_parent_invalid',
          'Context cha không hợp lệ',
        );

      const [role] = await tx
        .select()
        .from(authzRoles)
        .where(eq(authzRoles.key, input.roleKey))
        .limit(1);
      if (!role || role.contextKind !== input.context.kind) throw invalidRole();

      const [created] = await tx
        .insert(authzContexts)
        .values({
          kind: input.context.kind,
          resourceKey: input.context.resourceKey,
          parentId: input.context.parentId,
        })
        .returning();
      await tx.insert(authzRoleAssignments).values({
        userId: input.userId,
        roleId: role.id,
        contextId: created.id,
        source: input.source,
        grantedByUserId: input.grantedByUserId,
      });
      return contextRecord(created);
    });
  }

  async assignRole(input: RoleAssignmentInput) {
    return this.db.transaction(async (tx) => {
      const [context] = await tx
        .select()
        .from(authzContexts)
        .where(eq(authzContexts.id, input.contextId))
        .limit(1);
      const [role] = await tx
        .select()
        .from(authzRoles)
        .where(eq(authzRoles.key, input.roleKey))
        .limit(1);
      if (!context || !role || context.kind !== role.contextKind || context.kind === 'system')
        throw invalidRole();

      const inserted = await tx
        .insert(authzRoleAssignments)
        .values({
          userId: input.userId,
          roleId: role.id,
          contextId: input.contextId,
          source: input.source,
          grantedByUserId: input.grantedByUserId,
        })
        .onConflictDoNothing()
        .returning({ id: authzRoleAssignments.id });
      return inserted.length > 0;
    });
  }

  async revokeRole(contextId: string, userId: string, roleKey: string) {
    return this.db.transaction(async (tx) => {
      const [role] = await tx
        .select({ id: authzRoles.id })
        .from(authzRoles)
        .where(eq(authzRoles.key, roleKey))
        .limit(1);
      if (!role) return false;
      const revoked = await tx
        .update(authzRoleAssignments)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authzRoleAssignments.contextId, contextId),
            eq(authzRoleAssignments.userId, userId),
            eq(authzRoleAssignments.roleId, role.id),
            isNull(authzRoleAssignments.revokedAt),
          ),
        )
        .returning({ id: authzRoleAssignments.id });
      return revoked.length > 0;
    });
  }
}
