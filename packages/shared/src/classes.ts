import { z } from 'zod';

export const classJoinModeSchema = z.enum(['AUTO', 'APPROVAL']);
export const classStatusSchema = z.enum(['active', 'archived']);
export const classEnrolmentStatusSchema = z.enum(['pending', 'active', 'suspended', 'left']);

export const classSchema = z.strictObject({
  id: z.uuidv7(),
  name: z.string(),
  createdByUserId: z.uuidv7(),
  status: classStatusSchema,
  joinMode: classJoinModeSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const classCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  joinMode: classJoinModeSchema,
});

export const classPatchSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    joinMode: classJoinModeSchema.optional(),
    status: classStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Không có dữ liệu để cập nhật');

export const classEnrolmentSchema = z.strictObject({
  userId: z.uuidv7(),
  status: classEnrolmentStatusSchema,
  joinedAt: z.date(),
  updatedAt: z.date(),
});

export const classJoinResultSchema = z.strictObject({
  classId: z.uuidv7(),
  status: classEnrolmentStatusSchema,
});

export const classJoinCodeCreateSchema = z.strictObject({
  expiresInHours: z.number().int().min(1).max(720).default(24),
  maxUses: z.number().int().positive().optional(),
});

export const classJoinCodeSchema = z.strictObject({
  id: z.uuidv7(),
  code: z.string(),
  expiresAt: z.date(),
});

export type Class = z.infer<typeof classSchema>;
export type ClassCreate = z.infer<typeof classCreateSchema>;
export type ClassPatch = z.infer<typeof classPatchSchema>;
export type ClassEnrolment = z.infer<typeof classEnrolmentSchema>;
export type ClassJoinResult = z.infer<typeof classJoinResultSchema>;
export type ClassJoinCodeCreate = z.infer<typeof classJoinCodeCreateSchema>;
