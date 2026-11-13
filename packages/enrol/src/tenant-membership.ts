import { ensureTenantContext, markContextDirty } from './contexts';
import { TENANT_MEMBERSHIP_COLUMNS, type EnrolDatabase, type TenantMembershipRow } from './types';

/**
 * Kích hoạt lại một dòng membership (status về `active`, xoá mốc kết
 * thúc) và trả dòng sau cập nhật. Dùng chung cho đường "đã có dòng
 * nhưng chưa active" và đường "đua chèn, đọc lại được dòng chưa
 * active" của `ensureActiveTenantMembership`.
 *
 * @param db - tay cầm Kysely của host.
 * @param existing - dòng membership hiện hữu cần kích hoạt lại.
 */
async function reactivateMembership(db: EnrolDatabase, existing: TenantMembershipRow): Promise<TenantMembershipRow> {
  await db
    .updateTable('tenant_memberships')
    .set({ status: 'active', ended_at: null })
    .where('id', '=', existing.id)
    .execute();
  return { ...existing, status: 'active', endedAt: null };
}

/**
 * Đảm bảo membership `active` của một người dùng trong một tenant ở
 * tầng dữ liệu (dùng chung cho funnel ghi danh và bề mặt membership
 * của host): ghi danh vào khoá của tenant nào thì thuộc tenant đó —
 * membership active được bảo đảm ngay tại funnel ghi danh để cổng
 * membership của phép đánh giá quyền cho qua các vai ghi danh vừa
 * cấp.
 *
 * Flow: membership đã `active` thì trả nguyên dòng hiện hữu (no-op);
 * membership tồn tại ở trạng thái khác thì kích hoạt lại (status về
 * `active`, xoá mốc kết thúc); chưa có thì chèn mới ở trạng thái
 * `active`. Chèn mới đua đồng thời (hai phía cùng qua cửa "chưa có"
 * rồi cùng chèn) thì phía thua KHÔNG ném unique violation: chèn
 * bằng `onConflict doNothing` rồi đọc lại dòng hiện hữu (theo mẫu
 * `insertAssignment` ở `role-assignment.ts`) — ràng buộc duy nhất
 * `tenant_memberships_tenant_user_unique` trên (tenant_id, user_id)
 * là căn cứ của hành vi này (xem migration baseline của
 * `@giaokhoa/db`). Cả hai đường ghi đều kết thúc bằng việc đảm bảo context
 * tenant tồn tại và đánh dấu dirty context đó (membership là dữ
 * kiện cổng của phép đánh giá quyền trong cây của tenant).
 *
 * Ngữ cảnh RLS: hàm này kế thừa ngữ cảnh của nơi gọi — các bề mặt
 * gọi nó (funnel ghi danh, tạo tenant/user, bootstrap seed) tự bọc
 * ngữ cảnh phù hợp ở tầng của chúng, như hành vi hiện hành.
 *
 * @param db - tay cầm Kysely của host.
 * @param tenantId - tenant đích.
 * @param userId - người dùng cần thuộc tenant.
 * @returns dòng membership ở trạng thái `active`.
 */
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
    row = await reactivateMembership(db, existing);
  } else {
    const inserted = await db
      .insertInto('tenant_memberships')
      .values({ tenant_id: tenantId, user_id: userId, status: 'active' })
      .onConflict((oc) => oc.doNothing())
      .returning(TENANT_MEMBERSHIP_COLUMNS)
      .executeTakeFirst();
    if (inserted) {
      row = inserted;
    } else {
      // Đua chèn đồng thời: phía khác đã chèn dòng membership trước — đọc lại dòng hiện hữu; đã active thì trả luôn (phía thắng đã đánh dấu dirty context), chưa active thì kích hoạt lại.
      const winner = await db
        .selectFrom('tenant_memberships')
        .select(TENANT_MEMBERSHIP_COLUMNS)
        .where((eb) => eb.and([
          eb('tenant_memberships.tenant_id', '=', tenantId),
          eb('tenant_memberships.user_id', '=', userId),
        ]))
        .executeTakeFirstOrThrow();
      if (winner.status === 'active') return winner;
      row = await reactivateMembership(db, winner);
    }
  }
  const tenantCtx = await ensureTenantContext(db, tenantId);
  await markContextDirty(db, tenantCtx.id);
  return row;
}
