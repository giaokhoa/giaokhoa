import { z } from 'zod';

const nonEmptyTextSchema = z.string().trim().min(1);
const positionSchema = z.int().positive().max(2_147_483_647);

export const curriculumNodeCreateSchema = z.strictObject({
  curriculumId: z.uuidv7(),
  parentId: z.uuidv7().nullable().optional(),
  title: nonEmptyTextSchema,
  position: positionSchema.optional(),
});

export const curriculumNodePatchSchema = z
  .strictObject({
    parentId: z.uuidv7().nullable().optional(),
    title: nonEmptyTextSchema.optional(),
    position: positionSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Không có dữ liệu để cập nhật');

export const curriculumNodeSchema = curriculumNodeCreateSchema
  .safeExtend({ id: z.uuidv7() })
  .required();

export type CurriculumNodeCreate = z.infer<typeof curriculumNodeCreateSchema>;
export type CurriculumNodePatch = z.infer<typeof curriculumNodePatchSchema>;
export type CurriculumNode = z.infer<typeof curriculumNodeSchema>;
