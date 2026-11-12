import {
  importBookDatasetSchema,
  type ImportBookDataset,
} from '@giaokhoa/contracts';

/**
 * Validation của Books dùng Zod qua Standard Schema — schema nền ở
 * `@giaokhoa/contracts` là nguồn sự thật duy nhất.
 */
export {
  importBookDatasetSchema,
};
export type ImportBookDatasetDto = ImportBookDataset;
