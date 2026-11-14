import { z } from 'zod';
import { uuidIdSchema } from './ids.js';


export const tokenPairSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const loginResponseSchema = tokenPairSchema.extend({
  user: z.object({
    id: uuidIdSchema,
    username: z.string().min(1),
    forcePasswordChange: z.boolean(),
  }),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const customFieldValueSchema = z.object({
  shortName: z.string(),
  name: z.string(),
  type: z.string(),
  value: z.string().nullable(),
});
export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;

export const userProfileSchema = z.object({
  id: uuidIdSchema,
  username: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().optional(),
  suspended: z.boolean(),
  deleted: z.boolean(),
  isGuest: z.boolean(),
  forcePasswordChange: z.boolean(),
  lastLogin: z.string().nullable(),
  createdAt: z.string(),
  customFields: z.array(customFieldValueSchema),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const userListResponseSchema = z.object({
  users: z.array(userProfileSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const roleSchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  shortName: z.string(),
  description: z.string(),
  archetype: z.string().nullable(),
});
export type Role = z.infer<typeof roleSchema>;

export const capabilitySchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  capType: z.string(),
  contextLevel: z.number().int(),
  component: z.string(),
});
export type Capability = z.infer<typeof capabilitySchema>;

export const CAP = { PROHIBIT: -1000, PREVENT: -1, INHERIT: 0, ALLOW: 1 } as const;


export const createContextSchema = z.strictObject({
  contextLevel: z.number().int(),
  instanceId: uuidIdSchema,
  parentId: uuidIdSchema.optional(),
});
export type CreateContext = z.infer<typeof createContextSchema>;

export const createRoleSchema = z.strictObject({
  name: z.string().min(1),
  shortName: z.string().min(1),
  description: z.string().optional(),
  archetype: z.string().optional(),
});
export type CreateRole = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.strictObject({
  name: z.string().optional(),
  description: z.string().optional(),
});
export type UpdateRole = z.infer<typeof updateRoleSchema>;

export const assignRoleSchema = z.strictObject({
  userId: uuidIdSchema,
  roleId: uuidIdSchema,
  contextId: uuidIdSchema,
});
export type AssignRole = z.infer<typeof assignRoleSchema>;

export const overrideCapabilitySchema = z.strictObject({
  roleId: uuidIdSchema,
  capability: z.string(),
  contextId: uuidIdSchema,
  permission: z.number().int(),
});
export type OverrideCapability = z.infer<typeof overrideCapabilitySchema>;

export const hasCapabilityQuerySchema = z.strictObject({
  userId: uuidIdSchema,
  capability: z.string(),
  contextId: uuidIdSchema,
});
export type HasCapabilityQuery = z.infer<typeof hasCapabilityQuerySchema>;

export const roleListItemSchema = roleSchema.extend({
  userCount: z.number().int().min(0),
  overrideCount: z.number().int().min(0),
  readOverrideCount: z.number().int().min(0),
  writeOverrideCount: z.number().int().min(0),
  resourceCount: z.number().int().min(0),
});
export type RoleListItem = z.infer<typeof roleListItemSchema>;

export const replaceRoleCapabilitiesSchema = z.strictObject({
  contextId: uuidIdSchema,
  overrides: z.array(z.strictObject({
    capability: z.string().min(1),
    permission: z.number().int(),
  })),
});
export type ReplaceRoleCapabilities = z.infer<typeof replaceRoleCapabilitiesSchema>;

export const capabilityMatrixQuerySchema = z.strictObject({
  contextId: uuidIdSchema,
});
export type CapabilityMatrixQuery = z.infer<typeof capabilityMatrixQuerySchema>;

export const capabilityMatrixRoleSchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  userCount: z.number().int().min(0),
  overrides: z.array(z.strictObject({
    capability: z.string().min(1),
    permission: z.number().int(),
  })),
});
export type CapabilityMatrixRole = z.infer<typeof capabilityMatrixRoleSchema>;

export const capabilityMatrixResponseSchema = z.object({
  contextId: uuidIdSchema,
  roles: z.array(capabilityMatrixRoleSchema),
});
export type CapabilityMatrixResponse = z.infer<typeof capabilityMatrixResponseSchema>;

export const listAssignmentsQuerySchema = z.strictObject({
  userId: uuidIdSchema.optional(),
  contextId: uuidIdSchema.optional(),
  roleId: uuidIdSchema.optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).optional(),
});
export type ListAssignmentsQuery = z.infer<typeof listAssignmentsQuerySchema>;

export const assignmentListItemSchema = z.object({
  id: uuidIdSchema,
  roleId: uuidIdSchema,
  userId: uuidIdSchema,
  contextId: uuidIdSchema,
  component: z.string(),
  itemId: uuidIdSchema.nullable(),
  modifierId: uuidIdSchema.nullable(),
  updatedAt: z.iso.datetime(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
});
export type AssignmentListItem = z.infer<typeof assignmentListItemSchema>;

export const assignmentListResponseSchema = z.object({
  assignments: z.array(assignmentListItemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type AssignmentListResponse = z.infer<typeof assignmentListResponseSchema>;

export const createUserSchema = z.strictObject({
  username: z.string().min(1),
  email: z.email(),
  password: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  forcePasswordChange: z.boolean().optional(),
  customFields: z.record(z.string(), z.string()).optional(),
});
export type CreateUser = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.strictObject({
  email: z.email().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  password: z.string().optional(),
  customFields: z.record(z.string(), z.string()).optional(),
});
export type UpdateUser = z.infer<typeof updateUserSchema>;

export const userListStatusSchema = z.enum(['active', 'suspended', 'deleted']);
export type UserListStatus = z.infer<typeof userListStatusSchema>;

export const userListSortBySchema = z.enum(['name', 'createdAt', 'lastLogin']);
export type UserListSortBy = z.infer<typeof userListSortBySchema>;

export const listUsersQuerySchema = z.strictObject({
  search: z.string().optional(),
  status: userListStatusSchema.optional(),
  sortBy: userListSortBySchema.optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const listUsersWithAssignmentsQuerySchema = z.strictObject({
  search: z.string().optional(),
  roleId: uuidIdSchema.optional(),
  status: userListStatusSchema.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
export type ListUsersWithAssignmentsQuery = z.infer<typeof listUsersWithAssignmentsQuerySchema>;

export const userAssignmentEntrySchema = z.object({
  id: uuidIdSchema,
  roleId: uuidIdSchema,
  roleName: z.string(),
  contextId: uuidIdSchema,
  contextLevel: z.number().int(),
  component: z.string(),
});
export type UserAssignmentEntry = z.infer<typeof userAssignmentEntrySchema>;

export const userWithAssignmentsListItemSchema = z.object({
  id: uuidIdSchema,
  username: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  suspended: z.boolean(),
  deleted: z.boolean(),
  createdAt: z.iso.datetime(),
  assignments: z.array(userAssignmentEntrySchema),
});
export type UserWithAssignmentsListItem = z.infer<typeof userWithAssignmentsListItemSchema>;

export const userWithAssignmentsListResponseSchema = z.object({
  users: z.array(userWithAssignmentsListItemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type UserWithAssignmentsListResponse = z.infer<typeof userWithAssignmentsListResponseSchema>;

export const setUserPreferenceSchema = z.strictObject({
  name: z.string(),
  value: z.string().optional(),
});
export type SetUserPreference = z.infer<typeof setUserPreferenceSchema>;

export const loginSchema = z.strictObject({
  username: z.string(),
  password: z.string(),
});
export type Login = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.strictObject({
  refreshToken: z.string(),
});
export type RefreshToken = z.infer<typeof refreshTokenSchema>;

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string(),
  newPassword: z.string().min(1),
});
export type ChangePassword = z.infer<typeof changePasswordSchema>;

export const loginAsSchema = z.strictObject({
  userId: uuidIdSchema,
  reason: z.string().trim().min(1).max(500),
});
export type LoginAs = z.infer<typeof loginAsSchema>;

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/);

export const mfaTotpCodeSchema = z.strictObject({
  code: totpCodeSchema,
});
export type MfaTotpCode = z.infer<typeof mfaTotpCodeSchema>;

export const mfaTotpSetupSchema = z
  .strictObject({
    currentCode: totpCodeSchema.optional(),
  })
  .optional();
export type MfaTotpSetup = z.infer<typeof mfaTotpSetupSchema>;

export const mfaVerifySchema = z.strictObject({
  challengeToken: z.string().min(1),
  code: totpCodeSchema,
});
export type MfaVerify = z.infer<typeof mfaVerifySchema>;

export const mfaTotpSetupResponseSchema = z.object({
  secret: z.string().min(1),
  otpauthUrl: z.string().startsWith('otpauth://totp/'),
});
export type MfaTotpSetupResponse = z.infer<typeof mfaTotpSetupResponseSchema>;

export const mfaStatusResponseSchema = z.object({
  enabled: z.boolean(),
});
export type MfaStatusResponse = z.infer<typeof mfaStatusResponseSchema>;

export const oauthIssuerSchema = z.enum(['google', 'facebook']);
export type OAuthIssuer = z.infer<typeof oauthIssuerSchema>;

export const oauthProviderSchema = z.object({
  issuer: oauthIssuerSchema,
  enabled: z.boolean(),
});
export type OAuthProvider = z.infer<typeof oauthProviderSchema>;

export const oauthProvidersResponseSchema = z.object({
  providers: z.array(oauthProviderSchema),
});
export type OAuthProvidersResponse = z.infer<typeof oauthProvidersResponseSchema>;

export const oauthAuthorizeResponseSchema = z.object({
  authorizeUrl: z.string().min(1),
});
export type OAuthAuthorizeResponse = z.infer<typeof oauthAuthorizeResponseSchema>;

export const oauthHandoffSchema = z.strictObject({
  code: z.string().min(1),
});
export type OAuthHandoff = z.infer<typeof oauthHandoffSchema>;

export const oauthLinkSchema = z.object({
  id: uuidIdSchema,
  issuer: oauthIssuerSchema,
  email: z.string(),
  createdAt: z.string(),
});
export type OAuthLink = z.infer<typeof oauthLinkSchema>;

export const oauthLinksResponseSchema = z.object({
  links: z.array(oauthLinkSchema),
  hasPassword: z.boolean(),
});
export type OAuthLinksResponse = z.infer<typeof oauthLinksResponseSchema>;

export const sessionLoginResponseSchema = z.object({
  user: z.object({
    id: uuidIdSchema,
    username: z.string().min(1),
    forcePasswordChange: z.boolean(),
  }),
  sessionId: uuidIdSchema,
});
export type SessionLoginResponse = z.infer<typeof sessionLoginResponseSchema>;

export const mySessionSchema = z.object({
  id: uuidIdSchema,
  kind: z.enum(['web', 'api', 'better-auth']),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});
export type MySession = z.infer<typeof mySessionSchema>;

export const mySessionsResponseSchema = z.object({
  sessions: z.array(mySessionSchema),
});
export type MySessionsResponse = z.infer<typeof mySessionsResponseSchema>;

export const revokeSessionsResponseSchema = z.object({
  revoked: z.number().int().min(0),
});
export type RevokeSessionsResponse = z.infer<typeof revokeSessionsResponseSchema>;

export const mfaChallengeResponseSchema = z.object({
  mfaRequired: z.literal(true),
  challengeToken: z.string().min(1),
  user: z.object({ id: uuidIdSchema, username: z.string().min(1) }),
});
export type MfaChallengeResponse = z.infer<typeof mfaChallengeResponseSchema>;

export const myRoleAssignmentSchema = z.object({
  id: uuidIdSchema,
  roleId: uuidIdSchema,
  roleShortname: z.string(),
  roleName: z.string(),
  contextId: uuidIdSchema,
  contextLevel: z.number().int(),
  contextPath: z.string(),
  instanceId: uuidIdSchema.nullable(),
});
export type MyRoleAssignment = z.infer<typeof myRoleAssignmentSchema>;

export const myContextCapabilitiesSchema = z.object({
  contextId: uuidIdSchema,
  contextLevel: z.number().int(),
  contextPath: z.string(),
  capabilities: z.array(z.string()),
});
export type MyContextCapabilities = z.infer<typeof myContextCapabilitiesSchema>;

export const myAccessViewSchema = z.object({
  userId: uuidIdSchema,
  isSiteAdmin: z.boolean(),
  assignments: z.array(myRoleAssignmentSchema),
  contexts: z.array(myContextCapabilitiesSchema),
  hasLearnerArtifacts: z.boolean(),
});
export type MyAccessView = z.infer<typeof myAccessViewSchema>;

export const createCustomFieldCategorySchema = z.strictObject({
  name: z.string(),
  component: z.string(),
  area: z.string(),
});
export type CreateCustomFieldCategory = z.infer<typeof createCustomFieldCategorySchema>;

export const createCustomFieldSchema = z.strictObject({
  categoryId: uuidIdSchema,
  shortName: z.string(),
  name: z.string(),
  type: z.string(),
  configData: z.record(z.string(), z.unknown()).optional(),
});
export type CreateCustomField = z.infer<typeof createCustomFieldSchema>;
