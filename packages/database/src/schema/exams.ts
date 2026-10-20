import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.generated.js';
import { questionVersions } from './questions.js';

export const exams = pgTable(
  'exams',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    title: text('title').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('exams_created_by_idx').on(table.createdByUserId),
    check('exams_title_check', sql`length(trim(${table.title})) > 0`),
  ],
);

export const examRevisions = pgTable(
  'exam_revisions',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'restrict' }),
    revision: integer('revision').notNull(),
    title: text('title').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('exam_revisions_exam_revision_unique').on(table.examId, table.revision),
    index('exam_revisions_exam_idx').on(table.examId),
    check('exam_revisions_revision_check', sql`${table.revision} > 0`),
  ],
);

export const examRevisionQuestions = pgTable(
  'exam_revision_questions',
  {
    examRevisionId: uuid('exam_revision_id')
      .notNull()
      .references(() => examRevisions.id, { onDelete: 'restrict' }),
    questionVersionId: uuid('question_version_id')
      .notNull()
      .references(() => questionVersions.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    questionSnapshot: jsonb('question_snapshot').notNull(),
  },
  (table) => [
    unique('exam_revision_questions_position_unique').on(table.examRevisionId, table.position),
    unique('exam_revision_questions_version_unique').on(
      table.examRevisionId,
      table.questionVersionId,
    ),
    index('exam_revision_questions_version_idx').on(table.questionVersionId),
    check('exam_revision_questions_position_check', sql`${table.position} > 0`),
  ],
);
