import { z } from 'zod';
import {
  createUserSchema,
  listUsersQuerySchema,
  setUserPreferenceSchema,
  updateUserSchema,
  type CreateUser,
  type SetUserPreference,
  type UpdateUser,
} from '@giaokhoa/contracts';

export { createUserSchema, setUserPreferenceSchema, updateUserSchema };
export type CreateUserDto = CreateUser;
export type UpdateUserDto = UpdateUser;
export type SetPreferenceDto = SetUserPreference;

export const listUsersQueryServerSchema = listUsersQuerySchema.extend({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListUsersQueryDto = z.infer<typeof listUsersQueryServerSchema>;
