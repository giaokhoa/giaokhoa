import { z } from 'zod';
import { uuidIdSchema } from './ids.js';

export const reasonInputSchema = z.strictObject({
  reason: z.string().min(1),
});
export type ReasonInput = z.infer<typeof reasonInputSchema>;

export const trimmedReasonInputSchema = z.strictObject({
  reason: z.string().trim().min(1),
});
export type TrimmedReasonInput = z.infer<typeof trimmedReasonInputSchema>;

export const limitedReasonInputSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});
export type LimitedReasonInput = z.infer<typeof limitedReasonInputSchema>;

export const datasetImportSchema = z.strictObject({
  datasetKey: z.string().min(1),
});
export type DatasetImport = z.infer<typeof datasetImportSchema>;

export const courseSectionItemOutcomeSchema = z.object({
  outcomeId: uuidIdSchema.nullable(),
  content: z.string(),
});
export type CourseSectionItemOutcome = z.infer<typeof courseSectionItemOutcomeSchema>;

export const namedEntityInputFields = {
  name: z.string().min(1),
  idNumber: z.string().optional(),
  description: z.string().optional(),
};

export const datasetStatusFields = {
  datasetKey: z.string(),
  subjectName: z.string(),
  slug: z.string(),
};

export const datasetImportCountFields = {
  subjectId: uuidIdSchema,
  totalRecords: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
};
