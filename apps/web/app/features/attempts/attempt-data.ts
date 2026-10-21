import { attemptAnswerSchema, type AttemptAnswer } from '@giaokhoa/shared/attempts';
import {
  essayContentSchema,
  multipleChoiceContentSchema,
  shortAnswerContentSchema,
  trueFalseContentSchema,
  type QuestionType,
} from '@giaokhoa/shared/questions';

function normalizeDates(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = { ...value } as Record<string, unknown>;
  for (const field of fields) {
    if (typeof record[field] === 'string') record[field] = new Date(record[field]);
  }
  return record;
}

export function normalizeAttemptDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeAttemptDates);
  const record = normalizeDates(value, ['startedAt', 'submittedAt', 'gradedAt']);
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  if ('responses' in record && Array.isArray(record.responses)) {
    return {
      ...record,
      responses: record.responses.map((response) => normalizeDates(response, ['updatedAt'])),
    };
  }
  return record;
}

export function normalizeDeliveryDates(value: unknown) {
  return normalizeDates(value, ['openAt', 'closeAt']);
}

export function parseQuestionContent(type: QuestionType, value: unknown) {
  const schemas = {
    multiple_choice: multipleChoiceContentSchema,
    true_false: trueFalseContentSchema,
    short_answer: shortAnswerContentSchema,
    essay: essayContentSchema,
  };
  const result = schemas[type].safeParse(value);
  return result.success ? result.data : null;
}

export function parseAnswer(value: unknown): AttemptAnswer | null {
  const result = attemptAnswerSchema.safeParse(value);
  if (!result.success) return null;
  if (result.data.type === 'true_false') {
    const ids = result.data.answers.map((answer) => answer.statementId);
    if (new Set(ids).size !== ids.length) return null;
  }
  if (result.data.type === 'essay' && 'answers' in result.data) {
    const ids = result.data.answers.map((answer) => answer.partId);
    if (new Set(ids).size !== ids.length) return null;
  }
  return result.data;
}

export function parsePublishedSolution(type: QuestionType | undefined, solution: unknown) {
  return type && solution && typeof solution === 'object'
    ? parseAnswer({ ...solution, type })
    : null;
}

export function textToDocument(text: string) {
  return {
    type: 'doc' as const,
    content: text.split('\n').map((line) => ({
      type: 'paragraph' as const,
      content: line ? [{ type: 'text' as const, text: line }] : [],
    })),
  };
}

export const attemptStatusLabels = {
  in_progress: 'Đang làm',
  submitted: 'Đã nộp',
  graded: 'Đã chấm',
};

export function formatAttemptDate(value: Date | string | null) {
  if (value === null) return 'Chưa có';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Ngày không hợp lệ';
  return (
    new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(date) + ' UTC'
  );
}
