import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';
import { authzContexts } from './authorization.js';

export const classes = pgTable(
  'classes',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    name: text('name').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    authzContextId: uuid('authz_context_id')
      .unique()
      .references(() => authzContexts.id),
    status: text('status').default('active').notNull(),
    joinMode: text('join_mode').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('classes_created_by_idx').on(table.createdByUserId),
    check('classes_status_check', sql`${table.status} in ('active', 'archived')`),
    check('classes_join_mode_check', sql`${table.joinMode} in ('AUTO', 'APPROVAL')`),
    check('classes_name_check', sql`length(trim(${table.name})) > 0`),
  ],
);

export const classEnrolments = pgTable(
  'class_enrolments',
  {
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull(),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  },
  (table) => [
    primaryKey({ columns: [table.classId, table.userId] }),
    index('class_enrolments_user_idx').on(table.userId),
    check(
      'class_enrolments_status_check',
      sql`${table.status} in ('pending', 'active', 'suspended', 'left')`,
    ),
  ],
);

export const classJoinCodes = pgTable(
  'class_join_codes',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    maxUses: integer('max_uses'),
    usedCount: integer('used_count').default(0).notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('class_join_codes_hash_unique').on(table.codeHash),
    index('class_join_codes_class_idx').on(table.classId),
    check('class_join_codes_max_uses_check', sql`${table.maxUses} is null or ${table.maxUses} > 0`),
    check('class_join_codes_used_count_check', sql`${table.usedCount} >= 0`),
  ],
);
