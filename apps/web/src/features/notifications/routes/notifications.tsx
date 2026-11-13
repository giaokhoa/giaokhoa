import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent } from '@giaokhoa/ui/components/card';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { fetchNotificationGroupItems, flattenNotificationGroups, updateNotificationGroupsCache, useClearReadNotifications, useDeleteNotification, useMarkAllNotificationsRead, useMarkNotificationRead, useNotificationGroups, useReadNotificationGroup } from '../queries/notifications';
import { groupsUrl, notificationGroupKey } from '../utils/notifications';
import type { NotificationCourseOverrideView, NotificationGroupFilter, NotificationGroupView, NotificationGroupsPage, NotificationItemView, NotificationPreferenceView } from '../types/notifications';
import { formatDate, formatDateTime } from '#utils/date-format';
import { queryKeys } from '../queries/keys';
import { buildSsrLoaderData, serverProbe, serverQueryFn, type SsrLoaderData } from '#lib/ssr-data';

export async function loader({ request }: { request: Request }): Promise<SsrLoaderData> {
  return buildSsrLoaderData(request, async (queryClient, req) => {
    await Promise.all([
      queryClient.prefetchInfiniteQuery({
        queryKey: queryKeys.notificationGroups('all', false),
        queryFn: ({ pageParam }) =>
          serverQueryFn<NotificationGroupsPage>(req, groupsUrl('all', false, pageParam))(),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage: NotificationGroupsPage) => lastPage.nextCursor ?? undefined,
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.messagePreferences,
        queryFn: serverQueryFn<NotificationPreferenceView[]>(req, '/api/v1/messages/preferences'),
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.messageCourseOverrides,
        queryFn: async () => {
          const body = await serverProbe<{ courses: NotificationCourseOverrideView[] }>(
            req,
            '/api/v1/messages/preferences/courses',
          );
          if (body === null) throw new Error('SSR prefetch failed: /api/v1/messages/preferences/courses');
          return body.courses;
        },
      }),
    ]);
  });
}

type GroupFilterSelection = NotificationGroupFilter | 'all';

function groupKey(g: Pick<NotificationGroupView, 'eventType' | 'contextUrl' | 'day'>): string {
  return notificationGroupKey(g);
}

function dayLabel(day: string, t: (key: string) => string): string {
  const localDay = (d: Date) => {
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const dd = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dd}`;
  };
  const now = new Date();
  if (day === localDay(now)) return t('todayLabel');
  if (day === localDay(new Date(now.getTime() - 86_400_000))) return t('yesterdayLabel');
  return formatDate(`${day}T00:00:00`);
}

function relativeTime(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return t('justNow');
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t('minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('daysAgo', { count: days });
  return formatDateTime(iso);
}

export function NotificationsPage() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [groupFilter, setGroupFilter] = useState<GroupFilterSelection>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [expandedItems, setExpandedItems] = useState<ReadonlyMap<string, NotificationItemView[]>>(new Map());
  const [expanding, setExpanding] = useState<ReadonlySet<string>>(new Set());
  const [expandError, setExpandError] = useState(false);

  const groupsQuery = useNotificationGroups(groupFilter, unreadOnly);
  const markReadMutation = useMarkNotificationRead();
  const readGroupMutation = useReadNotificationGroup();
  const deleteMutation = useDeleteNotification();
  const markAllMutation = useMarkAllNotificationsRead();
  const clearReadMutation = useClearReadNotifications();

  const groups = flattenNotificationGroups(groupsQuery.data);
  const error = groupsQuery.isError || expandError ? t('notificationsLoadFailed') : null;

  const filterKey = groupFilter + ':' + String(unreadOnly);
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey);
  if (filterKey !== previousFilterKey) {
    setPreviousFilterKey(filterKey);
    setExpandedItems(new Map());
  }

  function loadMore() {
    if (groupsQuery.hasNextPage) void groupsQuery.fetchNextPage();
  }

  async function toggleExpand(group: NotificationGroupView) {
    const key = groupKey(group);
    if (expandedItems.has(key)) {
      setExpandedItems((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    setExpanding((prev) => new Set(prev).add(key));
    try {
      const items = await fetchNotificationGroupItems(queryClient, group);
      setExpandedItems((prev) => new Map(prev).set(key, items));
    } catch {
      setExpandError(true);
    } finally {
      setExpanding((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function applyItemRead(group: NotificationGroupView, itemId: string) {
    const key = groupKey(group);
    updateNotificationGroupsCache(queryClient, (prev) =>
      prev.map((g) => (groupKey(g) === key && g.unreadCount > 0
        ? { ...g, unreadCount: g.unreadCount - 1, latest: g.latest.id === itemId ? { ...g.latest, timeRead: new Date().toISOString() } : g.latest }
        : g)),
    );
    setExpandedItems((prev) => {
      const items = prev.get(key);
      if (!items) return prev;
      const next = new Map(prev);
      next.set(key, items.map((n) => (n.id === itemId ? { ...n, timeRead: n.timeRead ?? new Date().toISOString() } : n)));
      return next;
    });
  }

  function openItem(group: NotificationGroupView, item: Pick<NotificationItemView, 'id' | 'contextUrl' | 'timeRead'>) {
    const target = item.contextUrl ?? group.contextUrl;
    if (!item.timeRead) {
      markReadMutation.mutate(item.id, {
        onSettled: () => {
          applyItemRead(group, item.id);
          if (target) navigate(target);
        },
      });
      return;
    }
    if (target) navigate(target);
  }

  function openGroup(group: NotificationGroupView) {
    if (group.count === 1) {
      openItem(group, { id: group.latest.id, contextUrl: group.contextUrl, timeRead: group.latest.timeRead });
      return;
    }
    if (!group.contextUrl) {
      void toggleExpand(group);
      return;
    }
    if (group.unreadCount > 0) {
      readGroupMutation.mutate(group, {
        onSettled: () => {
          const key = groupKey(group);
          updateNotificationGroupsCache(queryClient, (prev) =>
            prev.map((g) => (groupKey(g) === key ? { ...g, unreadCount: 0 } : g)),
          );
          navigate(group.contextUrl!);
        },
      });
      return;
    }
    navigate(group.contextUrl);
  }

  function deleteItem(group: NotificationGroupView, item: NotificationItemView) {
    deleteMutation.mutate(item.id, {
      onSettled: () => {
        const key = groupKey(group);
        setExpandedItems((prev) => {
          const items = prev.get(key);
          if (!items) return prev;
          const next = new Map(prev);
          next.set(key, items.filter((n) => n.id !== item.id));
          return next;
        });
        updateNotificationGroupsCache(queryClient, (prev) =>
          prev.flatMap((g) => {
            if (groupKey(g) !== key) return [g];
            const count = g.count - 1;
            if (count <= 0) return [];
            const remaining = expandedItems.get(key)?.filter((n) => n.id !== item.id) ?? [];
            const latest = g.latest.id === item.id && remaining.length > 0
              ? {
                  id: remaining[0]!.id, subject: remaining[0]!.subject, smallMessage: remaining[0]!.smallMessage,
                  contextUrlName: remaining[0]!.contextUrlName, createdAt: remaining[0]!.createdAt, timeRead: remaining[0]!.timeRead,
                }
              : g.latest;
            return [{ ...g, count, unreadCount: item.timeRead ? g.unreadCount : Math.max(0, g.unreadCount - 1), latest }];
          }),
        );
      },
    });
  }

  function markAllRead() {
    markAllMutation.mutate(undefined, {
      onSuccess: () => setExpandedItems(new Map()),
    });
  }

  function clearRead() {
    clearReadMutation.mutate(undefined, {
      onSuccess: () => setExpandedItems(new Map()),
    });
  }

  const groupLabel: Record<NotificationGroupFilter, string> = {
    learning: t('notificationsGroupLearning'),
    people: t('notificationsGroupPeople'),
    system: t('notificationsGroupSystem'),
  };
  const filterOptions: { value: GroupFilterSelection; label: string }[] = [
    { value: 'all', label: t('notificationsFilterAll') },
    { value: 'learning', label: groupLabel.learning },
    { value: 'people', label: groupLabel.people },
    { value: 'system', label: groupLabel.system },
  ];

  const rows: { dayHeader: string | null; group: NotificationGroupView }[] = [];
  let lastDay: string | null = null;
  for (const group of groups) {
    rows.push({ dayHeader: group.day !== lastDay ? dayLabel(group.day, t) : null, group });
    lastDay = group.day;
  }

  return (
    <PageShell width="narrow">
      <PageHeader
        title={t('notifications')}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => markAllRead()}>
              {t('markAllRead')}
            </Button>
            <Button type="button" variant="outline" onClick={() => clearRead()}>
              {t('clearReadNotifications')}
            </Button>
          </>
        }
      />
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {filterOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={groupFilter === option.value ? 'default' : 'outline'}
                aria-pressed={groupFilter === option.value}
                onClick={() => setGroupFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
              {t('unreadOnlyLabel')}
            </label>
          </div>
          {error ? (
            <ErrorAlert variant="destructive">
              {error}
            </ErrorAlert>
          ) : null}
          {groups.length === 0 && !error ? (
            <Empty className="p-6">
              <EmptyHeader>
                <EmptyTitle>{t('noNotifications')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="space-y-2" aria-label={t('notificationsListLabel')}>
              {rows.map(({ dayHeader, group }) => {
                const key = groupKey(group);
                const items = expandedItems.get(key);
                return (
                  <li key={key} className="space-y-2">
                    {dayHeader ? <p className="pt-2 text-xs font-semibold uppercase text-muted-foreground">{dayHeader}</p> : null}
                    <div className={`rounded border p-2 ${group.unreadCount > 0 ? '' : 'opacity-60'}`}>
                      <div className="flex items-start gap-2">
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openGroup(group)}>
                          <p className="font-medium">{group.latest.subject}</p>
                          {group.latest.smallMessage ? <p className="truncate text-sm">{group.latest.smallMessage}</p> : null}
                          <p className="text-xs text-muted-foreground">
                            {groupLabel[group.group]}
                            {group.count > 1 ? ` · ${t('notificationGroupCount', { count: group.count })}` : ''}
                            {` · ${relativeTime(group.latest.createdAt, t)}`}
                            {group.unreadCount > 0 ? ` · ${t('notificationGroupUnread', { count: group.unreadCount })}` : ` · ${t('readSuffix')}`}
                          </p>
                        </button>
                        {group.count > 1 ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-expanded={items !== undefined}
                            aria-label={`${items !== undefined ? t('collapseGroup') : t('expandGroup')}: ${group.latest.subject}`}
                            onClick={() => void toggleExpand(group)}
                          >
                            {items !== undefined ? t('collapseGroup') : t('expandGroup')}
                          </Button>
                        ) : null}
                        {group.count === 1 ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`${t('deleteNotification')}: ${group.latest.subject}`}
                            onClick={() => deleteItem(group, {
                              id: group.latest.id, subject: group.latest.subject, fullMessage: '', smallMessage: group.latest.smallMessage,
                              eventType: group.eventType, contextUrl: group.contextUrl, contextUrlName: group.latest.contextUrlName,
                              timeRead: group.latest.timeRead, createdAt: group.latest.createdAt,
                            })}
                          >
                            {t('deleteNotification')}
                          </Button>
                        ) : null}
                      </div>
                      {items !== undefined ? (
                        <ul className="mt-2 space-y-1 border-t pt-2">
                          {items.map((item) => (
                            <li key={item.id} className={`flex items-start gap-2 rounded p-1 ${item.timeRead ? 'opacity-60' : ''}`}>
                              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openItem(group, item)}>
                                <p className="text-sm font-medium">{item.subject}</p>
                                <p className="text-sm">{item.fullMessage}</p>
                                <p className="text-xs text-muted-foreground">
                                  {`${relativeTime(item.createdAt, t)} · ${item.timeRead ? t('readSuffix') : t('unreadStateSuffix')}`}
                                </p>
                              </button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                aria-label={`${t('deleteNotification')}: ${item.subject}`}
                                onClick={() => deleteItem(group, item)}
                              >
                                {t('deleteNotification')}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {expanding.has(key) ? <p className="mt-2 text-xs text-muted-foreground">{t('notificationsLoading')}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {groupsQuery.hasNextPage ? (
            <Button type="button" variant="outline" onClick={() => loadMore()}>
              {t('loadMoreNotifications')}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default NotificationsPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navNotifications');
}
