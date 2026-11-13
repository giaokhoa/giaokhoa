import { describe, expect, it } from 'vitest';
import { tenantAls as dbTenantAls } from './tenant-als';
import { tenantAls as legacyTenantAls } from '../modules/tenants/tenant-als';

/**
 * Cổng hồi quy của việc đưa AsyncLocalStorage về tầng dữ liệu:
 * mọi service dùng lối import tương thích phải đọc cùng một context,
 * nếu tạo hai ALS sẽ mất GUC tenant và định tuyến kho riêng.
 */
describe('Một nguồn ngữ cảnh tenant cho tầng DB và feature', () => {
  it('hai lối import nhận cùng singleton và cùng ngữ cảnh tenant/space khi chạy bất đồng bộ', async () => {
    expect(legacyTenantAls).toBe(dbTenantAls);
    const scoped = await dbTenantAls.run({
      tenantId: 'tenant-test', spaceSlug: 'space-test', userId: 'user-test',
    }, async () => {
      await Promise.resolve();
      return legacyTenantAls.getStore();
    });
    expect(scoped).toEqual({
      tenantId: 'tenant-test', spaceSlug: 'space-test', userId: 'user-test',
    });
    expect(dbTenantAls.getStore()).toBeUndefined();
  });
});
