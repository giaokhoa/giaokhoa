import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { questions } from './questions.js';

export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    position: integer('position').notNull().default(1),
  },
  (table) => [check('subjects_position_check', sql`${table.position} > 0`)],
);

export const curricula = pgTable(
  'curricula',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    grade: smallint('grade').notNull(),
  },
  (table) => [
    check('curricula_grade_check', sql`${table.grade} between 1 and 12`),
    unique('curricula_subject_id_grade_unique').on(table.subjectId, table.grade),
  ],
);

export const curriculumNodes = pgTable(
  'curriculum_nodes',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    curriculumId: uuid('curriculum_id')
      .notNull()
      .references(() => curricula.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    position: integer('position').notNull().default(1),
  },
  (table) => [
    unique('curriculum_nodes_curriculum_id_id_unique').on(table.curriculumId, table.id),
    foreignKey({
      name: 'curriculum_nodes_parent_fk',
      columns: [table.curriculumId, table.parentId],
      foreignColumns: [table.curriculumId, table.id],
    }).onDelete('cascade'),
    check(
      'curriculum_nodes_parent_not_self_check',
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
    check('curriculum_nodes_position_check', sql`${table.position} > 0`),
    index('curriculum_nodes_tree_idx').on(table.curriculumId, table.parentId, table.position),
  ],
);

export const learningOutcomes = pgTable(
  'learning_outcomes',
  {
    id: uuid('id')
      .default(sql`uuidv7()`)
      .primaryKey(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => curriculumNodes.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    position: integer('position').notNull().default(1),
  },
  (table) => [
    check('learning_outcomes_position_check', sql`${table.position} > 0`),
    index('learning_outcomes_node_id_idx').on(table.nodeId, table.position),
  ],
);

export const questionSubjects = pgTable(
  'question_subjects',
  {
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.questionId, table.subjectId] }),
    index('question_subjects_subject_id_idx').on(table.subjectId),
  ],
);

export const questionLearningOutcomes = pgTable(
  'question_learning_outcomes',
  {
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    learningOutcomeId: uuid('learning_outcome_id')
      .notNull()
      .references(() => learningOutcomes.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.questionId, table.learningOutcomeId] }),
    index('question_learning_outcomes_learning_outcome_id_idx').on(table.learningOutcomeId),
  ],
);
