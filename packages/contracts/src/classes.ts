import { z } from 'zod';
import { courseSchema } from './course.js';
import { uuidIdSchema } from './ids.js';

export const CLASS_ON_LEAVE_MODES = ['suspend', 'unenrol'] as const;
export const CLASS_STATUSES = ['active', 'archived'] as const;

export const classSchema = z.object({
  id: uuidIdSchema,
  tenantId: uuidIdSchema,
  name: z.string(),
  code: z.string().nullable(),
  schoolYear: z.string().nullable(),
  ownerId: uuidIdSchema,
  cohortId: uuidIdSchema,
  allowSelfReport: z.boolean(),
  joinCode: z.string().nullable(),
  joinAutoApprove: z.boolean(),
  onLeave: z.enum(CLASS_ON_LEAVE_MODES),
  status: z.enum(CLASS_STATUSES),
  description: z.string(),
  feeCost: z.number().int().nullable(),
  feeCurrency: z.string(),
  feePaymentAccountId: uuidIdSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClassView = z.infer<typeof classSchema>;

export const classListItemSchema = classSchema.extend({
  canCreate: z.boolean(),
  canUpdate: z.boolean(),
  canDelete: z.boolean(),
  canManageRoster: z.boolean(),
});
export type ClassListItem = z.infer<typeof classListItemSchema>;

export const createClassSchema = z.strictObject({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(80).optional(),
  schoolYear: z.string().min(1).max(40).optional(),
  description: z.string().max(2000).optional(),
  ownerId: uuidIdSchema.optional(),
});
export type CreateClass = z.infer<typeof createClassSchema>;

export const updateClassSchema = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(80).nullable().optional(),
  schoolYear: z.string().min(1).max(40).nullable().optional(),
  description: z.string().max(2000).optional(),
  allowSelfReport: z.boolean().optional(),
  joinAutoApprove: z.boolean().optional(),
  onLeave: z.enum(CLASS_ON_LEAVE_MODES).optional(),
  rotateJoinCode: z.boolean().optional(),
  feeCost: z.number().int().min(0).nullable().optional(),
  feeCurrency: z.string().min(3).max(3).optional(),
  feePaymentAccountId: uuidIdSchema.nullable().optional(),
});
export type UpdateClass = z.infer<typeof updateClassSchema>;

const memberIdentityFields = {
  firstName: z.string(),
  lastName: z.string(),
  username: z.string(),
  email: z.string(),
};

export const classRosterMemberSchema = z.object({
  userId: uuidIdSchema,
  timeAdded: z.string(),
  ...memberIdentityFields,
});
export type ClassRosterMember = z.infer<typeof classRosterMemberSchema>;

export const addClassRosterMemberSchema = z.strictObject({
  userId: uuidIdSchema,
});
export type AddClassRosterMember = z.infer<typeof addClassRosterMemberSchema>;


export const rosterStudentIdentitySchema = z.strictObject({
  fullName: z.string().min(1).max(200),
  email: z.string().max(200).optional(),
  phone: z.string().max(30).optional(),
  dateOfBirth: z.string().max(20).optional(),
});
export type RosterStudentIdentity = z.infer<typeof rosterStudentIdentitySchema>;

export const addRosterStudentResultSchema = z.object({
  userId: uuidIdSchema,
  username: z.string(),
  email: z.string(),
  fullName: z.string(),
  outcome: z.enum(['matched', 'created', 'already_member']),
  temporaryPassword: z.string().nullable(),
});
export type AddRosterStudentResult = z.infer<typeof addRosterStudentResultSchema>;

export const importClassRosterSchema = z.strictObject({
  rows: z.array(rosterStudentIdentitySchema).min(1).max(500),
});
export type ImportClassRoster = z.infer<typeof importClassRosterSchema>;

export const classRosterImportReportSchema = z.object({
  total: z.number().int(),
  added: z.number().int(),
  created: z.number().int(),
  alreadyMembers: z.number().int(),
  failed: z.number().int(),
  results: z.array(
    z.object({
      row: z.number().int(),
      fullName: z.string(),
      status: z.enum(['added_matched', 'added_created', 'already_member', 'error']),
      userId: uuidIdSchema.nullable(),
      username: z.string().nullable(),
      temporaryPassword: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
export type ClassRosterImportReport = z.infer<typeof classRosterImportReportSchema>;

export const CLASS_STAFF_ROLES = ['classassigner', 'classgrader', 'classrostermanager'] as const;
export const classStaffRoleSchema = z.enum(CLASS_STAFF_ROLES);
export type ClassStaffRole = z.infer<typeof classStaffRoleSchema>;

export const classStaffMemberSchema = z.object({
  userId: uuidIdSchema,
  ...memberIdentityFields,
  isOwner: z.boolean(),
  roles: z.array(classStaffRoleSchema),
});
export type ClassStaffMember = z.infer<typeof classStaffMemberSchema>;

export const classStaffViewSchema = z.object({
  staff: z.array(classStaffMemberSchema),
  canShare: z.boolean(),
  canManageRoster: z.boolean(),
});
export type ClassStaffView = z.infer<typeof classStaffViewSchema>;

export const setClassStaffRolesSchema = z.strictObject({
  userId: uuidIdSchema.optional(),
  email: z.string().min(3).max(200).optional(),
  roles: z.array(classStaffRoleSchema).max(3),
});
export type SetClassStaffRoles = z.infer<typeof setClassStaffRolesSchema>;

export const joinClassByCodeSchema = z.strictObject({
  joinCode: z.string().min(4).max(40),
});
export type JoinClassByCode = z.infer<typeof joinClassByCodeSchema>;

export const classJoinPreviewSchema = z.object({
  classId: uuidIdSchema,
  name: z.string(),
  schoolYear: z.string().nullable(),
  ownerName: z.string(),
});
export type ClassJoinPreview = z.infer<typeof classJoinPreviewSchema>;

export const joinClassResultSchema = z.object({
  outcome: z.enum(['joined', 'pending', 'already_member']),
  class: z.object({
    id: uuidIdSchema,
    name: z.string(),
    schoolYear: z.string().nullable(),
  }),
});
export type JoinClassResult = z.infer<typeof joinClassResultSchema>;

export const classJoinRequestSchema = z.object({
  id: uuidIdSchema,
  classId: uuidIdSchema,
  userId: uuidIdSchema,
  ...memberIdentityFields,
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type ClassJoinRequest = z.infer<typeof classJoinRequestSchema>;

export const classSuspendedMemberSchema = z.object({
  userId: uuidIdSchema,
  ...memberIdentityFields,
});
export type ClassSuspendedMember = z.infer<typeof classSuspendedMemberSchema>;


export const CLASS_VIEWER_ROLES = ['owner', 'staff', 'member'] as const;
export const classViewerRoleSchema = z.enum(CLASS_VIEWER_ROLES);
export type ClassViewerRole = z.infer<typeof classViewerRoleSchema>;

export const classOverviewSchema = z.object({
  class: classSchema,
  viewerRole: classViewerRoleSchema,
  canManageRoster: z.boolean(),
  canShare: z.boolean(),
  rosterCount: z.number().int().nonnegative(),
  courses: z.array(courseSchema),
});
export type ClassOverview = z.infer<typeof classOverviewSchema>;


export const classPublicViewSchema = z.object({
  classId: uuidIdSchema,
  name: z.string(),
  code: z.string().nullable(),
  schoolYear: z.string().nullable(),
  description: z.string(),
  ownerName: z.string(),
  status: z.enum(CLASS_STATUSES),
  feeCost: z.number().int().nullable(),
  feeCurrency: z.string(),
  feeEnabled: z.boolean(),
  isMember: z.boolean(),
  canPurchase: z.boolean(),
});
export type ClassPublicView = z.infer<typeof classPublicViewSchema>;
