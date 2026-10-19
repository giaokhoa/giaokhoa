import { z } from 'zod';
import { choiceIdSchema, partIdSchema, statementIdSchema } from './child-id.js';
import {
  CHOICE_LIST_NODE_TYPE,
  PART_LIST_NODE_TYPE,
  SHORT_ANSWER_INPUT_PATTERN,
  SHORT_ANSWER_MAX_LENGTH,
  STATEMENT_LIST_NODE_TYPE,
  TRUE_FALSE_STATEMENT_COUNT,
} from './constants.js';
import {
  draftEssayContentSchema,
  draftMultipleChoiceContentSchema,
  draftTrueFalseContentSchema,
  essayContentSchema,
  multipleChoiceContentSchema,
  nonEmptyRichDocumentSchema,
  richDocumentSchema,
  shortAnswerContentSchema,
  trueFalseContentSchema,
} from './content.js';

export const questionTypeSchema = z.enum([
  'multiple_choice',
  'true_false',
  'short_answer',
  'essay',
]);

const stimulusId = z.uuidv7().nullable().optional();
const guidance = richDocumentSchema.nullable().optional();
const multipleChoiceSchema = z
  .strictObject({
    stimulusId,
    type: z.literal('multiple_choice'),
    content: multipleChoiceContentSchema,
    guidance,
    solution: z.strictObject({ choiceId: choiceIdSchema }),
  })
  .superRefine((question, ctx) => {
    const choiceList = question.content.content.at(-1);
    if (choiceList?.type !== CHOICE_LIST_NODE_TYPE) return;
    if (
      !(choiceList.content ?? []).some((choice) => choice.attrs?.id === question.solution.choiceId)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['solution', 'choiceId'],
        message: 'Choice không thuộc question',
      });
    }
  });

const trueFalseSchema = z
  .strictObject({
    stimulusId,
    type: z.literal('true_false'),
    content: trueFalseContentSchema,
    guidance,
    solution: z.strictObject({
      answers: z
        .array(z.strictObject({ statementId: statementIdSchema, value: z.boolean() }))
        .length(TRUE_FALSE_STATEMENT_COUNT),
    }),
  })
  .superRefine((question, ctx) => {
    const statementList = question.content.content.at(-1);
    if (statementList?.type !== STATEMENT_LIST_NODE_TYPE) return;

    const statementIds = new Set(
      (statementList.content ?? []).flatMap(({ attrs }) =>
        typeof attrs?.id === 'string' ? [attrs.id] : [],
      ),
    );
    const answerIds = question.solution.answers.map(({ statementId }) => statementId);

    if (new Set(answerIds).size !== answerIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['solution', 'answers'],
        message: 'Statement bị lặp trong solution',
      });
    }
    if (answerIds.some((id) => !statementIds.has(id))) {
      ctx.addIssue({
        code: 'custom',
        path: ['solution', 'answers'],
        message: 'Statement không thuộc question',
      });
    }
    if (answerIds.length !== statementIds.size) {
      ctx.addIssue({
        code: 'custom',
        path: ['solution', 'answers'],
        message: 'Solution phải có đáp án cho mọi statement',
      });
    }
  });

export const shortAnswerValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(SHORT_ANSWER_MAX_LENGTH)
  .regex(SHORT_ANSWER_INPUT_PATTERN, 'Đáp án chỉ dùng chữ, số, dấu phẩy, + hoặc -');

const shortAnswerSchema = z.strictObject({
  stimulusId,
  type: z.literal('short_answer'),
  content: shortAnswerContentSchema,
  guidance,
  solution: z.strictObject({
    answer: shortAnswerValueSchema,
  }),
});

const essaySchema = z
  .strictObject({
    stimulusId,
    type: z.literal('essay'),
    content: essayContentSchema,
    guidance,
    solution: z.union([
      z.strictObject({ answer: nonEmptyRichDocumentSchema }),
      z.strictObject({
        answers: z.array(
          z.strictObject({ partId: partIdSchema, content: nonEmptyRichDocumentSchema }),
        ),
      }),
    ]),
  })
  .superRefine((question, ctx) => {
    const last = question.content.content.at(-1);
    const partList = last?.type === PART_LIST_NODE_TYPE ? last : undefined;

    if (!partList) {
      if (!('answer' in question.solution)) {
        ctx.addIssue({
          code: 'custom',
          path: ['solution'],
          message: 'Essay không có part dùng một answer',
        });
      }
      return;
    }

    if (!('answers' in question.solution)) {
      ctx.addIssue({
        code: 'custom',
        path: ['solution'],
        message: 'Essay có part dùng answers theo partId',
      });
      return;
    }

    const partIds = new Set(
      (partList.content ?? []).flatMap(({ attrs }) =>
        typeof attrs?.id === 'string' ? [attrs.id] : [],
      ),
    );
    const answerIds = question.solution.answers.map(({ partId }) => partId);

    if (new Set(answerIds).size !== answerIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['solution', 'answers'],
        message: 'Part bị lặp trong solution',
      });
    }
    if (answerIds.some((id) => !partIds.has(id))) {
      ctx.addIssue({
        code: 'custom',
        path: ['solution', 'answers'],
        message: 'Part không thuộc question',
      });
    }
    if (answerIds.length !== partIds.size) {
      ctx.addIssue({
        code: 'custom',
        path: ['solution', 'answers'],
        message: 'Solution phải có đáp án cho mọi part',
      });
    }
  });

export const readyQuestionSchema = z.discriminatedUnion('type', [
  multipleChoiceSchema,
  trueFalseSchema,
  shortAnswerSchema,
  essaySchema,
]);

const draftMultipleChoiceSchema = z
  .strictObject({
    stimulusId,
    type: z.literal('multiple_choice'),
    content: draftMultipleChoiceContentSchema,
    guidance,
    solution: z.strictObject({ choiceId: choiceIdSchema }).nullable().optional(),
  })
  .superRefine((question, ctx) => {
    const choiceId = question.solution?.choiceId;
    const choiceList = question.content.content.at(-1);
    if (!choiceId || choiceList?.type !== CHOICE_LIST_NODE_TYPE) return;
    if (!(choiceList.content ?? []).some((choice) => choice.attrs?.id === choiceId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['solution', 'choiceId'],
        message: 'Choice không thuộc question',
      });
    }
  });

const draftTrueFalseSchema = z
  .strictObject({
    stimulusId,
    type: z.literal('true_false'),
    content: draftTrueFalseContentSchema,
    guidance,
    solution: z
      .strictObject({
        answers: z.array(z.strictObject({ statementId: statementIdSchema, value: z.boolean() })),
      })
      .nullable()
      .optional(),
  })
  .superRefine((question, ctx) => {
    const statementList = question.content.content.at(-1);
    if (!question.solution || statementList?.type !== STATEMENT_LIST_NODE_TYPE) return;

    const statementIds = new Set(
      (statementList.content ?? []).flatMap(({ attrs }) =>
        typeof attrs?.id === 'string' ? [attrs.id] : [],
      ),
    );
    const answerIds = question.solution.answers.map(({ statementId }) => statementId);
    if (new Set(answerIds).size !== answerIds.length) {
      ctx.addIssue({ code: 'custom', path: ['solution', 'answers'], message: 'Statement bị lặp' });
    }
    if (answerIds.some((id) => !statementIds.has(id))) {
      ctx.addIssue({
        code: 'custom',
        path: ['solution', 'answers'],
        message: 'Statement không thuộc question',
      });
    }
  });

const draftShortAnswerSchema = z.strictObject({
  stimulusId,
  type: z.literal('short_answer'),
  content: richDocumentSchema,
  guidance,
  solution: z
    .strictObject({ answer: z.string().max(SHORT_ANSWER_MAX_LENGTH) })
    .nullable()
    .optional(),
});

const draftEssaySchema = z.strictObject({
  stimulusId,
  type: z.literal('essay'),
  content: draftEssayContentSchema,
  guidance,
  solution: z
    .union([
      z.strictObject({ answer: richDocumentSchema }),
      z.strictObject({
        answers: z.array(z.strictObject({ partId: partIdSchema, content: richDocumentSchema })),
      }),
    ])
    .nullable()
    .optional(),
});

export const draftQuestionSchema = z.discriminatedUnion('type', [
  draftMultipleChoiceSchema,
  draftTrueFalseSchema,
  draftShortAnswerSchema,
  draftEssaySchema,
]);

export const questionStatusSchema = z.enum(['draft', 'ready']);

const draftQuestionWriteSchemas = [
  draftMultipleChoiceSchema.safeExtend({ status: z.literal('draft') }),
  draftTrueFalseSchema.safeExtend({ status: z.literal('draft') }),
  draftShortAnswerSchema.safeExtend({ status: z.literal('draft') }),
  draftEssaySchema.safeExtend({ status: z.literal('draft') }),
] as const;
const readyQuestionWriteSchemas = [
  multipleChoiceSchema.safeExtend({ status: z.literal('ready') }),
  trueFalseSchema.safeExtend({ status: z.literal('ready') }),
  shortAnswerSchema.safeExtend({ status: z.literal('ready') }),
  essaySchema.safeExtend({ status: z.literal('ready') }),
] as const;

export const questionCreateSchema = z.union([
  ...draftQuestionWriteSchemas,
  ...readyQuestionWriteSchemas,
]);

export const questionPatchSchema = z
  .strictObject({
    stimulusId: z.uuidv7().nullable().optional(),
    status: questionStatusSchema.optional(),
    type: questionTypeSchema.optional(),
    content: z.unknown().optional(),
    guidance: z.unknown().optional(),
    solution: z.unknown().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Không có dữ liệu để cập nhật');

export const questionSchema = z.union([
  ...draftQuestionWriteSchemas.map((schema) => schema.safeExtend({ id: z.uuidv7() }).required()),
  ...readyQuestionWriteSchemas.map((schema) => schema.safeExtend({ id: z.uuidv7() }).required()),
]);

export type QuestionType = z.infer<typeof questionTypeSchema>;
export type QuestionStatus = z.infer<typeof questionStatusSchema>;
export type QuestionCreate = z.infer<typeof questionCreateSchema>;
export type QuestionPatch = z.infer<typeof questionPatchSchema>;
export type Question = z.infer<typeof questionSchema>;
