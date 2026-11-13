import { z } from 'zod';
import { matrixImportIssueSchema } from './assessment.js';

export const problemDetailsSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().min(1),
  errors: z
    .array(z.object({ field: z.string().optional(), message: z.string() }))
    .optional(),
  blockedStudents: z
    .array(
      z.object({
        userId: z.string().min(1),
        reason: z.enum(['awaiting_makeup', 'incomplete']),
        roles: z.array(z.string()),
      }),
    )
    .optional(),
  matrixImportIssues: z.array(matrixImportIssueSchema).optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
