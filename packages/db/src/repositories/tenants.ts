import { sql, type Insertable, type RawBuilder, type Updateable } from 'kysely';
import type { CentreDb, CentreDB } from '../client';
import type { Json } from '../types/centre-db';

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  kind: string;
  status: string;
  plan: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantMembershipRow {
  id: string;
  tenantId: string;
  userId: string;
  status: string;
  joinedAt: Date;
  endedAt: Date | null;
}

export interface TenantConfigRow {
  id: string;
  tenantId: string;
  key: string;
  value: unknown;
  updatedAt: Date;
}

export interface NewTenant {
  id?: string;
  slug: string;
  name: string;
  kind: string;
  status?: string;
  plan?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewTenantMembership {
  id?: string;
  tenantId: string;
  userId: string;
  status?: string;
  joinedAt?: Date;
  endedAt?: Date | null;
}

export const PLATFORM_TENANT_SLUG = 'trang-chinh';
export const DEFAULT_SCHOOL_TENANT_SLUG = 'truong-mac-dinh';

function jsonbValue(value: unknown): RawBuilder<Json> {
  return sql<Json>`${JSON.stringify(value as Json)}::jsonb`;
}

const TENANT_COLUMNS = [
  'id',
  'slug',
  'name',
  'kind',
  'status',
  'plan',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const TENANT_MEMBERSHIP_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'user_id as userId',
  'status',
  'joined_at as joinedAt',
  'ended_at as endedAt',
] as const;

const TENANT_CONFIG_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'key',
  'value',
  'updated_at as updatedAt',
] as const;

function tenantInsertValues(values: NewTenant): Insertable<CentreDB['tenants']> {
  const row: Insertable<CentreDB['tenants']> = {
    slug: values.slug,
    name: values.name,
    kind: values.kind,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.status !== undefined) row.status = values.status;
  if (values.plan !== undefined) row.plan = values.plan;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function tenantUpdateSet(patch: Partial<TenantRow>): Updateable<CentreDB['tenants']> {
  const set: Updateable<CentreDB['tenants']> = {};
  if (patch.slug !== undefined) set.slug = patch.slug;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.plan !== undefined) set.plan = patch.plan;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  return set;
}

function membershipInsertValues(values: NewTenantMembership): Insertable<CentreDB['tenant_memberships']> {
  const row: Insertable<CentreDB['tenant_memberships']> = {
    tenant_id: values.tenantId,
    user_id: values.userId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.status !== undefined) row.status = values.status;
  if (values.joinedAt !== undefined) row.joined_at = values.joinedAt;
  if (values.endedAt !== undefined) row.ended_at = values.endedAt;
  return row;
}

function membershipUpdateSet(patch: Partial<TenantMembershipRow>): Updateable<CentreDB['tenant_memberships']> {
  const set: Updateable<CentreDB['tenant_memberships']> = {};
  if (patch.tenantId !== undefined) set.tenant_id = patch.tenantId;
  if (patch.userId !== undefined) set.user_id = patch.userId;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.joinedAt !== undefined) set.joined_at = patch.joinedAt;
  if (patch.endedAt !== undefined) set.ended_at = patch.endedAt;
  return set;
}

export class TenantsRepository {
  constructor(private readonly handle: CentreDb) {}

  get dbHandle(): CentreDb { return this.handle; }

  async insertTenant(v: NewTenant): Promise<TenantRow> {
    const rows = await this.handle
      .insertInto('tenants')
      .values(tenantInsertValues(v))
      .returning(TENANT_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getTenant(id: string): Promise<TenantRow | undefined> {
    return this.handle
      .selectFrom('tenants')
      .select(TENANT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getTenantBySlug(slug: string): Promise<TenantRow | undefined> {
    return this.handle
      .selectFrom('tenants')
      .select(TENANT_COLUMNS)
      .where('slug', '=', slug)
      .executeTakeFirst();
  }

  private platformTenantCache: TenantRow | undefined;

  async getPlatformTenant(): Promise<TenantRow | undefined> {
    if (!this.platformTenantCache) {
      this.platformTenantCache = await this.getTenantBySlug(PLATFORM_TENANT_SLUG);
    }
    return this.platformTenantCache;
  }

  async listTenants(): Promise<TenantRow[]> {
    return this.handle
      .selectFrom('tenants')
      .select(TENANT_COLUMNS)
      .orderBy('created_at', 'asc')
      .execute();
  }

  async updateTenant(id: string, patch: Partial<TenantRow>): Promise<void> {
    await this.handle
      .updateTable('tenants')
      .set({ ...tenantUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async insertMembership(v: NewTenantMembership): Promise<TenantMembershipRow> {
    const rows = await this.handle
      .insertInto('tenant_memberships')
      .values(membershipInsertValues(v))
      .returning(TENANT_MEMBERSHIP_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getMembership(tenantId: string, userId: string): Promise<TenantMembershipRow | undefined> {
    return this.handle
      .selectFrom('tenant_memberships')
      .select(TENANT_MEMBERSHIP_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  async listMembershipsForUser(userId: string): Promise<TenantMembershipRow[]> {
    return this.handle
      .selectFrom('tenant_memberships')
      .select(TENANT_MEMBERSHIP_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('joined_at', 'asc')
      .execute();
  }

  async listMembershipsForTenant(tenantId: string): Promise<TenantMembershipRow[]> {
    return this.handle
      .selectFrom('tenant_memberships')
      .select(TENANT_MEMBERSHIP_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .orderBy('joined_at', 'asc')
      .execute();
  }

  async updateMembership(id: string, patch: Partial<TenantMembershipRow>): Promise<void> {
    await this.handle
      .updateTable('tenant_memberships')
      .set(membershipUpdateSet(patch))
      .where('id', '=', id)
      .execute();
  }

  async getConfigValue(tenantId: string, key: string): Promise<TenantConfigRow | undefined> {
    const row = await this.handle
      .selectFrom('tenant_config')
      .select(TENANT_CONFIG_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .where('key', '=', key)
      .executeTakeFirst();
    return row as TenantConfigRow | undefined;
  }

  async listConfigForTenant(tenantId: string): Promise<TenantConfigRow[]> {
    const rows = await this.handle
      .selectFrom('tenant_config')
      .select(TENANT_CONFIG_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .execute();
    return rows as TenantConfigRow[];
  }

  async upsertConfigValue(tenantId: string, key: string, value: unknown): Promise<void> {
    const stored = value === null || value === undefined ? null : jsonbValue(value);
    await this.handle
      .insertInto('tenant_config')
      .values({ tenant_id: tenantId, key, value: stored })
      .onConflict((oc) => oc.columns(['tenant_id', 'key']).doUpdateSet({
        value: stored,
        updated_at: new Date(),
      }))
      .execute();
  }

  async deleteConfigValue(tenantId: string, key: string): Promise<void> {
    await this.handle
      .deleteFrom('tenant_config')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', key)
      .execute();
  }
}
