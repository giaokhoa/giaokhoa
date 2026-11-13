import {
  createEnrolInstanceSchema,
  enrolUserSchema,
  selfEnrolSchema,
  updateEnrolInstanceSchema,
  type CreateEnrolInstance,
  type EnrolUser,
  type SelfEnrol,
  type UpdateEnrolInstance,
} from '@giaokhoa/contracts';

export { createEnrolInstanceSchema, enrolUserSchema, selfEnrolSchema, updateEnrolInstanceSchema };
export type CreateEnrolInstanceDto = CreateEnrolInstance;
export type UpdateEnrolInstanceDto = UpdateEnrolInstance;
export type EnrolUserDto = EnrolUser;
export type SelfEnrolDto = SelfEnrol;
