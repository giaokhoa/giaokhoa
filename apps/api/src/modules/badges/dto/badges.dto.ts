import {
  badgeUserSchema,
  createBadgeSchema,
  setBadgeCriteriaSchema,
  setBadgeStatusSchema,
  updateBadgeSchema,
  type BadgeUser,
  type CreateBadge,
  type SetBadgeCriteria,
  type SetBadgeStatus,
  type UpdateBadge,
} from '@giaokhoa/contracts';

export { badgeUserSchema, createBadgeSchema, setBadgeCriteriaSchema, setBadgeStatusSchema, updateBadgeSchema };
export type CreateBadgeDto = CreateBadge;
export type UpdateBadgeDto = UpdateBadge;
export type SetStatusDto = SetBadgeStatus;
export type SetCriteriaDto = SetBadgeCriteria;
export type ManualAwardDto = BadgeUser;
export type EvaluateDto = BadgeUser;
