/**
 * Hợp đồng học liệu công bố: quản trị gửi bản chụp từ kho riêng, hệ thống
 * duyệt, giáo viên chọn phiên bản để dùng trong khoá qua mod_resource.
 * Không chứa câu hỏi, category ngân hàng, dữ liệu khoá hoặc hồ sơ học sinh.
 * API kiểm quyền và checksum; Zod giữ hình dạng dùng chung cho API và web.
 */
import { z } from 'zod';
import { uuidIdSchema } from './ids.js';

/** Tệp thuộc bản công bố có byte độc lập; không mang fileId của trung tâm gửi. */
export const systemMaterialFileSchema = z.strictObject({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
});

/** Chỉ cho phép liên kết web tuyệt đối; liên kết file riêng nội bộ bị API từ chối. */
const materialUrlSchema = z.url({ protocol: /^https?$/ });

/**
 * Bản chụp tự đủ của học liệu hiện hữu (tệp hoặc liên kết), kèm nguồn và
 * giấy phép bắt buộc. Bộ câu hỏi tham chiếu không được công bố qua hợp đồng này.
 */
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

/** Quản trị gửi nội dung hiện tại; server tự chụp metadata, file và tính revision. */
export const submitSystemMaterialSchema = z.strictObject({ contentId: uuidIdSchema });

/** Giáo viên chủ động chọn đúng phiên bản; không có mặc định tự nâng lên bản mới nhất. */
export const useSystemMaterialSchema = z.strictObject({
  materialId: uuidIdSchema,
  version: z.number().int().positive(),
  courseId: uuidIdSchema,
  sectionId: uuidIdSchema,
});
export type UseSystemMaterial = z.infer<typeof useSystemMaterialSchema>;

/** Hàng gửi duyệt và quyết định; package không được phát ra cho học sinh. */
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

/** Metadata khám phá từng phiên bản, đủ để giáo viên chọn bản và xem nguồn. */
export interface SystemMaterialVersion {
  materialId: string;
  version: number;
  checksum: string;
  package: SystemMaterialPackage;
}
