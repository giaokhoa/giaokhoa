import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';
import { assignments, assignmentRecipients } from './assignments.js';

export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    attemptNumber: integer('attempt_number').notNull(),
    status: text('status').notNull().default('in_progress'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    submittedAt: timestamp('submitted_at'),
    gradedAt: timestamp('graded_at'),
    scoreBasisPoints: integer('score_basis_points'),
    feedback: text('feedback'),
  },
  (table) => [
    foreignKey({
      columns: [table.assignmentId, table.userId],
      foreignColumns: [assignmentRecipients.assignmentId, assignmentRecipients.userId],
      name: 'attempts_recipient_fk',
    }).onDelete('restrict'),
    unique('attempts_assignment_user_number_unique').on(
      table.assignmentId,
      table.userId,
      table.attemptNumber,
    ),
    index('attempts_assignment_idx').on(table.assignmentId),
    index('attempts_user_idx').on(table.userId),
    check('attempts_number_check', sql`${table.attemptNumber} > 0`),
    check('attempts_status_check', sql`${table.status} in ('in_progress', 'submitted', 'graded')`),
    check(
      'attempts_score_check',
      sql`${table.scoreBasisPoints} is null or ${table.scoreBasisPoints} between 0 and 10000`,
    ),
    check(
      'attempts_lifecycle_check',
      sql`
      (${table.status} = 'in_progress' and ${table.submittedAt} is null and ${table.gradedAt} is null and ${table.scoreBasisPoints} is null)
      or (${table.status} = 'submitted' and ${table.submittedAt} is not null and ${table.gradedAt} is null and ${table.scoreBasisPoints} is null)
      or (${table.status} = 'graded' and ${table.submittedAt} is not null and ${table.gradedAt} is not null and ${table.scoreBasisPoints} is not null)
    `,
    ),
  ],
);

export const attemptResponses = pgTable(
  'attempt_responses',
  {
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    answer: jsonb('answer').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.attemptId, table.position] }),
    check('attempt_responses_position_check', sql`${table.position} > 0`),
  ],
);
