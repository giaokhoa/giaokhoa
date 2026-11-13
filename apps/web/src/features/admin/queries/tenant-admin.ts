import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateTenant, CreateUser } from '@giaokhoa/contracts';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  addTenantMember,
  createTenant,
  createTenantUser,
  fetchCurrentTenant,
  fetchTenantMembers,
  fetchTenantUsers,
  fetchTenants,
  setTenantMemberStatus,
} from '../api/tenant-admin';
import type { TenantMemberStatus } from '../types/tenant-admin';
import { queryKeys } from './keys';


export function tenantsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.tenants,
    queryFn: () => fetchTenants(),
  });
}

export function currentTenantQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.currentTenant,
    queryFn: () => fetchCurrentTenant(),
  });
}

export function tenantMembersQueryOptions(tenantId: string) {
  return queryOptions({
    queryKey: queryKeys.tenantMembers(tenantId),
    queryFn: () => fetchTenantMembers(tenantId),
    enabled: tenantId !== '',
  });
}

export function tenantUsersQueryOptions(tenantId: string) {
  return queryOptions({
    queryKey: queryKeys.tenantUsers(tenantId),
    queryFn: () => fetchTenantUsers(tenantId),
    enabled: tenantId !== '',
  });
}

export function useCreateTenant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: CreateTenant) => createTenant(draft),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.tenantsRoot }),
  });
}

export function useAddTenantMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { tenantId: string; userId: string }) => addTenantMember(input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.tenantsRoot }),
  });
}

export function useCreateTenantUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { tenantId: string; draft: CreateUser }) => createTenantUser(input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.tenantsRoot }),
  });
}

export function useSetTenantMemberStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { tenantId: string; userId: string; status: TenantMemberStatus }) =>
      setTenantMemberStatus(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.tenantsRoot });
      void client.invalidateQueries({ queryKey: sharedQueryKeys.capabilities });
    },
  });
}
