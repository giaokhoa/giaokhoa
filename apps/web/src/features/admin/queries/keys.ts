import type { ListAssignmentsParams, ListUsersWithAssignmentsParams } from '../api/admin-roles';
import type { ListAdminUsersParams } from '../api/admin-users';

const capabilityMatrixRoot = ['admin', 'capability-matrix'] as const;

export const queryKeys = {
  adminUsersRoot: ['admin', 'users'] as const,
  adminUsersList: (params: ListAdminUsersParams) =>
    [
      'admin',
      'users',
      'list',
      params.search ?? '',
      params.status ?? '',
      params.sortBy ?? '',
      params.sortDirection ?? '',
      params.page,
      params.pageSize,
    ] as const,
  adminUsersAll: (params: Omit<ListAdminUsersParams, 'page' | 'pageSize'>) =>
    [
      'admin',
      'users',
      'all',
      params.search ?? '',
      params.status ?? '',
      params.sortBy ?? '',
      params.sortDirection ?? '',
    ] as const,
  adminUserStat: (group: string) => ['admin', 'users', 'stat', group] as const,
  roleAssignmentsRoot: ['admin', 'role-assignments'] as const,
  roleHolders: (roleId: string, contextId: string) =>
    ['admin', 'role-assignments', 'holders', roleId, contextId] as const,
  userAssignments: (userId: string) => ['admin', 'role-assignments', 'by-user', userId] as const,
  roleAssignments: (params: ListAssignmentsParams) =>
    [
      'admin',
      'role-assignments',
      params.userId ?? '',
      params.roleId ?? '',
      params.contextId ?? '',
      params.search ?? '',
      params.page,
      params.pageSize,
    ] as const,
  adminUserDetail: (userId: string) => ['admin', 'users', 'detail', userId] as const,
  capabilityMatrixRoot,
  capabilityMatrix: (contextId: string) => [...capabilityMatrixRoot, contextId] as const,
  usersWithAssignmentsRoot: ['admin', 'users-with-assignments'] as const,
  usersWithAssignments: (params: ListUsersWithAssignmentsParams) =>
    [
      'admin',
      'users-with-assignments',
      params.search ?? '',
      params.roleId ?? '',
      params.status ?? '',
      params.page,
      params.pageSize,
    ] as const,
  tenantsRoot: ['admin', 'tenants'] as const,
  tenants: ['admin', 'tenants', 'list'] as const,
  currentTenant: ['admin', 'tenants', 'current'] as const,
  tenantMembers: (tenantId: string) => ['admin', 'tenants', tenantId, 'members'] as const,
  tenantUsers: (tenantId: string) => ['admin', 'tenants', tenantId, 'users'] as const,
  siteConfig: ['site-config'] as const,
  siteConfigAudit: ['site-config', 'audit'] as const,
};
