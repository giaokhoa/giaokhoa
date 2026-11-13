import { z } from 'zod';
import { uuidIdSchema } from './ids.js';
import {
  getTrueFalseStatements,
  richTextBlocksContainStatementList,
  richTextBlocksHaveContent,
  richTextDocumentSchema,
  richTextInputSchema,
  TRUE_FALSE_STATEMENT_COUNT,
} from './rich-text.js';


export const gradeItemSchema = z.object({
  id: uuidIdSchema,
  courseId: uuidIdSchema,
  itemName: z.string(),
  itemType: z.string(),
  itemModule: z.string().nullable(),
  itemInstance: uuidIdSchema.nullable(),
  gradeMax: z.number(),
  gradeMin: z.number(),
  gradePass: z.number(),
  multiplicator: z.number(),
  plusFactor: z.number(),
  hidden: z.boolean(),
  locked: z.boolean(),
  sortOrder: z.number().int(),
  postingPolicy: z.string(),
  gradeType: z.string().optional(),
  idNumber: z.string().nullable().optional(),
});
export type GradeItem = z.infer<typeof gradeItemSchema>;

export const gradeGradeSchema = z.object({
  id: uuidIdSchema,
  itemId: uuidIdSchema,
  userId: uuidIdSchema,
  rawGrade: z.number().nullable(),
  finalGrade: z.number().nullable(),
  hidden: z.boolean(),
  locked: z.boolean(),
  overridden: z.boolean(),
  excluded: z.boolean(),
  frozen: z.boolean(),
  feedback: z.string().nullable(),
  aggregationWeight: z.number().nullable().optional(),
});
export type GradeGrade = z.infer<typeof gradeGradeSchema>;

export const gradePublicationStateSchema = z.object({
  policy: z.enum(['auto', 'manual']),
  published: z.boolean(),
});
export type GradePublicationState = z.infer<typeof gradePublicationStateSchema>;

export const activityGradeViewSchema = z.object({
  item: gradeItemSchema,
  grade: gradeGradeSchema.nullable(),
  publication: gradePublicationStateSchema,
});
export type ActivityGradeView = z.infer<typeof activityGradeViewSchema>;

export const myActivityGradesSchema = z.object({
  courseId: uuidIdSchema,
  userId: uuidIdSchema,
  activities: z.array(activityGradeViewSchema),
});
export type MyActivityGrades = z.infer<typeof myActivityGradesSchema>;

export const courseActivityGridSchema = z.object({
  courseId: uuidIdSchema,
  items: z.array(gradeItemSchema),
  publications: z.record(z.string(), gradePublicationStateSchema),
  rows: z.array(z.object({
    userId: uuidIdSchema,
    displayName: z.string(),
    grades: z.record(z.string(), z.number().nullable()),
  })),
});
export type CourseActivityGrid = z.infer<typeof courseActivityGridSchema>;


export const questionCategorySchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  contextId: uuidIdSchema,
  info: z.string(),
  parent: uuidIdSchema.nullable(),
});
export type QuestionCategory = z.infer<typeof questionCategorySchema>;

export const questionVersionSchema = z.object({
  id: uuidIdSchema,
  questionBankEntryId: uuidIdSchema,
  questionId: uuidIdSchema,
  version: z.number().int(),
  questionText: richTextDocumentSchema,
  generalFeedback: richTextDocumentSchema.nullable(),
  defaultMark: z.number(),
  penalty: z.number(),
  stimulusId: uuidIdSchema.nullable(),
});
export type QuestionVersion = z.infer<typeof questionVersionSchema>;

export const questionAnswerViewSchema = z.object({
  id: uuidIdSchema,
  questionVersionId: uuidIdSchema,
  answer: richTextDocumentSchema,
  isCorrect: z.boolean(),
  feedback: richTextDocumentSchema.nullable(),
  sortOrder: z.number().int(),
});
export type QuestionAnswerView = z.infer<typeof questionAnswerViewSchema>;

export const questionSolutionSchema = z.union([
  z.strictObject({ correctAnswerId: uuidIdSchema }),
  z.strictObject({
    statements: z
      .array(z.strictObject({ statementId: z.string().min(1), value: z.boolean() }))
      .min(1),
  }),
  z.strictObject({ acceptedAnswers: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ answer: richTextDocumentSchema }),
  z.strictObject({
    answers: z
      .array(z.strictObject({ partId: z.string().min(1), content: richTextDocumentSchema }))
      .min(1),
  }),
]);
export type QuestionSolution = z.infer<typeof questionSolutionSchema>;

export const questionAnswerKeyViewSchema = z.object({
  guidance: richTextDocumentSchema.nullable(),
  solution: questionSolutionSchema.nullable(),
});
export type QuestionAnswerKeyView = z.infer<typeof questionAnswerKeyViewSchema>;

export const questionSolutionInputSchema = z.union([
  z.strictObject({ answer: richTextInputSchema }),
  z.strictObject({
    answers: z
      .array(z.strictObject({ statementId: z.string().min(1), value: z.boolean() }))
      .min(1),
  }),
]);
export type QuestionSolutionInput = z.infer<typeof questionSolutionInputSchema>;

export const questionOptionsViewSchema = z.record(z.string(), z.unknown()).nullable();
export type QuestionOptionsView = z.infer<typeof questionOptionsViewSchema>;

export const stimulusViewSchema = z.object({
  id: uuidIdSchema,
  categoryId: uuidIdSchema,
  createdBy: uuidIdSchema.nullable(),
  content: richTextDocumentSchema,
  createdAt: z.string().optional(),
});
export type StimulusView = z.infer<typeof stimulusViewSchema>;

export const questionViewSchema = z.object({
  question: z.object({
    id: uuidIdSchema,
    category: uuidIdSchema,
    qtype: z.string(),
  }),
  entry: z.object({
    id: uuidIdSchema,
    questionCategoryId: uuidIdSchema,
    questionId: uuidIdSchema,
    latestVersion: z.number().int(),
  }),
  latestVersion: questionVersionSchema,
  answers: z.array(questionAnswerViewSchema),
  answerKey: questionAnswerKeyViewSchema,
  options: questionOptionsViewSchema,
  stimulus: stimulusViewSchema.nullable(),
});
export type QuestionView = z.infer<typeof questionViewSchema>;

export const QUESTION_STATES = [
  'notstarted', 'todo', 'incomplete', 'complete',
  'gradedright', 'gradedpartial', 'gradedwrong', 'gaveup', 'finished',
] as const;

export const questionAttemptSchema = z.object({
  id: uuidIdSchema,
  questionUsageId: uuidIdSchema,
  slot: z.number().int(),
  behaviour: z.string(),
  questionId: uuidIdSchema,
  questionVersionId: uuidIdSchema.nullable(),
  maxMark: z.number(),
  state: z.string(),
  fraction: z.number().nullable(),
  steps: z.array(z.object({
    id: uuidIdSchema,
    sequenceNumber: z.number().int(),
    state: z.string(),
    fraction: z.number().nullable(),
    data: z.record(z.string(), z.string().nullable()),
  })),
});
export type QuestionAttempt = z.infer<typeof questionAttemptSchema>;

export const questionUsageSchema = z.object({
  usage: z.object({
    id: uuidIdSchema,
    component: z.string(),
    instanceId: uuidIdSchema.nullable(),
    preferredBehaviour: z.string(),
  }),
  state: z.string(),
  attempts: z.array(questionAttemptSchema),
});
export type QuestionUsage = z.infer<typeof questionUsageSchema>;


export const completionCriterionSchema = z.strictObject({
  criteriaType: z.string(),
  moduleInstance: uuidIdSchema.optional(),
  date: z.string().optional(),
  courseInstance: uuidIdSchema.optional(),
  enrolPeriodDays: z.number().int().min(0).optional(),
  roleId: uuidIdSchema.optional(),
});
export type CompletionCriterion = z.infer<typeof completionCriterionSchema>;

export const setCompletionCriteriaSchema = z.strictObject({
  method: z.number().int().optional(),
  criteria: z.array(completionCriterionSchema),
});
export type SetCompletionCriteria = z.infer<typeof setCompletionCriteriaSchema>;

export const markCourseSelfCompletionSchema = z.strictObject({
  complete: z.boolean(),
});
export type MarkCourseSelfCompletion = z.infer<typeof markCourseSelfCompletionSchema>;

export const markCourseCriteriaCompletionSchema = z.strictObject({
  userId: uuidIdSchema,
  complete: z.boolean(),
});
export type MarkCourseCriteriaCompletion = z.infer<typeof markCourseCriteriaCompletionSchema>;

export const markManualCompletionSchema = z.strictObject({
  userId: uuidIdSchema,
  complete: z.boolean(),
});
export type MarkManualCompletion = z.infer<typeof markManualCompletionSchema>;

export const createGradeItemSchema = z.strictObject({
  itemName: z.string().min(1),
  itemType: z.string().optional(),
  cmId: uuidIdSchema.optional(),
  gradeMax: z.number().optional(),
  gradeMin: z.number().optional(),
  gradePass: z.number().optional(),
  idNumber: z.string().min(1).optional(),
  multiplicator: z.number().optional(),
  plusFactor: z.number().optional(),
  hidden: z.boolean().optional(),
});
export type CreateGradeItem = z.infer<typeof createGradeItemSchema>;

export const updateGradeItemSchema = z.strictObject({
  itemName: z.string().optional(),
  gradeMax: z.number().optional(),
  gradeMin: z.number().optional(),
  gradePass: z.number().optional(),
  idNumber: z.string().min(1).nullable().optional(),
  multiplicator: z.number().optional(),
  plusFactor: z.number().optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
});
export type UpdateGradeItem = z.infer<typeof updateGradeItemSchema>;

export const setGradeSchema = z.strictObject({
  userId: uuidIdSchema,
  rawGrade: z.number().nullable().optional(),
  feedback: z.string().optional(),
});
export type SetGrade = z.infer<typeof setGradeSchema>;

export const updateGradeSchema = z.strictObject({
  overridden: z.boolean().optional(),
  finalGrade: z.number().nullable().optional(),
  locked: z.boolean().optional(),
  excluded: z.boolean().optional(),
  hidden: z.boolean().optional(),
  frozen: z.boolean().optional(),
  feedback: z.string().optional(),
});
export type UpdateGrade = z.infer<typeof updateGradeSchema>;

export const exportGradesVneduSchema = z.strictObject({
  regularItemIds: z.array(uuidIdSchema).min(1),
  midtermItemId: uuidIdSchema,
  finalItemId: uuidIdSchema,
  semester: z.union([z.literal(1), z.literal(2)]),
  schoolYear: z.string().min(1).max(32).optional(),
  subjectName: z.string().min(1).max(200).optional(),
  className: z.string().min(1).max(200).optional(),
});
export type ExportGradesVnedu = z.infer<typeof exportGradesVneduSchema>;

export const gradeExportProviderSchema = z.enum(['vnedu']);
export type GradeExportProvider = z.infer<typeof gradeExportProviderSchema>;

export const exportGradesSchema = z.strictObject({
  provider: gradeExportProviderSchema,
  ...exportGradesVneduSchema.shape,
});
export type ExportGrades = z.infer<typeof exportGradesSchema>;

export const createQuestionCategorySchema = z.strictObject({
  name: z.string().min(1),
  contextId: uuidIdSchema,
  info: z.string().optional(),
  parent: uuidIdSchema.optional(),
  bankId: uuidIdSchema.optional(),
});
export type CreateQuestionCategory = z.infer<typeof createQuestionCategorySchema>;

export const questionAnswerInputSchema = z.strictObject({
  text: richTextInputSchema,
  correct: z.boolean().optional(),
  feedback: richTextInputSchema.optional(),
});
export type QuestionAnswerInput = z.infer<typeof questionAnswerInputSchema>;

export const questionOptionsInputSchema = z.strictObject({
  shuffleAnswers: z.boolean().optional(),
  answerNumbering: z.string().optional(),
  showStandardInstruction: z.boolean().optional(),
  useCase: z.boolean().optional(),
  numericAnswer: z.boolean().optional(),
  numericMaxLength: z.number().int().positive().nullable().optional(),
  numericAllowSign: z.boolean().optional(),
  numericAllowDecimal: z.boolean().optional(),
  responseFormat: z.string().optional(),
  responseRequired: z.boolean().optional(),
  responseFieldLines: z.number().int().optional(),
  minWordLimit: z.number().int().nullable().optional(),
  maxWordLimit: z.number().int().nullable().optional(),
  graderInfo: richTextInputSchema.optional(),
  responseTemplate: richTextInputSchema.optional(),
  correctFeedback: richTextInputSchema.optional(),
  incorrectFeedback: richTextInputSchema.optional(),
});
export type QuestionOptionsInput = z.infer<typeof questionOptionsInputSchema>;

export const QUESTION_SOURCE_KINDS = ['book', 'exam', 'manual', 'import', 'ai'] as const;
export const createQuestionSchema = z
  .strictObject({
    categoryId: uuidIdSchema,
    qtype: z.enum(['multichoice', 'truefalse', 'shortanswer', 'essay']),
    sourceKind: z.enum(QUESTION_SOURCE_KINDS).optional(),
    sourceRef: z.string().min(1).optional(),
    questionText: richTextInputSchema,
    generalFeedback: richTextInputSchema.optional(),
    guidance: richTextInputSchema.optional(),
    defaultMark: z.number().optional(),
    penalty: z.number().optional(),
    stimulusId: uuidIdSchema.optional(),
    answers: z.array(questionAnswerInputSchema).optional(),
    options: questionOptionsInputSchema.optional(),
    solution: questionSolutionInputSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const answers = input.answers ?? [];
    const correctCount = answers.filter((a) => a.correct === true).length;
    if (input.qtype !== 'truefalse' && typeof input.questionText !== 'string'
      && richTextBlocksContainStatementList(input.questionText.content)) {
      ctx.addIssue({
        code: 'custom',
        path: ['questionText'],
        message: 'Danh sách mệnh đề (statementList) chỉ thuộc thân câu đúng/sai chùm',
      });
    }
    if (input.qtype === 'multichoice') {
      if (answers.length !== 4) {
        ctx.addIssue({
          code: 'custom',
          path: ['answers'],
          message: 'Câu trắc nghiệm phải có đúng 4 lựa chọn',
        });
      }
      if (correctCount !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['answers'],
          message: 'Câu trắc nghiệm phải có đúng một đáp án đúng',
        });
      }
    } else if (input.qtype === 'truefalse') {
      if (answers.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['answers'],
          message: 'Câu đúng/sai chùm không có dòng đáp án; đáp án từng mệnh đề truyền qua solution.answers',
        });
      }
      const doc = typeof input.questionText === 'string' ? null : input.questionText;
      const statements = doc ? getTrueFalseStatements(doc) : null;
      if (!doc || !statements) {
        ctx.addIssue({
          code: 'custom',
          path: ['questionText'],
          message: 'Thân câu đúng/sai phải là tài liệu chốt đuôi bằng danh sách mệnh đề (statementList)',
        });
      } else {
        const stemBlocks = doc.content.slice(0, -1);
        if (!richTextBlocksHaveContent(stemBlocks) || richTextBlocksContainStatementList(stemBlocks)) {
          ctx.addIssue({
            code: 'custom',
            path: ['questionText'],
            message: 'Thân câu đúng/sai phải có nội dung phía trước danh sách mệnh đề',
          });
        }
        if (statements.length !== TRUE_FALSE_STATEMENT_COUNT) {
          ctx.addIssue({
            code: 'custom',
            path: ['questionText'],
            message: `Câu đúng/sai phải có đúng ${TRUE_FALSE_STATEMENT_COUNT} mệnh đề`,
          });
        }
        if (new Set(statements.map((s) => s.id)).size !== statements.length) {
          ctx.addIssue({
            code: 'custom',
            path: ['questionText'],
            message: 'Mỗi mệnh đề của câu đúng/sai phải có định danh riêng',
          });
        }
        if (statements.some((s) => !richTextBlocksHaveContent(s.content) || richTextBlocksContainStatementList(s.content))) {
          ctx.addIssue({
            code: 'custom',
            path: ['questionText'],
            message: 'Mỗi mệnh đề của câu đúng/sai phải có nội dung',
          });
        }
        const solutionAnswers = input.solution && 'answers' in input.solution ? input.solution.answers : null;
        if (!solutionAnswers) {
          ctx.addIssue({
            code: 'custom',
            path: ['solution'],
            message: 'Câu đúng/sai phải có đáp án Đúng/Sai cho từng mệnh đề qua solution.answers',
          });
        } else {
          const statementIds = new Set(statements.map((s) => s.id));
          const covered = new Set(solutionAnswers.map((a) => a.statementId));
          if (
            solutionAnswers.length !== statements.length
            || covered.size !== solutionAnswers.length
            || [...covered].some((id) => !statementIds.has(id))
          ) {
            ctx.addIssue({
              code: 'custom',
              path: ['solution'],
              message: 'Đáp án của câu đúng/sai phải phủ đúng từng mệnh đề của thân câu, mỗi mệnh đề một giá trị',
            });
          }
        }
      }
    } else if (input.qtype === 'shortanswer') {
      if (answers.length < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['answers'],
          message: 'Câu trả lời ngắn phải có ít nhất một đáp án được chấp nhận',
        });
      }
      if (answers.some((a) => a.correct === false)) {
        ctx.addIssue({
          code: 'custom',
          path: ['answers'],
          message: 'Mọi đáp án liệt kê của câu trả lời ngắn đều được chấp nhận, không đánh dấu correct: false',
        });
      }
    } else if (input.qtype === 'essay' && answers.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['answers'],
        message: 'Câu tự luận không có dòng đáp án; lời giải mẫu truyền qua solution',
      });
    }
  });
export type CreateQuestion = z.infer<typeof createQuestionSchema>;

export const updateQuestionSchema = z.strictObject({
  questionText: richTextInputSchema.optional(),
  generalFeedback: richTextInputSchema.optional(),
  guidance: richTextInputSchema.optional(),
  defaultMark: z.number().optional(),
  penalty: z.number().optional(),
  stimulusId: uuidIdSchema.nullable().optional(),
  answers: z.array(questionAnswerInputSchema).optional(),
  options: questionOptionsInputSchema.optional(),
  solution: questionSolutionInputSchema.optional(),
});
export type UpdateQuestion = z.infer<typeof updateQuestionSchema>;

export const setQuestionStatusSchema = z.strictObject({
  status: z.enum(['draft', 'ready']),
});
export type SetQuestionStatus = z.infer<typeof setQuestionStatusSchema>;

export const createStimulusSchema = z.strictObject({
  categoryId: uuidIdSchema,
  content: richTextInputSchema,
});
export type CreateStimulus = z.infer<typeof createStimulusSchema>;

export const updateStimulusSchema = z.strictObject({
  content: richTextInputSchema,
});
export type UpdateStimulus = z.infer<typeof updateStimulusSchema>;

export const questionUsageSlotSchema = z.strictObject({
  questionId: uuidIdSchema,
  maxMark: z.number().optional(),
});
export type QuestionUsageSlot = z.infer<typeof questionUsageSlotSchema>;

export const createQuestionUsageSchema = z.strictObject({
  component: z.string().min(1),
  instanceId: uuidIdSchema.optional(),
  contextId: uuidIdSchema.optional(),
  preferredBehaviour: z.string().optional(),
  slots: z.array(questionUsageSlotSchema),
});
export type CreateQuestionUsage = z.infer<typeof createQuestionUsageSchema>;

export const submitQuestionResponseSchema = z.strictObject({
  response: z.string().nullable().optional(),
  finish: z.boolean().optional(),
});
export type SubmitQuestionResponse = z.infer<typeof submitQuestionResponseSchema>;


export const QUIZ_GRADE_METHODS = ['highest', 'average', 'first', 'last'] as const;
export type QuizGradeMethod = (typeof QUIZ_GRADE_METHODS)[number];

export const QUIZ_ATTEMPT_STATES = ['inprogress', 'needsgrading', 'finished'] as const;
export type QuizAttemptState = (typeof QUIZ_ATTEMPT_STATES)[number];

export const tfScaleSchema = z.array(z.number().min(0).max(100)).length(5);
export type TfScale = z.infer<typeof tfScaleSchema>;

export const quizSlotViewSchema = z.object({
  id: uuidIdSchema,
  pinId: uuidIdSchema,
  slot: z.number().int(),
  page: z.number().int(),
  questionId: uuidIdSchema.nullable(),
  categoryId: uuidIdSchema.nullable(),
  matrixCellId: uuidIdSchema.nullable(),
  maxMark: z.number(),
  versionMode: z.enum(['pinned', 'follow_latest']).nullable(),
  pinnedVersion: z.number().int().nullable(),
  latestVersion: z.number().int().nullable(),
  hasNewerVersion: z.boolean(),
  bankId: uuidIdSchema.nullable(),
  bankName: z.string().nullable(),
  bankScope: z.string().nullable(),
  questionStatus: z.string().nullable(),
});
export type QuizSlotView = z.infer<typeof quizSlotViewSchema>;

export const quizViewSchema = z.object({
  id: uuidIdSchema,
  courseId: uuidIdSchema,
  cmId: uuidIdSchema.nullable(),
  targetGroupId: uuidIdSchema.nullable(),
  name: z.string(),
  intro: z.string(),
  timeOpen: z.string().nullable(),
  timeClose: z.string().nullable(),
  timeLimitSeconds: z.number().int().nullable(),
  attemptsAllowed: z.number().int(),
  gradeMethod: z.enum(QUIZ_GRADE_METHODS),
  grade: z.number(),
  shuffleAnswers: z.boolean(),
  hasPassword: z.boolean(),
  subnet: z.string().nullable(),
  reviewAttempt: z.number().int(),
  reviewCorrectness: z.number().int(),
  reviewMarks: z.number().int(),
  reviewSpecificFeedback: z.number().int(),
  reviewGeneralFeedback: z.number().int(),
  reviewRightAnswer: z.number().int(),
  reviewOverallFeedback: z.number().int(),
  matrixId: uuidIdSchema.nullable(),
  examId: uuidIdSchema,
  examVersionId: uuidIdSchema,
  examVersionNumber: z.number().int(),
  latestExamVersionNumber: z.number().int(),
  hasNewerExamVersion: z.boolean(),
  versionMode: z.enum(['pinned', 'float_latest_ready']),
  tfScale: tfScaleSchema.nullable(),
  preset: z.enum(['regular', 'periodic', 'mock']).nullable(),
  lateEntryMinutes: z.number().int().nullable(),
  monitorEvents: z.boolean(),
  slots: z.array(quizSlotViewSchema),
  sumGrades: z.number(),
  variants: z.array(z.object({ code: z.string(), seed: z.number() })),
});
export type QuizView = z.infer<typeof quizViewSchema>;

export const quizAttemptSummarySchema = z.object({
  id: uuidIdSchema,
  pinId: uuidIdSchema,
  userId: uuidIdSchema,
  attemptNumber: z.number().int(),
  usageId: uuidIdSchema,
  state: z.string(),
  preview: z.boolean(),
  timeStart: z.string(),
  timeFinish: z.string().nullable(),
  sumGrades: z.number().nullable(),
  grade: z.number().nullable(),
  makeup: z.boolean(),
  appliedSettings: z.record(z.string(), z.unknown()).nullable(),
});
export type QuizAttemptSummary = z.infer<typeof quizAttemptSummarySchema>;

export const quizAttemptQuestionViewSchema = z.object({
  slot: z.number().int(),
  page: z.number().int(),
  questionAttemptId: uuidIdSchema,
  questionId: uuidIdSchema,
  qtype: z.string(),
  questionExcerpt: z.string(),
  questionText: richTextDocumentSchema,
  guidance: richTextDocumentSchema.nullable(),
  solution: questionSolutionSchema.nullable(),
  stimulus: z.object({ id: uuidIdSchema, content: richTextDocumentSchema }).nullable(),
  answers: z.array(z.object({ id: uuidIdSchema, text: richTextDocumentSchema })),
  options: questionOptionsViewSchema,
  maxMark: z.number(),
  state: z.string(),
  response: z.string().nullable(),
  fraction: z.number().nullable(),
  mark: z.number().nullable(),
  rightAnswer: z.string().nullable(),
  feedback: richTextDocumentSchema.nullable(),
  generalFeedback: richTextDocumentSchema.nullable(),
  manualComment: z.string().nullable(),
});
export type QuizAttemptQuestionView = z.infer<typeof quizAttemptQuestionViewSchema>;

export const quizAttemptViewSchema = z.object({
  attempt: quizAttemptSummarySchema,
  quiz: quizViewSchema,
  questions: z.array(quizAttemptQuestionViewSchema),
  totalMax: z.number(),
  pendingManualCount: z.number().int(),
  closedDueToTimeLimit: z.boolean(),
  overallFeedback: z.string().nullable(),
});
export type QuizAttemptView = z.infer<typeof quizAttemptViewSchema>;

const pinAccessRuleFields = {
  password: z.string().min(1).nullable().optional(),
  subnet: z.string().min(1).nullable().optional(),
  preset: z.enum(['regular', 'periodic', 'mock']).nullable().optional(),
  lateEntryMinutes: z.number().int().min(0).nullable().optional(),
  monitorEvents: z.boolean().optional(),
  reviewAttempt: z.number().int().min(0).optional(),
  reviewCorrectness: z.number().int().min(0).optional(),
  reviewMarks: z.number().int().min(0).optional(),
  reviewSpecificFeedback: z.number().int().min(0).optional(),
  reviewGeneralFeedback: z.number().int().min(0).optional(),
  reviewRightAnswer: z.number().int().min(0).optional(),
  reviewOverallFeedback: z.number().int().min(0).optional(),
  targetGroupId: uuidIdSchema.nullable().optional(),
};





export const examPinOverrideViewSchema = z.object({
  id: uuidIdSchema,
  pinId: uuidIdSchema,
  groupId: uuidIdSchema.nullable(),
  groupName: z.string().nullable(),
  userId: uuidIdSchema.nullable(),
  userName: z.string().nullable(),
  timeOpen: z.string().nullable(),
  timeClose: z.string().nullable(),
  timeLimitSeconds: z.number().int().nullable(),
  attempts: z.number().int().nullable(),
  hasPassword: z.boolean(),
  reason: z.string().nullable(),
});
export type ExamPinOverrideView = z.infer<typeof examPinOverrideViewSchema>;

export const createExamPinOverrideSchema = z.strictObject({
  groupId: uuidIdSchema.optional(),
  userId: uuidIdSchema.optional(),
  timeOpen: z.string().nullable().optional(),
  timeClose: z.string().nullable().optional(),
  timeLimitSeconds: z.number().int().positive().nullable().optional(),
  attempts: z.number().int().min(0).nullable().optional(),
  password: z.string().min(1).nullable().optional(),
  reason: z.string().min(1).nullable().optional(),
});
export type CreateExamPinOverride = z.infer<typeof createExamPinOverrideSchema>;

export const updateExamPinOverrideSchema = z.strictObject({
  timeOpen: z.string().nullable().optional(),
  timeClose: z.string().nullable().optional(),
  timeLimitSeconds: z.number().int().positive().nullable().optional(),
  attempts: z.number().int().min(0).nullable().optional(),
  password: z.string().min(1).nullable().optional(),
  reason: z.string().min(1).nullable().optional(),
});
export type UpdateExamPinOverride = z.infer<typeof updateExamPinOverrideSchema>;

export const examPinFeedbackViewSchema = z.object({
  id: uuidIdSchema,
  pinId: uuidIdSchema,
  minPercent: z.number(),
  maxPercent: z.number(),
  feedback: z.string(),
});
export type ExamPinFeedbackView = z.infer<typeof examPinFeedbackViewSchema>;

export const createExamPinFeedbackSchema = z.strictObject({
  minPercent: z.number().min(0).max(100),
  maxPercent: z.number().min(0).max(100),
  feedback: z.string().min(1),
});
export type CreateExamPinFeedback = z.infer<typeof createExamPinFeedbackSchema>;

export const QUIZ_ATTEMPT_EVENT_TYPES = ['fullscreen_exit', 'focus_lost', 'disconnect_long'] as const;

export const recordQuizAttemptEventSchema = z.strictObject({
  type: z.enum(QUIZ_ATTEMPT_EVENT_TYPES),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type RecordQuizAttemptEvent = z.infer<typeof recordQuizAttemptEventSchema>;

export const gradeQuizQuestionSchema = z.strictObject({
  questionId: uuidIdSchema,
  grades: z.array(z.strictObject({
    attemptId: uuidIdSchema,
    mark: z.number().min(0),
    comment: z.string().optional(),
  })).min(1),
});
export type GradeQuizQuestion = z.infer<typeof gradeQuizQuestionSchema>;


export const COGNITIVE_LEVELS = ['biet', 'hieu', 'van_dung', 'van_dung_cao'] as const;

export const MATRIX_PRESET_KINDS = ['cv7991_periodic'] as const;

export const examMatrixCellViewSchema = z.object({
  id: uuidIdSchema,
  matrixId: uuidIdSchema,
  curriculumNodeId: uuidIdSchema,
  cognitiveLevel: z.enum(COGNITIVE_LEVELS),
  qtype: z.enum(['multichoice', 'truefalse', 'shortanswer', 'essay']),
  questionCount: z.number().int(),
  cellScore: z.number(),
  minutes: z.number().int().nullable(),
  tfScale: tfScaleSchema.nullable(),
  position: z.number().int(),
});
export type ExamMatrixCellView = z.infer<typeof examMatrixCellViewSchema>;

export const examMatrixViewSchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  subjectId: uuidIdSchema,
  curriculumId: uuidIdSchema,
  contextId: uuidIdSchema,
  presetKind: z.enum(MATRIX_PRESET_KINDS),
  targetFormPercents: z.record(z.string(), z.number()).nullable(),
  targetLevelPercents: z.record(z.string(), z.number()).nullable(),
  levelSet: z.enum(['three', 'four']),
  scopeNote: z.string().nullable(),
  scopeNodeIds: z.array(uuidIdSchema).nullable(),
  totalScore: z.number(),
  createdBy: uuidIdSchema.nullable(),
  bankId: uuidIdSchema.nullable(),
  status: z.enum(['draft', 'ready', 'hidden']),
  isTemplate: z.boolean(),
  derivedFromMatrixId: uuidIdSchema.nullable(),
  derivedFromBankId: uuidIdSchema.nullable(),
  originalAuthorId: uuidIdSchema.nullable(),
  copyCount: z.number().int(),
  withdrawnReason: z.string().nullable(),
  withdrawnBy: uuidIdSchema.nullable(),
  withdrawnAt: z.string().nullable(),
  version: z.number().int(),
  cells: z.array(examMatrixCellViewSchema),
  warnings: z.array(z.string()),
});
export type ExamMatrixView = z.infer<typeof examMatrixViewSchema>;

export const createExamMatrixSchema = z.strictObject({
  name: z.string().min(1),
  subjectId: uuidIdSchema,
  curriculumId: uuidIdSchema,
  targetFormPercents: z.record(z.string(), z.number().min(0).max(100)).nullable().optional(),
  targetLevelPercents: z.record(z.string(), z.number().min(0).max(100)).nullable().optional(),
  levelSet: z.enum(['three', 'four']).optional(),
  scopeNote: z.string().nullable().optional(),
  scopeNodeIds: z.array(uuidIdSchema).nullable().optional(),
  totalScore: z.number().positive().optional(),
  bankId: uuidIdSchema.nullable().optional(),
  status: z.enum(['draft', 'ready', 'hidden']).optional(),
  isTemplate: z.boolean().optional(),
  derivedFromMatrixId: uuidIdSchema.nullable().optional(),
});
export type CreateExamMatrix = z.infer<typeof createExamMatrixSchema>;

export const updateExamMatrixSchema = z.strictObject({
  name: z.string().min(1).optional(),
  targetFormPercents: z.record(z.string(), z.number().min(0).max(100)).nullable().optional(),
  targetLevelPercents: z.record(z.string(), z.number().min(0).max(100)).nullable().optional(),
  levelSet: z.enum(['three', 'four']).optional(),
  scopeNote: z.string().nullable().optional(),
  scopeNodeIds: z.array(uuidIdSchema).nullable().optional(),
  totalScore: z.number().positive().optional(),
  bankId: uuidIdSchema.nullable().optional(),
  status: z.enum(['draft', 'ready', 'hidden']).optional(),
  isTemplate: z.boolean().optional(),
});
export type UpdateExamMatrix = z.infer<typeof updateExamMatrixSchema>;

export const createExamMatrixCellSchema = z.strictObject({
  curriculumNodeId: uuidIdSchema,
  cognitiveLevel: z.enum(COGNITIVE_LEVELS),
  qtype: z.enum(['multichoice', 'truefalse', 'shortanswer', 'essay']),
  questionCount: z.number().int().positive(),
  cellScore: z.number().positive(),
  minutes: z.number().int().positive().nullable().optional(),
  tfScale: tfScaleSchema.nullable().optional(),
  position: z.number().int().positive().optional(),
});
export type CreateExamMatrixCell = z.infer<typeof createExamMatrixCellSchema>;

export const updateExamMatrixCellSchema = z.strictObject({
  questionCount: z.number().int().positive().optional(),
  cellScore: z.number().positive().optional(),
  minutes: z.number().int().positive().nullable().optional(),
  tfScale: tfScaleSchema.nullable().optional(),
  position: z.number().int().positive().optional(),
});
export type UpdateExamMatrixCell = z.infer<typeof updateExamMatrixCellSchema>;

export const copyExamMatrixSchema = z.strictObject({
  targetBankId: uuidIdSchema.nullable().optional(),
  name: z.string().min(1).optional(),
});
export type CopyExamMatrix = z.infer<typeof copyExamMatrixSchema>;

export const createMatrixContributionSchema = z.strictObject({
  targetBankId: uuidIdSchema,
  note: z.string().max(2000).optional(),
});
export type CreateMatrixContribution = z.infer<typeof createMatrixContributionSchema>;

export const approveMatrixContributionSchema = z.strictObject({});
export type ApproveMatrixContribution = z.infer<typeof approveMatrixContributionSchema>;

export const rejectMatrixContributionSchema = z.strictObject({
  reason: z.string().min(1),
});
export type RejectMatrixContribution = z.infer<typeof rejectMatrixContributionSchema>;

export const examMatrixContributionViewSchema = z.object({
  id: uuidIdSchema,
  matrixId: uuidIdSchema,
  matrixName: z.string().nullable(),
  targetBankId: uuidIdSchema,
  proposerId: uuidIdSchema,
  proposerName: z.string().nullable(),
  note: z.string(),
  contentHash: z.string(),
  nearDuplicateOf: uuidIdSchema.nullable(),
  status: z.enum(['pending', 'approved', 'rejected']),
  rejectReason: z.string().nullable(),
  reviewerId: uuidIdSchema.nullable(),
  resultMatrixId: uuidIdSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExamMatrixContributionView = z.infer<typeof examMatrixContributionViewSchema>;

export const matrixCellAvailabilitySchema = z.object({
  cellId: uuidIdSchema,
  required: z.number().int(),
  available: z.number().int(),
  deficit: z.number().int(),
});
export type MatrixCellAvailability = z.infer<typeof matrixCellAvailabilitySchema>;

export const MATRIX_QTYPES = ['multichoice', 'truefalse', 'shortanswer', 'essay'] as const;
export type MatrixQtype = (typeof MATRIX_QTYPES)[number];

export const matrixImportIssueSchema = z.object({
  sheet: z.string().nullable(),
  row: z.number().int().nullable(),
  column: z.string().nullable(),
  code: z.string(),
  message: z.string(),
});
export type MatrixImportIssue = z.infer<typeof matrixImportIssueSchema>;

export const matrixImportPreviewCellSchema = z.object({
  curriculumNodeId: uuidIdSchema,
  cognitiveLevel: z.enum(COGNITIVE_LEVELS),
  qtype: z.enum(MATRIX_QTYPES),
  questionCount: z.number().int(),
  cellScore: z.number(),
});
export type MatrixImportPreviewCell = z.infer<typeof matrixImportPreviewCellSchema>;

export const matrixImportCellAvailabilitySchema = z.object({
  curriculumNodeId: uuidIdSchema,
  cognitiveLevel: z.enum(COGNITIVE_LEVELS),
  qtype: z.enum(MATRIX_QTYPES),
  required: z.number().int(),
  available: z.number().int(),
  deficit: z.number().int(),
});
export type MatrixImportCellAvailability = z.infer<typeof matrixImportCellAvailabilitySchema>;

export const matrixImportPreviewRowSchema = z.object({
  nodeId: uuidIdSchema,
  topicTitle: z.string(),
  nodeTitle: z.string(),
  position: z.number().int(),
  outcomes: z.array(z.object({ id: uuidIdSchema, content: z.string() })),
});
export type MatrixImportPreviewRow = z.infer<typeof matrixImportPreviewRowSchema>;

export const matrixImportPreviewSchema = z.object({
  valid: z.boolean(),
  errors: z.array(matrixImportIssueSchema),
  warnings: z.array(z.string()),
  name: z.string().nullable(),
  subjectId: uuidIdSchema.nullable(),
  curriculumId: uuidIdSchema.nullable(),
  levelSet: z.enum(['three', 'four']).nullable(),
  totalScore: z.number().nullable(),
  scopeNote: z.string().nullable(),
  perFormScores: z.record(z.string(), z.number().nullable()),
  rows: z.array(matrixImportPreviewRowSchema),
  cells: z.array(matrixImportPreviewCellSchema),
  totals: z.object({
    byForm: z.array(z.object({
      qtype: z.enum(MATRIX_QTYPES), questionCount: z.number().int(), score: z.number(), percent: z.number(),
    })),
    byLevel: z.array(z.object({
      cognitiveLevel: z.enum(COGNITIVE_LEVELS), questionCount: z.number().int(), score: z.number(), percent: z.number(),
    })),
    totalScore: z.number(),
    totalQuestions: z.number().int(),
  }),
  availability: z.array(matrixImportCellAvailabilitySchema),
});
export type MatrixImportPreview = z.infer<typeof matrixImportPreviewSchema>;

export const generateFromMatrixSchema = z.strictObject({
  courseId: uuidIdSchema,
  sectionId: uuidIdSchema,
  name: z.string().min(1),
  timeLimitSeconds: z.number().int().positive().nullable().optional(),
});
export type GenerateFromMatrix = z.infer<typeof generateFromMatrixSchema>;



export const startQuizAttemptSchema = z.strictObject({
  preview: z.boolean().optional(),
  password: z.string().optional(),
});
export type StartQuizAttempt = z.infer<typeof startQuizAttemptSchema>;

export const submitQuizResponseSchema = z.strictObject({
  questionAttemptId: uuidIdSchema,
  response: z.string().nullable().optional(),
});
export type SubmitQuizResponse = z.infer<typeof submitQuizResponseSchema>;

export const manualGradeQuizSchema = z.strictObject({
  mark: z.number().min(0),
  comment: z.string().optional(),
});
export type ManualGradeQuiz = z.infer<typeof manualGradeQuizSchema>;

export const ASSIGN_SUBMISSION_STATUSES = ['none', 'draft', 'submitted', 'graded'] as const;
export type AssignSubmissionStatus = (typeof ASSIGN_SUBMISSION_STATUSES)[number];

export const ASSIGN_RESULT_MODES = ['score', 'level', 'score_feedback'] as const;
export type AssignResultMode = (typeof ASSIGN_RESULT_MODES)[number];

export const ASSIGN_GRADE_LEVELS = ['dat', 'chua_dat'] as const;
export type AssignGradeLevel = (typeof ASSIGN_GRADE_LEVELS)[number];

export const ASSIGN_GRADE_STATUSES = ['draft', 'released'] as const;
export type AssignGradeStatus = (typeof ASSIGN_GRADE_STATUSES)[number];

export const ASSIGN_ANNOTATION_KINDS = ['correct', 'incorrect', 'draw', 'note', 'highlight', 'frame'] as const;
export type AssignAnnotationKind = (typeof ASSIGN_ANNOTATION_KINDS)[number];

export const ASSIGN_COMMENT_BANK_CATEGORIES = ['strengths', 'weaknesses', 'improvement', 'progress', 'general'] as const;
export type AssignCommentBankCategory = (typeof ASSIGN_COMMENT_BANK_CATEGORIES)[number];

export const assignmentViewSchema = z.object({
  id: uuidIdSchema,
  courseId: uuidIdSchema,
  cmId: uuidIdSchema.nullable(),
  name: z.string(),
  intro: z.string(),
  dueDate: z.string().nullable(),
  maxFiles: z.number().int(),
  acceptedFileTypes: z.string().nullable(),
  grade: z.number(),
  resultMode: z.enum(ASSIGN_RESULT_MODES),
});
export type AssignmentView = z.infer<typeof assignmentViewSchema>;

export const assignSubmissionFileViewSchema = z.object({
  fileId: uuidIdSchema,
  fileName: z.string(),
  fileSize: z.number().int(),
  mimeType: z.string().nullable(),
  contentHash: z.string(),
  signedUrl: z.string(),
  signedUrlExpiresAt: z.number().int(),
});
export type AssignSubmissionFileView = z.infer<typeof assignSubmissionFileViewSchema>;

export const assignGradeViewSchema = z.object({
  grade: z.number().nullable(),
  level: z.enum(ASSIGN_GRADE_LEVELS).nullable(),
  feedback: z.string().nullable(),
  feedbackProgress: z.string().nullable(),
  feedbackStrengths: z.string().nullable(),
  feedbackWeaknesses: z.string().nullable(),
  graderId: uuidIdSchema,
  gradedAt: z.string(),
  attemptNumber: z.number().int(),
  status: z.enum(ASSIGN_GRADE_STATUSES),
  releasedAt: z.string().nullable(),
});
export type AssignGradeView = z.infer<typeof assignGradeViewSchema>;

export const assignAnnotationViewSchema = z.object({
  id: uuidIdSchema,
  submissionId: uuidIdSchema,
  fileId: uuidIdSchema,
  page: z.number().int(),
  x: z.number(),
  y: z.number(),
  kind: z.enum(ASSIGN_ANNOTATION_KINDS),
  color: z.string().nullable(),
  text: z.string().nullable(),
  points: z.array(z.object({ x: z.number(), y: z.number() })).nullable(),
  authorId: uuidIdSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssignAnnotationView = z.infer<typeof assignAnnotationViewSchema>;

export const assignRubricLevelViewSchema = z.object({
  id: uuidIdSchema,
  label: z.string(),
  score: z.number(),
});
export type AssignRubricLevelView = z.infer<typeof assignRubricLevelViewSchema>;

export const assignRubricCriterionViewSchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  descriptionForStudent: z.string().nullable(),
  descriptionForGrader: z.string().nullable(),
  mode: z.enum(['levels', 'score']),
  maxScore: z.number().nullable(),
  outcomeId: z.string().nullable(),
  outcomeText: z.string().nullable(),
  levels: z.array(assignRubricLevelViewSchema),
});
export type AssignRubricCriterionView = z.infer<typeof assignRubricCriterionViewSchema>;

export const assignRubricViewSchema = z.object({
  id: uuidIdSchema,
  assignmentId: uuidIdSchema,
  title: z.string().nullable(),
  criteria: z.array(assignRubricCriterionViewSchema),
});
export type AssignRubricView = z.infer<typeof assignRubricViewSchema>;

export const assignRubricEvaluationViewSchema = z.object({
  criterionId: uuidIdSchema,
  levelId: uuidIdSchema.nullable(),
  score: z.number().nullable(),
  note: z.string().nullable(),
});
export type AssignRubricEvaluationView = z.infer<typeof assignRubricEvaluationViewSchema>;

export const assignGradeRevisionViewSchema = z.object({
  id: uuidIdSchema,
  actorId: uuidIdSchema,
  createdAt: z.string(),
  previousGrade: z.number().nullable(),
  newGrade: z.number().nullable(),
  previousLevel: z.enum(ASSIGN_GRADE_LEVELS).nullable(),
  newLevel: z.enum(ASSIGN_GRADE_LEVELS).nullable(),
});
export type AssignGradeRevisionView = z.infer<typeof assignGradeRevisionViewSchema>;

export const assignFeedbackMessageViewSchema = z.object({
  id: uuidIdSchema,
  authorId: uuidIdSchema,
  body: z.string(),
  createdAt: z.string(),
});
export type AssignFeedbackMessageView = z.infer<typeof assignFeedbackMessageViewSchema>;

export const assignOwnSubmissionViewSchema = z.object({
  submissionId: uuidIdSchema.nullable(),
  status: z.enum(ASSIGN_SUBMISSION_STATUSES),
  attemptNumber: z.number().int(),
  submittedAt: z.string().nullable(),
  late: z.boolean(),
  files: z.array(assignSubmissionFileViewSchema),
  grade: assignGradeViewSchema.nullable(),
  annotations: z.array(assignAnnotationViewSchema),
  rubricEvaluations: z.array(assignRubricEvaluationViewSchema),
  feedbackMessages: z.array(assignFeedbackMessageViewSchema),
});
export type AssignOwnSubmissionView = z.infer<typeof assignOwnSubmissionViewSchema>;

export const assignmentForUserViewSchema = z.object({
  assignment: assignmentViewSchema,
  mySubmission: assignOwnSubmissionViewSchema,
  rubric: assignRubricViewSchema.nullable(),
  canSubmit: z.boolean(),
  canManage: z.boolean(),
  canGrade: z.boolean(),
  canViewAllSubmissions: z.boolean(),
});
export type AssignmentForUserView = z.infer<typeof assignmentForUserViewSchema>;

export const assignSubmissionSummarySchema = z.object({
  userId: uuidIdSchema,
  displayName: z.string(),
  status: z.enum(ASSIGN_SUBMISSION_STATUSES),
  attemptNumber: z.number().int(),
  submittedAt: z.string().nullable(),
  late: z.boolean(),
  fileCount: z.number().int(),
  grade: z.number().nullable(),
  level: z.enum(ASSIGN_GRADE_LEVELS).nullable(),
  feedback: z.string().nullable(),
  gradeStatus: z.enum(['none', 'draft', 'released']),
});
export type AssignSubmissionSummary = z.infer<typeof assignSubmissionSummarySchema>;

export const assignSubmissionDetailSchema = z.object({
  userId: uuidIdSchema,
  status: z.enum(ASSIGN_SUBMISSION_STATUSES),
  attemptNumber: z.number().int(),
  submittedAt: z.string().nullable(),
  late: z.boolean(),
  files: z.array(assignSubmissionFileViewSchema),
  grade: assignGradeViewSchema.nullable(),
  annotations: z.array(assignAnnotationViewSchema),
  rubricEvaluations: z.array(assignRubricEvaluationViewSchema),
  revisions: z.array(assignGradeRevisionViewSchema),
  feedbackMessages: z.array(assignFeedbackMessageViewSchema),
});
export type AssignSubmissionDetail = z.infer<typeof assignSubmissionDetailSchema>;

export const createAssignmentSchema = z.strictObject({
  sectionId: uuidIdSchema,
  name: z.string().min(1),
  intro: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  maxFiles: z.number().int().min(1).max(50).optional(),
  acceptedFileTypes: z.string().nullable().optional(),
  grade: z.number().positive().optional(),
  resultMode: z.enum(ASSIGN_RESULT_MODES).optional(),
});
export type CreateAssignment = z.infer<typeof createAssignmentSchema>;

export const updateAssignmentSchema = z.strictObject({
  name: z.string().min(1).optional(),
  intro: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  maxFiles: z.number().int().min(1).max(50).optional(),
  acceptedFileTypes: z.string().nullable().optional(),
  grade: z.number().positive().optional(),
  resultMode: z.enum(ASSIGN_RESULT_MODES).optional(),
});
export type UpdateAssignment = z.infer<typeof updateAssignmentSchema>;

export const assignRubricEvaluationInputSchema = z.strictObject({
  criterionId: uuidIdSchema,
  levelId: uuidIdSchema.nullable().optional(),
  score: z.number().min(0).nullable().optional(),
  note: z.string().nullable().optional(),
});
export type AssignRubricEvaluationInput = z.infer<typeof assignRubricEvaluationInputSchema>;

export const gradeAssignmentSubmissionSchema = z.strictObject({
  grade: z.number().min(0).optional(),
  level: z.enum(ASSIGN_GRADE_LEVELS).nullable().optional(),
  feedback: z.string().optional(),
  feedbackProgress: z.string().nullable().optional(),
  feedbackStrengths: z.string().nullable().optional(),
  feedbackWeaknesses: z.string().nullable().optional(),
  evaluations: z.array(assignRubricEvaluationInputSchema).optional(),
});
export type GradeAssignmentSubmission = z.infer<typeof gradeAssignmentSubmissionSchema>;

export const releaseAssignmentGradesSchema = z.strictObject({
  userIds: z.array(uuidIdSchema).optional(),
});
export type ReleaseAssignmentGrades = z.infer<typeof releaseAssignmentGradesSchema>;

export const releaseAssignmentResultSchema = z.object({
  releasedCount: z.number().int(),
  skippedUserIds: z.array(uuidIdSchema),
});
export type ReleaseAssignmentResult = z.infer<typeof releaseAssignmentResultSchema>;

export const createAssignAnnotationSchema = z.strictObject({
  fileId: uuidIdSchema,
  page: z.number().int().min(1).optional(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  kind: z.enum(ASSIGN_ANNOTATION_KINDS),
  color: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  points: z.array(z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })).max(2000).nullable().optional(),
});
export type CreateAssignAnnotation = z.infer<typeof createAssignAnnotationSchema>;

export const updateAssignAnnotationSchema = z.strictObject({
  page: z.number().int().min(1).optional(),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  color: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  points: z.array(z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })).max(2000).nullable().optional(),
});
export type UpdateAssignAnnotation = z.infer<typeof updateAssignAnnotationSchema>;

export const assignRubricCriterionInputSchema = z.strictObject({
  name: z.string().min(1),
  descriptionForStudent: z.string().nullable().optional(),
  descriptionForGrader: z.string().nullable().optional(),
  mode: z.enum(['levels', 'score']),
  maxScore: z.number().positive().nullable().optional(),
  outcomeId: z.string().nullable().optional(),
  outcomeText: z.string().nullable().optional(),
  levels: z.array(z.strictObject({
    label: z.string().min(1),
    score: z.number().min(0),
  })).optional(),
});
export type AssignRubricCriterionInput = z.infer<typeof assignRubricCriterionInputSchema>;

export const upsertAssignRubricSchema = z.strictObject({
  title: z.string().nullable().optional(),
  criteria: z.array(assignRubricCriterionInputSchema).min(1).max(30),
});
export type UpsertAssignRubric = z.infer<typeof upsertAssignRubricSchema>;

export const createAssignFeedbackMessageSchema = z.strictObject({
  body: z.string().min(1),
});
export type CreateAssignFeedbackMessage = z.infer<typeof createAssignFeedbackMessageSchema>;

export const teacherCommentBankEntryViewSchema = z.object({
  id: uuidIdSchema,
  category: z.enum(ASSIGN_COMMENT_BANK_CATEGORIES).nullable(),
  text: z.string(),
  createdAt: z.string(),
});
export type TeacherCommentBankEntryView = z.infer<typeof teacherCommentBankEntryViewSchema>;

export const createTeacherCommentBankEntrySchema = z.strictObject({
  text: z.string().min(1),
  category: z.enum(ASSIGN_COMMENT_BANK_CATEGORIES).nullable().optional(),
});
export type CreateTeacherCommentBankEntry = z.infer<typeof createTeacherCommentBankEntrySchema>;

export const QUESTION_BANK_SCOPES = ['personal', 'team', 'school', 'course', 'platform'] as const;

export const QUESTION_BANK_KINDS = ['question', 'exam', 'matrix'] as const;
export const createQuestionBankSchema = z.strictObject({
  name: z.string().min(1),
  scope: z.enum(QUESTION_BANK_SCOPES),
  bankKind: z.enum(QUESTION_BANK_KINDS).optional(),
  scopeRefId: uuidIdSchema.optional(),
  leaderId: uuidIdSchema.optional(),
});
export type CreateQuestionBank = z.infer<typeof createQuestionBankSchema>;

export const copyQuestionSchema = z.strictObject({
  targetBankId: uuidIdSchema.optional(),
  targetCategoryId: uuidIdSchema.optional(),
});
export type CopyQuestion = z.infer<typeof copyQuestionSchema>;

export const copyQuestionsBatchSchema = z.strictObject({
  questionIds: z.array(uuidIdSchema).min(1).max(100),
  targetBankId: uuidIdSchema.optional(),
  targetCategoryId: uuidIdSchema.optional(),
});
export type CopyQuestionsBatch = z.infer<typeof copyQuestionsBatchSchema>;

export const withdrawQuestionSchema = z.strictObject({
  reason: z.string().min(1),
});
export type WithdrawQuestion = z.infer<typeof withdrawQuestionSchema>;

export const QUIZ_SLOT_VERSION_MODES = ['pinned', 'follow_latest'] as const;

export const createContributionSchema = z.strictObject({
  questionId: uuidIdSchema,
  note: z.string().optional(),
  mode: z.enum(['new', 'update']).optional(),
  targetQuestionId: uuidIdSchema.optional(),
});
export type CreateContribution = z.infer<typeof createContributionSchema>;

export const approveContributionSchema = z.strictObject({
  targetCategoryId: uuidIdSchema.optional(),
});
export type ApproveContribution = z.infer<typeof approveContributionSchema>;

export const rejectContributionSchema = z.strictObject({
  reason: z.string().min(1),
});
export type RejectContribution = z.infer<typeof rejectContributionSchema>;

export const setGradePostingPolicySchema = z.strictObject({
  policy: z.enum(['auto', 'manual']),
});
export type SetGradePostingPolicy = z.infer<typeof setGradePostingPolicySchema>;

export const gradePublicationActionSchema = z.strictObject({
  note: z.string().max(500).optional(),
});
export type GradePublicationAction = z.infer<typeof gradePublicationActionSchema>;

export const createGuardianLinkSchema = z.strictObject({
  guardianUserId: uuidIdSchema,
  studentUserId: uuidIdSchema,
  relationship: z.string().min(1).max(100),
  note: z.string().max(500).optional(),
});
export type CreateGuardianLink = z.infer<typeof createGuardianLinkSchema>;

export const EXAM_PAPER_KINDS = ['snapshot'] as const;

export const EXAM_PAPER_EXAM_KINDS = ['regular', 'midterm', 'final', 'mock', 'practice'] as const;

export const EXAM_PAPER_STATUSES = ['draft', 'ready', 'hidden'] as const;

export const examSlotInputSchema = z.strictObject({
  questionId: uuidIdSchema,
  sourceDomain: z.enum(['centre', 'bank-system']).optional(),
  sourceVersionNumber: z.number().int().positive().optional(),
  maxMark: z.number().positive().optional(),
  section: z.string().max(200).optional(),
}).refine((slot) => slot.sourceDomain !== 'bank-system' || slot.sourceVersionNumber !== undefined, { path: ['sourceVersionNumber'], message: 'System question version is required' });
export type ExamSlotInput = z.infer<typeof examSlotInputSchema>;

export const createExamSchema = z.strictObject({
  name: z.string().min(1),
  subjectId: uuidIdSchema.nullable().optional(),
  grade: z.number().int().min(1).max(12).nullable().optional(),
  examKind: z.enum(EXAM_PAPER_EXAM_KINDS).nullable().optional(),
  totalScore: z.number().positive().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  tfScale: z.array(z.number()).length(5).nullable().optional(),
  matrixId: uuidIdSchema.nullable().optional(),
  slots: z.array(examSlotInputSchema).max(500).optional(),
});
export type CreateExam = z.infer<typeof createExamSchema>;

export const updateExamSchema = z.strictObject({
  name: z.string().min(1).optional(),
  subjectId: uuidIdSchema.nullable().optional(),
  grade: z.number().int().min(1).max(12).nullable().optional(),
  examKind: z.enum(EXAM_PAPER_EXAM_KINDS).nullable().optional(),
  totalScore: z.number().positive().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  tfScale: z.array(z.number()).length(5).nullable().optional(),
  matrixId: uuidIdSchema.nullable().optional(),
});
export type UpdateExam = z.infer<typeof updateExamSchema>;

export const setExamSlotsSchema = z.strictObject({
  slots: z.array(examSlotInputSchema).max(500),
});
export type SetExamSlots = z.infer<typeof setExamSlotsSchema>;

export const setExamStatusSchema = z.strictObject({
  status: z.enum(EXAM_PAPER_STATUSES),
});
export type SetExamStatus = z.infer<typeof setExamStatusSchema>;

export const copyExamSchema = z.strictObject({
  targetBankId: uuidIdSchema.optional(),
  name: z.string().min(1).optional(),
});
export type CopyExam = z.infer<typeof copyExamSchema>;

export const createExamContributionSchema = z.strictObject({
  examId: uuidIdSchema,
  note: z.string().optional(),
  mode: z.enum(['new', 'update']).optional(),
  targetExamId: uuidIdSchema.optional(),
  withDossier: z.boolean().optional(),
});
export type CreateExamContribution = z.infer<typeof createExamContributionSchema>;

export const withdrawExamSchema = z.strictObject({
  reason: z.string().trim().min(1),
});
export type WithdrawExam = z.infer<typeof withdrawExamSchema>;

export const withdrawExamMatrixSchema = z.strictObject({
  reason: z.string().trim().min(1),
});
export type WithdrawExamMatrix = z.infer<typeof withdrawExamMatrixSchema>;

export const approveExamContributionSchema = z.strictObject({});
export type ApproveExamContribution = z.infer<typeof approveExamContributionSchema>;

export const rejectExamContributionSchema = z.strictObject({
  reason: z.string().min(1),
});
export type RejectExamContribution = z.infer<typeof rejectExamContributionSchema>;

export const createExamPinSchema = z.strictObject({
  requestId: uuidIdSchema.optional(),
  sectionId: uuidIdSchema,
  examId: uuidIdSchema.optional(),
  examVersionId: uuidIdSchema.optional(),
  newExam: createExamSchema.optional(),
  name: z.string().min(1).optional(),
  intro: z.string().optional(),
  timeOpen: z.string().nullable().optional(),
  timeClose: z.string().nullable().optional(),
  timeLimitSeconds: z.number().int().positive().nullable().optional(),
  attemptsAllowed: z.number().int().min(0).optional(),
  gradeMethod: z.enum(QUIZ_GRADE_METHODS).optional(),
  shuffleAnswers: z.boolean().optional(),
  variantCount: z.number().int().min(1).max(50).optional(),
  versionMode: z.enum(['pinned', 'float_latest_ready']).optional(),
  ...pinAccessRuleFields,
});
export type CreateExamPin = z.infer<typeof createExamPinSchema>;

export const updateExamPinSchema = z.strictObject({
  name: z.string().min(1).optional(),
  intro: z.string().optional(),
  timeOpen: z.string().nullable().optional(),
  timeClose: z.string().nullable().optional(),
  timeLimitSeconds: z.number().int().positive().nullable().optional(),
  attemptsAllowed: z.number().int().min(0).optional(),
  gradeMethod: z.enum(QUIZ_GRADE_METHODS).optional(),
  shuffleAnswers: z.boolean().optional(),
  examVersionId: uuidIdSchema.optional(),
  variantCount: z.number().int().min(1).max(50).optional(),
  versionMode: z.enum(['pinned', 'float_latest_ready']).optional(),
  ...pinAccessRuleFields,
});
export type UpdateExamPin = z.infer<typeof updateExamPinSchema>;

export const pinVersionUpdateSlotDiffSchema = z.object({
  position: z.number().int(),
  change: z.enum(['added', 'removed', 'question_changed', 'question_version_changed', 'mark_changed', 'unchanged']),
  fromQuestionId: uuidIdSchema.nullable(),
  toQuestionId: uuidIdSchema.nullable(),
  fromPinnedVersionNumber: z.number().int().nullable(),
  toPinnedVersionNumber: z.number().int().nullable(),
  fromMaxMark: z.number().nullable(),
  toMaxMark: z.number().nullable(),
});
export type PinVersionUpdateSlotDiff = z.infer<typeof pinVersionUpdateSlotDiffSchema>;

export const pinVersionUpdatePreviewSchema = z.object({
  pinId: uuidIdSchema,
  fromExamVersionId: uuidIdSchema,
  fromVersionNumber: z.number().int(),
  toExamVersionId: uuidIdSchema.nullable(),
  toVersionNumber: z.number().int().nullable(),
  examStatus: z.string(),
  available: z.boolean(),
  blockedByAttempts: z.boolean(),
  slotDiffs: z.array(pinVersionUpdateSlotDiffSchema),
});
export type PinVersionUpdatePreview = z.infer<typeof pinVersionUpdatePreviewSchema>;

export const applyPinVersionUpdateSchema = z.strictObject({
  toExamVersionId: uuidIdSchema,
});
export type ApplyPinVersionUpdate = z.infer<typeof applyPinVersionUpdateSchema>;

export const regradePinQuestionSchema = z.strictObject({
  questionId: uuidIdSchema,
  toVersionId: uuidIdSchema,
  dryRun: z.boolean(),
});
export type RegradePinQuestion = z.infer<typeof regradePinQuestionSchema>;

export const pinRegradeChangeSchema = z.object({
  examAttemptId: uuidIdSchema,
  userId: uuidIdSchema,
  attemptNumber: z.number().int(),
  questionAttemptId: uuidIdSchema,
  oldFraction: z.number().nullable(),
  newFraction: z.number().nullable(),
  oldSumGrades: z.number().nullable(),
  newSumGrades: z.number().nullable(),
  changed: z.boolean(),
});
export type PinRegradeChange = z.infer<typeof pinRegradeChangeSchema>;

export const pinRegradeResultSchema = z.object({
  dryRun: z.boolean(),
  pinId: uuidIdSchema,
  questionId: uuidIdSchema,
  fromVersionIds: z.array(uuidIdSchema),
  toVersionId: uuidIdSchema,
  changes: z.array(pinRegradeChangeSchema),
});
export type PinRegradeResult = z.infer<typeof pinRegradeResultSchema>;

export const pinRegradeLogItemSchema = z.object({
  examAttemptId: uuidIdSchema,
  userId: uuidIdSchema,
  attemptNumber: z.number().int(),
  oldFraction: z.number().nullable(),
  newFraction: z.number().nullable(),
  oldSumGrades: z.number().nullable(),
  newSumGrades: z.number().nullable(),
});
export type PinRegradeLogItem = z.infer<typeof pinRegradeLogItemSchema>;

export const pinRegradeLogEntrySchema = z.object({
  id: uuidIdSchema,
  pinId: uuidIdSchema,
  questionId: uuidIdSchema,
  fromVersionId: uuidIdSchema,
  toVersionId: uuidIdSchema,
  actorId: uuidIdSchema,
  createdAt: z.string(),
  items: z.array(pinRegradeLogItemSchema),
});
export type PinRegradeLogEntry = z.infer<typeof pinRegradeLogEntrySchema>;



export const swapExamSlotSchema = z.strictObject({
  position: z.number().int().positive(),
  questionId: uuidIdSchema,
});
export type SwapExamSlot = z.infer<typeof swapExamSlotSchema>;


export const EXAM_DOSSIER_STATUSES = ['draft', 'pending', 'pending_board', 'approved', 'rejected'] as const;
export type ExamDossierStatus = (typeof EXAM_DOSSIER_STATUSES)[number];

export const createExamDossierSchema = z.strictObject({
  targetBankId: uuidIdSchema,
  note: z.string().max(1000).optional(),
});
export type CreateExamDossier = z.infer<typeof createExamDossierSchema>;

export const approveExamDossierSchema = z.strictObject({});
export type ApproveExamDossier = z.infer<typeof approveExamDossierSchema>;

export const rejectExamDossierSchema = z.strictObject({
  reason: z.string().trim().min(1),
});
export type RejectExamDossier = z.infer<typeof rejectExamDossierSchema>;

export const examDossierReviewViewSchema = z.object({
  id: z.string(),
  dossierId: z.string(),
  level: z.number().int(),
  reviewerId: z.string(),
  reviewerName: z.string().nullable(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type ExamDossierReviewView = z.infer<typeof examDossierReviewViewSchema>;

export const examDossierViewSchema = z.object({
  id: z.string(),
  examId: z.string(),
  examName: z.string().nullable(),
  sourceBankId: z.string().nullable(),
  targetBankId: z.string(),
  proposerId: z.string(),
  proposerName: z.string().nullable(),
  note: z.string(),
  status: z.enum(EXAM_DOSSIER_STATUSES),
  examVersionId: z.string().nullable(),
  examVersionNumber: z.number().nullable(),
  matrixId: z.string().nullable(),
  matrixName: z.string().nullable(),
  matrixVersion: z.number().nullable(),
  matrixVersionId: z.string().nullable(),
  boardApprovalRequired: z.boolean(),
  resultExamId: z.string().nullable(),
  reviews: z.array(examDossierReviewViewSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExamDossierView = z.infer<typeof examDossierViewSchema>;

export const PAPER_SCAN_STATUSES = ['needs_identity', 'needs_review', 'ready', 'recorded'] as const;
export type PaperScanStatus = (typeof PAPER_SCAN_STATUSES)[number];

export const PAPER_IDENTITY_SOURCES = ['qr', 'bubbles', 'manual'] as const;
export type PaperIdentitySource = (typeof PAPER_IDENTITY_SOURCES)[number];

export const paperSlotLayoutSchema = z.object({
  slot: z.number().int(),
  questionId: uuidIdSchema,
  versionId: uuidIdSchema,
  qtype: z.string(),
  optionCount: z.number().int(),
  answerIds: z.array(uuidIdSchema),
  statementIds: z.array(z.string()),
  maxMark: z.number(),
});
export type PaperSlotLayout = z.infer<typeof paperSlotLayoutSchema>;

export const paperRosterEntrySchema = z.object({
  code: z.string(),
  userId: uuidIdSchema,
  displayName: z.string(),
});
export type PaperRosterEntry = z.infer<typeof paperRosterEntrySchema>;

export const paperBatchSchema = z.object({
  id: uuidIdSchema,
  pinId: uuidIdSchema,
  variantCode: z.string(),
  examCode: z.string().nullable(),
  codeDigits: z.number().int(),
  layout: z.array(paperSlotLayoutSchema),
  roster: z.array(paperRosterEntrySchema),
  createdBy: uuidIdSchema,
  createdAt: z.string(),
});
export type PaperBatch = z.infer<typeof paperBatchSchema>;

export const createPaperBatchSchema = z.strictObject({
  variantCode: z.string().min(1).max(8).optional(),
  examCode: z.string().regex(/^\d{4}$/).optional(),
  codeDigits: z.union([z.literal(4), z.literal(8)]).optional(),
});
export type CreatePaperBatch = z.infer<typeof createPaperBatchSchema>;

export const paperReadingSchema = z.object({
  slot: z.number().int(),
  densities: z.array(z.number()),
  chosen: z.number().int().nullable(),
  state: z.enum(['filled', 'blank', 'ambiguous']),
  margin: z.number(),
  resolvedBy: z.enum(['omr', 'teacher']).nullable(),
  pairChoices: z.array(z.number().int().nullable()).optional(),
});
export type PaperReading = z.infer<typeof paperReadingSchema>;

export const paperQualitySchema = z.object({
  blurVariance: z.number(),
  glareRatio: z.number(),
  fiducialCount: z.number().int(),
});
export type PaperQuality = z.infer<typeof paperQualitySchema>;

export const paperRowGeometrySchema = z.object({
  slot: z.number().int().positive(),
  centers: z.array(z.object({ x: z.number(), y: z.number() })),
});
export type PaperRowGeometry = z.infer<typeof paperRowGeometrySchema>;

export const paperRegionSchema = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
});
export type PaperRegion = z.infer<typeof paperRegionSchema>;

export const paperScanRegionsSchema = z.object({
  name: paperRegionSchema,
  studentCode: paperRegionSchema,
  variantCode: paperRegionSchema,
});
export type PaperScanRegions = z.infer<typeof paperScanRegionsSchema>;

export const paperScanSchema = z.object({
  id: uuidIdSchema,
  pinId: uuidIdSchema,
  batchId: uuidIdSchema.nullable(),
  sessionId: uuidIdSchema.nullable(),
  status: z.enum(PAPER_SCAN_STATUSES),
  studentId: uuidIdSchema.nullable(),
  studentName: z.string().nullable(),
  identitySource: z.enum(PAPER_IDENTITY_SOURCES).nullable(),
  identityCode: z.string().nullable(),
  variantCodeRead: z.string().nullable(),
  fileId: uuidIdSchema,
  warpedFileId: uuidIdSchema.nullable(),
  rows: z.array(paperRowGeometrySchema),
  identityCandidates: z.array(paperRosterEntrySchema),
  regions: paperScanRegionsSchema,
  quality: paperQualitySchema.nullable(),
  readings: z.array(paperReadingSchema),
  attemptId: uuidIdSchema.nullable(),
  uploadedBy: uuidIdSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PaperScan = z.infer<typeof paperScanSchema>;

export const assignPaperIdentitySchema = z.strictObject({
  studentId: uuidIdSchema,
});
export type AssignPaperIdentity = z.infer<typeof assignPaperIdentitySchema>;

export const assignPaperBatchSchema = z.strictObject({
  batchId: uuidIdSchema,
});
export type AssignPaperBatch = z.infer<typeof assignPaperBatchSchema>;

export const resolvePaperReadingsSchema = z.strictObject({
  readings: z.array(z.strictObject({
    slot: z.number().int(),
    chosen: z.number().int().min(0).nullable().optional(),
    pairChoices: z.array(z.number().int().min(0).max(1).nullable()).length(4).optional(),
  })).min(1),
});
export type ResolvePaperReadings = z.infer<typeof resolvePaperReadingsSchema>;
