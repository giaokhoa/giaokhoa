/**
 * Helper dùng chung của trung tâm thông báo: khoá nhóm theo ngày + loại, URL danh
 * sách nhóm, và mở một nhóm thông báo (đánh dấu đã đọc cả nhóm, đưa số chưa đọc của
 * nhóm về 0 trong cache rồi điều hướng) để chuông ở header và trang trung tâm dùng
 * chung một đường.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { NotificationGroupView, NotificationPreferenceView } from '../types/notifications';
import { updateNotificationGroupsCache } from '../queries/notifications';

/**
 * Hàm thuần của trung tâm thông báo thuộc feature notifications. Tách từ module phẳng `src/lib/notifications.ts` khi tổ chức lại apps/web theo mô hình features/ (issue #500).
 */

/** Khoá định danh một dòng gộp trong cache/trạng thái hiển thị. */
export function notificationGroupKey(g: Pick<NotificationGroupView, 'eventType' | 'contextUrl' | 'day'>): string {
  return `${g.eventType}|${g.contextUrl ?? ''}|${g.day}`;
}

/**
 * Mở một dòng gộp CÓ ngữ cảnh khi còn tin chưa đọc — nhánh chung của
 * chuông thông báo và trang thông báo: đánh dấu đã đọc cả nhóm phía
 * server, đưa số chưa đọc của nhóm về 0 trong cache, rồi điều hướng
 * tới ngữ cảnh. Hai bề mặt khác nhau ở nhánh không có ngữ cảnh (chuông
 * về trang thông báo, trang mở rộng tại chỗ) và nhánh một tin nên chỉ
 * nhánh chung này được gộp.
 *
 * @param group - Dòng gộp đang mở.
 * @param queryClient - QueryClient để vá cache nhóm.
 * @param readGroup - Đột biến đánh dấu đã đọc cả nhóm.
 * @param navigate - Điều hướng tới URL ngữ cảnh.
 */
export function openNotificationGroupWithUnread(
  group: NotificationGroupView,
  queryClient: QueryClient,
  readGroup: {
    mutate: (
      group: Pick<NotificationGroupView, 'eventType' | 'contextUrl' | 'day'>,
      options: { onSettled: () => void },
    ) => void;
  },
  navigate: (url: string) => void,
): void {
  readGroup.mutate(group, {
    onSettled: () => {
      const key = notificationGroupKey(group);
      updateNotificationGroupsCache(queryClient, (prev) =>
        prev.map((g) => (notificationGroupKey(g) === key ? { ...g, unreadCount: 0 } : g)),
      );
      navigate(group.contextUrl!);
    },
  });
}

/** Khoá định danh một dòng tuỳ chọn v2 (một dòng cho mỗi provider). */
export function preferenceKey(row: Pick<NotificationPreferenceView, 'provider'>): string {
  return row.provider;
}

/**
 * URL một trang danh sách nhóm theo bộ lọc + con trỏ — dùng chung cho
 * hook phía client và loader SL-1 (loader phải gọi ĐÚNG URL này cho
 * bộ lọc mặc định để dữ liệu dehydrate khớp trang đầu phía client).
 */
export function groupsUrl(group: string, unreadOnly: boolean, cursor?: string): string {
  const params = new URLSearchParams({ limit: '20' });
  if (group !== 'all') params.set('group', group);
  if (unreadOnly) params.set('unreadOnly', 'true');
  if (cursor) params.set('cursor', cursor);
  return `/api/v1/notifications?${params.toString()}`;
}
