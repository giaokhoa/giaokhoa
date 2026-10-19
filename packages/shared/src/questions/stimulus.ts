import { z } from 'zod';
import { nonEmptyRichDocumentSchema } from './content.js';

export const stimulusCreateSchema = z.strictObject({
  content: nonEmptyRichDocumentSchema,
});

export const stimulusPatchSchema = stimulusCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Không có dữ liệu để cập nhật');

export const stimulusSchema = stimulusCreateSchema.extend({
  id: z.uuidv7(),
});

export type StimulusCreate = z.infer<typeof stimulusCreateSchema>;
export type StimulusPatch = z.infer<typeof stimulusPatchSchema>;
export type Stimulus = z.infer<typeof stimulusSchema>;
