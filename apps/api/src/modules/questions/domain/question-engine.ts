
export const QUESTION_STATES = [
  'notstarted', 'todo', 'incomplete', 'complete',
  'gradedright', 'gradedpartial', 'gradedwrong', 'gaveup', 'finished', 'needsgrading',
] as const;
export type QuestionState = (typeof QUESTION_STATES)[number];

export const GRADED_STATES: QuestionState[] = ['gradedright', 'gradedpartial', 'gradedwrong'];

const TRANSITIONS: Record<string, QuestionState[]> = {
  notstarted: ['todo'],
  todo: ['complete', 'incomplete', 'gaveup', 'gradedright', 'gradedpartial', 'gradedwrong', 'needsgrading'],
  incomplete: ['complete', 'incomplete', 'gaveup', 'gradedright', 'gradedpartial', 'gradedwrong', 'needsgrading'],
  complete: ['complete', 'incomplete', 'gradedright', 'gradedpartial', 'gradedwrong', 'needsgrading'],
  gradedright: [], gradedpartial: [], gradedwrong: [], gaveup: [], finished: [],
  needsgrading: ['gradedright', 'gradedpartial', 'gradedwrong'],
};

export function canTransition(from: string, to: QuestionState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}
export function isFinishedState(state: string): boolean {
  return GRADED_STATES.includes(state as QuestionState) || state === 'gaveup' || state === 'finished' || state === 'needsgrading';
}

export interface GradableAnswer {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface GradingData {
  answers: GradableAnswer[];
  truefalseStatements?: { statementId: string; value: boolean }[];
  tfScale?: readonly number[];
  shortanswer?: {
    useCase: boolean;
    numericAnswer?: boolean;
    numericMaxLength?: number | null;
    numericAllowSign?: boolean;
    numericAllowDecimal?: boolean;
  };
}

export interface GradeOutcome {
  fraction: number | null;
  state: QuestionState;
  rightAnswer: string;
}

export function gradedStateForFraction(fraction: number): QuestionState {
  if (fraction < 0.000001) return 'gradedwrong';
  if (fraction > 0.999999) return 'gradedright';
  return 'gradedpartial';
}

export const DEFAULT_TF_SCALE: readonly number[] = [0, 10, 25, 50, 100];

export function encodeTrueFalseResponse(answers: Readonly<Record<string, boolean>>): string {
  return JSON.stringify(answers);
}

export function decodeTrueFalseResponse(response: string | null): Record<string, boolean> {
  if (!response) return {};
  try {
    const parsed: unknown = JSON.parse(response);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function truefalseHashAnswers(
  questionText: unknown,
  solution: unknown,
): { textPlain: string; isCorrect: boolean }[] {
  const doc = questionText as { content?: { type?: string; content?: unknown[] }[] } | null;
  const list = doc?.content?.[doc.content.length - 1];
  if (!list || list.type !== 'statementList' || !Array.isArray(list.content)) return [];
  const sol = solution as { answers?: { statementId?: unknown; value?: unknown }[] } | null;
  if (!sol || !Array.isArray(sol.answers)) return [];
  const valueById = new Map<string, boolean>();
  for (const a of sol.answers) {
    if (typeof a?.statementId === 'string' && typeof a?.value === 'boolean') {
      valueById.set(a.statementId, a.value);
    }
  }
  const collectText = (node: unknown): string => {
    if (!node || typeof node !== 'object') return '';
    const n = node as { text?: unknown; content?: unknown[] };
    if (typeof n.text === 'string') return n.text;
    return (n.content ?? []).map((child) => collectText(child)).join('');
  };
  const out: { textPlain: string; isCorrect: boolean }[] = [];
  for (const statement of list.content) {
    const s = statement as { attrs?: { id?: unknown }; content?: unknown[] };
    if (typeof s?.attrs?.id !== 'string') return [];
    out.push({ textPlain: (s.content ?? []).map((child) => collectText(child)).join(''), isCorrect: valueById.get(s.attrs.id) === true });
  }
  return out;
}

function gradeTruefalse(data: GradingData, response: string | null): GradeOutcome {
  const statements = data.truefalseStatements ?? [];
  const rightAnswer = statements.map((s) => (s.value ? 'Đúng' : 'Sai')).join(', ');
  if (statements.length === 0) {
    return { fraction: 0, state: gradedStateForFraction(0), rightAnswer };
  }
  const given = decodeTrueFalseResponse(response);
  const correctCount = statements.filter((s) => given[s.statementId] === s.value).length;
  const scale = data.tfScale && data.tfScale.length === statements.length + 1
    ? data.tfScale
    : DEFAULT_TF_SCALE;
  const percent = scale[Math.min(correctCount, scale.length - 1)] ?? 0;
  const fraction = percent / 100;
  return { fraction, state: gradedStateForFraction(fraction), rightAnswer };
}

export const NUMERIC_ANSWER_DEFAULT_MAX_LENGTH = 4;

export function isValidNumericAnswer(response: string, opts: { maxLength?: number | null; allowSign?: boolean; allowDecimal?: boolean }): boolean {
  const value = response.trim();
  if (value === '') return false;
  const maxLength = opts.maxLength ?? NUMERIC_ANSWER_DEFAULT_MAX_LENGTH;
  if ([...value].length > maxLength) return false;
  const sign = opts.allowSign === false ? '' : '[+-]?';
  const decimal = opts.allowDecimal === false ? '' : '(?:[.,][0-9]+)?';
  return new RegExp(`^${sign}[0-9]+${decimal}$`).test(value);
}

function normaliseShortanswerText(value: string, ignoreCase: boolean): string {
  const trimmed = value.trim();
  return ignoreCase ? trimmed.toLowerCase() : trimmed;
}

function gradeShortanswer(data: GradingData, response: string | null): GradeOutcome {
  const ignoreCase = !(data.shortanswer?.useCase ?? false);
  const given = response ?? '';
  const accepted = data.answers.filter((a) => a.isCorrect);
  const rightAnswer = accepted[0]?.text ?? '';
  if (data.shortanswer?.numericAnswer) {
    const valid = isValidNumericAnswer(given, {
      maxLength: data.shortanswer.numericMaxLength,
      allowSign: data.shortanswer.numericAllowSign,
      allowDecimal: data.shortanswer.numericAllowDecimal,
    });
    if (!valid) {
      return { fraction: 0, state: gradedStateForFraction(0), rightAnswer };
    }
  }
  const givenNormalised = normaliseShortanswerText(given, ignoreCase);
  const matched = givenNormalised !== ''
    && accepted.some((a) => normaliseShortanswerText(a.text, ignoreCase) === givenNormalised);
  const fraction = matched ? 1 : 0;
  return { fraction, state: gradedStateForFraction(fraction), rightAnswer };
}

function gradeMultichoice(data: GradingData, response: string | null): GradeOutcome {
  const selectedIds = new Set((response ?? '').split(',').map((x) => x.trim()).filter((x) => x !== ''));
  const selected = data.answers.filter((a) => selectedIds.has(a.id));
  const correctRow = data.answers.find((a) => a.isCorrect);
  const fraction = selected.length === 1 && selected[0]!.isCorrect ? 1 : 0;
  return { fraction, state: gradedStateForFraction(fraction), rightAnswer: correctRow?.text ?? '' };
}

export function gradeAnswer(qtype: string, data: GradingData, response: string | null): GradeOutcome {
  switch (qtype) {
    case 'truefalse': return gradeTruefalse(data, response);
    case 'shortanswer': return gradeShortanswer(data, response);
    case 'multichoice': return gradeMultichoice(data, response);
    case 'essay': return { fraction: null, state: 'needsgrading', rightAnswer: '' };
    default:
      return { fraction: 0, state: 'gradedwrong', rightAnswer: '' };
  }
}

export interface QuestionBehaviour {
  readonly name: string;
  stateAfterSubmit(response: string | null): QuestionState;
  gradeAtFinish(qtype: string, data: GradingData, response: string | null): GradeOutcome | null;
}

export class DeferredFeedbackBehaviour implements QuestionBehaviour {
  readonly name = 'deferredfeedback';
  stateAfterSubmit(response: string | null): QuestionState {
    return response !== null && response.trim() !== '' ? 'complete' : 'incomplete';
  }
  gradeAtFinish(qtype: string, data: GradingData, response: string | null): GradeOutcome | null {
    if (response === null || response.trim() === '') return null;
    return gradeAnswer(qtype, data, response);
  }
}

export const BEHAVIOURS: Record<string, QuestionBehaviour> = {
  deferredfeedback: new DeferredFeedbackBehaviour(),
};

export function usageState(attemptStates: string[]): 'notstarted' | 'inprogress' | 'finished' {
  if (attemptStates.length === 0 || attemptStates.every((s) => s === 'notstarted')) return 'notstarted';
  if (attemptStates.every((s) => isFinishedState(s))) return 'finished';
  return 'inprogress';
}
