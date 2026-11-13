import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryClient } from '#lib/query-client';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  fetchSystemExamQuestionPreview,
  fetchSystemExamQuestions,
  createExamPaper,
  fetchExamPaper,
  fetchExamPaperPins,
  fetchExamQuestionDiscovery,
  replaceExamPaperSlots,
  swapExamPaperSlot,
  updateExamPaperMeta,
} from '../api/exam-paper';
import type { CreateExamPaperBody, UpdateExamPaperMetaBody } from '../types/exam-paper';
import { queryKeys } from './keys';


export function examQuestionDiscoveryQueryOptions(params: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.questionDiscovery(params),
    queryFn: () => fetchExamQuestionDiscovery(params),
  });
}

export function examPaperQueryOptions(paperId: string) {
  return queryOptions({
    queryKey: queryKeys.examPaperDetail(paperId),
    queryFn: () => fetchExamPaper(paperId),
  });
}

export function useExamPaper(paperId: string | undefined, enabled: boolean) {
  return useQuery({
    ...examPaperQueryOptions(paperId ?? ''),
    enabled: enabled && !!paperId,
  });
}

export function examPaperPinsQueryOptions(paperId: string) {
  return queryOptions({
    queryKey: queryKeys.examPaperPins(paperId),
    queryFn: () => fetchExamPaperPins(paperId),
  });
}

export function useExamPaperPins(paperId: string | undefined, enabled: boolean) {
  return useQuery({
    ...examPaperPinsQueryOptions(paperId ?? ''),
    enabled: enabled && !!paperId,
  });
}

function invalidateExamPaper(client: QueryClient, paperId: string) {
  void client.invalidateQueries({ queryKey: queryKeys.examPaperDetail(paperId) });
  void client.invalidateQueries({ queryKey: queryKeys.examPaperPins(paperId) });
}

export function useCreateExamPaper() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ bankId, body }: { bankId: string; body: CreateExamPaperBody }) =>
      createExamPaper(bankId, body),
    onSuccess: (view) => invalidateExamPaper(client, view.paper.id),
  });
}

export function useUpdateExamPaperMeta() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ paperId, body }: { paperId: string; body: UpdateExamPaperMetaBody }) =>
      updateExamPaperMeta(paperId, body),
    onSuccess: (_view, vars) => invalidateExamPaper(client, vars.paperId),
  });
}

export function useReplaceExamPaperSlots() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      paperId,
      slots,
    }: {
      paperId: string;
      slots: import('@giaokhoa/contracts').ExamSlotInput[];
    }) => replaceExamPaperSlots(paperId, slots),
    onSuccess: (_view, vars) => invalidateExamPaper(client, vars.paperId),
  });
}

export function useSwapExamPaperSlot() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ paperId, position, questionId }: { paperId: string; position: number; questionId: string }) =>
      swapExamPaperSlot(paperId, position, questionId),
    onSuccess: (view, vars) => {
      client.setQueryData(queryKeys.examPaperDetail(vars.paperId), view);
    },
  });
}

export async function examPaperEditPageClientLoader(paperId: string) {
  await Promise.all([
    queryClient.prefetchQuery(examPaperQueryOptions(paperId)),
    queryClient.prefetchQuery(examPaperPinsQueryOptions(paperId)),
  ]);
  return null;
}

export function systemExamQuestionsQueryOptions(offset: number) {
  return queryOptions({ queryKey: queryKeys.systemExamQuestions(offset), queryFn: () => fetchSystemExamQuestions(offset) });
}

export function systemExamQuestionPreviewQueryOptions(id: string, version: number) {
  return queryOptions({ queryKey: queryKeys.systemExamQuestionPreview(id, version), queryFn: () => fetchSystemExamQuestionPreview(id, version) });
}
