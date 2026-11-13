import {
  changeSpaceStatusSchema,
  createSpaceRegistrationSchema,
  recordSpaceSchemaMigrationRunSchema,
  updateSpaceRegistrationSchema,
  updateSpaceSchemaRegistrySchema,
  type ChangeSpaceStatus,
  type CreateSpaceRegistration,
  type RecordSpaceSchemaMigrationRun,
  type UpdateSpaceRegistration,
  type UpdateSpaceSchemaRegistry,
} from '@giaokhoa/contracts';

export {
  changeSpaceStatusSchema,
  createSpaceRegistrationSchema,
  recordSpaceSchemaMigrationRunSchema,
  updateSpaceRegistrationSchema,
  updateSpaceSchemaRegistrySchema,
};
export type CreateSpaceRegistrationDto = CreateSpaceRegistration;
export type UpdateSpaceRegistrationDto = UpdateSpaceRegistration;
export type ChangeSpaceStatusDto = ChangeSpaceStatus;
export type UpdateSpaceSchemaRegistryDto = UpdateSpaceSchemaRegistry;
export type RecordSpaceSchemaMigrationRunDto = RecordSpaceSchemaMigrationRun;
