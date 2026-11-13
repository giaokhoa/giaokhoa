import { apiJson } from '#lib/api';
import type { CalendarEventView, CalendarExportTokenView, CalendarSubscriptionView } from '../types/calendar';


export function fetchCalendarEvents(fromIso: string, toIso: string) {
  return apiJson<CalendarEventView[]>(`/api/v1/calendar/events?from=${fromIso}&to=${toIso}`);
}

export function fetchCalendarSubscriptions() {
  return apiJson<CalendarSubscriptionView[]>('/api/v1/calendar/subscriptions');
}

export function fetchCalendarExportToken() {
  return apiJson<CalendarExportTokenView | null>('/api/v1/calendar/export-token');
}

export function createCalendarEvent(body: Record<string, unknown>) {
  return apiJson('/api/v1/calendar/events', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteCalendarEvent(id: string) {
  return apiJson(`/api/v1/calendar/events/${id}`, { method: 'DELETE' });
}

export function remindCalendarEvent(id: string) {
  return apiJson(`/api/v1/calendar/events/${id}/remind`, {
    method: 'POST',
    body: JSON.stringify({ minutesBefore: 60 }),
  });
}

export function createCalendarSubscription(input: { name: string; url: string }) {
  return apiJson('/api/v1/calendar/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ name: input.name, url: input.url, eventType: 'user' }),
  });
}

export function importCalendarSubscription(id: string) {
  return apiJson(`/api/v1/calendar/subscriptions/${id}/import`, { method: 'POST', body: '{}' });
}

export function createCalendarExportToken() {
  return apiJson<CalendarExportTokenView>('/api/v1/calendar/export-token', { method: 'POST' });
}

export function revokeCalendarExportToken() {
  return apiJson('/api/v1/calendar/export-token', { method: 'DELETE' });
}
