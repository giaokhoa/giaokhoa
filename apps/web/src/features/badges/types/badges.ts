/**
 * Kiểu dữ liệu của trang huy hiệu thuộc feature badges. Tách từ module phẳng `src/lib/badges.ts` khi tổ chức lại apps/web theo mô hình features/ (issue #500): kiểu nằm ở tầng types/, lời gọi API thuần ở tầng api/, hook ở tầng queries/.
 */

/**
 * Loại huy hiệu "site badge" — trị `type` khi tạo huy hiệu toàn site (huy hiệu không gắn khoá học nào).
 */
export const BADGE_TYPE_SITE = 1;
/** Trạng thái huy hiệu: chưa kích hoạt. */
export const BADGE_STATUS_INACTIVE = 0;
/** Trạng thái huy hiệu: đang hoạt động. */
export const BADGE_STATUS_ACTIVE = 1;
/** Trạng thái huy hiệu: đã ngừng cấp. */
export const BADGE_STATUS_RETIRED = 2;
/** Trạng thái huy hiệu: đã lưu trữ. */
export const BADGE_STATUS_ARCHIVED = 3;
/** Trạng thái huy hiệu: đã vô hiệu. */
export const BADGE_STATUS_DISABLED = 4;

/** Huy hiệu (BadgeRow ở tầng API) như các bề mặt hiển thị cần. */
export interface BadgeView {
  id: string;
  name: string;
  description: string;
  type: number;
  courseId: string | null;
  status: number;
}

/** Bản ghi đã cấp (IssuedRow ở tầng API): bằng chứng bất biến của một lần cấp. */
export interface IssuedView {
  id: string;
  badgeId: string;
  userId: string;
  uniqueHash: string;
  dateIssued: string;
  dateExpire: string | null;
  revoked: boolean;
}

/**
 * Một dòng của GET /badges/mine: bản ghi đã cấp kèm chính huy hiệu lồng bên trong (badges.service listMyBadges trả `IssuedRow & { badge }`).
 */
export interface MyBadgeView extends IssuedView {
  badge?: BadgeView;
}
