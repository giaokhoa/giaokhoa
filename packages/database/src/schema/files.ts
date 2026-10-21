import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';
import { authzContexts } from './authorization.js';

/** Một bản bytes duy nhất cho mọi file có cùng SHA-256. */
export const fileBlobs = pgTable(
  'file_blobs',
  {
    contentHash: text('content_hash').primaryKey(),
    storageKey: text('storage_key').notNull().unique(),
    byteSize: integer('byte_size').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    check('file_blobs_content_hash_check', sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('file_blobs_byte_size_check', sql`${table.byteSize} >= 0`),
  ],
);

/** Asset bất biến; cùng một file có thể được dùng ở nhiều phiên bản nội dung. */
export const files = pgTable(
  'files',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    contentHash: text('content_hash')
      .notNull()
      .references(() => fileBlobs.contentHash),
    mimeType: text('mime_type').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    originalFilename: text('original_filename').notNull(),
    parentFileId: uuid('parent_file_id').references((): AnyPgColumn => files.id),
    orphanedAt: timestamp('orphaned_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    check('files_dimensions_check', sql`${table.width} > 0 and ${table.height} > 0`),
    check(
      'files_parent_not_self_check',
      sql`${table.parentFileId} is null or ${table.parentFileId} <> ${table.id}`,
    ),
    index('files_created_by_user_id_idx').on(table.createdByUserId),
    index('files_content_hash_idx').on(table.contentHash),
    index('files_parent_file_id_idx').on(table.parentFileId),
    index('files_orphaned_at_idx').on(table.orphanedAt),
  ],
);

/** Vị trí sử dụng kiểu Moodle: một asset có thể thuộc nhiều context/item. */
export const fileUses = pgTable(
  'file_uses',
  {
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    contextId: uuid('context_id')
      .notNull()
      .references(() => authzContexts.id),
    component: text('component').notNull(),
    fileArea: text('file_area').notNull(),
    itemId: text('item_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('file_uses_identity_unique').on(
      table.fileId,
      table.contextId,
      table.component,
      table.fileArea,
      table.itemId,
    ),
    index('file_uses_file_id_idx').on(table.fileId),
    index('file_uses_context_idx').on(table.contextId),
    check('file_uses_component_check', sql`length(trim(${table.component})) > 0`),
    check('file_uses_file_area_check', sql`length(trim(${table.fileArea})) > 0`),
    check('file_uses_item_id_check', sql`length(trim(${table.itemId})) > 0`),
  ],
);

/** Mã TikZ chỉ trả cho chủ sở hữu, không phát hành cùng binary. */
export const fileSources = pgTable(
  'file_sources',
  {
    fileId: uuid('file_id')
      .primaryKey()
      .references(() => files.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [check('file_sources_kind_check', sql`${table.kind} = 'tikz'`)],
);

/** Outbox: chỉ xóa object sau khi xóa metadata trong transaction. */
export const fileObjectDeletions = pgTable('file_object_deletions', {
  storageKey: text('storage_key').primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  availableAt: timestamp('available_at').defaultNow().notNull(),
});
