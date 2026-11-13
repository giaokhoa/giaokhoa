import { z } from 'zod';

export const setSiteSettingSchema = z.strictObject({
  value: z.unknown(),
});

export type SetSiteSetting = z.infer<typeof setSiteSettingSchema>;

export const siteSettingSchema = z.object({
  component: z.string(),
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'enum']),
  defaultValue: z.unknown(),
  value: z.unknown(),
  source: z.enum(['default', 'database']),
  scope: z.enum(['platform', 'tenant', 'both']),
});

export type SiteSetting = z.infer<typeof siteSettingSchema>;

export const siteSettingAuditEntrySchema = z.object({
  id: z.string(),
  settingKey: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  changedBy: z.string().nullable(),
  tenantId: z.string().nullable(),
  createdAt: z.string(),
});

export type SiteSettingAuditEntry = z.infer<typeof siteSettingAuditEntrySchema>;
