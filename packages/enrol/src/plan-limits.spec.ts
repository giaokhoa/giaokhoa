import { describe, expect, it } from 'vitest';
import { PlanLimitsCore } from './plan-limits';
import { FakeEnrolDb, runInPlatformScope, type FakeRow } from './test-support/fake-db';

/**
 * Ghim luật phân giải hạn mức hiệu lực của `PlanLimitsCore.effectiveLimit` (đọc qua hai bề mặt public
 * `effectiveTenantLimit`/`effectiveTeacherLimit`) và các giá trị khởi tạo `SLOT_CONFIG_DEFAULTS`
 * 30/10/3/1/7 — các con số này phải khớp `defaultValue` trong settings registry của
 * `apps/api` (xem C-E11 của báo cáo rà soát): gói trung tâm đang hoạt động 30 slot, gói giáo viên
 * đang hoạt động 10 khoá, mức nền 3/1, ân hạn 7 ngày. Mốc thời gian neo vào `Date.now()` như code
 * thật; các ca biên dùng khoảng lệch đủ xa mốc để không phụ thuộc vài mili-giây chạy test.
 *
 * Chỉ kiểm các lõi đọc qua handle giả — đếm slot và các điểm chặn cần thêm bảng/cột thì do các
 * suite integration của app ghim trên database thật.
 */

const DAY_MS = 86_400_000;
const TENANT_ID = '9a7b4d2e-5f36-4a1e-b28c-3d5e7f90a1b2';
const USER_ID = 'b3f7c21d-8a4e-4c5d-9e62-1f0a2b3c4d5e';
const OTHER_USER_ID = 'c4a8d32e-9b5f-4d6e-af73-2a1b3c4d5e6f';
const COURSE_ID = 'd5b9e43f-0a6f-5e7d-b084-3c2d4e5f6a7b';
const SYS_CTX_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_CTX_ID = '22222222-2222-4222-8222-222222222222';
const COURSE_CTX_ID = '33333333-3333-4333-8333-333333333333';

function createCore(db: FakeEnrolDb): PlanLimitsCore {
  return new PlanLimitsCore(db.handle, runInPlatformScope);
}

/** Một quyền lợi gói (dòng `plan_entitlements`, khoá snake_case như database). */
function entitlement(overrides: FakeRow = {}): FakeRow {
  const now = Date.now();
  return {
    component: 'tenant_plan',
    tenant_id: TENANT_ID,
    user_id: null,
    status: 'active',
    starts_at: new Date(now - DAY_MS),
    expires_at: new Date(now + 30 * DAY_MS),
    ...overrides,
  };
}

/** Một ghi đè cấu hình slot (dòng `plugin_config`, giá trị lưu dạng JSON). */
function slotConfig(name: string, value: string): FakeRow {
  return { plugin: 'payments', name, tenant_id: null, value };
}

describe('PlanLimitsCore — hạn mức gói hiệu lực', () => {
  it('gói trung tâm đang hoạt động trong cửa sổ hiệu lực: áp hạn mức gói 30, không ân hạn', async () => {
    const db = new FakeEnrolDb();
    db.seed('plan_entitlements', [entitlement()]);

    const limit = await createCore(db).effectiveTenantLimit(TENANT_ID);

    expect(limit).toEqual({ limit: 30, inGracePeriod: false, hasActivePlan: true });
  });

  it('không có quyền lợi nào: rơi về mức nền 3 của gói trung tâm', async () => {
    const db = new FakeEnrolDb();

    const limit = await createCore(db).effectiveTenantLimit(TENANT_ID);

    expect(limit).toEqual({ limit: 3, inGracePeriod: false, hasActivePlan: false });
  });

  it('gói trung tâm hết hạn 6 ngày trước (trong 7 ngày ân hạn): vẫn áp hạn mức gói 30 và báo đang ân hạn', async () => {
    const db = new FakeEnrolDb();
    const now = Date.now();
    db.seed('plan_entitlements', [entitlement({
      starts_at: new Date(now - 40 * DAY_MS),
      expires_at: new Date(now - 6 * DAY_MS),
    })]);

    const limit = await createCore(db).effectiveTenantLimit(TENANT_ID);

    expect(limit).toEqual({ limit: 30, inGracePeriod: true, hasActivePlan: false });
  });

  it('gói trung tâm hết hạn 8 ngày trước (quá 7 ngày ân hạn): rơi về mức nền 3', async () => {
    const db = new FakeEnrolDb();
    const now = Date.now();
    db.seed('plan_entitlements', [entitlement({
      starts_at: new Date(now - 40 * DAY_MS),
      expires_at: new Date(now - 8 * DAY_MS),
    })]);

    const limit = await createCore(db).effectiveTenantLimit(TENANT_ID);

    expect(limit).toEqual({ limit: 3, inGracePeriod: false, hasActivePlan: false });
  });

  it('gói trung tâm hết hạn đúng 7 ngày trước: mốc ân hạn đã qua nên rơi về mức nền 3', async () => {
    const db = new FakeEnrolDb();
    const now = Date.now();
    db.seed('plan_entitlements', [entitlement({
      starts_at: new Date(now - 40 * DAY_MS),
      expires_at: new Date(now - 7 * DAY_MS),
    })]);

    const limit = await createCore(db).effectiveTenantLimit(TENANT_ID);

    expect(limit).toEqual({ limit: 3, inGracePeriod: false, hasActivePlan: false });
  });

  it('quyền lợi có cửa sổ hoàn toàn trong tương lai (chưa bắt đầu): không tính ân hạn, rơi về mức nền 3', async () => {
    const db = new FakeEnrolDb();
    const now = Date.now();
    db.seed('plan_entitlements', [entitlement({
      starts_at: new Date(now + DAY_MS),
      expires_at: new Date(now + 30 * DAY_MS),
    })]);

    const limit = await createCore(db).effectiveTenantLimit(TENANT_ID);

    expect(limit).toEqual({ limit: 3, inGracePeriod: false, hasActivePlan: false });
  });

  it('quyền lợi bị đình chỉ (status khác active) dù mới hết hạn: không mở ân hạn, rơi về mức nền 3', async () => {
    const db = new FakeEnrolDb();
    const now = Date.now();
    db.seed('plan_entitlements', [entitlement({
      status: 'suspended',
      starts_at: new Date(now - 40 * DAY_MS),
      expires_at: new Date(now - 3 * DAY_MS),
    })]);

    const limit = await createCore(db).effectiveTenantLimit(TENANT_ID);

    expect(limit).toEqual({ limit: 3, inGracePeriod: false, hasActivePlan: false });
  });

  it('quyền lợi của tenant khác không tính vào hạn mức của tenant này', async () => {
    const db = new FakeEnrolDb();
    db.seed('plan_entitlements', [entitlement({ tenant_id: 'tenant-khac' })]);

    const limit = await createCore(db).effectiveTenantLimit(TENANT_ID);

    expect(limit).toEqual({ limit: 3, inGracePeriod: false, hasActivePlan: false });
  });

  it('ghi đè cấu hình của quản trị thắng mức khởi tạo: tenantplanslots = 5 thì gói đang hoạt động áp 5', async () => {
    const db = new FakeEnrolDb();
    db.seed('plugin_config', [slotConfig('tenantplanslots', '5')]);
    db.seed('plan_entitlements', [entitlement()]);

    const limit = await createCore(db).effectiveTenantLimit(TENANT_ID);

    expect(limit.limit).toBe(5);
    expect(limit.hasActivePlan).toBe(true);
  });

  it('ghi đè cấu hình mức nền thắng mức khởi tạo: tenantplanfreeslots = 9 thì không có gói áp 9', async () => {
    const db = new FakeEnrolDb();
    db.seed('plugin_config', [slotConfig('tenantplanfreeslots', '9')]);

    const limit = await createCore(db).effectiveTenantLimit(TENANT_ID);

    expect(limit.limit).toBe(9);
  });

  it('giá trị cấu hình lưu hỏng (không phải số nguyên không âm): rơi về mức khởi tạo 30', async () => {
    const bad = new FakeEnrolDb();
    bad.seed('plugin_config', [slotConfig('tenantplanslots', '"khong-phai-so"')]);
    bad.seed('plan_entitlements', [entitlement()]);
    const negative = new FakeEnrolDb();
    negative.seed('plugin_config', [slotConfig('tenantplanslots', '-1')]);
    negative.seed('plan_entitlements', [entitlement()]);

    expect((await createCore(bad).effectiveTenantLimit(TENANT_ID)).limit).toBe(30);
    expect((await createCore(negative).effectiveTenantLimit(TENANT_ID)).limit).toBe(30);
  });

  it('gói giáo viên đang hoạt động: áp hạn mức 10 khoá', async () => {
    const db = new FakeEnrolDb();
    db.seed('plan_entitlements', [entitlement({ component: 'teacher_plan', tenant_id: null, user_id: USER_ID })]);

    const limit = await createCore(db).effectiveTeacherLimit(USER_ID);

    expect(limit).toEqual({ limit: 10, inGracePeriod: false, hasActivePlan: true });
  });

  it('không có gói giáo viên: rơi về mức nền 1 khoá', async () => {
    const db = new FakeEnrolDb();

    const limit = await createCore(db).effectiveTeacherLimit(USER_ID);

    expect(limit).toEqual({ limit: 1, inGracePeriod: false, hasActivePlan: false });
  });

  it('quyền lợi gói trung tâm không tính vào hạn mức gói giáo viên', async () => {
    const db = new FakeEnrolDb();
    db.seed('plan_entitlements', [entitlement()]);

    const limit = await createCore(db).effectiveTeacherLimit(USER_ID);

    expect(limit).toEqual({ limit: 1, inGracePeriod: false, hasActivePlan: false });
  });

  it('quyền lợi gói giáo viên của người khác không tính vào hạn mức của giáo viên này', async () => {
    const db = new FakeEnrolDb();
    db.seed('plan_entitlements', [entitlement({ component: 'teacher_plan', tenant_id: null, user_id: OTHER_USER_ID })]);

    const limit = await createCore(db).effectiveTeacherLimit(USER_ID);

    expect(limit).toEqual({ limit: 1, inGracePeriod: false, hasActivePlan: false });
  });

  it('gói giáo viên hết hạn 2 ngày trước (trong ân hạn): vẫn áp hạn mức 10 và báo đang ân hạn', async () => {
    const db = new FakeEnrolDb();
    const now = Date.now();
    db.seed('plan_entitlements', [entitlement({
      component: 'teacher_plan',
      tenant_id: null,
      user_id: USER_ID,
      starts_at: new Date(now - 40 * DAY_MS),
      expires_at: new Date(now - 2 * DAY_MS),
    })]);

    const limit = await createCore(db).effectiveTeacherLimit(USER_ID);

    expect(limit).toEqual({ limit: 10, inGracePeriod: true, hasActivePlan: false });
  });
});

describe('PlanLimitsCore — suy tenant sở hữu một context', () => {
  /** Cây context giả: hệ thống → tenant → khoá học. */
  function seedContextTree(db: FakeEnrolDb): void {
    db.seed('context', [
      { id: SYS_CTX_ID, context_level: 10, instance_id: null, path: `/${SYS_CTX_ID}`, depth: 1, locked: false, version: 1 },
      { id: TENANT_CTX_ID, context_level: 20, instance_id: TENANT_ID, path: `/${SYS_CTX_ID}/${TENANT_CTX_ID}`, depth: 2, locked: false, version: 1 },
      { id: COURSE_CTX_ID, context_level: 50, instance_id: COURSE_ID, path: `/${SYS_CTX_ID}/${TENANT_CTX_ID}/${COURSE_CTX_ID}`, depth: 3, locked: false, version: 1 },
    ]);
  }

  it('context khoá học suy ra tenant qua tổ tiên cấp tenant trong path', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);

    expect(await createCore(db).tenantIdForContext(COURSE_CTX_ID)).toBe(TENANT_ID);
  });

  it('chính context tenant trả về instance của nó', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);

    expect(await createCore(db).tenantIdForContext(TENANT_CTX_ID)).toBe(TENANT_ID);
  });

  it('context không tồn tại thì không thuộc tenant nào', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);

    expect(await createCore(db).tenantIdForContext('44444444-4444-4444-8444-444444444444')).toBeNull();
  });
});
