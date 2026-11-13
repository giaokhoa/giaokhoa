import type { CentreDb } from '@giaokhoa/db';

export async function resolveDefaultTenantId(db: CentreDb, userId: string): Promise<string | null> {
  const rows = await db
    .selectFrom('tenant_memberships')
    .innerJoin('tenants', 'tenants.id', 'tenant_memberships.tenant_id')
    .select(['tenant_memberships.tenant_id as tenantId', 'tenants.kind as kind'])
    .where('tenant_memberships.user_id', '=', userId)
    .where('tenant_memberships.status', '=', 'active')
    .where('tenants.status', '=', 'active')
    .execute();
  const distinct = [...new Map(rows.map((r) => [r.tenantId, r])).values()];
  if (distinct.length === 1) return distinct[0]!.tenantId;
  if (distinct.length > 1) {
    const nonPlatform = distinct.find((r) => r.kind !== 'platform');
    if (nonPlatform) return nonPlatform.tenantId;
  }
  const [zero] = await db
    .selectFrom('tenants')
    .select('id')
    .where('tenants.kind', '=', 'platform')
    .execute();
  return zero?.id ?? null;
}
