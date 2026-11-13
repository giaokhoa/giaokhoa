import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignRole,
  CreateRole,
  OverrideCapability,
  ReplaceRoleCapabilities,
  UpdateRole,
} from '@giaokhoa/contracts';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  createAssignment,
  createRole,
  deleteAssignment,
  deleteRole,
  fetchCapabilityMatrix,
  fetchRoleHolderUserIds,
  listAssignments,
  listUsersWithAssignments,
  replaceRoleCapabilities,
  setCapabilityOverride,
  updateRole,
  type ListAssignmentsParams,
  type ListUsersWithAssignmentsParams,
} from '../api/admin-roles';
import { queryKeys } from './keys';


export function useCreateRole() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: CreateRole) => createRole(draft),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: sharedQueryKeys.access });
      void client.invalidateQueries({ queryKey: queryKeys.usersWithAssignmentsRoot });
      void client.invalidateQueries({ queryKey: queryKeys.capabilityMatrixRoot });
    },
  });
}

export function useUpdateRole() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { roleId: string; draft: UpdateRole }) => updateRole(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: sharedQueryKeys.access });
      void client.invalidateQueries({ queryKey: queryKeys.usersWithAssignmentsRoot });
      void client.invalidateQueries({ queryKey: queryKeys.capabilityMatrixRoot });
    },
  });
}

export function useReplaceRoleCapabilities() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { roleId: string; payload: ReplaceRoleCapabilities }) => replaceRoleCapabilities(input),
    onSuccess: () => client.invalidateQueries({ queryKey: sharedQueryKeys.access }),
  });
}

export function useDeleteRole() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => deleteRole(roleId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: sharedQueryKeys.access });
      void client.invalidateQueries({ queryKey: queryKeys.usersWithAssignmentsRoot });
      void client.invalidateQueries({ queryKey: queryKeys.capabilityMatrixRoot });
    },
  });
}

export function roleAssignmentsQueryOptions(params: ListAssignmentsParams) {
  return queryOptions({
    queryKey: queryKeys.roleAssignments(params),
    queryFn: () => listAssignments(params),
  });
}

export function userAssignmentsQueryOptions(userId: string) {
  return queryOptions({
    queryKey: queryKeys.userAssignments(userId),
    queryFn: () => listAssignments({ userId, page: 1, pageSize: 100 }),
  });
}

export function roleHoldersQueryOptions(roleId: string, contextId: string) {
  return queryOptions({
    queryKey: queryKeys.roleHolders(roleId, contextId),
    queryFn: () => fetchRoleHolderUserIds(roleId, contextId),
  });
}

export function useCreateRoleAssignment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignRole) => createAssignment(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.roleAssignmentsRoot });
      void client.invalidateQueries({ queryKey: queryKeys.usersWithAssignmentsRoot });
      void client.invalidateQueries({ queryKey: sharedQueryKeys.access });
    },
  });
}

export function useDeleteRoleAssignment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => deleteAssignment(assignmentId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.roleAssignmentsRoot });
      void client.invalidateQueries({ queryKey: queryKeys.usersWithAssignmentsRoot });
      void client.invalidateQueries({ queryKey: sharedQueryKeys.access });
    },
  });
}

export function capabilityMatrixQueryOptions(contextId: string) {
  return queryOptions({
    queryKey: queryKeys.capabilityMatrix(contextId),
    queryFn: () => fetchCapabilityMatrix(contextId),
    enabled: contextId !== '',
  });
}

export function useCapabilityMatrix(contextId: string) {
  return useQuery(capabilityMatrixQueryOptions(contextId));
}

export function useSetCapabilityOverride() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: OverrideCapability) => setCapabilityOverride(input),
    onSuccess: (_data, input) => {
      void client.invalidateQueries({ queryKey: queryKeys.capabilityMatrix(input.contextId) });
      void client.invalidateQueries({ queryKey: sharedQueryKeys.access });
    },
  });
}

export function usersWithAssignmentsQueryOptions(params: ListUsersWithAssignmentsParams) {
  return queryOptions({
    queryKey: queryKeys.usersWithAssignments(params),
    queryFn: () => listUsersWithAssignments(params),
  });
}
