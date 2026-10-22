import { z } from 'zod';

const systemRoleBody = z.strictObject({ role: z.enum(['teacher', 'admin']) });
const systemRoleParams = z.strictObject({ userId: z.uuidv7() });
const result = z.strictObject({ changed: z.boolean() });
const scopedRoleParams = z.strictObject({ contextId: z.uuidv7(), userId: z.uuidv7() });
const overrideParams = z.strictObject({ contextId: z.uuidv7() });
const scopedRoleBody = z.strictObject({ roleKey: z.string().min(1).max(120) });
const overrideBody = z.strictObject({
  roleKey: z.string().min(1).max(120),
  capability: z.string().min(1).max(120),
  effect: z.enum(['INHERIT', 'ALLOW', 'PREVENT', 'PROHIBIT']),
});

const roleKeyParams = z.strictObject({ roleKey: z.string().min(1).max(120) });
const contextKind = z.enum(['system', 'user', 'bank', 'question', 'exam', 'class', 'assignment']);
const roleContexts = z.array(contextKind).min(1);
const roleEffect = z.enum(['INHERIT', 'ALLOW', 'PREVENT', 'PROHIBIT']);
const createRoleBody = z.strictObject({
  key: z.string().min(1).max(120),
  contextKind: z.enum(['system', 'class']),
  contexts: roleContexts,
});
const rolePermissionBody = z.strictObject({
  capability: z.string().min(1).max(120),
  effect: roleEffect,
});
const roleContextsBody = z.strictObject({ contexts: roleContexts });
const roleMatrixBody = z.strictObject({
  targetRoleKey: z.string().min(1).max(120),
  action: z.enum(['assign', 'override']),
  allowed: z.boolean(),
});

/** Tra quyền của chính người đăng nhập và quản lý vai trò theo ngữ cảnh; không dùng quyền của Better Auth. */
export const authorizationContract = {
  check: {
    method: 'POST',
    path: '/authorization/check',
    body: z.strictObject({
      context: z.strictObject({ kind: contextKind, resourceKey: z.string().min(1).max(200) }),
      capabilities: z.array(z.string().min(1).max(120)).max(32),
    }),
    responses: {
      200: z.strictObject({ contextId: z.uuidv7(), capabilities: z.array(z.string()) }),
    },
  },
  createRole: {
    method: 'POST',
    path: '/authorization/roles',
    body: createRoleBody,
    responses: { 201: result },
  },
  setRolePermission: {
    method: 'PUT',
    path: '/authorization/roles/:roleKey/permissions',
    pathParams: roleKeyParams,
    body: rolePermissionBody,
    responses: { 200: result },
  },
  listRoleContexts: {
    method: 'GET',
    path: '/authorization/roles',
    responses: {
      200: z.array(
        z.strictObject({
          key: z.string(),
          contextKind,
          contexts: z.array(contextKind),
        }),
      ),
    },
  },
  setRoleContexts: {
    method: 'PUT',
    path: '/authorization/roles/:roleKey/contexts',
    pathParams: roleKeyParams,
    body: roleContextsBody,
    responses: { 200: result },
  },
  setRoleMatrix: {
    method: 'PUT',
    path: '/authorization/roles/:roleKey/matrix',
    pathParams: roleKeyParams,
    body: roleMatrixBody,
    responses: { 200: result },
  },
  grantContextRole: {
    method: 'POST',
    path: '/authorization/contexts/:contextId/roles/:userId',
    pathParams: scopedRoleParams,
    body: scopedRoleBody,
    responses: { 201: result },
  },
  revokeContextRole: {
    method: 'DELETE',
    path: '/authorization/contexts/:contextId/roles/:userId',
    pathParams: scopedRoleParams,
    body: scopedRoleBody,
    responses: { 200: result },
  },
  overrideRole: {
    method: 'PUT',
    path: '/authorization/contexts/:contextId/overrides',
    pathParams: overrideParams,
    body: overrideBody,
    responses: { 200: result },
  },
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
