import {
  createBackupSchema,
  restoreCourseSchema,
  type CreateBackup,
  type RestoreCourse,
} from '@giaokhoa/contracts';

export { createBackupSchema, restoreCourseSchema };
export type CreateBackupDto = CreateBackup;
export type RestoreDto = RestoreCourse;
