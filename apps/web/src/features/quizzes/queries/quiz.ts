import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryClient } from '#lib/query-client';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  applyExamPinVersionUpdate,
  createExamPinOverride,
  deleteExamPinOverride,
  fetchCourseRoster,
  fetchExamPin,
  fetchExamPinMyRegrades,
  fetchExamPinOverrides,
  fetchExamPinRegrades,
  fetchExamPinVersionUpdate,
  fetchExamSource,
  fetchQuizAttempt,
  fetchRegradeQuestionVersions,
  runExamPinRegrade,
  saveQuizResponse,
  startExamPinAttempt,
  submitQuizAttempt,
  updateExamPinOverride,
  updateExamPinSettings,
} from '../api/quiz';
import type { ExamPinOverrideFields, ExamPinSettingsPayload } from '../types/quiz';
import { queryKeys } from './keys';


export function examPinQueryOptions(pinId: string) {
  return queryOptions({
    queryKey: queryKeys.examPin(pinId),
    queryFn: () => fetchExamPin(pinId),
  });
}

export function useExamPin(pinId: string) {
  return useQuery(examPinQueryOptions(pinId));
}

export function examPinOverridesQueryOptions(pinId: string) {
  return queryOptions({
    queryKey: queryKeys.examPinOverrides(pinId),
    queryFn: () => fetchExamPinOverrides(pinId),
  });
}

export function useExamPinOverrides(pinId: string, enabled: boolean) {
  return useQuery({ ...examPinOverridesQueryOptions(pinId), enabled });
}

export function examSourceQueryOptions(examId: string) {
  return queryOptions({
    queryKey: queryKeys.examSource(examId),
    queryFn: () => fetchExamSource(examId),
  });
}

export function useExamSource(examId: string | undefined, enabled: boolean) {
  return useQuery({
    ...examSourceQueryOptions(examId ?? ''),
    enabled: enabled && !!examId,
  });
}

export function courseRosterQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: queryKeys.courseRosterMembers(courseId),
    queryFn: async () => {
      const res = await fetchCourseRoster(courseId);
      return res?.members ?? [];
    },
  });
}

export function useCourseRoster(courseId: string, enabled: boolean) {
  return useQuery({ ...courseRosterQueryOptions(courseId), enabled });
}


export function quizAttemptQueryOptions(attemptId: string) {
  return queryOptions({
    queryKey: queryKeys.quizAttempt(attemptId),
    queryFn: () => fetchQuizAttempt(attemptId),
  });
}

export function useQuizAttempt(attemptId: string | undefined) {
  return useQuery({
    ...quizAttemptQueryOptions(attemptId ?? ''),
    enabled: attemptId !== undefined,
  });
}

export function useSaveQuizResponse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { attemptId: string; questionAttemptId: string; response: string | null }) =>
      saveQuizResponse(vars),
    onSuccess: (_data, vars) =>
      void client.invalidateQueries({ queryKey: queryKeys.quizAttempt(vars.attemptId) }),
  });
}

export function useSubmitQuizAttempt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (attemptId: string) => submitQuizAttempt(attemptId),
    onSuccess: (_data, attemptId) =>
      void client.invalidateQueries({ queryKey: queryKeys.quizAttempt(attemptId) }),
  });
}

export async function quizAttemptPageClientLoader(attemptId: string) {
  await queryClient.prefetchQuery(quizAttemptQueryOptions(attemptId));
  return null;
}


export function examPinRegradesQueryOptions(pinId: string) {
  return queryOptions({
    queryKey: queryKeys.examPinRegrades(pinId),
    queryFn: () => fetchExamPinRegrades(pinId),
  });
}

export function useExamPinRegrades(pinId: string, enabled: boolean) {
  return useQuery({ ...examPinRegradesQueryOptions(pinId), enabled });
}

export function examPinMyRegradesQueryOptions(pinId: string) {
  return queryOptions({
    queryKey: queryKeys.examPinMyRegrades(pinId),
    queryFn: () => fetchExamPinMyRegrades(pinId),
  });
}

export function useExamPinMyRegrades(pinId: string) {
  return useQuery({ ...examPinMyRegradesQueryOptions(pinId), enabled: pinId !== '' });
}

export function examPinVersionUpdateQueryOptions(pinId: string) {
  return queryOptions({
    queryKey: queryKeys.examPinVersionUpdate(pinId),
    queryFn: () => fetchExamPinVersionUpdate(pinId),
  });
}

export function regradeQuestionVersionsQueryOptions(questionId: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.questionVersions(questionId),
    queryFn: () => fetchRegradeQuestionVersions(questionId),
  });
}

export function useUpdateExamPinSettings(pinId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: ExamPinSettingsPayload) => updateExamPinSettings(pinId, payload),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.examPin(pinId) }),
  });
}

export function useApplyExamPinVersionUpdate(pinId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (toExamVersionId: string) => applyExamPinVersionUpdate(pinId, toExamVersionId),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.examPin(pinId) }),
  });
}

export function useCreateExamPinOverride(pinId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ExamPinOverrideFields & { userId?: string; groupId?: string }) =>
      createExamPinOverride(pinId, body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.examPinOverrides(pinId) }),
  });
}

export function useUpdateExamPinOverride(pinId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ overrideId, fields }: { overrideId: string; fields: ExamPinOverrideFields }) =>
      updateExamPinOverride(overrideId, fields),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.examPinOverrides(pinId) }),
  });
}

export function useDeleteExamPinOverride(pinId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (overrideId: string) => deleteExamPinOverride(overrideId),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.examPinOverrides(pinId) }),
  });
}

export function useRunExamPinRegrade(pinId: string) {
  return useMutation({
    mutationFn: (vars: { questionId: string; toVersionId: string; dryRun: boolean }) =>
      runExamPinRegrade(pinId, vars),
  });
}

export function useStartExamPinAttempt(pinId: string) {
  return useMutation({
    mutationFn: (preview: boolean) => startExamPinAttempt(pinId, preview),
  });
}
