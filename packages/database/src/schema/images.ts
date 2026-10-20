import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';
import { question } from './questions.js';

export const storageObjectDeletions = pgTable('storage_object_deletions', {
  storageKey: text('storage_key').primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const images = pgTable(
  'images',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    storageKey: text('storage_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    originalFilename: text('original_filename').notNull(),
    orphanedAt: timestamp('orphaned_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'images_mime_type_check',
      sql`${table.mimeType} in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')`,
    ),
    check('images_byte_size_check', sql`${table.byteSize} > 0`),
    check('images_dimensions_check', sql`${table.width} > 0 and ${table.height} > 0`),
    index('images_created_by_user_id_idx').on(table.createdByUserId),
    index('images_orphaned_at_idx').on(table.orphanedAt),
  ],
);

export const imageSources = pgTable(
  'image_sources',
  {
    imageId: uuid('image_id')
      .primaryKey()
      .references(() => images.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [check('image_sources_kind_check', sql`${table.kind} = 'tikz'`)],
);

export const imageVariants = pgTable(
  'image_variants',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    imageId: uuid('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    filename: text('filename').notNull(),
    orphanedAt: timestamp('orphaned_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'image_variants_mime_type_check',
      sql`${table.mimeType} in ('image/png', 'image/jpeg', 'image/webp')`,
    ),
    check('image_variants_byte_size_check', sql`${table.byteSize} > 0`),
    check('image_variants_dimensions_check', sql`${table.width} > 0 and ${table.height} > 0`),
    index('image_variants_image_id_idx').on(table.imageId),
    index('image_variants_orphaned_at_idx').on(table.orphanedAt),
  ],
);

export const questionImageRefs = pgTable(
  'question_image_refs',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => question.id, { onDelete: 'cascade' }),
    imageId: uuid('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
    imageVariantId: uuid('image_variant_id').references(() => imageVariants.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('question_image_refs_question_id_idx').on(table.questionId),
    index('question_image_refs_image_id_idx').on(table.imageId),
    index('question_image_refs_image_variant_id_idx').on(table.imageVariantId),
  ],
);
