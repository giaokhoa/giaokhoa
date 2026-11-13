import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import { fetchProgressReport, fetchProgressReportGroups } from '../api/progress-report';
import { queryKeys } from './keys';


export function progressReportQueryOptions(courseId: string, groupId: string) {
  return queryOptions({
    queryKey: queryKeys.courseProgressReport(courseId, groupId),
    queryFn: () => fetchProgressReport(courseId, groupId),
  });
}

export function useProgressReport(courseId: string | undefined, groupId: string) {
  return useQuery({
    ...progressReportQueryOptions(courseId ?? '', groupId),
    enabled: !!courseId,
    placeholderData: keepPreviousData,
  });
}

export function courseGroupsQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.courseGroups(courseId),
    queryFn: () => fetchProgressReportGroups(courseId),
  });
}

export function useCourseGroups(courseId: string | undefined) {
  return useQuery({
    ...courseGroupsQueryOptions(courseId ?? ''),
    enabled: !!courseId,
  });
}
