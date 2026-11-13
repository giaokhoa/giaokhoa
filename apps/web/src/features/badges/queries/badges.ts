import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  createBadge, fetchAllBadges, fetchBadgeIssued, fetchMyBadges, setBadgeCriteria, setBadgeStatus,
} from '../api/badges';
import { queryKeys } from './keys';


export function useAllBadges() {
  return useQuery({
    queryKey: queryKeys.badgesAll,
    queryFn: () => fetchAllBadges(),
  });
}

export function useMyBadges() {
  return useQuery({
    queryKey: sharedQueryKeys.myBadges,
    queryFn: () => fetchMyBadges(),
  });
}

export function useBadgeIssued(badgeId: string | null) {
  return useQuery({
    queryKey: queryKeys.badgeIssued(badgeId ?? ''),
    queryFn: () => fetchBadgeIssued(badgeId ?? ''),
    enabled: badgeId !== null,
  });
}

function useInvalidateBadges() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.badges });
}

export function useCreateBadge() {
  const invalidate = useInvalidateBadges();
  return useMutation({
    mutationFn: (name: string) => createBadge(name),
    onSuccess: invalidate,
  });
}

export function useSetBadgeCriteria() {
  const invalidate = useInvalidateBadges();
  return useMutation({
    mutationFn: (input: { badgeId: string; courseId: string }) => setBadgeCriteria(input.badgeId, input.courseId),
    onSuccess: invalidate,
  });
}

export function useSetBadgeStatus() {
  const invalidate = useInvalidateBadges();
  return useMutation({
    mutationFn: (input: { badgeId: string; status: number }) => setBadgeStatus(input.badgeId, input.status),
    onSuccess: invalidate,
  });
}
