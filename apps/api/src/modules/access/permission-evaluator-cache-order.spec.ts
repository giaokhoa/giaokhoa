import { describe, expect, it } from 'vitest';
import type { Cache } from 'cache-manager';
import type { ConfigService } from '@nestjs/config';
import type { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { AccessRepository, type ContextRow } from '@giaokhoa/db/repositories/access';
import { ContextsService } from './contexts.service';
import { CAP_ALLOW } from './domain/permission';
import { PermissionEvaluator } from './permission-evaluator.service';
import { tenantAls } from '../tenants/tenant-als';


const SYS_ID = '00000000-0000-4000-8000-000000000010';
const TEN_ID = '00000000-0000-4000-8000-000000000020';
const CRS_ID = '00000000-0000-4000-8000-000000000050';
const OUT_ID = '00000000-0000-4000-8000-000000000060';

interface AssignmentRow { userId: string; roleId: string; contextId: string }
interface OverrideRow { roleId: string; capability: string; contextId: string; permission: number }

function makeWorld(opts?: { databaseUrl?: string; cacheStore?: Map<string, unknown>; contextDatabaseName?: () => string | undefined }) {
  const contexts: ContextRow[] = [
    { id: SYS_ID, contextLevel: 10, instanceId: null, path: `/${SYS_ID}`, depth: 1, version: 1 } as ContextRow,
    { id: TEN_ID, contextLevel: 20, instanceId: 'tenant-1', path: `/${SYS_ID}/${TEN_ID}`, depth: 2, version: 1 } as ContextRow,
    { id: CRS_ID, contextLevel: 50, instanceId: 'course-1', path: `/${SYS_ID}/${TEN_ID}/${CRS_ID}`, depth: 3, version: 1 } as ContextRow,
    { id: OUT_ID, contextLevel: 50, instanceId: 'course-2', path: `/${SYS_ID}/${OUT_ID}`, depth: 2, version: 1 } as ContextRow,
  ];
  const state = {
    tenantInfo: { kind: 'center', status: 'active' } as { kind: string; status: string } | undefined,
    memberships: new Map<string, string>([['tenant-1|user-member', 'active'], ['tenant-1|user-plain', 'active']]),
    siteAdmins: ['user-admin'] as string[],
    platformSiteAdmins: ['user-admin'] as string[],
    assignments: [
      { userId: 'user-member', roleId: 'role-viewer', contextId: CRS_ID },
      { userId: 'user-outsider', roleId: 'role-viewer', contextId: CRS_ID },
    ] as AssignmentRow[],
    overrides: [
      { roleId: 'role-viewer', capability: 'course:view', contextId: CRS_ID, permission: CAP_ALLOW },
      { roleId: 'role-guest', capability: 'files:view', contextId: SYS_ID, permission: CAP_ALLOW },
    ] as OverrideRow[],
  };
  const counters = {
    contextReads: 0,
    gateInfoReads: 0,
    membershipReads: 0,
    configReads: 0,
    assignmentReads: 0,
    overrideReads: 0,
  };
  const rolesByShortname: Record<string, { id: string; shortName: string }> = {
    user: { id: 'role-user', shortName: 'user' },
    guest: { id: 'role-guest', shortName: 'guest' },
    viewer: { id: 'role-viewer', shortName: 'viewer' },
  };

  const repo = {
    async getContextById(id: string) {
      counters.contextReads += 1;
      return contexts.find((c) => c.id === id);
    },
    async getContextsByIds(ids: string[]) {
      counters.contextReads += 1;
      return ids.map((id) => contexts.find((c) => c.id === id)).filter(Boolean) as ContextRow[];
    },
    async bumpContextVersions(pathPrefix: string) {
      for (const c of contexts) {
        if (c.path === pathPrefix || c.path.startsWith(`${pathPrefix}/`)) c.version += 1;
      }
    },
    async getTenantGateInfo(tenantId: string) {
      counters.gateInfoReads += 1;
      return tenantId === 'tenant-1' ? state.tenantInfo : undefined;
    },
    async getMembershipStatus(tenantId: string, userId: string) {
      counters.membershipReads += 1;
      return state.memberships.get(`${tenantId}|${userId}`);
    },
    async getConfigValue(key: string) {
      counters.configReads += 1;
      if (key !== 'siteadmins') return undefined;
      const store = tenantAls.getStore();
      if (store?.platform && !store?.spaceSlug) return state.platformSiteAdmins;
      return state.siteAdmins;
    },
    async setConfigValue(key: string, value: unknown) {
      if (key === 'siteadmins') state.siteAdmins = value as string[];
    },
    async getAssignmentsForUserInContexts(userId: string, contextIds: string[]) {
      counters.assignmentReads += 1;
      return state.assignments.filter((a) => a.userId === userId && contextIds.includes(a.contextId));
    },
    async getRoleByShortname(shortName: string) {
      return rolesByShortname[shortName];
    },
    async getRoleById(id: string) {
      return Object.values(rolesByShortname).find((r) => r.id === id);
    },
    async getOverridesForRoles(roleIds: string[], capability: string, contextIds: string[]) {
      counters.overrideReads += 1;
      return state.overrides.filter((o) => roleIds.includes(o.roleId) && o.capability === capability && contextIds.includes(o.contextId));
    },
  };

  const cacheStore = opts?.cacheStore ?? new Map<string, unknown>();
  const cache = {
    async get(key: string) { return cacheStore.get(key); },
    async set(key: string, value: unknown) { cacheStore.set(key, value); },
    async del(key: string) { cacheStore.delete(key); },
  };

  const repoCast = repo as unknown as AccessRepository;
  const contextsService = new ContextsService(repoCast);
  const config = {
    getOrThrow: () => opts?.databaseUrl ?? 'postgres://user:pass@localhost:5432/giaokhoa_test_api',
  } as unknown as ConfigService;
  const spaceDb = {
    currentContextDatabaseName: () => {
      const store = tenantAls.getStore();
      if (store?.platform && !store?.spaceSlug) return undefined;
      return opts?.contextDatabaseName?.();
    },
  } as unknown as SpaceDatabaseService;
  const evaluator = new PermissionEvaluator(repoCast, contextsService, cache as unknown as Cache, config, spaceDb);
  return { state, counters, contextsService, evaluator, cacheStore };
}

describe('PermissionEvaluator — ma trận cho/chặn theo vai trò và ngữ cảnh (cache nguội)', () => {
  it('thành viên có gán vai và override ALLOW tại khoá trong tenant thì được cho', async () => {
    const { evaluator } = makeWorld();
    await expect(evaluator.hasCapability('user-member', 'course:view', CRS_ID)).resolves.toBe(true);
  });

  it('có gán vai trong cây tenant nhưng không có membership thì cổng tenant chặn', async () => {
    const { evaluator } = makeWorld();
    await expect(evaluator.hasCapability('user-outsider', 'course:view', CRS_ID)).resolves.toBe(false);
  });

  it('thành viên không có override cho capability thì bị chặn', async () => {
    const { evaluator } = makeWorld();
    await expect(evaluator.hasCapability('user-member', 'course:delete', CRS_ID)).resolves.toBe(false);
  });

  it('site admin được cho ngoài cây tenant qua lối tắt', async () => {
    const { evaluator } = makeWorld();
    await expect(evaluator.hasCapability('user-admin', 'course:view', OUT_ID)).resolves.toBe(true);
  });

  it('site admin không có membership thì vẫn bị cổng chặn trong cây tenant (không lối tắt)', async () => {
    const { evaluator } = makeWorld();
    await expect(evaluator.hasCapability('user-admin', 'course:view', CRS_ID)).resolves.toBe(false);
  });

  it('thành viên chỉ có vai mặc định user, không override nào cho capability, thì bị chặn', async () => {
    const { evaluator } = makeWorld();
    await expect(evaluator.hasCapability('user-plain', 'course:view', CRS_ID)).resolves.toBe(false);
  });

  it('vai mặc định phân biệt user và guest: cùng một capability, user bị chặn còn guest được cho theo override của vai guest', async () => {
    const { evaluator } = makeWorld();
    await expect(evaluator.hasCapability('user-plain', 'files:view', SYS_ID)).resolves.toBe(false);
    await expect(evaluator.hasCapability('user-plain', 'files:view', SYS_ID, { isGuest: true })).resolves.toBe(true);
  });
});

describe('PermissionEvaluator — lượt kiểm lặp lại khi cache đã ấm', () => {
  it('cho cùng kết quả và không hỏi lại tầng dữ liệu đánh giá, cổng tenant và cấu hình; chỉ dấu version được đọc lại từ DB', async () => {
    const { evaluator, counters } = makeWorld();
    await expect(evaluator.hasCapability('user-member', 'course:view', CRS_ID)).resolves.toBe(true);
    await expect(evaluator.hasCapability('user-member', 'course:delete', CRS_ID)).resolves.toBe(false);
    await expect(evaluator.hasCapability('user-admin', 'course:view', OUT_ID)).resolves.toBe(true);
    await expect(evaluator.hasCapability('user-plain', 'course:view', CRS_ID)).resolves.toBe(false);

    const before = { ...counters };
    await expect(evaluator.hasCapability('user-member', 'course:view', CRS_ID)).resolves.toBe(true);
    await expect(evaluator.hasCapability('user-member', 'course:delete', CRS_ID)).resolves.toBe(false);
    await expect(evaluator.hasCapability('user-admin', 'course:view', OUT_ID)).resolves.toBe(true);
    await expect(evaluator.hasCapability('user-plain', 'course:view', CRS_ID)).resolves.toBe(false);

    expect(counters.assignmentReads).toBe(before.assignmentReads);
    expect(counters.overrideReads).toBe(before.overrideReads);
    expect(counters.gateInfoReads).toBe(before.gateInfoReads);
    expect(counters.membershipReads).toBe(before.membershipReads);
    expect(counters.configReads).toBe(before.configReads);
    expect(counters.contextReads).toBeGreaterThan(before.contextReads);
  });
});

describe('PermissionEvaluator — thay đổi dữ kiện quyền có hiệu lực tức thì dù kết quả đã cache', () => {
  it('membership bị đình chỉ (kèm bump version context tenant) thì lượt kiểm sau bị chặn ngay và cổng được đọc lại từ DB', async () => {
    const { evaluator, contextsService, state, counters } = makeWorld();
    await expect(evaluator.hasCapability('user-member', 'course:view', CRS_ID)).resolves.toBe(true);
    const readsBefore = counters.membershipReads + counters.gateInfoReads;

    state.memberships.set('tenant-1|user-member', 'suspended');
    await contextsService.markContextDirty(TEN_ID);

    await expect(evaluator.hasCapability('user-member', 'course:view', CRS_ID)).resolves.toBe(false);
    expect(counters.membershipReads + counters.gateInfoReads).toBeGreaterThan(readsBefore);
  });

  it('tenant bị đình chỉ (kèm bump version context tenant) thì thành viên cũng bị chặn ngay', async () => {
    const { evaluator, contextsService, state } = makeWorld();
    await expect(evaluator.hasCapability('user-member', 'course:view', CRS_ID)).resolves.toBe(true);

    state.tenantInfo = { kind: 'center', status: 'suspended' };
    await contextsService.markContextDirty(TEN_ID);

    await expect(evaluator.hasCapability('user-member', 'course:view', CRS_ID)).resolves.toBe(false);
  });

  it('gỡ gán vai (kèm bump version context của gán) thì lượt kiểm sau bị chặn và tầng đánh giá được hỏi lại', async () => {
    const { evaluator, contextsService, state, counters } = makeWorld();
    await expect(evaluator.hasCapability('user-member', 'course:view', CRS_ID)).resolves.toBe(true);
    const readsBefore = counters.assignmentReads;

    state.assignments = state.assignments.filter((a) => a.userId !== 'user-member');
    await contextsService.markContextDirty(CRS_ID);

    await expect(evaluator.hasCapability('user-member', 'course:view', CRS_ID)).resolves.toBe(false);
    expect(counters.assignmentReads).toBeGreaterThan(readsBefore);
  });

  it('thêm override ALLOW (kèm bump version context của override) thì capability trước đó bị chặn được cho ngay', async () => {
    const { evaluator, contextsService, state } = makeWorld();
    await expect(evaluator.hasCapability('user-member', 'course:delete', CRS_ID)).resolves.toBe(false);

    state.overrides.push({ roleId: 'role-viewer', capability: 'course:delete', contextId: CRS_ID, permission: CAP_ALLOW });
    await contextsService.markContextDirty(CRS_ID);

    await expect(evaluator.hasCapability('user-member', 'course:delete', CRS_ID)).resolves.toBe(true);
  });

  it('cấp rồi thu hồi site admin qua setSiteAdmins có hiệu lực ngay ở lượt kiểm sau', async () => {
    const { evaluator } = makeWorld();
    await expect(evaluator.hasCapability('user-plain', 'course:view', OUT_ID)).resolves.toBe(false);
    await evaluator.setSiteAdmins(['user-plain']);
    await expect(evaluator.hasCapability('user-plain', 'course:view', OUT_ID)).resolves.toBe(true);
    await evaluator.setSiteAdmins([]);
    await expect(evaluator.hasCapability('user-plain', 'course:view', OUT_ID)).resolves.toBe(false);
  });
});

describe('PermissionEvaluator — cô lập cache site admin theo cơ sở dữ liệu khi dùng chung Redis', () => {
  it('tiến trình trên DB trống không thấy danh sách site admin mà tiến trình của DB khác đã ghi xuyên vào Redis chung', async () => {
    const sharedStore = new Map<string, unknown>();
    const processA = makeWorld({ databaseUrl: 'postgres://localhost:5432/giaokhoa_db_a', cacheStore: sharedStore });
    const processB = makeWorld({ databaseUrl: 'postgres://localhost:5432/giaokhoa_db_b', cacheStore: sharedStore });
    processB.state.siteAdmins = [];

    await processA.evaluator.setSiteAdmins(['admin-cua-db-a']);

    await expect(processB.evaluator.listSiteAdmins()).resolves.toEqual([]);
    await expect(processB.evaluator.isSiteAdmin('admin-cua-db-a')).resolves.toBe(false);
    expect(processB.counters.configReads).toBeGreaterThan(0);
  });

  it('lượt đọc tự nạp cache của một DB không làm DB khác đọc trúng danh sách của DB đó', async () => {
    const sharedStore = new Map<string, unknown>();
    const processA = makeWorld({ databaseUrl: 'postgres://localhost:5432/giaokhoa_db_a', cacheStore: sharedStore });
    const processB = makeWorld({ databaseUrl: 'postgres://localhost:5432/giaokhoa_db_b', cacheStore: sharedStore });
    processB.state.siteAdmins = ['admin-cua-db-b'];

    await expect(processA.evaluator.listSiteAdmins()).resolves.toEqual(['user-admin']);
    await expect(processB.evaluator.listSiteAdmins()).resolves.toEqual(['admin-cua-db-b']);
  });

  it('hai tiến trình cùng một cơ sở dữ liệu vẫn dùng chung mục cache: lượt đọc của tiến trình sau trúng cache, không hỏi lại DB', async () => {
    const sharedStore = new Map<string, unknown>();
    const processA = makeWorld({ databaseUrl: 'postgres://localhost:5432/giaokhoa_db_chung', cacheStore: sharedStore });
    const processB = makeWorld({ databaseUrl: 'postgres://localhost:5432/giaokhoa_db_chung', cacheStore: sharedStore });

    await expect(processA.evaluator.listSiteAdmins()).resolves.toEqual(['user-admin']);
    await expect(processB.evaluator.listSiteAdmins()).resolves.toEqual(['user-admin']);
    expect(processB.counters.configReads).toBe(0);
  });

  it('cùng một tiến trình phục vụ hai kho: ngữ cảnh kho riêng chỉ nhận quản trị của kho mình, không nhận quản trị platform', async () => {
    const sharedStore = new Map<string, unknown>();
    let contextDatabaseName: string | undefined;
    const { evaluator, state, counters } = makeWorld({
      cacheStore: sharedStore,
      contextDatabaseName: () => contextDatabaseName,
    });
    state.siteAdmins = ['admin-kho-chung'];
    state.platformSiteAdmins = ['admin-kho-chung'];

    await expect(evaluator.isSiteAdmin('admin-kho-chung')).resolves.toBe(true);
    const readsAfterSharedPrime = counters.configReads;

    contextDatabaseName = 'giaokhoa_space_rieng';
    state.siteAdmins = ['admin-kho-rieng'];
    await expect(evaluator.isSiteAdmin('admin-kho-rieng')).resolves.toBe(true);
    expect(counters.configReads).toBeGreaterThan(readsAfterSharedPrime);
    await expect(evaluator.isSiteAdmin('admin-kho-chung')).resolves.toBe(false);

    await evaluator.setSiteAdmins(['admin-kho-rieng', 'admin-rieng-hai']);
    contextDatabaseName = undefined;
    state.siteAdmins = ['admin-kho-chung'];
    await expect(evaluator.listSiteAdmins()).resolves.toEqual(['admin-kho-chung']);
    await expect(evaluator.isSiteAdmin('admin-rieng-hai')).resolves.toBe(false);
  });
});
