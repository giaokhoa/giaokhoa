/**
 * Trang trung tâm thông báo: danh sách đã nhóm theo loại sự kiện, ngữ cảnh và ngày, kèm bộ lọc theo nhóm/chỉ-chưa-đọc, phân trang con trỏ, mở rộng dòng gộp, đánh dấu đã đọc và xoá từng mục.
 * Luồng chính: loader phía server prefetch trang đầu của bộ lọc mặc định cùng tuỳ chọn và ghi đè theo khoá rồi hydrate vào cache; mọi thao tác đọc/xoá đều làm mới khoá số chưa đọc dùng chung với chuông; phần cài đặt thông báo đã chuyển sang mục Thông báo của khu Cài đặt.
 */

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
import { groupsUrl, notificationGroupKey, openNotificationGroupWithUnread } from '../utils/notifications';
import type { NotificationCourseOverrideView, NotificationGroupFilter, NotificationGroupView, NotificationGroupsPage, NotificationItemView, NotificationPreferenceView } from '../types/notifications';
import { formatDate, formatDateTime, MS_PER_DAY, relativeTime } from '#utils/date-format';
import { queryKeys } from '../queries/keys';
import { buildSsrLoaderData, serverProbe, serverQueryFn, type SsrLoaderData } from '#lib/ssr-data';

/**
 * Loader phía server (tầng SL-1 của #7): prefetch bằng cookie của
 * chính request rồi dehydrate cho root.tsx hydrate vào cache (xem
 * `lib/ssr-data.ts`):
 *   - Trang ĐẦU của danh sách nhóm ở bộ lọc mặc định mà trang mở ra
 *     (nhóm 'all', không chỉ-chưa-đọc — key `notificationGroups('all',
 *     false)`, infinite query): cuộn tiếp/tải thêm và đổi bộ lọc vẫn
 *     chạy phía client như trước; các bộ lọc khác không prefetch vì
 *     key của chúng chỉ sinh khi người dùng chọn.
 *   - Toàn bộ dòng tuỳ chọn (key `messagePreferences`) và ghi đè theo
 *     khoá (key `messageCourseOverrides`, dữ liệu dehydrate là MẢNG
 *     `courses` đã bóc như queryFn phía client).
 * Không có cookie phiên thì không gọi API nào.
 *
 * @param request - Request đang phục vụ (nguồn cookie phiên).
 * @returns Dehydrated state cho HydrationBoundary ở root.
 */
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


/** Nhãn đầu mục ngày: Hôm nay / Hôm qua theo ngày lịch của trình duyệt, còn lại in ngày cụ thể. */
function dayLabel(day: string, t: (key: string) => string): string {
  const localDay = (d: Date) => {
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const dd = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dd}`;
  };
  const now = new Date();
  if (day === localDay(now)) return t('todayLabel');
  if (day === localDay(new Date(now.getTime() - MS_PER_DAY))) return t('yesterdayLabel');
  return formatDate(`${day}T00:00:00`);
}

/**
 * Trung tâm thông báo. Trung tâm này là danh sách đã nhóm dạng v2 (issue
 * #51): các dòng được nhóm theo (type × source × day) với phân trang
 * theo cursor, bộ lọc theo nhóm/chưa đọc, chi tiết mở rộng được, deep link
 * qua context_url để đánh dấu đã đọc, và xoá theo từng dòng.
 *
 * Từ issue #288 trang này CHỈ còn trung tâm thông báo: phần tuỳ
 * chọn (mô hình v2 của NB-2, issue #174) và ngoại lệ theo khoá đã
 * chuyển hẳn sang mục Thông báo của khu Cài đặt
 * (`/settings/notifications`) — tách "xem thông báo" khỏi "cài đặt
 * thông báo" đúng chuẩn các site lớn trong research #288. Trang này
 * không còn gọi API preferences nữa.
 *
 * Dữ liệu qua TanStack Query (features/notifications/queries/notifications, F-01): danh sách
 * nhóm là infinite query theo khoá bộ lọc, các mục mở rộng tải qua
 * fetchQuery vào cùng cache, tuỳ chọn là một query + mutation lạc quan
 * trên cache. Điểm khác hành vi cũ quan trọng nhất: mọi thao tác
 * đọc/đọc-nhóm/đọc-hết/xoá đều LÀM MỚI khoá `notificationUnreadCount`
 * — huy hiệu chuông ở sidebar/header dùng chung khoá đó (trước đây
 * trang này không hề invalidate nên huy hiệu giữ số cũ sau khi đã
 * đọc ở đây). Các cập nhật đếm tại chỗ vẫn giữ nguyên, nay áp thẳng
 * lên cache qua setQueriesData thay cho state cục bộ. Từ lát SL-1
 * (#7), loader của route prefetch trang đầu của bộ lọc mặc định +
 * tuỳ chọn + ghi đè theo khoá phía server (khi có cookie phiên) và
 * trang hydrate từ cache thay vì fetch lại khi mở.
 */
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

  // Đổi bộ lọc thì thu gọn toàn bộ dòng trước khi render danh sách mới.
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
    const key = notificationGroupKey(group);
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

  /** Đánh dấu một mục đã đọc ở trạng thái hiển thị (cache nhóm + mục đang mở rộng). */
  function applyItemRead(group: NotificationGroupView, itemId: string) {
    const key = notificationGroupKey(group);
    updateNotificationGroupsCache(queryClient, (prev) =>
      prev.map((g) => (notificationGroupKey(g) === key && g.unreadCount > 0
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

  /** Bấm vào một mục: đánh dấu đã đọc rồi đi tới đúng ngữ cảnh của mục đó. */
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

  /** Bấm vào thân dòng gộp: đi tới ngữ cảnh của nguồn và đánh dấu đã đọc cả nhóm. */
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
      openNotificationGroupWithUnread(group, queryClient, readGroupMutation, navigate);
      return;
    }
    navigate(group.contextUrl);
  }

  /** Xoá một mục ngay tại dòng (§9): cập nhật đếm của dòng gộp, dòng rỗng thì biến mất. */
  function deleteItem(group: NotificationGroupView, item: NotificationItemView) {
    deleteMutation.mutate(item.id, {
      onSettled: () => {
        const key = notificationGroupKey(group);
        setExpandedItems((prev) => {
          const items = prev.get(key);
          if (!items) return prev;
          const next = new Map(prev);
          next.set(key, items.filter((n) => n.id !== item.id));
          return next;
        });
        updateNotificationGroupsCache(queryClient, (prev) =>
          prev.flatMap((g) => {
            if (notificationGroupKey(g) !== key) return [g];
            const count = g.count - 1;
            if (count <= 0) return [];
            const remaining = expandedItems.get(key)?.filter((n) => n.id !== item.id) ?? [];
            const firstRemaining = remaining[0];
            const latest = g.latest.id === item.id && firstRemaining
              ? {
                  id: firstRemaining.id, subject: firstRemaining.subject, smallMessage: firstRemaining.smallMessage,
                  contextUrlName: firstRemaining.contextUrlName, createdAt: firstRemaining.createdAt, timeRead: firstRemaining.timeRead,
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

  // Các dòng gộp đã sắp theo hoạt động mới nhất nên ngày chỉ lùi dần:
  // chèn đầu mục ngày mỗi khi ngày đổi so với dòng trước.
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
                const key = notificationGroupKey(group);
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

/** Export mặc định cho route module React Router framework mode (xem src/routes.ts). */
export default NotificationsPage;

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navNotifications');
}
