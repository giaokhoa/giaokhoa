import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import { fetchCourseGradeData } from '#hooks/use-courses-grade-data';
import {
  createGradeItem,
  deleteGradeItem,
  fetchGradeItemHistory,
  setGradeItemPublished,
  setGradePostingPolicy,
  submitGrade,
  updateGradeItem,
} from '../api/course-grade';
import { queryKeys } from './keys';


export function useCourseGradeData(courseId: string | null | undefined) {
  return useQuery({
    queryKey: sharedQueryKeys.courseAccess(courseId ?? ''),
    queryFn: () => fetchCourseGradeData(courseId as string),
    enabled: !!courseId,
  });
}


export function gradeItemHistoryQueryOptions(itemId: string, userId: string) {
  return queryOptions({
    queryKey: queryKeys.gradeItemHistory(itemId, userId),
    queryFn: () => fetchGradeItemHistory(itemId, userId),
  });
}

function useGradeMutation<TVars>(
  courseId: string,
  mutationFn: (vars: TVars) => Promise<unknown>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => client.invalidateQueries({ queryKey: sharedQueryKeys.courseAccess(courseId) }),
  });
}

export function useSubmitGrade(courseId: string) {
  return useGradeMutation(
    courseId,
    (vars: { gradeItemId: string; userId: string; rawGrade: number | null; feedback?: string }) =>
      submitGrade(vars),
  );
}

export function useCreateGradeItem(courseId: string) {
  return useGradeMutation(courseId, (vars: { itemName: string; gradeMax: number }) =>
    createGradeItem(courseId, vars),
  );
}

export function useUpdateGradeItem(courseId: string) {
  return useGradeMutation(courseId, (vars: { itemId: string; itemName: string; gradeMax: number }) =>
    updateGradeItem(vars),
  );
}

export function useDeleteGradeItem(courseId: string) {
  return useGradeMutation(courseId, (itemId: string) => deleteGradeItem(itemId));
}

export function useSetGradePostingPolicy(courseId: string) {
  return useGradeMutation(courseId, (vars: { itemId: string; policy: 'auto' | 'manual' }) =>
    setGradePostingPolicy(vars),
  );
}

export function useSetGradeItemPublished(courseId: string) {
  return useGradeMutation(courseId, (vars: { itemId: string; published: boolean }) =>
    setGradeItemPublished(vars),
  );
}
