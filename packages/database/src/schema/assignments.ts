import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';
import { classes } from './classes.js';
import { examRevisions } from './exams.js';

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    examRevisionId: uuid('exam_revision_id')
      .notNull()
      .references(() => examRevisions.id, { onDelete: 'restrict' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    audienceMode: text('audience_mode').notNull(),
    selectedUserIds: jsonb('selected_user_ids').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('draft'),
    openAt: timestamp('open_at').notNull(),
    closeAt: timestamp('close_at').notNull(),
    maxAttempts: integer('max_attempts').notNull().default(1),
    releaseScoreAt: timestamp('release_score_at'),
    releaseFeedbackAt: timestamp('release_feedback_at'),
    releaseSolutionsAt: timestamp('release_solutions_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    publishedAt: timestamp('published_at'),
  },
  (table) => [
    index('assignments_class_idx').on(table.classId),
    index('assignments_exam_revision_idx').on(table.examRevisionId),
    check(
      'assignments_audience_check',
      sql`${table.audienceMode} in ('ALL_CLASS', 'SELECTED_USERS')`,
    ),
    check('assignments_status_check', sql`${table.status} in ('draft', 'published')`),
    check('assignments_window_check', sql`${table.openAt} < ${table.closeAt}`),
    check('assignments_max_attempts_check', sql`${table.maxAttempts} > 0`),
  ],
);

export const assignmentRecipients = pgTable(
  'assignment_recipients',
  {
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('active'),
    source: text('source').notNull(),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [
    primaryKey({ columns: [table.assignmentId, table.userId] }),
    index('assignment_recipients_user_idx').on(table.userId),
    check('assignment_recipients_status_check', sql`${table.status} in ('active', 'revoked')`),
    check(
      'assignment_recipients_source_check',
      sql`${table.source} in ('all_class', 'selected_users')`,
    ),
    check(
      'assignment_recipients_revocation_check',
      sql`(${table.status} = 'revoked') = (${table.revokedAt} is not null)`,
    ),
  ],
);
