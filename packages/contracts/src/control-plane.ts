import { z } from 'zod';
import { uuidIdSchema } from './ids.js';

export const SPACE_KINDS = ['center', 'platform'] as const;
export const SPACE_STATUSES = ['provisioning', 'active', 'suspended', 'closed'] as const;
export const SPACE_STORAGE_MODES = ['shared', 'dedicated'] as const;
export const SPACE_SCHEMA_RUN_STATUSES = ['running', 'success', 'failed'] as const;

const spaceSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/);

export const spaceRegistrationSchema = z.object({
  id: uuidIdSchema,
  slug: z.string(),
  name: z.string(),
  kind: z.enum(SPACE_KINDS),
  status: z.enum(SPACE_STATUSES),
  databaseName: z.string(),
  storageMode: z.enum(SPACE_STORAGE_MODES),
  connectionRoleRef: z.string(),
  secretRef: z.string().nullable(),
  schemaVersion: z.string().nullable(),
  plan: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SpaceRegistration = z.infer<typeof spaceRegistrationSchema>;

export const createSpaceRegistrationSchema = z.strictObject({
  slug: spaceSlugSchema,
  name: z.string().min(1).max(200),
  kind: z.enum(SPACE_KINDS),
  status: z.enum(SPACE_STATUSES).optional(),
  databaseName: z.string().min(1).max(120),
  storageMode: z.enum(SPACE_STORAGE_MODES),
  connectionRoleRef: z.string().min(1).max(200),
  secretRef: z.string().max(200).optional(),
  schemaVersion: z.string().max(120).optional(),
  plan: z.string().max(80).optional(),
});
export type CreateSpaceRegistration = z.infer<typeof createSpaceRegistrationSchema>;

export const updateSpaceRegistrationSchema = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  databaseName: z.string().min(1).max(120).optional(),
  storageMode: z.enum(SPACE_STORAGE_MODES).optional(),
  connectionRoleRef: z.string().min(1).max(200).optional(),
  secretRef: z.string().max(200).nullable().optional(),
  schemaVersion: z.string().max(120).nullable().optional(),
  plan: z.string().max(80).nullable().optional(),
});
export type UpdateSpaceRegistration = z.infer<typeof updateSpaceRegistrationSchema>;

export const changeSpaceStatusSchema = z.strictObject({
  status: z.enum(SPACE_STATUSES),
});
export type ChangeSpaceStatus = z.infer<typeof changeSpaceStatusSchema>;

export const spaceRegistryHistoryEntrySchema = z.object({
  id: uuidIdSchema,
  spaceId: uuidIdSchema,
  actorId: uuidIdSchema,
  action: z.enum(['create', 'update', 'status_change']),
  before: spaceRegistrationSchema.omit({ createdAt: true, updatedAt: true }).nullable(),
  after: spaceRegistrationSchema.omit({ createdAt: true, updatedAt: true }),
  createdAt: z.string(),
});
export type SpaceRegistryHistoryEntry = z.infer<typeof spaceRegistryHistoryEntrySchema>;

export const spaceSchemaRegistrySchema = z.object({
  spaceId: uuidIdSchema,
  currentVersion: z.string().nullable(),
  lastBackupStatus: z.string().nullable(),
  lastBackupAt: z.string().nullable(),
  lastRestoreStatus: z.string().nullable(),
  lastRestoreAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type SpaceSchemaRegistry = z.infer<typeof spaceSchemaRegistrySchema>;

export const updateSpaceSchemaRegistrySchema = z.strictObject({
  currentVersion: z.string().max(120).nullable().optional(),
  lastBackupStatus: z.string().max(40).nullable().optional(),
  lastBackupAt: z.iso.datetime({ offset: true }).nullable().optional(),
  lastRestoreStatus: z.string().max(40).nullable().optional(),
  lastRestoreAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type UpdateSpaceSchemaRegistry = z.infer<typeof updateSpaceSchemaRegistrySchema>;

export const spaceSchemaMigrationStepSchema = z.looseObject({
  name: z.string(),
  status: z.string(),
  detail: z.string().optional(),
});

export const recordSpaceSchemaMigrationRunSchema = z.strictObject({
  runId: z.string().min(1).max(120),
  fromVersion: z.string().max(120).nullable().optional(),
  toVersion: z.string().max(120).nullable().optional(),
  status: z.enum(SPACE_SCHEMA_RUN_STATUSES),
  steps: z.array(spaceSchemaMigrationStepSchema).default([]),
  finishedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type RecordSpaceSchemaMigrationRun = z.infer<typeof recordSpaceSchemaMigrationRunSchema>;

export const spaceSchemaMigrationRunSchema = z.object({
  id: uuidIdSchema,
  spaceId: uuidIdSchema,
  runId: z.string(),
  fromVersion: z.string().nullable(),
  toVersion: z.string().nullable(),
  status: z.enum(SPACE_SCHEMA_RUN_STATUSES),
  steps: z.array(spaceSchemaMigrationStepSchema),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type SpaceSchemaMigrationRun = z.infer<typeof spaceSchemaMigrationRunSchema>;
