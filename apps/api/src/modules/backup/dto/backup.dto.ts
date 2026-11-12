import {
  createBackupSchema,
  restoreCourseSchema,
  type CreateBackup,
  type RestoreCourse,
} from '@giaokhoa/contracts';

/** Validation Backup/Restore dùng Zod qua Standard Schema — schema nền ở `@giaokhoa/contracts`. */
export { createBackupSchema, restoreCourseSchema };
export type CreateBackupDto = CreateBackup;
export type RestoreDto = RestoreCourse;
