import { queryOptions } from '@tanstack/react-query';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import { fetchGlobalSearch } from '../api/search';


export function globalSearchQueryOptions(keyword: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.globalSearch(keyword),
    queryFn: () => fetchGlobalSearch(keyword),
    staleTime: 0,
  });
}
