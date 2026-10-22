import { attemptAnswerSchema, type AttemptAnswer } from '@giaokhoa/shared/attempts';
import {
  essayContentSchema,
  multipleChoiceContentSchema,
  shortAnswerContentSchema,
  trueFalseContentSchema,
  type QuestionType,
} from '@giaokhoa/shared/questions';

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
