import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchQuizResults, gradeQuizQuestion } from '../api/quiz-results';
import { queryKeys } from './keys';


export function quizResultsQueryOptions(quizId: string) {
  return queryOptions({
    queryKey: queryKeys.quizResults(quizId),
    queryFn: () => fetchQuizResults(quizId),
  });
}

export function useQuizResults(quizId: string | undefined) {
  return useQuery({
    ...quizResultsQueryOptions(quizId ?? ''),
    enabled: !!quizId,
  });
}

export function useGradeQuizQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      quizId: string;
      quizAttemptId: string;
      questionAttemptId: string;
      mark: number;
      comment?: string;
    }) => gradeQuizQuestion(vars),
    onSuccess: (_data, vars) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.quizResults(vars.quizId) }),
  });
}
