import {
  dashboardOverviewQuerySchema,
  upsertCourseCardPrefSchema,
  type DashboardOverviewQuery,
  type UpsertCourseCardPref,
} from '@giaokhoa/contracts';

/**
 * Validation của Dashboard dùng Zod qua Standard Schema — schema nền ở `@giaokhoa/contracts` là nguồn sự thật duy nhất (tiền lệ guardians.dto).
 */
export { dashboardOverviewQuerySchema, upsertCourseCardPrefSchema };
export type DashboardOverviewQueryDto = DashboardOverviewQuery;
export type UpsertCourseCardPrefDto = UpsertCourseCardPref;
