import { z } from 'zod';
import { uuidIdSchema } from './ids.js';

export const TENANT_KINDS = ['school', 'center', 'platform'] as const;
export const TENANT_STATUSES = ['active', 'suspended', 'archived'] as const;
export const TENANT_MEMBER_STATUSES = ['active', 'suspended', 'ended'] as const;

const tenantIdentityFields = {
  id: uuidIdSchema,
  slug: z.string(),
  name: z.string(),
  kind: z.enum(TENANT_KINDS),
};

export const tenantSchema = z.object({
  ...tenantIdentityFields,
  status: z.enum(TENANT_STATUSES),
  plan: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Tenant = z.infer<typeof tenantSchema>;

export const createTenantSchema = z.strictObject({
  slug: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  kind: z.enum(['school', 'center']),
  plan: z.string().max(80).optional(),
});
export type CreateTenant = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(TENANT_STATUSES).optional(),
  plan: z.string().max(80).nullable().optional(),
});
export type UpdateTenant = z.infer<typeof updateTenantSchema>;

export const tenantMembershipSchema = z.object({
  id: uuidIdSchema,
  tenantId: uuidIdSchema,
  userId: uuidIdSchema,
  status: z.enum(TENANT_MEMBER_STATUSES),
  joinedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type TenantMembership = z.infer<typeof tenantMembershipSchema>;

export const addTenantMemberSchema = z.strictObject({
  userId: uuidIdSchema,
});
export type AddTenantMember = z.infer<typeof addTenantMemberSchema>;

export const updateTenantMemberSchema = z.strictObject({
  status: z.enum(TENANT_MEMBER_STATUSES),
});
export type UpdateTenantMember = z.infer<typeof updateTenantMemberSchema>;

export const myTenantSchema = z.object({
  ...tenantIdentityFields,
  active: z.boolean(),
});
export type MyTenant = z.infer<typeof myTenantSchema>;
