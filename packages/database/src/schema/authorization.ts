import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';

export const authzContexts = pgTable(
  'authz_contexts',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    kind: text('kind').notNull(),
    resourceKey: text('resource_key').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => authzContexts.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('authz_contexts_kind_resource_unique').on(table.kind, table.resourceKey),
    index('authz_contexts_parent_idx').on(table.parentId),
    check(
      'authz_contexts_kind_check',
      sql`${table.kind} in ('system', 'user', 'bank', 'question', 'exam', 'class', 'assignment')`,
    ),
    check(
      'authz_contexts_parent_not_self_check',
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
  ],
);

export const authzRoles = pgTable(
  'authz_roles',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    key: text('key').notNull().unique(),
    contextKind: text('context_kind').notNull(),
    isBuiltin: boolean('is_builtin').default(true).notNull(),
  },
  (table) => [
    check('authz_roles_context_kind_check', sql`${table.contextKind} in ('system', 'class')`),
  ],
);

export const authzCapabilities = pgTable(
  'authz_capabilities',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    key: text('key').notNull().unique(),
    contextKind: text('context_kind').notNull(),
    description: text('description').notNull(),
  },
  (table) => [
    check(
      'authz_capabilities_context_kind_check',
      sql`${table.contextKind} in ('system', 'class')`,
    ),
  ],
);

export const authzRolePermissions = pgTable(
  'authz_role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => authzRoles.id),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => authzCapabilities.id),
    effect: text('effect').notNull(),
  },
  (table) => [
    unique('authz_role_permissions_role_capability_unique').on(table.roleId, table.capabilityId),
    check(
      'authz_role_permissions_effect_check',
      sql`${table.effect} in ('INHERIT', 'ALLOW', 'PREVENT', 'PROHIBIT')`,
    ),
  ],
);

export const authzRoleAssignments = pgTable(
  'authz_role_assignments',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => authzRoles.id),
    contextId: uuid('context_id')
      .notNull()
      .references(() => authzContexts.id),
    source: text('source').notNull(),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
    grantedAt: timestamp('granted_at').defaultNow().notNull(),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [
    uniqueIndex('authz_role_assignments_active_unique')
      .on(table.userId, table.roleId, table.contextId)
      .where(sql`${table.revokedAt} is null`),
    index('authz_role_assignments_context_idx').on(table.contextId),
    index('authz_role_assignments_user_idx').on(table.userId),
  ],
);
