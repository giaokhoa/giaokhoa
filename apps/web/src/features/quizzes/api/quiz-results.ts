import { apiJson } from '#lib/api';
import type { QuizResults } from '../types/quiz-results';


export function fetchQuizResults(quizId: string) {
  return apiJson<QuizResults>(`/api/v1/exam-pins/${quizId}/results`);
}

export function gradeQuizQuestion(vars: {
  quizId: string;
  quizAttemptId: string;
  questionAttemptId: string;
  mark: number;
  comment?: string;
}) {
  return apiJson(`/api/v1/quiz-attempts/${vars.quizAttemptId}/questions/${vars.questionAttemptId}/grade`, {
    method: 'POST',
    body: JSON.stringify({
      mark: vars.mark,
      ...(vars.comment ? { comment: vars.comment } : {}),
    }),
  });
}
