import { z } from 'zod';
import { uuidIdSchema } from './ids.js';
import { questionViewSchema } from './assessment.js';


export const mcpAnswerInputSchema = z.strictObject({
  text: z.string().min(1).max(5000),
  correct: z.boolean().optional(),
  feedback: z.string().max(5000).optional(),
});
export type McpAnswerInput = z.infer<typeof mcpAnswerInputSchema>;

export const mcpQuestionOptionsInputSchema = z.strictObject({
  shuffleAnswers: z.boolean().optional(),
  answerNumbering: z.string().max(50).optional(),
  showStandardInstruction: z.boolean().optional(),
  useCase: z.boolean().optional(),
  responseFormat: z.string().max(50).optional(),
  responseRequired: z.boolean().optional(),
  responseFieldLines: z.number().int().min(0).max(100).optional(),
  minWordLimit: z.number().int().min(0).nullable().optional(),
  maxWordLimit: z.number().int().min(0).nullable().optional(),
  graderInfo: z.string().max(5000).optional(),
  responseTemplate: z.string().max(5000).optional(),
  correctFeedback: z.string().max(5000).optional(),
  incorrectFeedback: z.string().max(5000).optional(),
});
export type McpQuestionOptionsInput = z.infer<typeof mcpQuestionOptionsInputSchema>;

export const mcpCreateQuestionInputSchema = z.strictObject({
  bankId: uuidIdSchema,
  categoryId: uuidIdSchema,
  qtype: z.enum(['multichoice', 'truefalse', 'shortanswer', 'essay']),
  questionText: z.string().min(1).max(20000),
  generalFeedback: z.string().max(5000).optional(),
  guidance: z.string().max(5000).optional(),
  defaultMark: z.number().gt(0).max(100).optional(),
  penalty: z.number().min(0).max(1).optional(),
  stimulusId: uuidIdSchema.optional(),
  answers: z.array(mcpAnswerInputSchema).max(10).optional(),
  options: mcpQuestionOptionsInputSchema.optional(),
  idempotencyKey: z.string().min(1).max(200),
});
export type McpCreateQuestionInput = z.infer<typeof mcpCreateQuestionInputSchema>;

export const mcpCreateQuestionOutputSchema = z.object({
  status: z.enum(['created', 'duplicate_exact']),
  questionId: uuidIdSchema.nullable(),
  existingQuestionId: uuidIdSchema.nullable(),
  entryId: uuidIdSchema.nullable(),
  version: z.number().int().nullable(),
  questionStatus: z.string().nullable(),
  duplicate: z.enum(['none', 'near', 'exact']),
  nearDuplicateOf: uuidIdSchema.nullable(),
  reviewUrl: z.string().nullable(),
});
export type McpCreateQuestionOutput = z.infer<typeof mcpCreateQuestionOutputSchema>;

export const mcpListMyBanksOutputSchema = z.object({
  banks: z.array(
    z.object({
      id: uuidIdSchema,
      name: z.string(),
      scope: z.string(),
      kind: z.string(),
      ownerId: uuidIdSchema.nullable(),
      capabilities: z.object({
        use: z.boolean(),
        add: z.boolean(),
        edit: z.boolean(),
        manageCategory: z.boolean(),
        copy: z.boolean(),
        share: z.boolean(),
        moderate: z.boolean(),
      }),
      defaultCategoryId: uuidIdSchema.nullable(),
      categoryCount: z.number().int(),
    }),
  ),
});
export type McpListMyBanksOutput = z.infer<typeof mcpListMyBanksOutputSchema>;

export const mcpListCategoriesInputSchema = z.strictObject({
  bankId: uuidIdSchema,
});
export type McpListCategoriesInput = z.infer<typeof mcpListCategoriesInputSchema>;

export const mcpListCategoriesOutputSchema = z.object({
  bankId: uuidIdSchema,
  categories: z.array(
    z.object({
      id: uuidIdSchema,
      name: z.string(),
      parentId: uuidIdSchema.nullable(),
      questionCount: z.number().int(),
    }),
  ),
});
export type McpListCategoriesOutput = z.infer<typeof mcpListCategoriesOutputSchema>;

export const mcpGetQuestionInputSchema = z.strictObject({
  questionId: uuidIdSchema,
});
export type McpGetQuestionInput = z.infer<typeof mcpGetQuestionInputSchema>;

export const mcpGetQuestionOutputSchema = questionViewSchema;

export const mcpSubmitContributionInputSchema = z.strictObject({
  targetBankId: uuidIdSchema,
  questionIds: z.array(uuidIdSchema).min(1).max(50).optional(),
  examIds: z.array(uuidIdSchema).min(1).max(50).optional(),
  matrixIds: z.array(uuidIdSchema).min(1).max(50).optional(),
  note: z.string().max(2000).optional(),
  idempotencyKey: z.string().min(1).max(200),
}).superRefine((value, ctx) => {
  if (!value.questionIds?.length && !value.examIds?.length && !value.matrixIds?.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['questionIds'],
      message: 'submit_contribution cần ít nhất một trong ba danh sách: questionIds, examIds, matrixIds.',
    });
  }
});
export type McpSubmitContributionInput = z.infer<typeof mcpSubmitContributionInputSchema>;

export const mcpSubmitContributionOutputSchema = z.object({
  targetBankId: uuidIdSchema,
  results: z.array(
    z.object({
      questionId: uuidIdSchema,
      status: z.enum(['pending', 'failed']),
      contributionId: uuidIdSchema.nullable(),
      code: z.string().nullable(),
      message: z.string().nullable(),
    }),
  ),
  examResults: z.array(
    z.object({
      examId: uuidIdSchema,
      status: z.enum(['pending', 'failed']),
      contributionId: uuidIdSchema.nullable(),
      code: z.string().nullable(),
      message: z.string().nullable(),
    }),
  ).default([]),
  matrixResults: z.array(
    z.object({
      matrixId: uuidIdSchema,
      status: z.enum(['pending', 'failed']),
      contributionId: uuidIdSchema.nullable(),
      code: z.string().nullable(),
      message: z.string().nullable(),
    }),
  ).default([]),
  created: z.number().int(),
  failed: z.number().int(),
});
export type McpSubmitContributionOutput = z.infer<typeof mcpSubmitContributionOutputSchema>;


export const mcpBatchQuestionItemSchema = z.strictObject({
  clientItemId: z.string().min(1).max(64),
  qtype: z.enum(['multichoice', 'truefalse', 'shortanswer', 'essay']),
  questionText: z.string().min(1).max(20000),
  generalFeedback: z.string().max(5000).optional(),
  guidance: z.string().max(5000).optional(),
  defaultMark: z.number().gt(0).max(100).optional(),
  penalty: z.number().min(0).max(1).optional(),
  stimulusId: uuidIdSchema.optional(),
  stimulusRef: z.string().min(1).max(64).optional(),
  answers: z.array(mcpAnswerInputSchema).max(10).optional(),
  options: mcpQuestionOptionsInputSchema.optional(),
});
export type McpBatchQuestionItem = z.infer<typeof mcpBatchQuestionItemSchema>;

export const mcpCreateQuestionsBatchInputSchema = z.strictObject({
  bankId: uuidIdSchema,
  categoryId: uuidIdSchema,
  stimuli: z
    .array(
      z.strictObject({
        ref: z.string().min(1).max(64),
        content: z.string().min(1).max(20000),
      }),
    )
    .max(10)
    .optional(),
  items: z.array(mcpBatchQuestionItemSchema).min(1).max(50),
  idempotencyKey: z.string().min(1).max(200),
});
export type McpCreateQuestionsBatchInput = z.infer<typeof mcpCreateQuestionsBatchInputSchema>;

export const mcpBatchItemResultSchema = z.object({
  clientItemId: z.string(),
  status: z.enum(['created', 'duplicate_exact', 'failed']),
  questionId: uuidIdSchema.nullable(),
  existingQuestionId: uuidIdSchema.nullable(),
  entryId: uuidIdSchema.nullable(),
  version: z.number().int().nullable(),
  questionStatus: z.string().nullable(),
  duplicate: z.enum(['none', 'near', 'exact']),
  nearDuplicateOf: uuidIdSchema.nullable(),
  reviewUrl: z.string().nullable(),
  code: z.string().nullable(),
  message: z.string().nullable(),
  fieldPath: z.string().nullable(),
});
export type McpBatchItemResult = z.infer<typeof mcpBatchItemResultSchema>;

export const mcpCreateQuestionsBatchOutputSchema = z.object({
  bankId: uuidIdSchema,
  categoryId: uuidIdSchema,
  stimuli: z.array(
    z.object({
      ref: z.string(),
      stimulusId: uuidIdSchema.nullable(),
      status: z.enum(['created', 'failed']),
      code: z.string().nullable(),
      message: z.string().nullable(),
    }),
  ),
  results: z.array(mcpBatchItemResultSchema),
  created: z.number().int(),
  failed: z.number().int(),
});
export type McpCreateQuestionsBatchOutput = z.infer<typeof mcpCreateQuestionsBatchOutputSchema>;

export const mcpStimulusQuestionItemSchema = z.strictObject({
  qtype: z.enum(['multichoice', 'truefalse', 'shortanswer', 'essay']),
  questionText: z.string().min(1).max(20000),
  generalFeedback: z.string().max(5000).optional(),
  guidance: z.string().max(5000).optional(),
  defaultMark: z.number().gt(0).max(100).optional(),
  penalty: z.number().min(0).max(1).optional(),
  answers: z.array(mcpAnswerInputSchema).max(10).optional(),
  options: mcpQuestionOptionsInputSchema.optional(),
});
export type McpStimulusQuestionItem = z.infer<typeof mcpStimulusQuestionItemSchema>;

export const mcpCreateStimulusWithQuestionsInputSchema = z.strictObject({
  bankId: uuidIdSchema,
  categoryId: uuidIdSchema,
  stimulusContent: z.string().min(1).max(20000),
  questions: z.array(mcpStimulusQuestionItemSchema).min(1).max(50),
  idempotencyKey: z.string().min(1).max(200),
});
export type McpCreateStimulusWithQuestionsInput = z.infer<typeof mcpCreateStimulusWithQuestionsInputSchema>;

export const mcpCreateStimulusWithQuestionsOutputSchema = z.object({
  stimulusId: uuidIdSchema,
  results: z.array(mcpCreateQuestionOutputSchema),
  created: z.number().int(),
});
export type McpCreateStimulusWithQuestionsOutput = z.infer<typeof mcpCreateStimulusWithQuestionsOutputSchema>;

export const mcpPublishQuestionsInputSchema = z.strictObject({
  questionIds: z.array(uuidIdSchema).min(1).max(50),
  idempotencyKey: z.string().min(1).max(200),
});
export type McpPublishQuestionsInput = z.infer<typeof mcpPublishQuestionsInputSchema>;

export const mcpPublishQuestionsOutputSchema = z.object({
  results: z.array(
    z.object({
      questionId: uuidIdSchema,
      status: z.enum(['published', 'failed']),
      code: z.string().nullable(),
      message: z.string().nullable(),
    }),
  ),
  published: z.number().int(),
  failed: z.number().int(),
});
export type McpPublishQuestionsOutput = z.infer<typeof mcpPublishQuestionsOutputSchema>;

export const mcpSearchQuestionsInputSchema = z.strictObject({
  bankId: uuidIdSchema,
  query: z.string().min(1).max(200),
  qtype: z.enum(['multichoice', 'truefalse', 'shortanswer', 'essay']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type McpSearchQuestionsInput = z.infer<typeof mcpSearchQuestionsInputSchema>;

export const mcpSearchQuestionsOutputSchema = z.object({
  bankId: uuidIdSchema,
  questions: z.array(
    z.object({
      id: uuidIdSchema,
      qtype: z.string(),
      status: z.string(),
      categoryId: uuidIdSchema,
      categoryName: z.string(),
      mine: z.boolean(),
    }),
  ),
  truncated: z.boolean(),
});
export type McpSearchQuestionsOutput = z.infer<typeof mcpSearchQuestionsOutputSchema>;

export const mcpCheckDuplicatesInputSchema = z.strictObject({
  bankId: uuidIdSchema,
  items: z
    .array(
      z.strictObject({
        clientItemId: z.string().min(1).max(64),
        qtype: z.enum(['multichoice', 'truefalse', 'shortanswer', 'essay']),
        questionText: z.string().min(1).max(20000),
        answers: z.array(mcpAnswerInputSchema).max(10).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type McpCheckDuplicatesInput = z.infer<typeof mcpCheckDuplicatesInputSchema>;

export const mcpCheckDuplicatesOutputSchema = z.object({
  bankId: uuidIdSchema,
  results: z.array(
    z.object({
      clientItemId: z.string(),
      verdict: z.enum(['exact', 'near', 'none']),
      existingQuestionId: uuidIdSchema.nullable(),
      nearDuplicateOf: uuidIdSchema.nullable(),
    }),
  ),
});
export type McpCheckDuplicatesOutput = z.infer<typeof mcpCheckDuplicatesOutputSchema>;

export const mcpSearchCurriculumOutcomesInputSchema = z.strictObject({
  query: z.string().min(1).max(200),
  subjectId: uuidIdSchema.optional(),
  gradeLevel: z.number().int().min(1).max(12).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type McpSearchCurriculumOutcomesInput = z.infer<typeof mcpSearchCurriculumOutcomesInputSchema>;

export const mcpSearchCurriculumOutcomesOutputSchema = z.object({
  outcomes: z.array(
    z.object({
      id: uuidIdSchema,
      content: z.string(),
      sourceKind: z.string(),
      sourceRef: z.string().nullable(),
      nodeId: uuidIdSchema,
      nodeTitle: z.string(),
      subjectId: uuidIdSchema,
      subjectName: z.string(),
      grade: z.number().int(),
    }),
  ),
});
export type McpSearchCurriculumOutcomesOutput = z.infer<typeof mcpSearchCurriculumOutcomesOutputSchema>;
