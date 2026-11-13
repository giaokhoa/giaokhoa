import { z } from 'zod';
import { uuidIdSchema } from './ids.js';


export const centreIdentitySchema = z.object({
  tenantId: uuidIdSchema,
  displayName: z.string(),
  logoPath: z.string().nullable(),
  brandColor: z.string().nullable(),
});
export type CentreIdentity = z.infer<typeof centreIdentitySchema>;

export const updateCentreIdentitySchema = z.strictObject({
  displayName: z.string().min(1).max(200).optional(),
  logoPath: z.string().max(500).nullable().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});
export type UpdateCentreIdentity = z.infer<typeof updateCentreIdentitySchema>;

export const activateCentreInviteSchema = z.strictObject({
  slug: z.string().min(1).max(63),
  token: z.string().min(1),
  password: z.string().min(1),
});
export type ActivateCentreInvite = z.infer<typeof activateCentreInviteSchema>;

export const centreInviteActivationSchema = z.object({
  activated: z.literal(true),
  userId: uuidIdSchema,
});
export type CentreInviteActivation = z.infer<typeof centreInviteActivationSchema>;
