import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  addMatrixCell,
  createMatrix,
  deleteMatrixCell,
  fetchCurriculaBySubject,
  fetchCurriculumTree,
  fetchMatrixAvailability,
  fetchMatrixBanks,
  fetchMatrixDetail,
  fetchMatrixSpecification,
  updateMatrix,
} from '../api/matrix';
import { queryKeys } from './keys';


export function matrixBanksQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.questionBanksByKind('matrix'),
    queryFn: () => fetchMatrixBanks(),
  });
}

export function useMatrixBanks(enabled: boolean) {
  return useQuery({ ...matrixBanksQueryOptions(), enabled });
}

export function curriculaBySubjectQueryOptions(subjectId: string, forCourseId?: string) {
  return queryOptions({
    queryKey: forCourseId ? [...queryKeys.curriculaBySubject(subjectId), forCourseId] : queryKeys.curriculaBySubject(subjectId),
    queryFn: () => fetchCurriculaBySubject(subjectId, forCourseId),
  });
}

export function useCurriculaBySubject(subjectId: string, forCourseId?: string) {
  return useQuery({
    ...curriculaBySubjectQueryOptions(subjectId, forCourseId),
    enabled: !!subjectId,
  });
}

export function matrixDetailQueryOptions(matrixId: string) {
  return queryOptions({
    queryKey: queryKeys.matrixDetail(matrixId),
    queryFn: () => fetchMatrixDetail(matrixId),
  });
}

export function useMatrixDetail(matrixId: string | undefined, enabled: boolean) {
  return useQuery({
    ...matrixDetailQueryOptions(matrixId ?? ''),
    enabled: enabled && !!matrixId,
  });
}

export function curriculumTreeQueryOptions(curriculumId: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.curriculumTree(curriculumId),
    queryFn: async () => (await fetchCurriculumTree(curriculumId)) ?? [],
  });
}

export function useCurriculumTree(curriculumId: string | undefined, enabled: boolean) {
  return useQuery({
    ...curriculumTreeQueryOptions(curriculumId ?? ''),
    enabled: enabled && !!curriculumId,
  });
}

export function matrixAvailabilityQueryOptions(matrixId: string) {
  return queryOptions({
    queryKey: queryKeys.matrixAvailability(matrixId),
    queryFn: () => fetchMatrixAvailability(matrixId),
  });
}

export function useMatrixAvailability(matrixId: string | undefined, enabled: boolean) {
  return useQuery({
    ...matrixAvailabilityQueryOptions(matrixId ?? ''),
    enabled: enabled && !!matrixId,
  });
}

export function matrixSpecificationQueryOptions(matrixId: string) {
  return queryOptions({
    queryKey: queryKeys.matrixSpecification(matrixId),
    queryFn: () => fetchMatrixSpecification(matrixId),
  });
}

export function useMatrixSpecification(matrixId: string | undefined, enabled: boolean) {
  return useQuery({
    ...matrixSpecificationQueryOptions(matrixId ?? ''),
    enabled: enabled && !!matrixId,
  });
}

export function useCreateMatrix() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      subjectId: string;
      curriculumId: string;
      bankId: string;
      levelSet: 'three' | 'four';
      totalScore: number;
      isTemplate: boolean;
      status: string;
    }) => createMatrix(body),
    onSuccess: (_data, body) => {
      void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.bankMatrices(body.bankId) });
    },
  });
}

export function useUpdateMatrix() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      matrixId: string;
      body: { name: string; status: string; isTemplate: boolean; totalScore: number; levelSet?: 'three' | 'four' };
    }) => updateMatrix(vars.matrixId, vars.body),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.matrixDetail(vars.matrixId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.matrixSpecification(vars.matrixId) });
    },
  });
}

export function useAddMatrixCell() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      matrixId: string;
      body: {
        curriculumNodeId: string;
        cognitiveLevel: string;
        qtype: string;
        questionCount: number;
        cellScore: number;
      };
    }) => addMatrixCell(vars.matrixId, vars.body),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.matrixDetail(vars.matrixId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.matrixSpecification(vars.matrixId) });
    },
  });
}

export function useDeleteMatrixCell() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { matrixId: string; cellId: string }) =>
      deleteMatrixCell(vars.matrixId, vars.cellId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.matrixDetail(vars.matrixId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.matrixSpecification(vars.matrixId) });
    },
  });
}
