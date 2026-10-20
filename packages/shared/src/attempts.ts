import { z } from 'zod';
import {
  choiceIdSchema,
  partIdSchema,
  statementIdSchema,
  TRUE_FALSE_STATEMENT_COUNT,
  nonEmptyRichDocumentSchema,
  shortAnswerValueSchema,
} from './questions.js';

export const attemptAnswerSchema = z.union([
  z.strictObject({ type: z.literal('multiple_choice'), choiceId: choiceIdSchema }),
  z.strictObject({
    type: z.literal('true_false'),
    answers: z
      .array(z.strictObject({ statementId: statementIdSchema, value: z.boolean() }))
      .length(TRUE_FALSE_STATEMENT_COUNT),
  }),
  z.strictObject({ type: z.literal('short_answer'), answer: shortAnswerValueSchema }),
  z.strictObject({ type: z.literal('essay'), answer: nonEmptyRichDocumentSchema }),
  z.strictObject({
    type: z.literal('essay'),
    answers: z
      .array(z.strictObject({ partId: partIdSchema, content: nonEmptyRichDocumentSchema }))
      .min(1),
  }),
]);

export const attemptGradeSchema = z.strictObject({
  score: z
    .number()
    .min(0)
    .max(100)
    .refine(
      (value) => Number.isInteger(Math.round(value * 10000) / 100),
      'Điểm tối đa hai chữ số thập phân',
    ),
  feedback: z.string().trim().max(5000).nullable().default(null),
});

export const attemptResponseSchema = z.strictObject({
  position: z.number().int().positive(),
  answer: attemptAnswerSchema,
  updatedAt: z.date(),
});

export const attemptSchema = z.strictObject({
  id: z.uuidv7(),
  assignmentId: z.uuidv7(),
  userId: z.uuidv7(),
  attemptNumber: z.number().int().positive(),
  status: z.enum(['in_progress', 'submitted', 'graded']),
  startedAt: z.date(),
  submittedAt: z.date().nullable(),
  gradedAt: z.date().nullable(),
  responses: z.array(attemptResponseSchema),
});

export const attemptReviewSchema = attemptSchema.extend({
  score: z.number().nullable(),
  feedback: z.string().nullable(),
});

export const attemptSummarySchema = attemptReviewSchema.omit({ responses: true });
export const attemptResultSchema = z.strictObject({
  attemptId: z.uuidv7(),
  gradedAt: z.date(),
  score: z.number().nullable(),
  feedback: z.string().nullable(),
});

export const attemptSolutionsSchema = z.strictObject({
  attemptId: z.uuidv7(),
  questions: z.array(
    z.strictObject({ position: z.number().int().positive(), solution: z.unknown() }),
  ),
});

export type AttemptAnswer = z.infer<typeof attemptAnswerSchema>;
export type AttemptGrade = z.input<typeof attemptGradeSchema>;
export type Attempt = z.infer<typeof attemptSchema>;
export type AttemptReview = z.infer<typeof attemptReviewSchema>;
export type AttemptSummary = z.infer<typeof attemptSummarySchema>;
export type AttemptResult = z.infer<typeof attemptResultSchema>;
export type AttemptSolutions = z.infer<typeof attemptSolutionsSchema>;
