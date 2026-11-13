import type {
  AssignRole,
  AssignmentListResponse,
  CapabilityMatrixResponse,
  CreateRole,
  OverrideCapability,
  ReplaceRoleCapabilities,
  Role,
  UpdateRole,
  UserListStatus,
  UserWithAssignmentsListResponse,
} from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';


export function createRole(draft: CreateRole) {
  return apiJson<Role>('/api/v1/access/roles', { method: 'POST', body: JSON.stringify(draft) });
}

export function updateRole(input: { roleId: string; draft: UpdateRole }) {
  return apiJson<Role>(`/api/v1/access/roles/${input.roleId}`, {
    method: 'PATCH',
    body: JSON.stringify(input.draft),
  });
}

export function replaceRoleCapabilities(input: { roleId: string; payload: ReplaceRoleCapabilities }) {
  return apiJson<{ capability: string; permission: number }[]>(`/api/v1/access/roles/${input.roleId}/capabilities`, {
    method: 'PUT',
    body: JSON.stringify(input.payload),
  });
}

export function deleteRole(roleId: string) {
  return apiJson<{ deleted: boolean }>(`/api/v1/access/roles/${roleId}`, { method: 'DELETE' });
}

export interface ListAssignmentsParams {
  userId?: string;
  roleId?: string;
  contextId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export function listAssignments(params: ListAssignmentsParams) {
  const query = new URLSearchParams();
  if (params.userId) query.set('userId', params.userId);
  if (params.roleId) query.set('roleId', params.roleId);
  if (params.contextId) query.set('contextId', params.contextId);
  if (params.search) query.set('search', params.search);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  return apiJson<AssignmentListResponse>(`/api/v1/access/assignments?${query.toString()}`);
}

const ALL_ASSIGNMENTS_PAGE_SIZE = 100;

export async function fetchRoleHolderUserIds(roleId: string, contextId: string) {
  const userIds = new Set<string>();
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  let fetched = 0;
  while (fetched < total) {
    const result = await listAssignments({ roleId, contextId, page, pageSize: ALL_ASSIGNMENTS_PAGE_SIZE });
    for (const row of result.assignments) userIds.add(row.userId);
    fetched += result.assignments.length;
    total = result.total;
    if (result.assignments.length === 0) break;
    page += 1;
  }
  return userIds;
}

export function createAssignment(input: AssignRole) {
  return apiJson('/api/v1/access/assignments', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteAssignment(assignmentId: string) {
  return apiJson<{ deleted: boolean }>(`/api/v1/access/assignments/${assignmentId}`, { method: 'DELETE' });
}

export function fetchCapabilityMatrix(contextId: string) {
  const query = new URLSearchParams({ contextId });
  return apiJson<CapabilityMatrixResponse>(`/api/v1/access/capability-matrix?${query.toString()}`);
}

export function setCapabilityOverride(input: OverrideCapability) {
  return apiJson<{ updated: boolean }>('/api/v1/access/overrides', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface ListUsersWithAssignmentsParams {
  search?: string;
  roleId?: string;
  status?: UserListStatus;
  page: number;
  pageSize: number;
}

export function listUsersWithAssignments(params: ListUsersWithAssignmentsParams) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.roleId) query.set('roleId', params.roleId);
  if (params.status) query.set('status', params.status);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  return apiJson<UserWithAssignmentsListResponse>(
    `/api/v1/access/users-with-assignments?${query.toString()}`,
  );
}
