import type { TenantMembership } from '@giaokhoa/contracts';


export interface TenantUserSummary {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email?: string;
  suspended: boolean;
  deleted: boolean;
}

export type TenantMemberStatus = TenantMembership['status'];
