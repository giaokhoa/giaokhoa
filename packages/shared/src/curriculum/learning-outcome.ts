import { z } from 'zod';

const nonEmptyTextSchema = z.string().trim().min(1);
const positionSchema = z.int().positive().max(2_147_483_647);

export const learningOutcomeCreateSchema = z.strictObject({
  nodeId: z.uuidv7(),
  content: nonEmptyTextSchema,
  position: positionSchema.optional(),
});

export const learningOutcomePatchSchema = z
  .strictObject({
    content: nonEmptyTextSchema.optional(),
    position: positionSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Không có dữ liệu để cập nhật');

export const learningOutcomeSchema = learningOutcomeCreateSchema
  .safeExtend({ id: z.uuidv7() })
  .required();

export type LearningOutcomeCreate = z.infer<typeof learningOutcomeCreateSchema>;
export type LearningOutcomePatch = z.infer<typeof learningOutcomePatchSchema>;
export type LearningOutcome = z.infer<typeof learningOutcomeSchema>;
