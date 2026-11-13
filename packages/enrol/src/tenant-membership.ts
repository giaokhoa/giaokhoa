import { ensureTenantContext, markContextDirty } from './contexts';
import { TENANT_MEMBERSHIP_COLUMNS, type EnrolDatabase, type TenantMembershipRow } from './types';

export async function ensureActiveTenantMembership(
  db: EnrolDatabase,
  tenantId: string,
  userId: string,
): Promise<TenantMembershipRow> {
  const existing = await db
    .selectFrom('tenant_memberships')
    .select(TENANT_MEMBERSHIP_COLUMNS)
    .where((eb) => eb.and([
      eb('tenant_memberships.tenant_id', '=', tenantId),
      eb('tenant_memberships.user_id', '=', userId),
    ]))
    .executeTakeFirst();
  if (existing?.status === 'active') return existing;
  let row: TenantMembershipRow;
  if (existing) {
    await db
      .updateTable('tenant_memberships')
      .set({ status: 'active', ended_at: null })
      .where('id', '=', existing.id)
      .execute();
    row = { ...existing, status: 'active', endedAt: null };
  } else {
    row = await db
      .insertInto('tenant_memberships')
      .values({ tenant_id: tenantId, user_id: userId, status: 'active' })
      .returning(TENANT_MEMBERSHIP_COLUMNS)
      .executeTakeFirstOrThrow();
  }
  const tenantCtx = await ensureTenantContext(db, tenantId);
  await markContextDirty(db, tenantCtx.id);
  return row;
}
