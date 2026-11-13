
export interface BadgeView {
  id: string;
  name: string;
  description: string;
  type: number;
  courseId: string | null;
  status: number;
}

export interface IssuedView {
  id: string;
  badgeId: string;
  userId: string;
  uniqueHash: string;
  dateIssued: string;
  dateExpire: string | null;
  revoked: boolean;
}

export interface MyBadgeView extends IssuedView {
  badge?: BadgeView;
}
