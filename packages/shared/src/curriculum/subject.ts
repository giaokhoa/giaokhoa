import { z } from 'zod';

const nonEmptyTextSchema = z.string().trim().min(1);
const positionSchema = z.int().positive().max(2_147_483_647);

export const subjectCreateSchema = z.strictObject({
  name: nonEmptyTextSchema,
  slug: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  position: positionSchema.optional(),
});

export const subjectPatchSchema = subjectCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Không có dữ liệu để cập nhật');

export const subjectSchema = subjectCreateSchema.safeExtend({ id: z.uuidv7() }).required();

export type SubjectCreate = z.infer<typeof subjectCreateSchema>;
export type SubjectPatch = z.infer<typeof subjectPatchSchema>;
export type Subject = z.infer<typeof subjectSchema>;
