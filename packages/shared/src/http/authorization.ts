import { z } from 'zod';

const systemRoleBody = z.strictObject({ role: z.enum(['teacher', 'admin']) });
const systemRoleParams = z.strictObject({ userId: z.uuidv7() });
const result = z.strictObject({ changed: z.boolean() });

/** Quản lý vai trò theo ngữ cảnh hệ thống; không dùng API quản trị của Better Auth. */
export const authorizationContract = {
  grantSystemRole: {
    method: 'POST',
    path: '/authorization/system-roles/:userId',
    pathParams: systemRoleParams,
    body: systemRoleBody,
    responses: { 201: result },
  },
  revokeSystemRole: {
    method: 'DELETE',
    path: '/authorization/system-roles/:userId',
    pathParams: systemRoleParams,
    body: systemRoleBody,
    responses: { 200: result },
  },
} as const;
