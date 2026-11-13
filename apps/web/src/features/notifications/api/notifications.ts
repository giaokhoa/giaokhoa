import { apiJson } from '#lib/api';
import type {
  NotificationCourseOverrideView,
  NotificationGroupsPage,
  NotificationItemView,
  NotificationPreferenceView,
  PreferencePatch,
} from '../types/notifications';
import { groupsUrl } from '../utils/notifications';


export function fetchNotificationUnreadCount() {
  return apiJson<{ unread: number }>('/api/v1/notifications/unread-count');
}

export function fetchNotificationGroupsPage(group: string, unreadOnly: boolean, cursor?: string) {
  return apiJson<NotificationGroupsPage>(groupsUrl(group, unreadOnly, cursor));
}

export async function fetchNotificationGroupItems(eventType: string, contextUrl: string, day: string) {
  const params = new URLSearchParams({ eventType, contextUrl, day, limit: '100' });
  const page = await apiJson<{ items: NotificationItemView[]; nextCursor: string | null }>(
    `/api/v1/notifications/items?${params.toString()}`,
  );
  return page.items;
}

export function markNotificationRead(id: string) {
  return apiJson(`/api/v1/notifications/${id}/read`, { method: 'POST', body: '{}' }).catch(() => undefined);
}

export function readNotificationGroup(group: { eventType: string; contextUrl: string | null; day: string }) {
  return apiJson('/api/v1/notifications/read-group', {
    method: 'POST',
    body: JSON.stringify({ eventType: group.eventType, contextUrl: group.contextUrl, day: group.day }),
  }).catch(() => undefined);
}

export function deleteNotification(id: string) {
  return apiJson(`/api/v1/notifications/${id}`, { method: 'DELETE' }).catch(() => undefined);
}

export function markAllNotificationsRead() {
  return apiJson('/api/v1/notifications/mark-read', { method: 'POST', body: JSON.stringify({ scope: 'all' }) });
}

export function clearReadNotifications() {
  return apiJson('/api/v1/notifications/clear-read', { method: 'POST', body: '{}' });
}

export function fetchMessagePreferences() {
  return apiJson<NotificationPreferenceView[]>('/api/v1/messages/preferences');
}

export async function fetchNotificationCourseOverrides() {
  const res = await apiJson<{ courses: NotificationCourseOverrideView[] }>('/api/v1/messages/preferences/courses');
  return res.courses;
}

export function setNotificationCourseOverride(input: { courseId: string; mode: NotificationCourseOverrideView['mode'] }) {
  return apiJson<NotificationCourseOverrideView>('/api/v1/messages/preferences/courses', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function setMessagePreference(input: { provider: string; patch: PreferencePatch }) {
  return apiJson<NotificationPreferenceView>('/api/v1/messages/preferences', {
    method: 'PUT',
    body: JSON.stringify({ provider: input.provider, ...input.patch }),
  });
}
