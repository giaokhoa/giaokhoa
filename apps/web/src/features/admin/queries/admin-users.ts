import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryClient } from '#lib/query-client';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUser,
  fetchAdminUsers,
  fetchAdminUsersList,
  fetchAllAdminUsers,
  toggleUserSuspended,
  updateAdminUser,
  type ListAdminUsersParams,
} from '../api/admin-users';
import type { NewUserDraft, UpdateUserDraft } from '../types/admin-users';
import { queryKeys } from './keys';


export function adminUsersQueryOptions(page: number, pageSize: number, search: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.adminUsers(page, pageSize, search),
    queryFn: () => fetchAdminUsers(page, pageSize, search),
  });
}

export function adminUsersListQueryOptions(params: ListAdminUsersParams) {
  return queryOptions({
    queryKey: queryKeys.adminUsersList(params),
    queryFn: () => fetchAdminUsersList(params),
  });
}

export function adminUsersAllQueryOptions(params: Omit<ListAdminUsersParams, 'page' | 'pageSize'>) {
  return queryOptions({
    queryKey: queryKeys.adminUsersAll(params),
    queryFn: () => fetchAllAdminUsers(params),
  });
}

export function adminUserStatQueryOptions(status: 'active' | 'suspended' | 'deleted') {
  return queryOptions({
    queryKey: queryKeys.adminUserStat(status),
    queryFn: () => fetchAdminUsersList({ page: 1, pageSize: 1, status }),
  });
}

export function adminUserDetailQueryOptions(userId: string) {
  return queryOptions({
    queryKey: queryKeys.adminUserDetail(userId),
    queryFn: () => fetchAdminUser(userId),
  });
}

export function useAdminUserDetail(userId: string | undefined) {
  return useQuery({
    ...adminUserDetailQueryOptions(userId ?? ''),
    enabled: userId !== undefined && userId !== '',
  });
}

export function useToggleUserSuspended() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; suspended: boolean }) => toggleUserSuspended(input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.adminUsersRoot }),
  });
}

export function useDeleteAdminUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAdminUser(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.adminUsersRoot }),
  });
}

export function useCreateAdminUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: NewUserDraft) => createAdminUser(draft),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.adminUsersRoot }),
  });
}

export function useUpdateAdminUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; draft: UpdateUserDraft }) => updateAdminUser(input),
    onSuccess: (_data, vars) => {
      void client.invalidateQueries({ queryKey: queryKeys.adminUsersRoot });
      void client.invalidateQueries({ queryKey: queryKeys.adminUserDetail(vars.userId) });
    },
  });
}

export async function adminUsersPageClientLoader() {
  await queryClient
    .ensureQueryData(adminUsersListQueryOptions({ page: 1, pageSize: 10 }))
    .catch(() => undefined);
  return null;
}
