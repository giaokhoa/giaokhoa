import type { UserListResponse, UserListSortBy, UserListStatus, UserProfile } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type { NewUserDraft, UpdateUserDraft } from '../types/admin-users';


export function fetchAdminUsers(page: number, pageSize: number, search: string) {
  return fetchAdminUsersList({ page, pageSize, search });
}

export interface ListAdminUsersParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: UserListStatus;
  sortBy?: UserListSortBy;
  sortDirection?: 'asc' | 'desc';
}

export function fetchAdminUsersList(params: ListAdminUsersParams) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortBy && params.sortDirection) query.set('sortDirection', params.sortDirection);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  return apiJson<UserListResponse>(`/api/v1/users?${query.toString()}`);
}

const ALL_USERS_PAGE_SIZE = 100;

export async function fetchAllAdminUsers(params: Omit<ListAdminUsersParams, 'page' | 'pageSize'>) {
  const users: UserProfile[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (users.length < total) {
    const result = await fetchAdminUsersList({ ...params, page, pageSize: ALL_USERS_PAGE_SIZE });
    users.push(...result.users);
    total = result.total;
    if (result.users.length === 0) break;
    page += 1;
  }
  return { users, total };
}

export function fetchAdminUser(userId: string) {
  return apiJson<UserProfile>(`/api/v1/users/${userId}`);
}

export function toggleUserSuspended(input: { id: string; suspended: boolean }) {
  return apiJson(`/api/v1/users/${input.id}/${input.suspended ? 'suspend' : 'reactivate'}`, {
    method: 'POST',
  });
}

export function deleteAdminUser(id: string) {
  return apiJson(`/api/v1/users/${id}`, { method: 'DELETE' });
}

export function createAdminUser(draft: NewUserDraft) {
  return apiJson('/api/v1/users', { method: 'POST', body: JSON.stringify(draft) });
}

export function updateAdminUser(input: { userId: string; draft: UpdateUserDraft }) {
  return apiJson(`/api/v1/users/${input.userId}`, {
    method: 'PATCH',
    body: JSON.stringify(input.draft),
  });
}
