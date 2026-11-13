import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '#lib/query-keys';
import { courseContentQueryOptions } from '#lib/course-content';
import {
  applyBookFrame,
  applyCurriculumFrame,
  createBuilderAssignment,
  createBuilderExamPin,
  createBuilderModule,
  createBuilderSection,
  deleteBuilderModule,
  deleteBuilderSection,
  duplicateBuilderModule,
  duplicateBuilderSection,
  fetchBuilderCourseList,
  fetchCourseBuilder,
  importBuilderContent,
  recalculateBuilderCompletion,
  reorderBuilderModules,
  reorderBuilderSections,
  saveBuilderCourse,
  saveBuilderCriteria,
  saveBuilderModule,
  saveBuilderSection,
  updateCourseFrameInfo,
} from '../api/course-builder';
import type { BuilderBody } from '../types/course-builder';


export function courseBuilderQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: queryKeys.courseBuilder(courseId),
    queryFn: () => fetchCourseBuilder(courseId),
  });
}

export function useCourseBuilder(courseId: string, enabled: boolean) {
  return useQuery({ ...courseBuilderQueryOptions(courseId), enabled });
}

export function coursesListQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.courses,
    queryFn: () => fetchBuilderCourseList(),
  });
}

export function useCoursesList() {
  return useQuery(coursesListQueryOptions());
}

export function useCourseContent(courseId: string) {
  return useQuery({
    ...courseContentQueryOptions(courseId),
    enabled: !!courseId,
  });
}


function useBuilderMutation<TVars, TData>(courseId: string, mutationFn: (vars: TVars) => Promise<TData>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.courseBuilder(courseId) });
      void client.invalidateQueries({ queryKey: queryKeys.courseContent(courseId) });
    },
  });
}

export function useSaveBuilderCourse(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BuilderBody) => saveBuilderCourse(courseId, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.courseBuilder(courseId) });
      void client.invalidateQueries({ queryKey: queryKeys.courseContent(courseId) });
      void client.invalidateQueries({ queryKey: queryKeys.courses });
      void client.invalidateQueries({ queryKey: queryKeys.courseDetail(courseId) });
    },
  });
}

export function useCreateBuilderSection(courseId: string) {
  return useBuilderMutation(courseId, (body: BuilderBody) => createBuilderSection(courseId, body));
}

export function useSaveBuilderSection(courseId: string) {
  return useBuilderMutation(courseId, (vars: { sectionId: string; body: BuilderBody }) =>
    saveBuilderSection(courseId, vars),
  );
}

export function useDeleteBuilderSection(courseId: string) {
  return useBuilderMutation(courseId, (sectionId: string) =>
    deleteBuilderSection(courseId, sectionId),
  );
}

export function useDuplicateBuilderSection(courseId: string) {
  return useBuilderMutation(courseId, (sectionId: string) =>
    duplicateBuilderSection(courseId, sectionId),
  );
}

export function useReorderBuilderSections(courseId: string) {
  return useBuilderMutation(courseId, (sectionIds: string[]) =>
    reorderBuilderSections(courseId, sectionIds),
  );
}

export function useReorderBuilderModules(courseId: string) {
  return useBuilderMutation(courseId, (vars: { sectionId: string; moduleIds: string[] }) =>
    reorderBuilderModules(courseId, vars),
  );
}

export function useCreateBuilderExamPin(courseId: string) {
  return useBuilderMutation(courseId, (vars: { sectionId: string; name: string; requestId: string }) =>
    createBuilderExamPin(courseId, vars),
  );
}

export function useCreateBuilderAssignment(courseId: string) {
  return useBuilderMutation(courseId, (vars: { sectionId: string; name: string }) =>
    createBuilderAssignment(courseId, vars),
  );
}

export function useCreateBuilderModule(courseId: string) {
  return useBuilderMutation(courseId, (body: BuilderBody) => createBuilderModule(courseId, body));
}

export function useSaveBuilderModule(courseId: string) {
  return useBuilderMutation(courseId, (vars: { cmId: string; body: BuilderBody }) =>
    saveBuilderModule(courseId, vars),
  );
}

export function useDeleteBuilderModule(courseId: string) {
  return useBuilderMutation(courseId, (cmId: string) => deleteBuilderModule(courseId, cmId));
}

export function useDuplicateBuilderModule(courseId: string) {
  return useBuilderMutation(courseId, (cmId: string) => duplicateBuilderModule(courseId, cmId));
}

export function useImportBuilderContent(courseId: string) {
  return useBuilderMutation(courseId, (body: BuilderBody) => importBuilderContent(courseId, body));
}

export function useSaveBuilderCriteria(courseId: string) {
  return useBuilderMutation(courseId, (body: BuilderBody) => saveBuilderCriteria(courseId, body));
}

export function useRecalculateBuilderCompletion(courseId: string) {
  return useBuilderMutation(courseId, () => recalculateBuilderCompletion(courseId));
}


export function useUpdateCourseFrameInfo() {
  return useMutation({
    mutationFn: (input: { courseId: string; subjectId: string | null; grade: number | null }) =>
      updateCourseFrameInfo(input),
  });
}

export function useApplyCurriculumFrame() {
  return useMutation({
    mutationFn: (input: {
      courseId: string;
      curriculumId: string;
      nodeIds: string[];
      insertAtSection?: number;
    }) => applyCurriculumFrame(input),
  });
}

export function useApplyBookFrame() {
  return useMutation({
    mutationFn: (input: {
      courseId: string;
      bookId: string;
      chapterNodeIds: string[];
      insertAtSection?: number;
    }) => applyBookFrame(input),
  });
}
