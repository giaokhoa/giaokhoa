import type { QuestionType, TrueFalseAnswers } from '@giaokhoa/shared/questions';
import {
  createEmptyMultipleChoiceDocument,
  createEmptyPlainQuestionDocument,
  createEmptyTrueFalseDocument,
  getTrueFalseStatementIds,
  hasTextContent,
  isCompleteMultipleChoice,
  isCompleteTrueFalse,
  isValidShortAnswer,
  type JSONContent,
} from '@giaokhoa/editor';

type DraftBase = {
  content: JSONContent;
  guidance: JSONContent;
};

export type QuestionDraft =
  | (DraftBase & {
      type: 'multiple_choice';
      correctChoiceId?: string;
    })
  | (DraftBase & {
      type: 'true_false';
      answers: TrueFalseAnswers;
    })
  | (DraftBase & {
      type: 'short_answer';
      answer: string;
    })
  | (DraftBase & {
      type: 'essay';
      answer: JSONContent;
    });

export function createQuestionDraft(type: QuestionType): QuestionDraft {
  const guidance = createEmptyPlainQuestionDocument();

  switch (type) {
    case 'multiple_choice':
      return {
        type,
        content: createEmptyMultipleChoiceDocument(),
        guidance,
      };
    case 'true_false':
      return {
        type,
        content: createEmptyTrueFalseDocument(),
        guidance,
        answers: {},
      };
    case 'short_answer':
      return {
        type,
        content: createEmptyPlainQuestionDocument(),
        guidance,
        answer: '',
      };
    case 'essay':
      return {
        type,
        content: createEmptyPlainQuestionDocument(),
        guidance,
        answer: createEmptyPlainQuestionDocument(),
      };
  }
}

export function getDraftFingerprint(draft: QuestionDraft): string {
  return JSON.stringify(draft);
}

export function hasDraftData(draft: QuestionDraft): boolean {
  if (hasTextContent(draft.content) || hasTextContent(draft.guidance)) return true;

  switch (draft.type) {
    case 'multiple_choice':
      return Boolean(draft.correctChoiceId);
    case 'true_false':
      return Object.keys(draft.answers).length > 0;
    case 'short_answer':
      return Boolean(draft.answer);
    case 'essay':
      return hasTextContent(draft.answer);
  }
}

export function isDraftComplete(draft: QuestionDraft): boolean {
  switch (draft.type) {
    case 'multiple_choice':
      return isCompleteMultipleChoice(draft.content, draft.correctChoiceId);
    case 'true_false':
      return isCompleteTrueFalse(draft.content, draft.answers);
    case 'short_answer':
      return hasTextContent(draft.content) && isValidShortAnswer(draft.answer);
    case 'essay':
      return hasTextContent(draft.content) && hasTextContent(draft.answer);
  }
}

export function getDraftSolution(draft: QuestionDraft): object | null {
  switch (draft.type) {
    case 'multiple_choice':
      return draft.correctChoiceId ? { choiceId: draft.correctChoiceId } : null;
    case 'true_false': {
      const answers = getTrueFalseStatementIds(draft.content).flatMap((statementId) => {
        const value = draft.answers[statementId];
        return typeof value === 'boolean' ? [{ statementId, value }] : [];
      });
      return answers.length ? { answers } : null;
    }
    case 'short_answer':
      return draft.answer ? { answer: draft.answer } : null;
    case 'essay':
      return hasTextContent(draft.answer) ? { answer: draft.answer } : null;
  }
}
