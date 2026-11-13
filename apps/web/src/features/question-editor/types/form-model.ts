import type { QuestionView, RichTextDocument } from '@giaokhoa/contracts';
import { extractRichTextPlainText } from '@giaokhoa/contracts';
import {
  composeMultipleChoiceDocument,
  composeTrueFalseDocument,
  createEmptyMultipleChoiceDocument,
  createEmptyTrueFalseDocument,
  splitMultipleChoiceDocument,
  splitTrueFalseDocument,
  type MultipleChoiceDocumentJson,
  type TrueFalseDocumentJson,
} from '@giaokhoa/editor';
import { QTYPES, plainText } from '#features/questions/utils/shared';
import type { OptionsRecord, Qtype } from '#features/questions/utils/shared';


export type Doc = RichTextDocument;

export const emptyDoc = (): Doc => ({ type: 'doc', content: [{ type: 'paragraph' }] });

function docFromText(text: string): Doc {
  return text ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } : emptyDoc();
}

function asDoc(value: unknown): Doc | undefined {
  if (typeof value === 'string') return value ? docFromText(value) : undefined;
  if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'doc') {
    return value as Doc;
  }
  return undefined;
}

export function docHasContent(doc: Doc | null | undefined): boolean {
  if (!doc) return false;
  if (extractRichTextPlainText(doc).trim() !== '') return true;
  return (doc.content ?? []).some((node) =>
    ((node as { content?: { type: string }[] }).content ?? []).some((child) => child.type !== 'text'),
  );
}

function docOrUndefined(doc: Doc | undefined): Doc | undefined {
  return docHasContent(doc) ? doc : undefined;
}

export function entryStatus(view: QuestionView | null | undefined): string | undefined {
  return (view?.entry as { status?: string } | undefined)?.status;
}


export interface QuestionEditorFormState {
  qtype: Qtype;
  questionText: Doc;
  generalFeedback: Doc | undefined;
  guidance: Doc | undefined;
  stimulusId: string;
  mcDocument: MultipleChoiceDocumentJson;
  mcCorrectChoiceId: string | undefined;
  mcChoiceFeedbacks: Record<string, Doc | undefined>;
  mcShuffleAnswers: boolean;
  mcAnswerNumbering: string;
  mcShowStandardInstruction: boolean;
  mcCorrectFeedback: Doc | undefined;
  mcIncorrectFeedback: Doc | undefined;
  tfDocument: TrueFalseDocumentJson;
  tfAnswers: Record<string, boolean>;
  saUseCase: boolean;
  saNumericAnswer: boolean;
  saNumericMaxLength: string;
  saNumericAllowSign: boolean;
  saNumericAllowDecimal: boolean;
  saAnswers: { id: string; text: string }[];
  essayResponseFormat: string;
  essayResponseRequired: boolean;
  essayResponseFieldLines: string;
  essayMinWords: string;
  essayMaxWords: string;
  essayGraderInfo: Doc | undefined;
  essayResponseTemplate: Doc | undefined;
  essaySolution: Doc | undefined;
}

export function emptyEditorForm(qtype: Qtype = 'multichoice'): QuestionEditorFormState {
  return {
    qtype,
    questionText: emptyDoc(),
    generalFeedback: undefined,
    guidance: undefined,
    stimulusId: '',
    mcDocument: createEmptyMultipleChoiceDocument(),
    mcCorrectChoiceId: undefined,
    mcChoiceFeedbacks: {},
    mcShuffleAnswers: true,
    mcAnswerNumbering: 'abc',
    mcShowStandardInstruction: true,
    mcCorrectFeedback: undefined,
    mcIncorrectFeedback: undefined,
    tfDocument: createEmptyTrueFalseDocument(),
    tfAnswers: {},
    saUseCase: false,
    saNumericAnswer: false,
    saNumericMaxLength: '',
    saNumericAllowSign: false,
    saNumericAllowDecimal: false,
    saAnswers: [{ id: crypto.randomUUID(), text: '' }],
    essayResponseFormat: 'editor',
    essayResponseRequired: true,
    essayResponseFieldLines: '15',
    essayMinWords: '',
    essayMaxWords: '',
    essayGraderInfo: undefined,
    essayResponseTemplate: undefined,
    essaySolution: undefined,
  };
}

export function editorFormFromView(
  view: QuestionView,
  fallbackOptions?: OptionsRecord | null,
): QuestionEditorFormState {
  const options = (view.options ?? fallbackOptions ?? {}) as OptionsRecord;
  const qtype = (QTYPES as readonly string[]).includes(view.question.qtype)
    ? (view.question.qtype as Qtype)
    : 'multichoice';
  const form = emptyEditorForm(qtype);
  form.questionText = view.latestVersion.questionText ?? emptyDoc();
  form.generalFeedback = view.latestVersion.generalFeedback ?? undefined;
  form.stimulusId = view.latestVersion.stimulusId ?? view.stimulus?.id ?? '';
  form.guidance = view.answerKey?.guidance ?? undefined;

  if (qtype === 'multichoice') {
    form.mcShuffleAnswers = options.shuffleAnswers !== false;
    form.mcAnswerNumbering = typeof options.answerNumbering === 'string' ? options.answerNumbering : 'abc';
    form.mcShowStandardInstruction = options.showStandardInstruction !== false;
    form.mcCorrectFeedback = asDoc(options.correctFeedback);
    form.mcIncorrectFeedback = asDoc(options.incorrectFeedback);
    const answers = [...(view.answers ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    form.mcDocument = composeMultipleChoiceDocument(view.latestVersion.questionText, answers);
    form.mcCorrectChoiceId = answers.find((a) => a.isCorrect)?.id;
    form.mcChoiceFeedbacks = Object.fromEntries(
      answers.filter((a) => a.feedback).map((a) => [a.id, a.feedback ?? undefined]),
    );
  }

  if (qtype === 'truefalse') {
    form.tfDocument = composeTrueFalseDocument(view.latestVersion.questionText);
    const solution = view.answerKey?.solution;
    form.tfAnswers =
      solution && 'answers' in solution
        ? Object.fromEntries(
            (solution.answers as unknown[])
              .filter(
                (a): a is { statementId: string; value: boolean } =>
                  typeof a === 'object' && a !== null && 'statementId' in a,
              )
              .map((a) => [a.statementId, a.value]),
          )
        : {};
  }

  if (qtype === 'shortanswer') {
    form.saUseCase = options.useCase === true;
    form.saNumericAnswer = options.numericAnswer === true;
    form.saNumericMaxLength = typeof options.numericMaxLength === 'number' ? String(options.numericMaxLength) : '';
    form.saNumericAllowSign = options.numericAllowSign === true;
    form.saNumericAllowDecimal = options.numericAllowDecimal === true;
    const answers = [...(view.answers ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((answer) => ({ id: crypto.randomUUID(), text: plainText(answer.answer) }));
    if (answers.length > 0) form.saAnswers = answers;
  }

  if (qtype === 'essay') {
    form.essayResponseFormat = typeof options.responseFormat === 'string' ? options.responseFormat : 'editor';
    form.essayResponseRequired = options.responseRequired !== false;
    form.essayResponseFieldLines =
      typeof options.responseFieldLines === 'number' ? String(options.responseFieldLines) : '15';
    form.essayMinWords = typeof options.minWordLimit === 'number' ? String(options.minWordLimit) : '';
    form.essayMaxWords = typeof options.maxWordLimit === 'number' ? String(options.maxWordLimit) : '';
    form.essayGraderInfo = asDoc(options.graderInfo);
    form.essayResponseTemplate = asDoc(options.responseTemplate);
    const solution = view.answerKey?.solution;
    form.essaySolution = solution && 'answer' in solution ? (solution.answer as Doc) : undefined;
  }

  return form;
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function editorFormContent(form: QuestionEditorFormState): Record<string, unknown> {
  const generalFeedback = docOrUndefined(form.generalFeedback);
  const guidance = docOrUndefined(form.guidance);
  const base: Record<string, unknown> = {
    questionText: form.questionText,
    ...(generalFeedback ? { generalFeedback } : {}),
    ...(guidance ? { guidance } : {}),
  };

  if (form.qtype === 'multichoice') {
    const correctFeedback = docOrUndefined(form.mcCorrectFeedback);
    const incorrectFeedback = docOrUndefined(form.mcIncorrectFeedback);
    const { question, choices } = splitMultipleChoiceDocument(form.mcDocument);
    return {
      ...base,
      questionText: question as Doc,
      answers: choices.map((choice) => {
        const feedback = docOrUndefined(form.mcChoiceFeedbacks[choice.attrs.id]);
        return {
          text: { type: 'doc', content: choice.content ?? [] } as Doc,
          correct: choice.attrs.id === form.mcCorrectChoiceId,
          ...(feedback ? { feedback } : {}),
        };
      }),
      options: {
        shuffleAnswers: form.mcShuffleAnswers,
        answerNumbering: form.mcAnswerNumbering,
        showStandardInstruction: form.mcShowStandardInstruction,
        ...(correctFeedback ? { correctFeedback } : {}),
        ...(incorrectFeedback ? { incorrectFeedback } : {}),
      },
    };
  }

  if (form.qtype === 'truefalse') {
    const { statements } = splitTrueFalseDocument(form.tfDocument);
    return {
      questionText: form.tfDocument as Doc,
      ...(generalFeedback ? { generalFeedback } : {}),
      ...(guidance ? { guidance } : {}),
      solution: {
        answers: statements
          .filter((statement) => typeof form.tfAnswers[statement.attrs.id] === 'boolean')
          .map((statement) => ({
            statementId: statement.attrs.id,
            value: form.tfAnswers[statement.attrs.id] === true,
          })),
      },
    };
  }

  if (form.qtype === 'shortanswer') {
    const numericMaxLength = numberOrUndefined(form.saNumericMaxLength);
    return {
      ...base,
      answers: form.saAnswers.map((answer) => ({
        text: answer.text,
        correct: true,
      })),
      options: {
        useCase: form.saUseCase,
        numericAnswer: form.saNumericAnswer,
        ...(form.saNumericAnswer && numericMaxLength !== undefined ? { numericMaxLength } : {}),
        ...(form.saNumericAnswer
          ? { numericAllowSign: form.saNumericAllowSign, numericAllowDecimal: form.saNumericAllowDecimal }
          : {}),
      },
    };
  }

  const minWordLimit = numberOrUndefined(form.essayMinWords);
  const maxWordLimit = numberOrUndefined(form.essayMaxWords);
  const graderInfo = docOrUndefined(form.essayGraderInfo);
  const responseTemplate = docOrUndefined(form.essayResponseTemplate);
  const solution = docOrUndefined(form.essaySolution);
  return {
    ...base,
    ...(solution ? { solution: { answer: solution } } : {}),
    options: {
      responseFormat: form.essayResponseFormat,
      responseRequired: form.essayResponseRequired,
      responseFieldLines: numberOrUndefined(form.essayResponseFieldLines) ?? 15,
      ...(minWordLimit !== undefined ? { minWordLimit } : {}),
      ...(maxWordLimit !== undefined ? { maxWordLimit } : {}),
      ...(graderInfo ? { graderInfo } : {}),
      ...(responseTemplate ? { responseTemplate } : {}),
    },
  };
}
