import {
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  clearReadNotifications, deleteNotification, fetchMessagePreferences, fetchNotificationCourseOverrides,
  fetchNotificationGroupItems as fetchNotificationGroupItemsApi, fetchNotificationGroupsPage,
  fetchNotificationUnreadCount,
  markAllNotificationsRead, markNotificationRead, readNotificationGroup, setMessagePreference,
  setNotificationCourseOverride,
} from '../api/notifications';
import type {
  NotificationCourseOverrideView,
  NotificationGroupView,
  NotificationGroupsPage,
  NotificationItemView,
  NotificationPreferenceView,
  PreferencePatch,
} from '../types/notifications';
import { queryKeys } from './keys';


export function notificationUnreadCountQueryOptions() {
  return queryOptions({
    queryKey: sharedQueryKeys.notificationUnreadCount,
    queryFn: () => fetchNotificationUnreadCount(),
  });
}

export function useNotificationUnreadCount() {
  return useQuery(notificationUnreadCountQueryOptions());
}

export function useNotificationGroups(group: string, unreadOnly: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.notificationGroups(group, unreadOnly),
    queryFn: ({ pageParam }) => fetchNotificationGroupsPage(group, unreadOnly, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function flattenNotificationGroups(
  data: InfiniteData<NotificationGroupsPage> | undefined,
): NotificationGroupView[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function updateNotificationGroupsCache(
  queryClient: QueryClient,
  updater: (groups: NotificationGroupView[]) => NotificationGroupView[],
) {
  queryClient.setQueriesData<InfiniteData<NotificationGroupsPage>>(
    { queryKey: queryKeys.notificationGroupsRoot },
    (old) =>
      old
        ? { ...old, pages: old.pages.map((page) => ({ ...page, items: updater(page.items) })) }
        : old,
  );
}

export function fetchNotificationGroupItems(
  queryClient: QueryClient,
  group: NotificationGroupView,
): Promise<NotificationItemView[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.notificationGroupItems(group.eventType, group.contextUrl ?? '', group.day),
    queryFn: () => fetchNotificationGroupItemsApi(group.eventType, group.contextUrl ?? '', group.day),
  });
}

function useInvalidateUnreadCount() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: sharedQueryKeys.notificationUnreadCount });
}

export function useMarkNotificationRead() {
  const invalidateUnread = useInvalidateUnreadCount();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSettled: invalidateUnread,
  });
}

export function useReadNotificationGroup() {
  const invalidateUnread = useInvalidateUnreadCount();
  return useMutation({
    mutationFn: (group: Pick<NotificationGroupView, 'eventType' | 'contextUrl' | 'day'>) =>
      readNotificationGroup(group),
    onSettled: invalidateUnread,
  });
}

export function useDeleteNotification() {
  const invalidateUnread = useInvalidateUnreadCount();
  return useMutation({
    mutationFn: (id: string) => deleteNotification(id),
    onSettled: invalidateUnread,
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationGroupsRoot });
      void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.notificationUnreadCount });
    },
  });
}

export function useClearReadNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearReadNotifications(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notificationGroupsRoot }),
  });
}

export function useMessagePreferences() {
  return useQuery({
    queryKey: queryKeys.messagePreferences,
    queryFn: () => fetchMessagePreferences(),
  });
}

export function useNotificationCourseOverrides() {
  return useQuery({
    queryKey: queryKeys.messageCourseOverrides,
    queryFn: () => fetchNotificationCourseOverrides(),
  });
}

export function useSetNotificationCourseOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { courseId: string; mode: NotificationCourseOverrideView['mode'] }) =>
      setNotificationCourseOverride(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.messageCourseOverrides });
      const previous = queryClient.getQueryData<NotificationCourseOverrideView[]>(queryKeys.messageCourseOverrides);
      queryClient.setQueryData<NotificationCourseOverrideView[]>(queryKeys.messageCourseOverrides, (old) =>
        old?.map((c) => (c.courseId === input.courseId ? { ...c, mode: input.mode } : c)),
      );
      return { previous };
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<NotificationCourseOverrideView[]>(queryKeys.messageCourseOverrides, (old) =>
        old?.map((c) => (c.courseId === saved.courseId ? saved : c)),
      );
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.messageCourseOverrides, context.previous);
      }
    },
  });
}

export function useSetMessagePreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: string; patch: PreferencePatch }) => setMessagePreference(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.messagePreferences });
      const previous = queryClient.getQueryData<NotificationPreferenceView[]>(queryKeys.messagePreferences);
      queryClient.setQueryData<NotificationPreferenceView[]>(queryKeys.messagePreferences, (old) =>
        old?.map((p) => (p.provider === input.provider ? { ...p, ...input.patch } : p)),
      );
      return { previous };
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<NotificationPreferenceView[]>(queryKeys.messagePreferences, (old) =>
        old?.map((p) => (p.provider === saved.provider ? saved : p)),
      );
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.messagePreferences, context.previous);
      }
    },
  });
}
