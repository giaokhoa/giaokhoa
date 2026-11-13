import { extractRichTextPlainText, type QuestionView, type RichTextDocument } from '@giaokhoa/contracts';

import { ApiError } from '#lib/api';

export function withApiReason(fallback: string, err: unknown): string {
  if (err instanceof ApiError) {
    const reason = err.problem.detail ?? err.problem.title;
    if (reason) return `${fallback} ${reason}`;
  }
  return fallback;
}

export interface ContextOption {
  id: string;
  level: number;
  label: string;
}

export const QTYPES = ['multichoice', 'truefalse', 'shortanswer', 'essay'] as const;
export type Qtype = (typeof QTYPES)[number];

export const QTYPE_LABEL_KEYS: Record<Qtype, string> = {
  multichoice: 'qtypeMultichoice',
  truefalse: 'qtypeTruefalse',
  shortanswer: 'qtypeShortanswer',
  essay: 'qtypeEssay',
};

export const COGNITIVE_LEVELS = ['biet', 'hieu', 'van_dung', 'van_dung_cao'] as const;
export const LEVEL_LABEL_KEYS: Record<(typeof COGNITIVE_LEVELS)[number], string> = {
  biet: 'levelBiet',
  hieu: 'levelHieu',
  van_dung: 'levelVanDung',
  van_dung_cao: 'levelVanDungCao',
};

export interface CurriculumLinksView {
  questionId: string;
  subjectIds: string[];
  outcomes: { outcomeId: string; cognitiveLevel: string }[];
}

export interface CurriculumTreeNode {
  id: string;
  title: string;
  outcomes: { id: string; content: string }[];
  children: CurriculumTreeNode[];
}












export function plainText(doc: RichTextDocument | null | undefined): string {
  return doc ? extractRichTextPlainText(doc) : '';
}

export function systemBankPlainText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const doc = value as Record<string, unknown>;
    if (doc.type === 'doc' && Array.isArray(doc.content)) return plainText(value as RichTextDocument);
  }
  return '';
}

export function questionExcerpt(view: QuestionView): string {
  return plainText(view.latestVersion.questionText).slice(0, 120);
}

export type OptionsRecord = Record<string, unknown>;

const OPTION_KEYS_BY_QTYPE: Record<Qtype, string[]> = {
  multichoice: [
    'shuffleAnswers',
    'answerNumbering',
    'showStandardInstruction',
    'correctFeedback',
    'incorrectFeedback',
  ],
  truefalse: ['showStandardInstruction'],
  shortanswer: ['useCase'],
  essay: [
    'responseFormat',
    'responseRequired',
    'responseFieldLines',
    'minWordLimit',
    'maxWordLimit',
    'graderInfo',
    'responseTemplate',
  ],
};

export function hasAllOptions(qtype: Qtype, options: OptionsRecord | null | undefined): boolean {
  if (!options) return false;
  return OPTION_KEYS_BY_QTYPE[qtype].every(
    (key) => Object.prototype.hasOwnProperty.call(options, key) && options[key] !== undefined,
  );
}

export type BankArea =
  | 'my-questions'
  | 'stimuli'
  | 'my-exams'
  | 'my-matrices'
  | 'system-questions'
  | 'system-exams'
  | 'system-matrices';

export function matrixStatusKey(status: string): string {
  return `matrixStatus${status[0]!.toUpperCase()}${status.slice(1)}`;
}

export function dossierStatusKey(status: string): string {
  return status === 'pending_board'
    ? 'dossierStatusPendingBoard'
    : `dossierStatus${status[0]!.toUpperCase()}${status.slice(1)}`;
}
