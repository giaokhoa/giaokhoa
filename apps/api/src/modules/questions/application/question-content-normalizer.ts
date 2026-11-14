import { BadRequestException } from '@nestjs/common';
import { badRequest } from '../../../common/http-errors';
import {
  getTrueFalseStatements, richTextBlocksContainStatementList,
  richTextBlocksHaveContent, toRichTextDocument, TRUE_FALSE_STATEMENT_COUNT,
  type RichTextDocument, type RichTextInput,
} from '@giaokhoa/contracts';

export interface QuestionAnswerInput {
  text: RichTextInput;
  correct?: boolean;
  feedback?: RichTextInput;
}

export interface QuestionOptionsInput {
  shuffleAnswers?: boolean;
  answerNumbering?: string;
  showStandardInstruction?: boolean;
  correctFeedback?: RichTextInput;
  incorrectFeedback?: RichTextInput;
  useCase?: boolean;
  numericAnswer?: boolean;
  numericMaxLength?: number | null;
  numericAllowSign?: boolean;
  numericAllowDecimal?: boolean;
  responseFormat?: string;
  responseRequired?: boolean;
  responseFieldLines?: number;
  minWordLimit?: number | null;
  maxWordLimit?: number | null;
  graderInfo?: RichTextInput;
  responseTemplate?: RichTextInput;
}

export interface QuestionContentInput {
  questionText?: RichTextInput;
  generalFeedback?: RichTextInput;
  guidance?: RichTextInput;
  defaultMark?: number;
  penalty?: number;
  stimulusId?: string | null;
  answers?: QuestionAnswerInput[];
  options?: QuestionOptionsInput;
  solution?: { answer: RichTextInput } | { answers: { statementId: string; value: boolean }[] };
}


export const SUPPORTED_QTYPES = ['multichoice', 'truefalse', 'shortanswer', 'essay'] as const;
export type SupportedQtype = (typeof SUPPORTED_QTYPES)[number];

export type StoredSolution =
  | { answer: RichTextDocument }
  | { answers: { statementId: string; value: boolean }[] };

export interface NormalisedContent {
  answers: { answer: RichTextDocument; isCorrect: boolean; feedback: RichTextDocument | null }[];
  multichoice?: { shuffleAnswers: boolean; answerNumbering: string; correctFeedback: RichTextDocument | null; incorrectFeedback: RichTextDocument | null; showStandardInstruction: boolean };
  shortanswer?: { useCase: boolean; numericAnswer: boolean; numericMaxLength: number | null; numericAllowSign: boolean; numericAllowDecimal: boolean };
  essay?: { responseFormat: string; responseRequired: boolean; responseFieldLines: number; minWordLimit: number | null; maxWordLimit: number | null; graderInfo: RichTextDocument | null; responseTemplate: RichTextDocument | null };
  answerKey: { guidance: RichTextDocument | null; solution: StoredSolution | null };
}


export function badAnswerData(message: string): BadRequestException {
  return new BadRequestException({ message, code: 'question.bad_answer_data' });
}

export function assertSupportedQtype(qtype: string): asserts qtype is SupportedQtype {
  if (!(SUPPORTED_QTYPES as readonly string[]).includes(qtype)) {
    badRequest(`qtype ${qtype} is not one of the standard Moodle qtypes supported by the core (multichoice, truefalse, shortanswer, essay)`, 'question.qtype_not_supported');
  }
}

export function docOrNull(input: RichTextInput | undefined): RichTextDocument | null {
  return input === undefined ? null : toRichTextDocument(input);
}


export function normaliseQuestionContent(qtype: SupportedQtype, input: QuestionContentInput, existingQuestionText?: RichTextDocument | null): NormalisedContent {
  const options = input.options ?? {};
  const answerKey: NormalisedContent['answerKey'] = {
    guidance: docOrNull(input.guidance),
    solution: qtype === 'essay' && input.solution !== undefined && 'answer' in input.solution
      ? { answer: toRichTextDocument(input.solution.answer) }
      : null,
  };
  if (qtype === 'truefalse') {
    if (input.answers && input.answers.length > 0) {
      throw badAnswerData('truefalse (TF-A) questions do not carry answer rows; per-statement answers go through solution.answers');
    }
    const doc = input.questionText !== undefined
      ? (typeof input.questionText === 'string' ? null : toRichTextDocument(input.questionText))
      : (existingQuestionText ?? null);
    const statements = doc ? getTrueFalseStatements(doc) : null;
    if (!doc || !statements) {
      throw badAnswerData('truefalse question text must be a document ending with a statement list (statementList)');
    }
    const stemBlocks = doc.content.slice(0, -1);
    if (!richTextBlocksHaveContent(stemBlocks) || richTextBlocksContainStatementList(stemBlocks)) {
      throw badAnswerData('truefalse stem must carry content before the statement list');
    }
    if (statements.length !== TRUE_FALSE_STATEMENT_COUNT) {
      throw badAnswerData(`truefalse requires exactly ${TRUE_FALSE_STATEMENT_COUNT} statements`);
    }
    if (new Set(statements.map((s) => s.id)).size !== statements.length) {
      throw badAnswerData('truefalse statements must have unique ids');
    }
    if (statements.some((s) => !richTextBlocksHaveContent(s.content) || richTextBlocksContainStatementList(s.content))) {
      throw badAnswerData('every truefalse statement must carry content');
    }
    const solutionAnswers = input.solution !== undefined && 'answers' in input.solution ? input.solution.answers : null;
    if (!solutionAnswers) {
      if (existingQuestionText === undefined || existingQuestionText === null) {
        throw badAnswerData('truefalse requires solution.answers with a Đúng/Sai value for every statement');
      }
      return { answers: [], answerKey };
    }
    const statementIds = new Set(statements.map((s) => s.id));
    const covered = new Set(solutionAnswers.map((a) => a.statementId));
    if (solutionAnswers.length !== statements.length || covered.size !== solutionAnswers.length
      || [...covered].some((id) => !statementIds.has(id))) {
      throw badAnswerData('truefalse solution.answers must cover exactly the statements of the question text');
    }
    return {
      answers: [],
      answerKey: {
        guidance: answerKey.guidance,
        solution: {
          answers: statements.map((s) => ({
            statementId: s.id,
            value: solutionAnswers.find((a) => a.statementId === s.id)!.value === true,
          })),
        },
      },
    };
  }
  if (qtype === 'essay') {
    if (input.answers && input.answers.length > 0) throw badAnswerData('essay questions do not carry answers; the response is graded manually');
    const min = options.minWordLimit ?? null;
    const max = options.maxWordLimit ?? null;
    if (min !== null && max !== null && min > max) throw badAnswerData('essay minWordLimit must not exceed maxWordLimit');
    return {
      answers: [],
      essay: {
        responseFormat: options.responseFormat ?? 'editor',
        responseRequired: options.responseRequired ?? true,
        responseFieldLines: options.responseFieldLines ?? 15,
        minWordLimit: min, maxWordLimit: max,
        graderInfo: docOrNull(options.graderInfo),
        responseTemplate: docOrNull(options.responseTemplate),
      },
      answerKey,
    };
  }
  const rawAnswers = input.answers;
  if (!rawAnswers || rawAnswers.length === 0) {
    throw badAnswerData(`${qtype} requires at least one answer in the structured answers list`);
  }
  const answers = rawAnswers.map((a) => ({
    answer: toRichTextDocument(a.text),
    isCorrect: a.correct === true,
    feedback: a.feedback === undefined ? null : toRichTextDocument(a.feedback),
  }));
  const correctCount = answers.filter((a) => a.isCorrect).length;
  if (qtype === 'shortanswer') {
    if (answers.some((a) => !a.isCorrect)) {
      throw badAnswerData('shortanswer answers are all accepted answers; a listed answer cannot be marked incorrect');
    }
    return {
      answers,
      shortanswer: {
        useCase: options.useCase ?? false,
        numericAnswer: options.numericAnswer ?? false,
        numericMaxLength: options.numericMaxLength ?? null,
        numericAllowSign: options.numericAllowSign ?? true,
        numericAllowDecimal: options.numericAllowDecimal ?? true,
      },
      answerKey,
    };
  }
  if (answers.length !== 4) throw badAnswerData('multichoice requires exactly four choices');
  if (correctCount !== 1) throw badAnswerData('multichoice requires exactly one correct answer');
  return {
    answers,
    multichoice: {
      shuffleAnswers: options.shuffleAnswers ?? false,
      answerNumbering: options.answerNumbering ?? 'abc',
      correctFeedback: docOrNull(options.correctFeedback),
      incorrectFeedback: docOrNull(options.incorrectFeedback),
      showStandardInstruction: options.showStandardInstruction ?? true,
    },
    answerKey,
  };
}
