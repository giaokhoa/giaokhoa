import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';

/** Shared source material that one or more independent questions may reference. */
export const stimuli = pgTable('stimuli', {
  id: uuid('id')
    .default(sql`uuidv7()`)
    .primaryKey(),
  content: jsonb('content').notNull(),
});

/** Stable identity of a question across all of its revisions. */
export const questionBankEntries = pgTable(
  'question_bank_entries',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
  },
  (table) => [index('question_bank_entries_created_by_user_id_idx').on(table.createdByUserId)],
);

/** A complete, version-specific question definition. */
export const question = pgTable(
  'question',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    stimulusId: uuid('stimulus_id').references(() => stimuli.id),
    type: text('type').notNull(),
    content: jsonb('content').notNull(),
    guidance: jsonb('guidance'),
    solution: jsonb('solution'),
  },
  (table) => [
    check(
      'question_type_check',
      sql`${table.type} in ('multiple_choice', 'true_false', 'short_answer', 'essay')`,
    ),
    index('question_created_by_user_id_idx').on(table.createdByUserId),
    index('question_stimulus_id_idx').on(table.stimulusId),
  ],
);

/** Moodle-style association between a stable bank entry and each question revision. */
export const questionVersions = pgTable(
  'question_versions',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    questionBankEntryId: uuid('question_bank_entry_id')
      .notNull()
      .references(() => questionBankEntries.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => question.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status').notNull(),
  },
  (table) => [
    check('question_versions_version_check', sql`${table.version} > 0`),
    check('question_versions_status_check', sql`${table.status} in ('draft', 'ready')`),
    unique('question_versions_entry_version_unique').on(table.questionBankEntryId, table.version),
    unique('question_versions_question_unique').on(table.questionId),
    index('question_versions_entry_id_idx').on(table.questionBankEntryId),
  ],
);
