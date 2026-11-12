import {
  createReportSchema,
  createReportScheduleSchema,
  type CreateReport,
  type CreateReportSchedule,
} from '@giaokhoa/contracts';

/** Validation Report Builder dùng Zod qua Standard Schema — schema nền ở `@giaokhoa/contracts`. */
export { createReportSchema, createReportScheduleSchema };
export type CreateReportDto = CreateReport;
export type CreateScheduleDto = CreateReportSchedule;
