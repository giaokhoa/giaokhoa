import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPlayerView, markPlayerModuleLearned } from '../api/player';
import { queryKeys } from './keys';


export function playerViewQueryOptions(courseId: string, cmId: string) {
  return queryOptions({
    queryKey: queryKeys.playerView(courseId, cmId),
    queryFn: () => fetchPlayerView(courseId, cmId),
  });
}

export function usePlayerView(courseId: string | undefined, cmId: string | undefined) {
  return useQuery({
    ...playerViewQueryOptions(courseId ?? '', cmId ?? ''),
    enabled: !!courseId && !!cmId,
  });
}

export function useMarkPlayerModuleLearned(courseId: string | undefined, cmId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => markPlayerModuleLearned(courseId, cmId),
    onSuccess: () => {
      if (courseId && cmId) {
        void client.invalidateQueries({ queryKey: queryKeys.playerView(courseId, cmId) });
      }
    },
  });
}
