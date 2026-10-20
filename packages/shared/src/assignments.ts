import { z } from 'zod';
import { questionTypeSchema, stimulusSchema } from './questions.js';

const audienceModeSchema = z.enum(['ALL_CLASS', 'SELECTED_USERS']);
const instantSchema = z.iso.datetime();

export const assignmentCreateSchema = z
  .strictObject({
    classId: z.uuidv7(),
    examRevisionId: z.uuidv7(),
    audienceMode: audienceModeSchema,
    selectedUserIds: z.array(z.uuidv7()).max(5000).default([]),
    openAt: instantSchema,
    closeAt: instantSchema,
    maxAttempts: z.number().int().positive().max(100).default(1),
    releaseScoreAt: instantSchema.nullable().default(null),
    releaseFeedbackAt: instantSchema.nullable().default(null),
    releaseSolutionsAt: instantSchema.nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (new Date(value.openAt) >= new Date(value.closeAt))
      ctx.addIssue({ code: 'custom', path: ['closeAt'], message: 'Thời gian đóng phải sau mở' });
    if (value.audienceMode === 'SELECTED_USERS' && !value.selectedUserIds.length)
      ctx.addIssue({ code: 'custom', path: ['selectedUserIds'], message: 'Phải chọn học sinh' });
    if (value.audienceMode === 'ALL_CLASS' && value.selectedUserIds.length)
      ctx.addIssue({
        code: 'custom',
        path: ['selectedUserIds'],
        message: 'Không chọn học sinh ở chế độ cả lớp',
      });
    if (new Set(value.selectedUserIds).size !== value.selectedUserIds.length)
      ctx.addIssue({ code: 'custom', path: ['selectedUserIds'], message: 'Học sinh bị lặp' });
  });

export const assignmentPatchSchema = z
  .strictObject({
    audienceMode: audienceModeSchema.optional(),
    selectedUserIds: z.array(z.uuidv7()).max(5000).optional(),
    openAt: instantSchema.optional(),
    closeAt: instantSchema.optional(),
    maxAttempts: z.number().int().positive().max(100).optional(),
    releaseScoreAt: instantSchema.nullable().optional(),
    releaseFeedbackAt: instantSchema.nullable().optional(),
    releaseSolutionsAt: instantSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Không có dữ liệu cập nhật');

export const assignmentSchema = z.strictObject({
  id: z.uuidv7(),
  classId: z.uuidv7(),
  examRevisionId: z.uuidv7(),
  createdByUserId: z.uuidv7(),
  audienceMode: audienceModeSchema,
  selectedUserIds: z.array(z.uuidv7()),
  status: z.enum(['draft', 'published']),
  openAt: z.date(),
  closeAt: z.date(),
  maxAttempts: z.number().int().positive(),
  releaseScoreAt: z.date().nullable(),
  releaseFeedbackAt: z.date().nullable(),
  releaseSolutionsAt: z.date().nullable(),
  createdAt: z.date(),
  publishedAt: z.date().nullable(),
});

export const assignmentRecipientSchema = z.strictObject({
  userId: z.uuidv7(),
  status: z.enum(['active', 'revoked']),
  source: z.enum(['all_class', 'selected_users']),
  assignedAt: z.date(),
  revokedAt: z.date().nullable(),
});

export const studentAssignmentSchema = z.strictObject({
  assignmentId: z.uuidv7(),
  examRevisionId: z.uuidv7(),
  title: z.string(),
  openAt: z.date(),
  closeAt: z.date(),
  maxAttempts: z.number().int().positive(),
  questions: z.array(
    z.strictObject({
      position: z.number().int().positive(),
      question: z.strictObject({
        id: z.uuidv7(),
        version: z.number().int().positive(),
        type: questionTypeSchema,
        content: z.unknown(),
        stimulusId: z.uuidv7().nullable().optional(),
        stimulus: stimulusSchema.nullable(),
      }),
    }),
  ),
});

export type Assignment = z.infer<typeof assignmentSchema>;
export type AssignmentCreate = z.input<typeof assignmentCreateSchema>;
export type AssignmentPatch = z.infer<typeof assignmentPatchSchema>;
export type AssignmentRecipient = z.infer<typeof assignmentRecipientSchema>;
export type StudentAssignment = z.infer<typeof studentAssignmentSchema>;
