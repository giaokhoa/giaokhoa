import { z } from 'zod';
import { COGNITIVE_LEVELS } from './assessment.js';
import { limitedReasonInputSchema } from './common.js';
import { uuidIdSchema } from './ids.js';

export const SYSTEM_BANK_QUESTION_TYPES = ['multichoice', 'truefalse', 'shortanswer', 'essay'] as const;

export const systemBankPackageAnswerSchema = z.strictObject({
  answer: z.unknown(),
  isCorrect: z.boolean(),
  feedback: z.unknown().nullable(),
  sortOrder: z.number().int(),
});
export type SystemBankPackageAnswer = z.infer<typeof systemBankPackageAnswerSchema>;

export const systemBankPackageOutcomeSchema = z.strictObject({
  outcomeId: uuidIdSchema,
  cognitiveLevel: z.enum(COGNITIVE_LEVELS),
});
export type SystemBankPackageOutcome = z.infer<typeof systemBankPackageOutcomeSchema>;

export const systemBankSourceSchema = z.strictObject({
  centreSlug: z.string().min(1).max(150),
  questionId: uuidIdSchema,
  versionId: uuidIdSchema,
  versionNumber: z.number().int().min(1),
  authorId: uuidIdSchema.nullable(),
  sourceKind: z.string().nullable(),
  sourceRef: z.string().nullable(),
  license: z.string().nullable(),
});

export const systemBankMediaSchema = z.strictObject({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
});

export const systemBankPackageSchema = z.strictObject({
  questionText: z.unknown(),
  generalFeedback: z.unknown().nullable(),
  stimulusContent: z.unknown().nullable(),
  answers: z.array(systemBankPackageAnswerSchema),
  answerKey: z
    .strictObject({
      guidance: z.unknown().nullable(),
      solution: z.unknown().nullable(),
    })
    .nullable(),
  options: z.record(z.string(), z.unknown()).nullable(),
  outcomes: z.array(systemBankPackageOutcomeSchema),
  source: systemBankSourceSchema.optional(),
  media: z.array(systemBankMediaSchema).optional(),
});
export type SystemBankPackage = z.infer<typeof systemBankPackageSchema>;

export const submitSystemBankQuestionSchema = z.strictObject({
  questionId: uuidIdSchema,
  license: z.string().trim().min(1).max(200).optional(),
});
export type SubmitSystemBankQuestion = z.infer<typeof submitSystemBankQuestionSchema>;

export const rejectSystemBankSubmissionSchema = limitedReasonInputSchema;
export type RejectSystemBankSubmission = z.infer<typeof rejectSystemBankSubmissionSchema>;

export const createSystemBankQuestionSchema = z.strictObject({
  id: uuidIdSchema.optional(),
  qtype: z.enum(SYSTEM_BANK_QUESTION_TYPES),
  package: systemBankPackageSchema,
});
export type CreateSystemBankQuestion = z.infer<typeof createSystemBankQuestionSchema>;

export const createSystemBankVersionSchema = z.strictObject({
  package: systemBankPackageSchema,
});
export type CreateSystemBankVersion = z.infer<typeof createSystemBankVersionSchema>;

export const withdrawSystemBankQuestionSchema = z.strictObject({
  reason: z.string().min(1).max(500),
});
export type WithdrawSystemBankQuestion = z.infer<typeof withdrawSystemBankQuestionSchema>;

export const withdrawSystemResourceSchema = limitedReasonInputSchema;
export type WithdrawSystemResource = z.infer<typeof withdrawSystemResourceSchema>;

export const discoverSystemBankQuestionsSchema = z.strictObject({
  qtype: z.enum(SYSTEM_BANK_QUESTION_TYPES).optional(),
  outcomeId: uuidIdSchema.optional(),
  cognitiveLevel: z.enum(COGNITIVE_LEVELS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type DiscoverSystemBankQuestions = z.infer<typeof discoverSystemBankQuestionsSchema>;

export const importSystemBankQuestionSchema = z.strictObject({
  sourceQuestionId: uuidIdSchema,
  sourceVersionNumber: z.coerce.number().int().min(1).optional(),
  targetBankId: uuidIdSchema.optional(),
  targetCategoryId: uuidIdSchema.optional(),
});
export type ImportSystemBankQuestion = z.infer<typeof importSystemBankQuestionSchema>;


export const systemExamSlotSchema = z.strictObject({
  position: z.number().int().positive(),
  section: z.string(),
  questionId: uuidIdSchema,
  versionId: uuidIdSchema,
  versionNumber: z.number().int().positive(),
  qtype: z.enum(SYSTEM_BANK_QUESTION_TYPES),
  maxMark: z.number().positive(),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  package: systemBankPackageSchema,
});
export const systemExamPackageSchema = z.strictObject({
  name: z.string().min(1),
  grade: z.number().int().nullable(),
  examKind: z.enum(['regular', 'midterm', 'final', 'mock', 'practice']).nullable(),
  totalScore: z.number().positive(),
  durationMinutes: z.number().int().positive().nullable(),
  tfScale: z.array(z.number()).nullable(),
  source: z.strictObject({
    centreSlug: z.string().min(1),
    examId: uuidIdSchema,
    versionId: uuidIdSchema,
    versionNumber: z.number().int().positive(),
  }),
  slots: z.array(systemExamSlotSchema).min(1),
});
export type SystemExamPackage = z.infer<typeof systemExamPackageSchema>;
export const submitSystemExamSchema = z.strictObject({ examId: uuidIdSchema });
export type SubmitSystemExam = z.infer<typeof submitSystemExamSchema>;
export const rejectSystemExamSchema = limitedReasonInputSchema;
export type RejectSystemExam = z.infer<typeof rejectSystemExamSchema>;

export const createSystemOutcomePackageSchema = z.strictObject({
  version: z.string().min(1).max(50),
  scope: z.string().min(1).max(100),
  mappings: z
    .array(
      z.strictObject({
        fromOutcomeId: uuidIdSchema,
        toOutcomeId: uuidIdSchema,
        note: z.string().max(500).default(''),
      }),
    )
    .default([]),
});
export type CreateSystemOutcomePackage = z.infer<typeof createSystemOutcomePackageSchema>;

export const rejectSystemOutcomePackageSchema = z.strictObject({ reason: z.string().trim().min(1).max(1000) });
export type RejectSystemOutcomePackage = z.infer<typeof rejectSystemOutcomePackageSchema>;
