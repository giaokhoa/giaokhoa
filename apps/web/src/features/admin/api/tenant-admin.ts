import type { CreateUser, Tenant, TenantMembership } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type { TenantMemberStatus, TenantUserSummary } from '../types/tenant-admin';


export function fetchTenants() {
  return apiJson<Tenant[]>('/api/v1/tenants');
}

export function fetchCurrentTenant() {
  return apiJson<Tenant>('/api/v1/tenants/current');
}

export function fetchTenantMembers(tenantId: string) {
  return apiJson<TenantMembership[]>(`/api/v1/tenants/${tenantId}/members`);
}

export function fetchTenantUsers(tenantId: string) {
  return apiJson<TenantUserSummary[]>(`/api/v1/tenants/${tenantId}/users`);
}

export function addTenantMember(input: { tenantId: string; userId: string }) {
  return apiJson<TenantMembership>(`/api/v1/tenants/${input.tenantId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId: input.userId }),
  });
}

export function createTenantUser(input: { tenantId: string; draft: CreateUser }) {
  return apiJson<TenantUserSummary>(`/api/v1/tenants/${input.tenantId}/users`, {
    method: 'POST',
    body: JSON.stringify(input.draft),
  });
}

export function setTenantMemberStatus(input: {
  tenantId: string;
  userId: string;
  status: TenantMemberStatus;
}) {
  return apiJson<TenantMembership>(`/api/v1/tenants/${input.tenantId}/members/${input.userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: input.status }),
  });
}
