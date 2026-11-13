import { describe, expect, it } from 'vitest';
import { PlanLimitsCore, type EnrolDatabase } from '@giaokhoa/enrol';
import { tenantAls, type TenantAlsStore } from '../tenants/tenant-als';
import { PlanLimitsService } from './plan-limits.service';
import { RoleSeparationService } from './role-separation.service';
import { EnrolService } from '../enrol/enrol.service';
import { AuthService } from '../auth/auth.service';

function makeLazyQuery(seen: Array<TenantAlsStore | undefined>) {
  return {
    then(resolve: (value: unknown[]) => void) {
      seen.push(tenantAls.getStore());
      resolve([]);
    },
  };
}

function makeFakeDb(seen: Array<TenantAlsStore | undefined>): EnrolDatabase {
  const terminal = {
    execute: async (): Promise<unknown[]> => {
      seen.push(tenantAls.getStore());
      return [];
    },
    executeTakeFirst: async (): Promise<undefined> => {
      seen.push(tenantAls.getStore());
      return undefined;
    },
  };
  return {
    selectFrom: () => ({ select: () => ({ where: () => terminal }) }),
  } as unknown as EnrolDatabase;
}

const CALLER_STORE: TenantAlsStore = { tenantId: 'tenant-goi', spaceSlug: 'trung-tam-goi' };

describe('Lõi kiểm hạn mức gói — ngữ cảnh đọc membership khi kích hoạt lại tài khoản', () => {
  it('closure thật của PlanLimitsService giữ spaceSlug khi vào ngữ cảnh platform', async () => {
    const seen: Array<TenantAlsStore | undefined> = [];
    const service = new PlanLimitsService({ routedKysely: makeFakeDb(seen) } as never);
    await tenantAls.run(CALLER_STORE, () => service.assertUserReactivationWithinSlotLimits('user-1'));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.platform).toBe(true);
    expect(seen[0]?.spaceSlug).toBe('trung-tam-goi');
  });

  it('closure thật của RoleSeparationService giữ spaceSlug khi vào ngữ cảnh platform', async () => {
    const seen: Array<TenantAlsStore | undefined> = [];
    const service = new RoleSeparationService({ routedKysely: makeFakeDb(seen) } as never);
    await tenantAls.run(CALLER_STORE, () => service.hasTeachingCoverageForCourse('user-1', 'course-1'));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.platform).toBe(true);
    expect(seen[0]?.spaceSlug).toBe('trung-tam-goi');
  });

  it('closure thật của EnrolService giữ spaceSlug khi vào ngữ cảnh platform', async () => {
    const seen: Array<TenantAlsStore | undefined> = [];
    const fakeDb = makeFakeDb(seen);
    const service = new EnrolService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { routedKysely: fakeDb } as never,
    );
    const surface = (service as unknown as { materialization: { planLimitsCore: PlanLimitsCore } })
      .materialization;
    await tenantAls.run(CALLER_STORE, () => surface.planLimitsCore.assertUserReactivationWithinSlotLimits('user-1'));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.platform).toBe(true);
    expect(seen[0]?.spaceSlug).toBe('trung-tam-goi');
  });

  it('closure thật của centreClaimForTenant giữ spaceSlug khi vào ngữ cảnh platform', async () => {
    const seen: Array<TenantAlsStore | undefined> = [];
    const tenants = {
      getTenant: async () => {
        seen.push(tenantAls.getStore());
        return { slug: 'trung-tam-goi' };
      },
    };
    const spaceDb = {
      resolveTarget: async () => ({ mode: 'dedicated', spaceId: 'space-1' }),
    };
    const auth = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      tenants as never,
      {} as never,
      {} as never,
      {} as never,
      spaceDb as never,
    );
    const claim = await tenantAls.run(CALLER_STORE, () =>
      (auth as unknown as { centreClaimForTenant: (tenantId: string) => Promise<string | undefined> }).centreClaimForTenant(
        'tenant-goi',
      ),
    );
    expect(claim).toBe('space-1');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.platform).toBe(true);
    expect(seen[0]?.spaceSlug).toBe('trung-tam-goi');
  });

  it('callback trả thẳng thenable lười ra khỏi cổng platform thì lượt đọc chạy ngoài ngữ cảnh platform (tái hiện cơ chế lỗi A4)', async () => {
    const seen: Array<TenantAlsStore | undefined> = [];
    const lazy = makeLazyQuery(seen);
    const returned = tenantAls.run({ platform: true }, () => lazy);
    await tenantAls.run({ tenantId: 'tenant-goi' }, async () => returned);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.platform).toBeUndefined();
    expect(seen[0]?.tenantId).toBe('tenant-goi');
  });
});
