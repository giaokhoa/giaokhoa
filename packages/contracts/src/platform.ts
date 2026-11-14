import { z } from 'zod';
import { limitedReasonInputSchema } from './common.js';
import { uuidIdSchema } from './ids.js';


export const searchDocumentSchema = z.object({
  id: uuidIdSchema,
  area: z.enum(['courses', 'users', 'contentbank']),
  itemId: uuidIdSchema,
  contextId: uuidIdSchema,
  title: z.string(),
  content: z.string(),
});
export type SearchDocument = z.infer<typeof searchDocumentSchema>;

export const externalServiceSchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  shortName: z.string(),
  enabled: z.boolean(),
  functions: z.array(z.string()),
});
export type ExternalService = z.infer<typeof externalServiceSchema>;

export const externalTokenCreatedSchema = z.object({
  token: z.string().length(64),
  id: uuidIdSchema,
  userId: uuidIdSchema,
  serviceId: uuidIdSchema,
});
export type ExternalTokenCreated = z.infer<typeof externalTokenCreatedSchema>;

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_SCOPES = ['course', 'site'] as const;
export const backupJobSchema = z.object({
  id: uuidIdSchema,
  type: z.enum(['backup', 'restore']),
  scope: z.enum(BACKUP_SCOPES),
  courseId: uuidIdSchema.nullable(),
  targetCourseId: uuidIdSchema.nullable(),
  mode: z.enum(['new', 'merge', 'replace']),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  anonymize: z.boolean(),
});
export type BackupJob = z.infer<typeof backupJobSchema>;

export const backupIdMappingSchema = z.object({
  id: uuidIdSchema,
  jobId: uuidIdSchema,
  itemType: z.string(),
  oldId: uuidIdSchema,
  newId: uuidIdSchema,
}).refine((m) => m.newId !== m.oldId, { message: 'restore must remap ids, never keep the original id' });
export type BackupIdMapping = z.infer<typeof backupIdMappingSchema>;

export const insightSchema = z.object({
  id: uuidIdSchema,
  modelId: uuidIdSchema,
  userId: uuidIdSchema,
  recipientId: uuidIdSchema,
  contextId: uuidIdSchema,
  courseId: uuidIdSchema,
  heading: z.string(),
});
export type Insight = z.infer<typeof insightSchema>;

export const REPORT_DATASOURCES = ['enrolments', 'grades', 'completion'] as const;
export const reportSchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  dataSource: z.enum(REPORT_DATASOURCES),
  columns: z.array(z.string()),
  createdBy: uuidIdSchema,
});
export type Report = z.infer<typeof reportSchema>;

export const contentBankResourceTypeSchema = z.enum(['multimedia_lecture', 'lab_guide', 'simulation', 'question_set', 'reference']);
export type ContentBankResourceType = z.infer<typeof contentBankResourceTypeSchema>;
export const contentBankScopeSchema = z.enum(['personal', 'org', 'school']);
export type ContentBankScope = z.infer<typeof contentBankScopeSchema>;
export const contentBankReviewStatusSchema = z.enum(['draft', 'pending', 'approved', 'rejected']);
export type ContentBankReviewStatus = z.infer<typeof contentBankReviewStatusSchema>;
export const contentBankLevelSchema = z.enum(['primary', 'lower_secondary', 'upper_secondary', 'multi']);
export type ContentBankLevel = z.infer<typeof contentBankLevelSchema>;
export const contentBankSourceKindSchema = z.enum(['self', 'cited', 'derived']);
export type ContentBankSourceKind = z.infer<typeof contentBankSourceKindSchema>;
export const contentBankTargetAudienceSchema = z.enum(['students', 'teachers', 'both']);
export type ContentBankTargetAudience = z.infer<typeof contentBankTargetAudienceSchema>;
export const contentBankLessonPositionSchema = z.enum(['opening', 'new_knowledge', 'practice', 'application']);
export type ContentBankLessonPosition = z.infer<typeof contentBankLessonPositionSchema>;
export const contentBankReviewChecklistSchema = z.object({
  contentAccurate: z.boolean(),
  sourceClear: z.boolean(),
  pedagogyAesthetics: z.boolean(),
  mobileReady: z.boolean(),
});
export type ContentBankReviewChecklist = z.infer<typeof contentBankReviewChecklistSchema>;

export const contentBankContentSchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  contentType: z.string(),
  contextId: uuidIdSchema,
  creatorId: uuidIdSchema,
  visibility: z.enum(['draft', 'public']),
  fileId: uuidIdSchema.nullable(),
  resourceType: contentBankResourceTypeSchema,
  scope: contentBankScopeSchema,
  spaceId: uuidIdSchema.nullable(),
  subjectId: uuidIdSchema.nullable(),
  grade: z.number().int().min(1).max(12).nullable(),
  level: contentBankLevelSchema.nullable(),
  curriculumNodeId: uuidIdSchema.nullable(),
  outcomeIds: z.array(uuidIdSchema).nullable(),
  questionCategoryId: uuidIdSchema.nullable(),
  externalUrl: z.string().nullable(),
  description: z.string().nullable(),
  keywords: z.array(z.string()).nullable(),
  targetAudience: contentBankTargetAudienceSchema.nullable(),
  lessonPosition: contentBankLessonPositionSchema.nullable(),
  techFormat: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  language: z.string(),
  originalAuthor: z.string().nullable(),
  sourceKind: contentBankSourceKindSchema.nullable(),
  sourceCitation: z.string().nullable(),
  license: z.string().nullable(),
  derivedFromId: uuidIdSchema.nullable(),
  reviewStatus: contentBankReviewStatusSchema,
  reviewedBy: uuidIdSchema.nullable(),
  reviewNote: z.string().nullable(),
  reviewChecklist: contentBankReviewChecklistSchema.nullable(),
});
export type ContentBankContent = z.infer<typeof contentBankContentSchema>;

export const contentBankSpaceSchema = z.object({
  scope: contentBankScopeSchema,
  spaceId: uuidIdSchema.nullable(),
  name: z.string(),
  canReview: z.boolean(),
});
export type ContentBankSpace = z.infer<typeof contentBankSpaceSchema>;

export const paymentSchema = z.object({
  id: uuidIdSchema,
  accountId: uuidIdSchema,
  userId: uuidIdSchema,
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  status: z.enum(['pending', 'succeeded', 'failed', 'refunded', 'needs_review']),
  gateway: z.string(),
});
export type Payment = z.infer<typeof paymentSchema>;

export const privacyRequestSchema = z.object({
  id: uuidIdSchema,
  userId: uuidIdSchema,
  type: z.enum(['export', 'delete']),
  status: z.enum(['pending', 'approved', 'rejected', 'completed', 'failed']),
});
export type PrivacyRequest = z.infer<typeof privacyRequestSchema>;


export const searchIndexItemSchema = z.strictObject({
  area: z.string().min(1),
  itemId: uuidIdSchema,
});
export type SearchIndexItem = z.infer<typeof searchIndexItemSchema>;

export const createExternalServiceSchema = z.strictObject({
  name: z.string().min(1),
  shortName: z.string().min(1),
  enabled: z.boolean().optional(),
  functions: z.array(z.string()).optional(),
});
export type CreateExternalService = z.infer<typeof createExternalServiceSchema>;

export const setExternalServiceEnabledSchema = z.strictObject({ enabled: z.boolean() });
export type SetExternalServiceEnabled = z.infer<typeof setExternalServiceEnabledSchema>;

export const createExternalTokenSchema = z.strictObject({
  userId: uuidIdSchema,
  serviceId: uuidIdSchema,
  validUntil: z.string().optional(),
  ipRestriction: z.string().optional(),
});
export type CreateExternalToken = z.infer<typeof createExternalTokenSchema>;

export const callExternalFunctionSchema = z.strictObject({
  token: z.string().min(1),
  functionName: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});
export type CallExternalFunction = z.infer<typeof callExternalFunctionSchema>;

export const createBackupSchema = z.strictObject({
  courseId: uuidIdSchema.optional(),
  scope: z.enum(BACKUP_SCOPES).optional(),
  anonymize: z.boolean().optional(),
}).superRefine((v, ctx) => {
  const scope = v.scope ?? 'course';
  if (scope === 'course' && !v.courseId) {
    ctx.addIssue({ code: 'custom', path: ['courseId'], message: 'A course backup requires courseId' });
  }
  if (scope === 'site' && v.courseId) {
    ctx.addIssue({ code: 'custom', path: ['courseId'], message: 'A site backup must not carry a courseId' });
  }
});
export type CreateBackup = z.infer<typeof createBackupSchema>;

export const restoreCourseSchema = z.strictObject({
  backupJobId: uuidIdSchema,
  mode: z.enum(['new', 'merge', 'replace']),
  targetCourseId: uuidIdSchema.optional(),
});
export type RestoreCourse = z.infer<typeof restoreCourseSchema>;

export const runAnalyticsModelSchema = z.strictObject({ courseId: uuidIdSchema });
export type RunAnalyticsModel = z.infer<typeof runAnalyticsModelSchema>;

export const createReportSchema = z.strictObject({
  name: z.string().min(1),
  dataSource: z.enum(['enrolments', 'grades', 'completion']),
  columns: z.array(z.string()).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  audienceUserIds: z.array(uuidIdSchema).optional(),
  audienceRoles: z.array(z.string()).optional(),
});
export type CreateReport = z.infer<typeof createReportSchema>;

export const createReportScheduleSchema = z.strictObject({ cron: z.string().optional() });
export type CreateReportSchedule = z.infer<typeof createReportScheduleSchema>;


export const listEventLogsQuerySchema = z.strictObject({
  userId: uuidIdSchema.optional(),
  relatedUserId: uuidIdSchema.optional(),
  courseId: uuidIdSchema.optional(),
  contextId: uuidIdSchema.optional(),
  component: z.string().min(1).optional(),
  eventType: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
});
export type ListEventLogsQuery = z.infer<typeof listEventLogsQuerySchema>;

export const createContentBankContentSchema = z.strictObject({
  name: z.string().min(1),
  contextId: uuidIdSchema.optional(),
  contentType: z.string().optional(),
  visibility: z.enum(['draft', 'public']).optional(),
  fileId: uuidIdSchema.optional(),
  resourceType: contentBankResourceTypeSchema.optional(),
  scope: contentBankScopeSchema.optional(),
  spaceId: uuidIdSchema.optional(),
  subjectId: uuidIdSchema.optional(),
  grade: z.number().int().min(1).max(12).optional(),
  level: contentBankLevelSchema.optional(),
  curriculumNodeId: uuidIdSchema.optional(),
  outcomeIds: z.array(uuidIdSchema).optional(),
  questionCategoryId: uuidIdSchema.optional(),
  externalUrl: z.url().optional(),
  description: z.string().max(5000).optional(),
  keywords: z.array(z.string().min(1).max(100)).max(20).optional(),
  targetAudience: contentBankTargetAudienceSchema.optional(),
  lessonPosition: contentBankLessonPositionSchema.optional(),
  techFormat: z.string().max(50).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  language: z.string().max(10).optional(),
  originalAuthor: z.string().max(300).optional(),
  sourceKind: contentBankSourceKindSchema.optional(),
  sourceCitation: z.string().max(2000).optional(),
  license: z.string().max(300).optional(),
  derivedFromId: uuidIdSchema.optional(),
});
export type CreateContentBankContent = z.infer<typeof createContentBankContentSchema>;

export const updateContentBankContentSchema = createContentBankContentSchema
  .omit({ contextId: true })
  .partial()
  .extend({ fileId: uuidIdSchema.optional() });
export type UpdateContentBankContent = z.infer<typeof updateContentBankContentSchema>;

export const reviewContentBankContentSchema = z.strictObject({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(1000).optional(),
  checklist: contentBankReviewChecklistSchema.optional(),
});
export type ReviewContentBankContent = z.infer<typeof reviewContentBankContentSchema>;

export const insertContentBankContentSchema = z.strictObject({
  courseId: uuidIdSchema,
  sectionId: uuidIdSchema,
});
export type InsertContentBankContent = z.infer<typeof insertContentBankContentSchema>;

export const uploadContentBankFileSchema = z.strictObject({
  fileName: z.string().min(1),
  contentBase64: z.string(),
  mimeType: z.string().optional(),
});
export type UploadContentBankFile = z.infer<typeof uploadContentBankFileSchema>;

export const createPaymentAccountSchema = z.strictObject({
  name: z.string().min(1),
  gateway: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type CreatePaymentAccount = z.infer<typeof createPaymentAccountSchema>;

export const createPaymentSchema = z.strictObject({
  accountId: uuidIdSchema,
  amount: z.number().int().min(1),
  currency: z.string().min(3),
  component: z.string().optional(),
  itemId: uuidIdSchema.optional(),
});
export type CreatePayment = z.infer<typeof createPaymentSchema>;

export const paymentWebhookSchema = z.strictObject({
  gateway: z.string().min(1),
  externalTransactionId: z.string().min(1),
  paymentId: uuidIdSchema,
  status: z.string().min(1),
});
export type PaymentWebhook = z.infer<typeof paymentWebhookSchema>;

export const paymentRefundStatusSchema = z.enum(['requested', 'approved', 'settled', 'rejected']);
export type PaymentRefundStatus = z.infer<typeof paymentRefundStatusSchema>;

export const createRefundSchema = z.strictObject({
  amount: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500),
  externalTransactionId: z.string().trim().min(1).max(128).optional(),
});
export type CreateRefund = z.infer<typeof createRefundSchema>;

export const rejectRefundSchema = limitedReasonInputSchema;
export type RejectRefund = z.infer<typeof rejectRefundSchema>;

export const settleRefundSchema = z.strictObject({
  externalTransactionId: z.string().trim().min(1).max(128).optional(),
});
export type SettleRefund = z.infer<typeof settleRefundSchema>;

export const paymentRefundSchema = z.object({
  id: uuidIdSchema,
  paymentId: uuidIdSchema,
  amount: z.number().int(),
  currency: z.string(),
  reason: z.string(),
  externalTransactionId: z.string().nullable(),
  status: paymentRefundStatusSchema,
  createdBy: uuidIdSchema.nullable(),
  approvalLevel: z.number().int().nullable(),
  approvalThreshold: z.number().int().nullable(),
  approvedBy: uuidIdSchema.nullable(),
  approvedAt: z.string().nullable(),
  rejectedBy: uuidIdSchema.nullable(),
  rejectedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  settledBy: uuidIdSchema.nullable(),
  settledEventId: uuidIdSchema.nullable(),
  settledAt: z.string().nullable(),
  entitlementReversed: z.boolean().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PaymentRefund = z.infer<typeof paymentRefundSchema>;

export const paymentReviewDecisionSchema = z.enum(['matched', 'rejected']);
export type PaymentReviewDecision = z.infer<typeof paymentReviewDecisionSchema>;

export const resolvePaymentReviewSchema = z.strictObject({
  decision: paymentReviewDecisionSchema,
  reason: z.string().trim().min(1).max(500),
});
export type ResolvePaymentReview = z.infer<typeof resolvePaymentReviewSchema>;

export const paymentReviewMismatchSchema = z.enum([
  'amount_mismatch', 'account_mismatch', 'expired', 'unknown_code', 'unmatched_debit',
]);
export type PaymentReviewMismatch = z.infer<typeof paymentReviewMismatchSchema>;

export const paymentReviewQueueItemSchema = z.object({
  kind: z.enum(['payment', 'event']),
  tenantId: uuidIdSchema,
  payment: z.object({
    id: uuidIdSchema,
    paymentCode: z.string().nullable(),
    amount: z.number().int(),
    currency: z.string(),
    component: z.string(),
    userId: uuidIdSchema,
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
  }).nullable(),
  event: z.object({
    id: uuidIdSchema,
    externalTransactionId: z.string(),
    direction: z.enum(['credit', 'debit']),
    amount: z.number().int(),
    extractedCode: z.string().nullable(),
    receivedAt: z.string(),
  }).nullable(),
  mismatches: z.array(paymentReviewMismatchSchema),
  ageHours: z.number(),
  overdue: z.boolean(),
});
export type PaymentReviewQueueItem = z.infer<typeof paymentReviewQueueItemSchema>;

export const planComponentSchema = z.enum(['tenant_plan', 'teacher_plan']);
export type PlanComponent = z.infer<typeof planComponentSchema>;

export const purchasePlanSchema = z.strictObject({
  component: planComponentSchema,
  couponCode: z.string().trim().min(1).max(64).optional(),
});
export type PurchasePlan = z.infer<typeof purchasePlanSchema>;

export const couponDiscountTypeSchema = z.enum(['percent', 'fixed']);
export type CouponDiscountType = z.infer<typeof couponDiscountTypeSchema>;

export const couponAppliesToSchema = z.enum(['tenant_plan', 'teacher_plan', 'all']);
export type CouponAppliesTo = z.infer<typeof couponAppliesToSchema>;

const couponValidityFields = {
  startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
};

export const createCouponSchema = z.strictObject({
  code: z.string().trim().min(1).max(64),
  discountType: couponDiscountTypeSchema,
  discountValue: z.number().int().min(1).max(99_999_999),
  appliesTo: couponAppliesToSchema.default('all'),
  ...couponValidityFields,
  isActive: z.boolean().default(true),
}).superRefine((input, ctx) => {
  if (input.discountType === 'percent' && input.discountValue > 99) {
    ctx.addIssue({
      code: 'custom',
      path: ['discountValue'],
      message: 'Percent discount value must be between 1 and 99',
    });
  }
  if (input.startsAt && input.endsAt && new Date(input.startsAt).getTime() >= new Date(input.endsAt).getTime()) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Coupon endsAt must be after startsAt',
    });
  }
});
export type CreateCoupon = z.infer<typeof createCouponSchema>;

export const updateCouponSchema = z.strictObject({
  discountType: couponDiscountTypeSchema.optional(),
  discountValue: z.number().int().min(1).max(99_999_999).optional(),
  appliesTo: couponAppliesToSchema.optional(),
  ...couponValidityFields,
  isActive: z.boolean().optional(),
});
export type UpdateCoupon = z.infer<typeof updateCouponSchema>;

export const couponSchema = z.object({
  id: uuidIdSchema,
  code: z.string(),
  discountType: couponDiscountTypeSchema,
  discountValue: z.number().int(),
  appliesTo: couponAppliesToSchema,
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  maxRedemptions: z.number().int().nullable(),
  isActive: z.boolean(),
  createdBy: uuidIdSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Coupon = z.infer<typeof couponSchema>;

export const planEntitlementSchema = z.object({
  id: uuidIdSchema,
  tenantId: uuidIdSchema,
  userId: uuidIdSchema.nullable(),
  component: planComponentSchema,
  paymentId: uuidIdSchema,
  startsAt: z.string(),
  expiresAt: z.string(),
  status: z.enum(['active', 'suspended']),
  createdAt: z.string(),
});
export type PlanEntitlement = z.infer<typeof planEntitlementSchema>;

export const createPrivacyRequestSchema = z.strictObject({
  type: z.enum(['export', 'delete']),
});
export type CreatePrivacyRequest = z.infer<typeof createPrivacyRequestSchema>;

export const decidePrivacyRequestSchema = z.strictObject({
  decision: z.enum(['approved', 'rejected']),
});
export type DecidePrivacyRequest = z.infer<typeof decidePrivacyRequestSchema>;

export const uploadFileMetaSchema = z.strictObject({
  contextId: uuidIdSchema,
  component: z.string(),
  fileArea: z.string(),
  itemId: uuidIdSchema.optional(),
  filePath: z.string().optional(),
});
export type UploadFileMeta = z.infer<typeof uploadFileMetaSchema>;
