import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';

/** Shared source material that one or more independent questions may reference. */
export const stimuli = pgTable('stimuli', {
  id: uuid('id')
    .default(sql`uuidv7()`)
    .primaryKey(),
  content: jsonb('content').notNull(),
});

/** Canonical question item. Multipart content remains inside the question JSON. */
export const questions = pgTable(
  'questions',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    stimulusId: uuid('stimulus_id').references(() => stimuli.id),
    type: text('type').notNull(),
    status: text('status').notNull(),
    content: jsonb('content').notNull(),
    guidance: jsonb('guidance'),
    solution: jsonb('solution'),
  },
  (table) => [
    check('questions_status_check', sql`${table.status} in ('draft', 'ready')`),
    check(
      'questions_ready_solution_check',
      sql`${table.status} = 'draft' or ${table.solution} is not null`,
    ),
    check(
      'questions_type_check',
      sql`${table.type} in ('multiple_choice', 'true_false', 'short_answer', 'essay')`,
    ),
    index('questions_created_by_user_id_idx').on(table.createdByUserId),
    index('questions_stimulus_id_idx').on(table.stimulusId),
  ],
);
