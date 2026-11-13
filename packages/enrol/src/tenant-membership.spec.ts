import { describe, expect, it } from 'vitest';
import { ensureActiveTenantMembership } from './tenant-membership';
import { FakeEnrolDb } from './test-support/fake-db';

/**
 * Ghim tính idempotent của `ensureActiveTenantMembership`
 * (`tenant-membership.ts`), kể cả khi hai phía cùng chèn đồng thời
 * (C-E5): chèn trùng (tenant_id, user_id) được xử lý bằng
 * `onConflict doNothing` + đọc lại dòng hiện hữu, không ném unique
 * violation — đúng mẫu `insertAssignment` ở `role-assignment.ts`,
 * dựa trên ràng buộc duy nhất
 * `tenant_memberships_tenant_user_unique` trong migration baseline.
 */

const TENANT_ID = '9a7b4d2e-5f36-4a1e-b28c-3d5e7f90a1b2';
const USER_ID = 'b3f7c21d-8a4e-4c5d-9e62-1f0a2b3c4d5e';

/** Một dòng membership (khoá snake_case như database). */
function membershipRow(id: string, status: string, endedAt: Date | null): Record<string, unknown> {
  return { id, tenant_id: TENANT_ID, user_id: USER_ID, status, joined_at: new Date('2026-01-01T00:00:00Z'), ended_at: endedAt };
}

describe('ensureActiveTenantMembership — membership active idempotent', () => {
  it('chưa có membership: chèn mới ở trạng thái active và đảm bảo context tenant', async () => {
    const db = new FakeEnrolDb();

    const row = await ensureActiveTenantMembership(db.handle, TENANT_ID, USER_ID);

    expect(row.tenantId).toBe(TENANT_ID);
    expect(row.userId).toBe(USER_ID);
    expect(row.status).toBe('active');
    // Lưu ý: `ended_at` của dòng vừa chèn do database mặc định NULL — bản giả không mô phỏng giá trị mặc định của cột nên không khẳng định giá trị trả về ở đây (đường kích hoạt lại tự đặt null tường minh nên vẫn được khẳng định ở test dưới).
    expect(db.rows('tenant_memberships')).toHaveLength(1);
    // Đường ghi kết thúc bằng việc đảm bảo context tenant (hệ thống + tenant).
    expect(db.rows('context').filter((r) => r.context_level === 20 && r.instance_id === TENANT_ID)).toHaveLength(1);
  });

  it('membership đã active: trả nguyên dòng hiện hữu, không ghi gì thêm', async () => {
    const db = new FakeEnrolDb();
    db.seed('tenant_memberships', [membershipRow('mem-1', 'active', null)]);

    const row = await ensureActiveTenantMembership(db.handle, TENANT_ID, USER_ID);

    expect(row.id).toBe('mem-1');
    expect(db.log.filter((entry) => entry.kind === 'insert' || entry.kind === 'update')).toHaveLength(0);
  });

  it('membership tồn tại nhưng đã kết thúc: kích hoạt lại (status về active, xoá mốc kết thúc)', async () => {
    const db = new FakeEnrolDb();
    db.seed('tenant_memberships', [membershipRow('mem-1', 'ended', new Date('2026-06-01T00:00:00Z'))]);

    const row = await ensureActiveTenantMembership(db.handle, TENANT_ID, USER_ID);

    expect(row.id).toBe('mem-1');
    expect(row.status).toBe('active');
    expect(row.endedAt).toBeNull();
    expect(db.rows('tenant_memberships')).toHaveLength(1);
    expect(db.rows('tenant_memberships')[0]!.status).toBe('active');
    expect(db.rows('tenant_memberships')[0]!.ended_at).toBeNull();
  });

  it('hai phía cùng chèn đồng thời, phía thắng đã chèn dòng active: phía thua trả luôn dòng đó, không ném lỗi', async () => {
    const winner = membershipRow('mem-thang', 'active', null);
    let planted = false;
    const db = new FakeEnrolDb({
      beforeInsert: (fake, table, values) => {
        // Mô phỏng phía ghi đồng thời: chèn dòng thắng ngay trước lần chèn thật.
        if (table === 'tenant_memberships' && !planted && values.tenant_id === TENANT_ID) {
          planted = true;
          fake.seed('tenant_memberships', [winner]);
        }
      },
    });

    const row = await ensureActiveTenantMembership(db.handle, TENANT_ID, USER_ID);

    expect(row.id).toBe('mem-thang');
    expect(row.status).toBe('active');
    expect(db.rows('tenant_memberships')).toHaveLength(1);
    // Dòng đã active nên đường no-op: không cập nhật membership nào.
    expect(db.log.filter((entry) => entry.kind === 'update' && entry.table === 'tenant_memberships')).toHaveLength(0);
  });

  it('hai phía cùng chèn đồng thời, phía thắng chèn dòng chưa active: phía thua kích hoạt lại đúng dòng đó', async () => {
    const winner = membershipRow('mem-thang', 'ended', new Date('2026-06-01T00:00:00Z'));
    let planted = false;
    const db = new FakeEnrolDb({
      beforeInsert: (fake, table, values) => {
        if (table === 'tenant_memberships' && !planted && values.tenant_id === TENANT_ID) {
          planted = true;
          fake.seed('tenant_memberships', [winner]);
        }
      },
    });

    const row = await ensureActiveTenantMembership(db.handle, TENANT_ID, USER_ID);

    expect(row.id).toBe('mem-thang');
    expect(row.status).toBe('active');
    expect(row.endedAt).toBeNull();
    expect(db.rows('tenant_memberships')).toHaveLength(1);
    expect(db.rows('tenant_memberships')[0]!.status).toBe('active');
  });
});
