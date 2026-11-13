import { describe, expect, it, vi } from 'vitest';
import { TenantsRepository, type TenantRow } from './tenants';

describe('TenantsRepository.getPlatformTenant — cache singleton chỉ khi đã tra thấy', () => {
  function buildDb(row: TenantRow | undefined) {
    const state = { selectCalls: 0 };
    const db = {
      selectFrom: vi.fn(() => {
        state.selectCalls += 1;
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: () => Promise.resolve(row),
            }),
          }),
        };
      }),
    };
    return { db, state };
  }

  it('đã tra thấy: các lần gọi sau dùng bản cache, cơ sở dữ liệu chỉ bị tra đúng một lần', async () => {
    const zero = { id: 'tenant-zero-id', slug: 'trang-chinh' } as TenantRow;
    const { db, state } = buildDb(zero);
    const repo = new TenantsRepository(db as never);

    await expect(repo.getPlatformTenant()).resolves.toBe(zero);
    await expect(repo.getPlatformTenant()).resolves.toBe(zero);
    await expect(repo.getPlatformTenant()).resolves.toBe(zero);

    expect(state.selectCalls).toBe(1);
  });

  it('chưa tra thấy (trước bootstrap seed): không cache — mỗi lần gọi vẫn tra cơ sở dữ liệu', async () => {
    const { db, state } = buildDb(undefined);
    const repo = new TenantsRepository(db as never);

    await expect(repo.getPlatformTenant()).resolves.toBeUndefined();
    await expect(repo.getPlatformTenant()).resolves.toBeUndefined();

    expect(state.selectCalls).toBe(2);
  });
});
