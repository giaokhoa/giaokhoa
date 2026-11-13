import type { DashboardOverviewView } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';


export function fetchDashboardOverview() {
  return apiJson<DashboardOverviewView>('/api/v1/dashboard/overview?days=7');
}

export function fetchNotificationUnreadCount() {
  return apiJson<{ unread: number }>('/api/v1/notifications/unread-count');
}
