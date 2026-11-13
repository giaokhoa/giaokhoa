import { apiJson } from '#lib/api';
import type { BadgeView, IssuedView, MyBadgeView } from '../types/badges';


export function fetchAllBadges() {
  return apiJson<BadgeView[]>('/api/v1/badges');
}

export function fetchMyBadges() {
  return apiJson<MyBadgeView[]>('/api/v1/badges/mine');
}

export function fetchBadgeIssued(badgeId: string) {
  return apiJson<IssuedView[]>(`/api/v1/badges/${badgeId}/issued`);
}

export function createBadge(name: string) {
  return apiJson('/api/v1/badges', { method: 'POST', body: JSON.stringify({ name, type: 1 }) });
}

export function setBadgeCriteria(badgeId: string, courseId: string) {
  return apiJson(`/api/v1/badges/${badgeId}/criteria`, {
    method: 'PUT',
    body: JSON.stringify({
      method: 1,
      criteria: [{ criteriaType: 'coursecompletion', params: { courseId } }],
    }),
  });
}

export function setBadgeStatus(badgeId: string, status: number) {
  return apiJson(`/api/v1/badges/${badgeId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}
