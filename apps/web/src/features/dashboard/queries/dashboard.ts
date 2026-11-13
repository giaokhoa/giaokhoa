import { queryOptions, useQuery } from '@tanstack/react-query';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import { fetchDashboardOverview, fetchNotificationUnreadCount } from '../api/dashboard';
import { queryKeys } from './keys';


export function dashboardOverviewQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.dashboardOverview,
    queryFn: () => fetchDashboardOverview(),
  });
}

export function useDashboardOverview() {
  return useQuery(dashboardOverviewQueryOptions());
}

export function dashboardUnreadCountQueryOptions() {
  return queryOptions({
    queryKey: sharedQueryKeys.notificationUnreadCount,
    queryFn: () => fetchNotificationUnreadCount(),
  });
}
