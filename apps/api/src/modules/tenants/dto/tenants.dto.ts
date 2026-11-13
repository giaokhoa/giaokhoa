import {
  addTenantMemberSchema,
  createTenantSchema,
  createUserSchema,
  updateTenantMemberSchema,
  updateTenantSchema,
  type AddTenantMember,
  type CreateTenant,
  type CreateUser,
  type UpdateTenant,
  type UpdateTenantMember,
} from '@giaokhoa/contracts';

export { addTenantMemberSchema, createTenantSchema, createUserSchema, updateTenantMemberSchema, updateTenantSchema };
export type CreateTenantDto = CreateTenant;
export type UpdateTenantDto = UpdateTenant;
export type AddTenantMemberDto = AddTenantMember;
export type UpdateTenantMemberDto = UpdateTenantMember;
export type CreateTenantUserDto = CreateUser;
