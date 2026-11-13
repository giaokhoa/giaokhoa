import { z } from 'zod';
import { uploadFileMetaSchema, type UploadFileMeta, uuidIdSchema } from '@giaokhoa/contracts';

export { uploadFileMetaSchema };
export type UploadMetaBaseDto = UploadFileMeta;

export const uploadMetaServerSchema = uploadFileMetaSchema.extend({
  contextId: uuidIdSchema,
  itemId: uuidIdSchema.optional(),
});
export type UploadMetaDto = z.infer<typeof uploadMetaServerSchema>;

export const QUESTION_FILE_AREAS = ['questiontext', 'generalfeedback', 'answer', 'feedback', 'stimulus', 'guidance'] as const;
export type QuestionFileArea = (typeof QUESTION_FILE_AREAS)[number];

export const questionImageMetaServerSchema = z.strictObject({
  contextId: uuidIdSchema,
  fileArea: z.enum(QUESTION_FILE_AREAS),
  itemId: uuidIdSchema.optional(),
});
export type QuestionImageMetaDto = z.infer<typeof questionImageMetaServerSchema>;
