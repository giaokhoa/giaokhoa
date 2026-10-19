import { z } from 'zod';

export const gradeSchema = z.int().min(1).max(12);

export const curriculumCreateSchema = z.strictObject({
  subjectId: z.uuidv7(),
  grade: gradeSchema,
});

export const curriculumPatchSchema = curriculumCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Không có dữ liệu để cập nhật');

export const curriculumSchema = curriculumCreateSchema.extend({
  id: z.uuidv7(),
});

export type CurriculumCreate = z.infer<typeof curriculumCreateSchema>;
export type CurriculumPatch = z.infer<typeof curriculumPatchSchema>;
export type Curriculum = z.infer<typeof curriculumSchema>;
