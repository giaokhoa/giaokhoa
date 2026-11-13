/**
 * Hợp đồng quyền hỗ trợ trung tâm: người nhận là nhân sự platform có phiên
 * vận hành riêng, phạm vi là tập thao tác đóng, thời hạn hữu hạn.
 * API quản trị trung tâm cấp/thu hồi; API hỗ trợ chỉ đọc đúng phạm vi,
 * không phát phiên mượn danh hoặc quyền nghiệp vụ rộng hơn grant.
 */
import { z } from "zod";
import { uuidIdSchema } from "./ids.js";

/** Các thao tác hỗ trợ chỉ-đọc được xét tường minh tại API vận hành. */
export const SUPPORT_SCOPES = ["classes:read", "courses:read"] as const;
export const supportScopeSchema = z.enum(SUPPORT_SCOPES);
export type SupportScope = z.infer<typeof supportScopeSchema>;

/**
 * Yêu cầu cấp quyền: thời hạn phải nằm trong tương lai và tối đa 30 ngày
 * (service kiểm tại thời điểm ghi); không nhận wildcard hay danh sách rỗng.
 */
export const createSupportGrantSchema = z.strictObject({
  recipientId: uuidIdSchema,
  scopes: z
    .array(supportScopeSchema)
    .min(1)
    .max(SUPPORT_SCOPES.length)
    .refine(
      (scopes) => new Set(scopes).size === scopes.length,
      "Các scope hỗ trợ phải khác nhau",
    ),
  expiresAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1).max(500),
});
export type CreateSupportGrant = z.infer<typeof createSupportGrantSchema>;

/** Trạng thái tính lại từ thời gian máy chủ và mốc thu hồi, không ghi vào phiên. */
export const supportGrantSchema = z.object({
  id: uuidIdSchema,
  tenantId: uuidIdSchema,
  recipientId: uuidIdSchema,
  createdBy: uuidIdSchema,
  scopes: z.array(supportScopeSchema),
  reason: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedBy: uuidIdSchema.nullable(),
  createdAt: z.string(),
  status: z.enum(["active", "expired", "revoked"]),
});
export type SupportGrant = z.infer<typeof supportGrantSchema>;

/** Audit chỉ mang định danh và quyết định, không chứa nội dung hồ sơ. */
export const supportAuditEntrySchema = z.object({
  id: uuidIdSchema,
  tenantId: uuidIdSchema,
  grantId: uuidIdSchema.nullable(),
  actorId: uuidIdSchema,
  action: z.enum([
    "grant_created",
    "grant_revoked",
    "access_allowed",
    "access_denied",
  ]),
  scope: supportScopeSchema.nullable(),
  createdAt: z.string(),
});
export type SupportAuditEntry = z.infer<typeof supportAuditEntrySchema>;
