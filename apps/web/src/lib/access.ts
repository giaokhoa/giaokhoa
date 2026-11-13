import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Capability, RoleListItem } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import { queryKeys } from '#lib/query-keys';

export interface ContextRow {
  id: string;
  contextLevel: number;
  instanceId: string;
  path: string;
}

export interface RoleCapabilityRow {
  roleId: string;
  capability: string;
  contextId: string;
  permission: number;
}

export function useAccessRoles() {
  return useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => apiJson<RoleListItem[]>('/api/v1/access/roles'),
  });
}

export function useAccessCapabilities() {
  return useQuery({
    queryKey: queryKeys.accessCapabilities,
    queryFn: () => apiJson<Capability[]>('/api/v1/access/capabilities'),
  });
}

export function accessContextsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.accessContexts,
    queryFn: () => apiJson<ContextRow[]>('/api/v1/access/contexts'),
  });
}

export function useAccessContexts() {
  return useQuery(accessContextsQueryOptions());
}

export function useRoleCapabilities(roleId: string | null) {
  return useQuery({
    queryKey: queryKeys.roleCapabilities(roleId ?? ''),
    queryFn: () => apiJson<RoleCapabilityRow[]>(`/api/v1/access/roles/${roleId}/capabilities`),
    enabled: roleId !== null,
  });
}

export function useCreateAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; roleId: string; contextId: string }) =>
      apiJson('/api/v1/access/assignments', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.access });
      void queryClient.invalidateQueries({ queryKey: queryKeys.capabilities });
    },
  });
}
