import { z } from 'zod';
import {
  assignRoleSchema,
  capabilityMatrixQuerySchema,
  createContextSchema,
  createRoleSchema,
  hasCapabilityQuerySchema,
  listAssignmentsQuerySchema,
  listUsersWithAssignmentsQuerySchema,
  overrideCapabilitySchema,
  replaceRoleCapabilitiesSchema,
  updateRoleSchema,
  type AssignRole,
  type CapabilityMatrixQuery,
  type CreateContext,
  type CreateRole,
  type ListAssignmentsQuery,
  type ListUsersWithAssignmentsQuery,
  type OverrideCapability,
  type ReplaceRoleCapabilities,
  type UpdateRole,
  uuidIdSchema,
} from '@giaokhoa/contracts';

export { assignRoleSchema, capabilityMatrixQuerySchema, createContextSchema, createRoleSchema, overrideCapabilitySchema, replaceRoleCapabilitiesSchema, updateRoleSchema };
export type CreateContextDto = CreateContext;
export type CreateRoleDto = CreateRole;
export type UpdateRoleDto = UpdateRole;
export type AssignRoleDto = AssignRole;
export type OverrideCapabilityDto = OverrideCapability;
export type ReplaceRoleCapabilitiesDto = ReplaceRoleCapabilities;
export type CapabilityMatrixQueryDto = CapabilityMatrixQuery;

export const listAssignmentsQueryServerSchema = listAssignmentsQuerySchema.extend({
  search: z.string().trim().transform((value) => (value === '' ? undefined : value)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListAssignmentsQueryDto = z.infer<typeof listAssignmentsQueryServerSchema>;
export type ListAssignmentsFilter = Pick<ListAssignmentsQuery, 'userId' | 'contextId' | 'roleId' | 'search'>;

export const listUsersWithAssignmentsQueryServerSchema = listUsersWithAssignmentsQuerySchema.extend({
  search: z.string().trim().transform((value) => (value === '' ? undefined : value)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListUsersWithAssignmentsQueryDto = z.infer<typeof listUsersWithAssignmentsQueryServerSchema>;
export type ListUsersWithAssignmentsFilter = Pick<ListUsersWithAssignmentsQuery, 'search' | 'roleId' | 'status'>;

export const hasCapabilityQueryServerSchema = hasCapabilityQuerySchema.extend({
  userId: uuidIdSchema,
  contextId: uuidIdSchema,
});
export type HasCapabilityQueryDto = z.infer<typeof hasCapabilityQueryServerSchema>;
