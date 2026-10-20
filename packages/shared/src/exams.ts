import { z } from 'zod';
import { questionSchema } from './questions.js';

export const examSchema = z.strictObject({
  id: z.uuidv7(),
  title: z.string(),
  createdByUserId: z.uuidv7(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const examCreateSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
});

export const examPatchSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
});

export const examRevisionCreateSchema = z
  .strictObject({
    questions: z
      .array(
        z.strictObject({
          questionId: z.uuidv7(),
          version: z.number().int().positive(),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (value) =>
      new Set(value.questions.map(({ questionId }) => questionId)).size === value.questions.length,
    'Không được lặp câu hỏi trong cùng phiên bản đề',
  );

export const examRevisionQuestionSchema = z.strictObject({
  position: z.number().int().positive(),
  question: questionSchema,
});

export const examRevisionSummarySchema = z.strictObject({
  id: z.uuidv7(),
  revision: z.number().int().positive(),
  title: z.string(),
  createdAt: z.date(),
});

export const examRevisionSchema = examRevisionSummarySchema.extend({
  examId: z.uuidv7(),
  questions: z.array(examRevisionQuestionSchema).min(1),
});

export type Exam = z.infer<typeof examSchema>;
export type ExamCreate = z.infer<typeof examCreateSchema>;
export type ExamPatch = z.infer<typeof examPatchSchema>;
export type ExamRevisionCreate = z.infer<typeof examRevisionCreateSchema>;
export type ExamRevision = z.infer<typeof examRevisionSchema>;
export type ExamRevisionSummary = z.infer<typeof examRevisionSummarySchema>;
