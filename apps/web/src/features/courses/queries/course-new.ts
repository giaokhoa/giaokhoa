import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryClient } from '#lib/query-client';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import { createClass, fetchClasses } from '#features/classes/api/classes';
import type { ClassView } from '#features/classes/types/classes';
import {
  applyCurriculumFrame,
  createCourse,
  duplicateCourse,
  fetchWizardCategoryTree,
  fetchWizardCourseList,
  fetchWizardCourseTemplates,
} from '../api/course-new';
import { queryKeys } from './keys';


export function courseCategoryTreeQueryOptions() {
  return queryOptions({
    queryKey: sharedQueryKeys.categoryTree,
    queryFn: () => fetchWizardCategoryTree(),
  });
}

export function useCourseCategoryTree() {
  return useQuery(courseCategoryTreeQueryOptions());
}

export function courseListQueryOptions() {
  return queryOptions({
    queryKey: sharedQueryKeys.courses,
    queryFn: () => fetchWizardCourseList(),
  });
}

export function useCourseList() {
  return useQuery(courseListQueryOptions());
}

export function courseTemplatesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.courseTemplates,
    queryFn: () => fetchWizardCourseTemplates(),
  });
}

export function useCourseTemplates() {
  return useQuery(courseTemplatesQueryOptions());
}

export function wizardClassesQueryOptions() {
  return queryOptions({
    queryKey: sharedQueryKeys.classes,
    queryFn: async (): Promise<ClassView[]> => {
      try {
        return await fetchClasses();
      } catch {
        return [];
      }
    },
  });
}

export function useWizardClasses() {
  return useQuery(wizardClassesQueryOptions());
}

export function useCreateCourse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => createCourse(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: sharedQueryKeys.courses }),
  });
}

export function useDuplicateCourse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { fromId: string; body: Record<string, unknown> }) => duplicateCourse(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: sharedQueryKeys.courses }),
  });
}

export function useApplyCurriculumFrame() {
  return useMutation({
    mutationFn: (input: { courseId: string; curriculumId: string; nodeIds: string[] }) =>
      applyCurriculumFrame(input),
  });
}

export function useCreateClassForWizard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) => createClass(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: sharedQueryKeys.classes }),
  });
}

export async function courseNewPageClientLoader() {
  await Promise.all([
    queryClient.prefetchQuery(courseCategoryTreeQueryOptions()),
    queryClient.prefetchQuery(courseListQueryOptions()),
    queryClient.prefetchQuery(courseTemplatesQueryOptions()),
    queryClient.prefetchQuery(wizardClassesQueryOptions()),
  ]);
  return null;
}
