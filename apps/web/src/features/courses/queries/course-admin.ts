import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Cohort,
  CourseCompletion,
  CourseGroup,
  CourseGrouping,
  EnrolInstance,
  UserEnrolment,
} from '@giaokhoa/contracts';
import { queryClient } from '#lib/query-client';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  addCohortMember,
  addCourseGroupMember,
  addGroupToGrouping,
  createCourseGroup,
  createCourseGrouping,
  deleteCourseGroup,
  deleteCourseGrouping,
  enrolUserManually,
  fetchCohortMembers,
  fetchCohorts,
  fetchCourseCompletions,
  fetchCourseConversation,
  fetchCourseDetail,
  fetchCourseEnrolInstances,
  fetchCourseEnrolments,
  fetchCourseGroupingGroups,
  fetchCourseGroupMembers,
  fetchCourseGroupings,
  fetchCourseGroups,
  openGroupConversation,
  removeCohortMember,
  removeCourseGroupMember,
  renameCourseGroup,
  saveCourseGroupMode,
  toggleCourseConversation,
  toggleEnrolSuspend,
} from '../api/course-admin';
import { queryKeys } from './keys';



export function courseGroupsQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.courseGroups(courseId),
    queryFn: () => fetchCourseGroups(courseId).catch(() => [] as CourseGroup[]),
  });
}

export function useCourseGroups(courseId: string) {
  return useQuery(courseGroupsQueryOptions(courseId));
}

export function courseGroupingsQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: queryKeys.courseGroupings(courseId),
    queryFn: () => fetchCourseGroupings(courseId).catch(() => [] as CourseGrouping[]),
  });
}

export function useCourseGroupings(courseId: string) {
  return useQuery(courseGroupingsQueryOptions(courseId));
}

export function cohortsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.cohorts,
    queryFn: () => fetchCohorts().catch(() => [] as Cohort[]),
  });
}

export function useCohorts() {
  return useQuery(cohortsQueryOptions());
}

export function courseEnrolInstancesQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: queryKeys.courseEnrolInstances(courseId),
    queryFn: () =>
      fetchCourseEnrolInstances(courseId).catch(() => [] as EnrolInstance[]),
  });
}

export function useCourseEnrolInstances(courseId: string) {
  return useQuery(courseEnrolInstancesQueryOptions(courseId));
}

export function courseEnrolmentsQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: queryKeys.courseEnrolments(courseId),
    queryFn: () =>
      fetchCourseEnrolments(courseId).catch(() => [] as UserEnrolment[]),
  });
}

export function useCourseEnrolments(courseId: string) {
  return useQuery(courseEnrolmentsQueryOptions(courseId));
}

export function courseCompletionsQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: queryKeys.courseCompletions(courseId),
    queryFn: () =>
      fetchCourseCompletions(courseId).catch(() => [] as CourseCompletion[]),
  });
}

export function useCourseCompletions(courseId: string) {
  return useQuery(courseCompletionsQueryOptions(courseId));
}

export function courseDetailQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.courseDetail(courseId),
    queryFn: () => fetchCourseDetail(courseId).catch(() => null),
  });
}

export function useCourseDetail(courseId: string) {
  return useQuery(courseDetailQueryOptions(courseId));
}

export function courseConversationQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.courseConversation(courseId),
    queryFn: () => fetchCourseConversation(courseId).catch(() => null),
  });
}

export function useCourseConversation(courseId: string) {
  return useQuery(courseConversationQueryOptions(courseId));
}


export function courseGroupMembersQueryOptions(courseId: string, groupId: string) {
  return queryOptions({
    queryKey: queryKeys.courseGroupMembers(courseId, groupId),
    queryFn: () => fetchCourseGroupMembers(courseId, groupId),
  });
}

export function useCourseGroupMembers(courseId: string, groupId: string) {
  return useQuery(courseGroupMembersQueryOptions(courseId, groupId));
}

export function courseGroupingGroupsQueryOptions(courseId: string, groupingId: string) {
  return queryOptions({
    queryKey: queryKeys.courseGroupingGroups(courseId, groupingId),
    queryFn: () => fetchCourseGroupingGroups(courseId, groupingId),
  });
}

export function useCourseGroupingGroups(courseId: string, groupingId: string) {
  return useQuery(courseGroupingGroupsQueryOptions(courseId, groupingId));
}

export function cohortMembersQueryOptions(cohortId: string) {
  return queryOptions({
    queryKey: queryKeys.cohortMembers(cohortId),
    queryFn: () => fetchCohortMembers(cohortId),
  });
}

export function useCohortMembers(cohortId: string) {
  return useQuery(cohortMembersQueryOptions(cohortId));
}


export function useCreateCourseGroup(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createCourseGroup(courseId, name),
    onSuccess: () => client.invalidateQueries({ queryKey: sharedQueryKeys.courseGroups(courseId) }),
  });
}

export function useRenameCourseGroup(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { groupId: string; name: string }) => renameCourseGroup(courseId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: sharedQueryKeys.courseGroups(courseId) }),
  });
}

export function useDeleteCourseGroup(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => deleteCourseGroup(courseId, groupId),
    onSuccess: () => client.invalidateQueries({ queryKey: sharedQueryKeys.courseGroups(courseId) }),
  });
}

export function useAddCourseGroupMember(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { groupId: string; userId: string }) =>
      addCourseGroupMember(courseId, input),
    onSuccess: (_data, vars) =>
      client.invalidateQueries({ queryKey: queryKeys.courseGroupMembers(courseId, vars.groupId) }),
  });
}

export function useRemoveCourseGroupMember(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { groupId: string; userId: string }) =>
      removeCourseGroupMember(courseId, input),
    onSuccess: (_data, vars) =>
      client.invalidateQueries({ queryKey: queryKeys.courseGroupMembers(courseId, vars.groupId) }),
  });
}

export function useSaveCourseGroupMode(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { groupMode: number; groupModeForce: boolean }) =>
      saveCourseGroupMode(courseId, body),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: sharedQueryKeys.courseDetail(courseId) }),
  });
}

export function useToggleCourseConversation(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; enabled: boolean }) =>
      toggleCourseConversation(input),
    onSuccess: (updated) => {
      client.setQueryData(sharedQueryKeys.courseConversation(courseId), {
        id: updated.id,
        enabled: updated.enabled,
      });
    },
  });
}

export function useOpenGroupConversation() {
  return useMutation({
    mutationFn: (groupId: string) => openGroupConversation(groupId),
  });
}

export function useCreateCourseGrouping(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; idNumber?: string; description?: string }) =>
      createCourseGrouping(courseId, body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.courseGroupings(courseId) }),
  });
}

export function useDeleteCourseGrouping(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (groupingId: string) => deleteCourseGrouping(courseId, groupingId),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.courseGroupings(courseId) }),
  });
}

export function useAddGroupToGrouping(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { groupingId: string; groupId: string }) =>
      addGroupToGrouping(courseId, input),
    onSuccess: (_data, vars) =>
      client.invalidateQueries({
        queryKey: queryKeys.courseGroupingGroups(courseId, vars.groupingId),
      }),
  });
}

export function useAddCohortMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { cohortId: string; userId: string }) => addCohortMember(input),
    onSuccess: (_data, vars) =>
      client.invalidateQueries({ queryKey: queryKeys.cohortMembers(vars.cohortId) }),
  });
}

export function useRemoveCohortMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { cohortId: string; userId: string }) => removeCohortMember(input),
    onSuccess: (_data, vars) =>
      client.invalidateQueries({ queryKey: queryKeys.cohortMembers(vars.cohortId) }),
  });
}

export function useEnrolUserManually(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { manualInstanceId: string | null; userId: string }) =>
      enrolUserManually(courseId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.courseEnrolInstances(courseId) });
      void client.invalidateQueries({ queryKey: queryKeys.courseEnrolments(courseId) });
    },
  });
}

export function useToggleEnrolSuspend(courseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ue: UserEnrolment) => toggleEnrolSuspend(courseId, ue),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.courseEnrolments(courseId) }),
  });
}

export async function courseAdminPageClientLoader(courseId: string) {
  await Promise.allSettled([
    queryClient.ensureQueryData(courseGroupsQueryOptions(courseId)),
    queryClient.ensureQueryData(courseGroupingsQueryOptions(courseId)),
    queryClient.ensureQueryData(cohortsQueryOptions()),
    queryClient.ensureQueryData(courseEnrolInstancesQueryOptions(courseId)),
    queryClient.ensureQueryData(courseEnrolmentsQueryOptions(courseId)),
    queryClient.ensureQueryData(courseCompletionsQueryOptions(courseId)),
    queryClient.ensureQueryData(courseConversationQueryOptions(courseId)),
    queryClient.ensureQueryData(courseDetailQueryOptions(courseId)),
  ]);
  return null;
}
