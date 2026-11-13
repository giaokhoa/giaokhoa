import { describe, expect, it } from 'vitest';
import type { Cache } from 'cache-manager';
import type { ConfigService } from '@nestjs/config';
import type { AccessRepository, ContextRow } from '@giaokhoa/db/repositories/access';
import type { ContextsService } from './contexts.service';
import { CAPABILITY_DEFINITIONS } from './domain/capabilities';
import { PermissionEvaluator } from './permission-evaluator.service';


type Ctx = ContextRow;
const ctx = (id: string, contextLevel: number, path: string, instanceId: string | null = null): Ctx =>
  ({ id, contextLevel, instanceId, path, depth: path.split('/').filter(Boolean).length, version: 1 }) as Ctx;

const S = ctx('ctx-system', 10, '/ctx-system');
const CAT = ctx('ctx-coursecat', 40, '/ctx-system/ctx-coursecat');
const C1 = ctx('ctx-course-1', 50, '/ctx-system/ctx-coursecat/ctx-course-1');
const CL = ctx('ctx-class', 45, '/ctx-system/ctx-class');
const TT = ctx('ctx-tenant-center', 20, '/ctx-system/ctx-tenant-center', 'tenant-center');
const TC = ctx('ctx-tenant-course', 50, '/ctx-system/ctx-tenant-center/ctx-tenant-course');
const TS2 = ctx('ctx-tenant-susp', 20, '/ctx-system/ctx-tenant-susp', 'tenant-suspended');
const TSC = ctx('ctx-susp-course', 50, '/ctx-system/ctx-tenant-susp/ctx-susp-course');
const ALL_CONTEXTS = [S, CAT, C1, CL, TT, TC, TS2, TSC];

interface AssignmentRow { userId: string; roleId: string; contextId: string }
interface OverrideRow { roleId: string; capability: string; contextId: string; permission: number }

const ASSIGNMENTS: AssignmentRow[] = [
  { userId: 'user-cat', roleId: 'role-teacherx', contextId: CAT.id },
  { userId: 'user-teacher', roleId: 'role-teacherx', contextId: C1.id },
  { userId: 'user-teacher', roleId: 'role-teacherx', contextId: CL.id },
  { userId: 'user-both', roleId: 'role-teacherx', contextId: C1.id },
  { userId: 'user-both', roleId: 'role-assistant', contextId: C1.id },
  { userId: 'user-member', roleId: 'role-teacherx', contextId: TC.id },
  { userId: 'user-member', roleId: 'role-teacherx', contextId: S.id },
  { userId: 'user-outsider', roleId: 'role-teacherx', contextId: TC.id },
  { userId: 'user-suspended-tenant', roleId: 'role-teacherx', contextId: TSC.id },
  { userId: 'user-admin', roleId: 'role-teacherx', contextId: TC.id },
];

const ALLOW = 1;
const PREVENT = -1;
const PROHIBIT = -1000;
const OVERRIDES: OverrideRow[] = [
  { roleId: 'role-user', capability: 'files:view', contextId: S.id, permission: ALLOW },
  { roleId: 'role-user', capability: 'course:view', contextId: S.id, permission: ALLOW },
  { roleId: 'role-guest', capability: 'files:view', contextId: S.id, permission: ALLOW },
  { roleId: 'role-guest', capability: 'course:view', contextId: S.id, permission: PREVENT },
  { roleId: 'role-teacherx', capability: 'question:add', contextId: S.id, permission: ALLOW },
  { roleId: 'role-teacherx', capability: 'question:add', contextId: CAT.id, permission: PREVENT },
  { roleId: 'role-teacherx', capability: 'question:add', contextId: C1.id, permission: ALLOW },
  { roleId: 'role-teacherx', capability: 'site:config', contextId: S.id, permission: ALLOW },
  { roleId: 'role-teacherx', capability: 'site:config', contextId: C1.id, permission: PROHIBIT },
  { roleId: 'role-teacherx', capability: 'course:view', contextId: CL.id, permission: ALLOW },
  { roleId: 'role-teacherx', capability: 'question:delete', contextId: S.id, permission: ALLOW },
  { roleId: 'role-assistant', capability: 'question:add', contextId: CAT.id, permission: PROHIBIT },
];

const TENANTS: Record<string, { kind: string; status: string }> = {
  'tenant-center': { kind: 'center', status: 'active' },
  'tenant-suspended': { kind: 'school', status: 'suspended' },
};
const MEMBERSHIPS: Record<string, string> = {
  'tenant-center|user-member': 'active',
  'tenant-center|user-admin': 'active',
  'tenant-suspended|user-suspended-tenant': 'active',
};
const SITE_ADMINS = ['user-admin'];
const ROLES: Record<string, { id: string; shortName: string }> = {
  user: { id: 'role-user', shortName: 'user' },
  guest: { id: 'role-guest', shortName: 'guest' },
};

function makeWorld() {
  const counter = { dbCalls: 0 };
  const byId = new Map(ALL_CONTEXTS.map((c) => [c.id, c]));
  const repo = {
    async getConfigValue(key: string) { counter.dbCalls += 1; return key === 'siteadmins' ? SITE_ADMINS : undefined; },
    async getContextById(id: string) { counter.dbCalls += 1; return byId.get(id); },
    async getContextsByIds(ids: string[]) { counter.dbCalls += 1; return ids.map((id) => byId.get(id)).filter(Boolean) as Ctx[]; },
    async getTenantGateInfo(tenantId: string) { counter.dbCalls += 1; return TENANTS[tenantId]; },
    async getTenantGateInfos(tenantIds: string[]) {
      counter.dbCalls += 1;
      return tenantIds.filter((id) => TENANTS[id]).map((id) => ({ id, ...TENANTS[id]! }));
    },
    async getMembershipStatus(tenantId: string, userId: string) { counter.dbCalls += 1; return MEMBERSHIPS[`${tenantId}|${userId}`]; },
    async getMembershipStatuses(tenantIds: string[], userId: string) {
      counter.dbCalls += 1;
      return tenantIds.filter((id) => MEMBERSHIPS[`${id}|${userId}`] !== undefined)
        .map((tenantId) => ({ tenantId, status: MEMBERSHIPS[`${tenantId}|${userId}`]! }));
    },
    async getAssignmentsForUserInContexts(userId: string, contextIds: string[]) {
      counter.dbCalls += 1;
      return ASSIGNMENTS.filter((a) => a.userId === userId && contextIds.includes(a.contextId));
    },
    async getRoleByShortname(shortName: string) { counter.dbCalls += 1; return ROLES[shortName]; },
    async getOverridesForRoles(roleIds: string[], capability: string, contextIds: string[]) {
      counter.dbCalls += 1;
      return OVERRIDES.filter((o) => roleIds.includes(o.roleId) && o.capability === capability && contextIds.includes(o.contextId));
    },
    async getOverridesForRolesInContexts(roleIds: string[], contextIds: string[]) {
      counter.dbCalls += 1;
      return OVERRIDES.filter((o) => roleIds.includes(o.roleId) && contextIds.includes(o.contextId));
    },
  };
  const contexts = {
    async getContext(id: string) {
      counter.dbCalls += 1;
      const row = byId.get(id);
      if (!row) throw new Error(`context ${id} missing`);
      return row;
    },
    async getPathContexts(c: Ctx) {
      counter.dbCalls += 1;
      const ids = c.path.split('/').filter(Boolean);
      return ids.slice().reverse().map((id) => byId.get(id)!).filter(Boolean);
    },
    pathVersionStamp(pathContexts: Ctx[]) {
      return pathContexts.map((c) => `${c.id}:${c.version}`).join('|');
    },
  };
  const cacheStore = new Map<string, unknown>();
  const cache = {
    async get(key: string) { return cacheStore.get(key); },
    async set(key: string, value: unknown) { cacheStore.set(key, value); },
  };
  const evaluator = new PermissionEvaluator(
    repo as unknown as AccessRepository,
    contexts as unknown as ContextsService,
    cache as unknown as Cache,
    { getOrThrow: () => 'postgres://user:pass@localhost:5432/giaokhoa_test_api' } as unknown as ConfigService,
  );
  return { evaluator, counter, byId };
}

const ALL_DEFS = CAPABILITY_DEFINITIONS.map((d) => d.name);

async function legacySnapshot(
  evaluator: PermissionEvaluator,
  userId: string,
  targets: Ctx[],
  opts?: { isGuest?: boolean },
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const target of targets) {
    const caps: string[] = [];
    for (const def of ALL_DEFS) {
      if (await evaluator.hasCapability(userId, def, target.id, opts)) caps.push(def);
    }
    out.set(target.id, caps);
  }
  return out;
}

describe('Hàm PermissionEvaluator.resolveCapabilitiesForContexts', () => {
  it('khớp hasCapability với mọi người dùng, ngữ cảnh và năng lực trong thế giới fixture', async () => {
    const { evaluator, byId } = makeWorld();
    const scenarios: { userId: string; targets: Ctx[]; opts?: { isGuest?: boolean } }[] = [
      { userId: 'user-cat', targets: [C1, CAT, S] },
      { userId: 'user-teacher', targets: [C1, CAT, S, CL] },
      { userId: 'user-both', targets: [C1, CAT, S] },
      { userId: 'user-member', targets: [TC, TT, S] },
      { userId: 'user-outsider', targets: [TC, TT, S] },
      { userId: 'user-suspended-tenant', targets: [TSC, TS2, S] },
      { userId: 'user-admin', targets: [TC, TT, S, C1] },
      { userId: 'user-plain', targets: [S, C1] },
      { userId: 'user-plain', targets: [S], opts: { isGuest: true } },
    ];
    for (const scenario of scenarios) {
      const batch = await evaluator.resolveCapabilitiesForContexts(
        scenario.userId, scenario.targets, byId, scenario.opts,
      );
      const legacy = await legacySnapshot(evaluator, scenario.userId, scenario.targets, scenario.opts);
      for (const target of scenario.targets) {
        expect(batch.get(target.id), `${scenario.userId} @ ${target.id}`).toEqual(legacy.get(target.id));
      }
    }
  });

  it('giữ ngữ nghĩa tính tay của các nhánh khó', async () => {
    const { evaluator, byId } = makeWorld();
    const teacher = await evaluator.resolveCapabilitiesForContexts('user-teacher', [C1, CL], byId);
    expect(teacher.get(C1.id)).toContain('question:add');
    expect(teacher.get(C1.id)).not.toContain('site:config');
    expect(teacher.get(CL.id)).toContain('course:view');

    const cat = await evaluator.resolveCapabilitiesForContexts('user-cat', [CAT, C1], byId);
    expect(cat.get(CAT.id)).not.toContain('question:add');
    expect(cat.get(C1.id)).toContain('question:add');

    const both = await evaluator.resolveCapabilitiesForContexts('user-both', [C1], byId);
    expect(both.get(C1.id)).not.toContain('question:add');

    const outsider = await evaluator.resolveCapabilitiesForContexts('user-outsider', [TC], byId);
    expect(outsider.get(TC.id)).toEqual([]);

    const suspended = await evaluator.resolveCapabilitiesForContexts('user-suspended-tenant', [TSC], byId);
    expect(suspended.get(TSC.id)).toEqual([]);

    const admin = await evaluator.resolveCapabilitiesForContexts('user-admin', [S, TC], byId);
    expect(admin.get(S.id)).toEqual(ALL_DEFS);
    expect(admin.get(TC.id)!.length).toBeLessThan(ALL_DEFS.length);
    expect(admin.get(TC.id)).toEqual(
      await legacySnapshot(evaluator, 'user-admin', [TC]).then((m) => m.get(TC.id)),
    );

    const guest = await evaluator.resolveCapabilitiesForContexts('user-plain', [S], byId, { isGuest: true });
    expect(guest.get(S.id)).toContain('files:view');
    expect(guest.get(S.id)).not.toContain('course:view');
  });

  it('phân giải cả snapshot với số lần gọi dữ liệu bị chặn, khác với đường theo từng cặp', async () => {
    const { evaluator, counter, byId } = makeWorld();
    const targets = [C1, CAT, S, CL];
    counter.dbCalls = 0;
    await evaluator.resolveCapabilitiesForContexts('user-teacher', targets, byId);
    const batchCalls = counter.dbCalls;
    expect(batchCalls).toBeLessThanOrEqual(10);

    counter.dbCalls = 0;
    await legacySnapshot(evaluator, 'user-teacher', targets);
    expect(counter.dbCalls).toBeGreaterThan(500);
  });
});
