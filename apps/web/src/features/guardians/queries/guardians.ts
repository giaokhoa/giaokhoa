import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GuardianDigestFrequency } from '@giaokhoa/contracts';
import { queryClient } from '#lib/query-client';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  createGuardianLink, fetchGuardianDigestPreference, fetchGuardianLinks, fetchGuardianMyStudents,
  fetchGuardianOverview, fetchGuardianResults, revokeGuardianLink, updateGuardianDigestPreference,
} from '../api/guardians';
import type { CreateGuardianLinkDraft } from '../types/guardians';
import { queryKeys } from './keys';


export function guardianMyStudentsQueryOptions() {
  return queryOptions({
    queryKey: sharedQueryKeys.guardianMyStudents,
    queryFn: () => fetchGuardianMyStudents(),
  });
}

export function guardianOverviewQueryOptions(studentId: string) {
  return queryOptions({
    queryKey: queryKeys.guardianOverview(studentId),
    queryFn: () => fetchGuardianOverview(studentId),
  });
}

export function guardianResultsQueryOptions(studentId: string) {
  return queryOptions({
    queryKey: queryKeys.guardianResults(studentId),
    queryFn: () => fetchGuardianResults(studentId),
  });
}

export function guardianDigestPreferenceQueryOptions(studentId: string) {
  return queryOptions({
    queryKey: queryKeys.guardianDigestPreference(studentId),
    queryFn: () => fetchGuardianDigestPreference(studentId),
  });
}

export function useUpdateGuardianDigestPreference(studentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (frequency: GuardianDigestFrequency) => updateGuardianDigestPreference(studentId, frequency),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.guardianDigestPreference(studentId) });
    },
  });
}

export function guardianLinksQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.guardianLinks,
    queryFn: () => fetchGuardianLinks(),
  });
}

export function useCreateGuardianLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: CreateGuardianLinkDraft) => createGuardianLink(draft),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.guardianLinks });
      void client.invalidateQueries({ queryKey: sharedQueryKeys.guardianMyStudents });
    },
  });
}

export function useRevokeGuardianLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => revokeGuardianLink(linkId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.guardianLinks });
      void client.invalidateQueries({ queryKey: sharedQueryKeys.guardianMyStudents });
    },
  });
}

export async function guardianPageClientLoader() {
  const students = await queryClient.ensureQueryData(guardianMyStudentsQueryOptions()).catch(() => null);
  const firstStudentId = students?.[0]?.student.id;
  if (firstStudentId) {
    await Promise.all([
      queryClient.prefetchQuery(guardianOverviewQueryOptions(firstStudentId)),
      queryClient.prefetchQuery(guardianResultsQueryOptions(firstStudentId)),
      queryClient.prefetchQuery(guardianDigestPreferenceQueryOptions(firstStudentId)),
    ]);
  }
  return null;
}

export async function guardianStudentPageClientLoader(studentId: string) {
  await Promise.all([
    queryClient.prefetchQuery(guardianMyStudentsQueryOptions()),
    queryClient.prefetchQuery(guardianOverviewQueryOptions(studentId)),
    queryClient.prefetchQuery(guardianResultsQueryOptions(studentId)),
    queryClient.prefetchQuery(guardianDigestPreferenceQueryOptions(studentId)),
  ]);
  return null;
}
