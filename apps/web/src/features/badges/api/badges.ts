/**
 * Tầng gọi API thuần của feature badges: chỉ chứa các hàm gọi HTTP qua apiJson, không
 * phụ thuộc React hay React Query. Gồm đọc toàn bộ huy hiệu, huy hiệu của tôi, danh sách
 * đã cấp, tạo site badge, đặt tiêu chí hoàn thành khoá học và đổi trạng thái badge;
 * tầng queries/ của feature bọc các hàm này thành hook.
 */

import { apiJson } from '#lib/api';
import type { BadgeView, IssuedView, MyBadgeView } from '../types/badges';

/**
 * Tầng gọi API thuần của trang huy hiệu thuộc feature badges:
 * chỉ chứa các hàm gọi HTTP, không phụ thuộc React hay React Query. Tầng `queries/` của feature bọc các hàm này thành hook. Tách từ module phẳng `src/lib/badges.ts` khi tổ chức lại apps/web theo mô hình features/ (issue #500).
 */

import { BADGE_TYPE_SITE } from '../types/badges';

/**
 * Đọc toàn bộ huy hiệu (GET /badges).
 *
 * @returns Danh sách huy hiệu.
 */
export function fetchAllBadges() {
  return apiJson<BadgeView[]>('/api/v1/badges');
}

/**
 * Đọc huy hiệu đã cấp cho chính người dùng (GET /badges/mine).
 *
 * @returns Danh sách bản ghi đã cấp kèm huy hiệu.
 */
export function fetchMyBadges() {
  return apiJson<MyBadgeView[]>('/api/v1/badges/mine');
}

/**
 * Đọc danh sách đã cấp của một huy hiệu (GET /badges/:id/issued).
 *
 * @param badgeId - Định danh huy hiệu.
 * @returns Danh sách bản ghi đã cấp.
 */
export function fetchBadgeIssued(badgeId: string) {
  return apiJson<IssuedView[]>(`/api/v1/badges/${badgeId}/issued`);
}

/**
 * Tạo một site badge mới (POST /badges).
 *
 * @param name - Tên huy hiệu.
 * @returns Đáp ứng của API.
 */
export function createBadge(name: string) {
  return apiJson('/api/v1/badges', { method: 'POST', body: JSON.stringify({ name, type: BADGE_TYPE_SITE }) });
}

/**
 * Đặt tiêu chí hoàn thành khoá học cho một badge (PUT /badges/:id/criteria).
 *
 * @param badgeId - Định danh huy hiệu.
 * @param courseId - Định danh khoá học làm tiêu chí.
 * @returns Đáp ứng của API.
 */
export function setBadgeCriteria(badgeId: string, courseId: string) {
  return apiJson(`/api/v1/badges/${badgeId}/criteria`, {
    method: 'PUT',
    body: JSON.stringify({
      method: 1,
      criteria: [{ criteriaType: 'coursecompletion', params: { courseId } }],
    }),
  });
}

/**
 * Đổi trạng thái một badge (POST /badges/:id/status) — kích hoạt dùng { status: BADGE_STATUS_ACTIVE }.
 *
 * @param badgeId - Định danh huy hiệu.
 * @param status - Trạng thái mới.
 * @returns Đáp ứng của API.
 */
export function setBadgeStatus(badgeId: string, status: number) {
  return apiJson(`/api/v1/badges/${badgeId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}
