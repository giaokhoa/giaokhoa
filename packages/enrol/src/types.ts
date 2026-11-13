import type { CentreDb, CentreTx } from '@giaokhoa/db';


export type EnrolDatabase = CentreDb | CentreTx;

export interface SharedOutboxEventInput {
  aggregate: string;
  type: string;
  payload: Record<string, unknown>;
  tenantId?: string | null;
}

export type SharedOutboxTx = CentreTx;

export interface SharedOutboxPort {
  enqueue(tx: SharedOutboxTx, input: SharedOutboxEventInput): Promise<void>;
  enqueueStandalone(input: SharedOutboxEventInput): Promise<void>;
}

export type PlatformScopeRunner = <T>(fn: () => Promise<T>) => Promise<T>;

export interface SharedSurfaceDeps {
  db: CentreDb;
  outbox: SharedOutboxPort;
  runInPlatformScope: PlatformScopeRunner;
}


export interface ContextRow {
  id: string;
  contextLevel: number;
  instanceId: string | null;
  path: string;
  depth: number;
  locked: boolean;
  version: number;
}

export interface RoleRow {
  id: string;
  name: string;
  shortName: string;
  description: string;
  sortOrder: number;
  archetype: string | null;
}

export interface RoleAssignmentRow {
  id: string;
  roleId: string;
  userId: string;
  contextId: string;
  updatedAt: Date;
  modifierId: string | null;
  component: string;
  itemId: string | null;
}

export interface TenantMembershipRow {
  id: string;
  tenantId: string;
  userId: string;
  status: string;
  joinedAt: Date;
  endedAt: Date | null;
}

export type { EnrolRow as EnrolInstanceRow, UserEnrolmentRow } from '@giaokhoa/db/repositories/enrol';


export const CONTEXT_COLUMNS = [
  'id',
  'context_level as contextLevel',
  'instance_id as instanceId',
  'path',
  'depth',
  'locked',
  'version',
] as const;

export const ROLE_COLUMNS = [
  'id',
  'name',
  'short_name as shortName',
  'description',
  'sort_order as sortOrder',
  'archetype',
] as const;

export const ROLE_ASSIGNMENT_COLUMNS = [
  'id',
  'role_id as roleId',
  'user_id as userId',
  'context_id as contextId',
  'updated_at as updatedAt',
  'modifier_id as modifierId',
  'component',
  'item_id as itemId',
] as const;

export const TENANT_MEMBERSHIP_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'user_id as userId',
  'status',
  'joined_at as joinedAt',
  'ended_at as endedAt',
] as const;

export const ENROL_COLUMNS = [
  'id',
  'course_id as courseId',
  'enrol',
  'name',
  'role_id as roleId',
  'status',
  'enrol_period as enrolPeriod',
  'time_start as timeStart',
  'time_end as timeEnd',
  'enrolment_key as enrolmentKey',
  'custom_int1 as customInt1',
  'custom_int2 as customInt2',
  'custom_text1 as customText1',
  'cost',
  'currency',
  'payment_account_id as paymentAccountId',
  'send_welcome_message as sendWelcomeMessage',
  'welcome_message as welcomeMessage',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

export const USER_ENROLMENT_COLUMNS = [
  'id',
  'enrol_id as enrolId',
  'user_id as userId',
  'status',
  'time_start as timeStart',
  'time_end as timeEnd',
  'modifier_id as modifierId',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;
