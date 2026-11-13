import { z } from "zod";
import { uuidIdSchema } from "./ids.js";

export const SUPPORT_SCOPES = ["classes:read", "courses:read"] as const;
export const supportScopeSchema = z.enum(SUPPORT_SCOPES);
export type SupportScope = z.infer<typeof supportScopeSchema>;

export const createSupportGrantSchema = z.strictObject({
  recipientId: uuidIdSchema,
  scopes: z
    .array(supportScopeSchema)
    .min(1)
    .max(SUPPORT_SCOPES.length)
    .refine(
      (scopes) => new Set(scopes).size === scopes.length,
      "Support scopes must be distinct",
    ),
  expiresAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1).max(500),
});
export type CreateSupportGrant = z.infer<typeof createSupportGrantSchema>;

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
