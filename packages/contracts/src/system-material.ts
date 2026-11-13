import { z } from 'zod';
import { uuidIdSchema } from './ids.js';

export const systemMaterialFileSchema = z.strictObject({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
});

const materialUrlSchema = z.url({ protocol: /^https?$/ });

export const systemMaterialPackageSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  resourceType: z.enum(['multimedia_lecture', 'lab_guide', 'simulation', 'question_set', 'reference']),
  description: z.string().nullable(),
  language: z.string().min(1),
  subjectId: uuidIdSchema.nullable(),
  grade: z.number().int().min(1).max(12).nullable(),
  level: z.string().nullable(),
  curriculumNodeId: uuidIdSchema.nullable(),
  outcomeIds: z.array(uuidIdSchema),
  file: systemMaterialFileSchema.nullable(),
  externalUrl: materialUrlSchema.nullable(),
  source: z.strictObject({
    centreSlug: z.string().min(1),
    contentId: uuidIdSchema,
    originalAuthor: z.string().trim().min(1),
    sourceKind: z.enum(['self', 'cited', 'derived']),
    sourceCitation: z.string().nullable(),
    license: z.string().trim().min(1),
  }),
}).refine((pkg) => Boolean(pkg.file) !== Boolean(pkg.externalUrl), 'Exactly one material source is required')
  .refine((pkg) => pkg.source.sourceKind === 'self' || Boolean(pkg.source.sourceCitation?.trim()), 'Source citation is required');
export type SystemMaterialPackage = z.infer<typeof systemMaterialPackageSchema>;

export const submitSystemMaterialSchema = z.strictObject({ contentId: uuidIdSchema });

export const useSystemMaterialSchema = z.strictObject({
  materialId: uuidIdSchema,
  version: z.number().int().positive(),
  courseId: uuidIdSchema,
  sectionId: uuidIdSchema,
});
export type UseSystemMaterial = z.infer<typeof useSystemMaterialSchema>;

export interface SystemMaterialSubmission {
  id: string;
  centreSlug: string;
  sourceContentId: string;
  sourceRevision: string;
  package: SystemMaterialPackage;
  checksum: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  publishedMaterialId: string | null;
  publishedVersion: number | null;
}

export interface SystemMaterialVersion {
  materialId: string;
  version: number;
  checksum: string;
  package: SystemMaterialPackage;
}
