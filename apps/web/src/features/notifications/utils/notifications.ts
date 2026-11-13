import type { NotificationGroupView, NotificationPreferenceView } from '../types/notifications';


export function notificationGroupKey(g: Pick<NotificationGroupView, 'eventType' | 'contextUrl' | 'day'>): string {
  return `${g.eventType}|${g.contextUrl ?? ''}|${g.day}`;
}

export function preferenceKey(row: Pick<NotificationPreferenceView, 'provider'>): string {
  return row.provider;
}

export function groupsUrl(group: string, unreadOnly: boolean, cursor?: string): string {
  const params = new URLSearchParams({ limit: '20' });
  if (group !== 'all') params.set('group', group);
  if (unreadOnly) params.set('unreadOnly', 'true');
  if (cursor) params.set('cursor', cursor);
  return `/api/v1/notifications?${params.toString()}`;
}
