import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { Cache } from 'cache-manager';
import { describe, expect, it, vi } from 'vitest';
import type { CentreDb } from '@giaokhoa/db';
import { AccessRepository, type ContextRow } from '@giaokhoa/db/repositories/access';
import type { FileSigningService } from '../files/file-signing.service';
import type { FileRow, FilesRepository } from '@giaokhoa/db/repositories/files';
import { FilesService } from '../files/files.service';
import type { ObjectStorage } from '../files/storage';
import { tenantAls } from '../tenants/tenant-als';
import type { ContextsService } from './contexts.service';
import { CONTEXT_LEVELS } from './domain/capabilities';
import { PermissionEvaluator } from './permission-evaluator.service';



const ctx = (id: string, contextLevel: number, path: string, instanceId: string | null = null): ContextRow =>
  ({ id, contextLevel, instanceId, path, depth: path.split('/').filter(Boolean).length, version: 1 }) as ContextRow;

const S = ctx('ctx-system', CONTEXT_LEVELS.SYSTEM, '/ctx-system');
const TB = ctx('ctx-tenant-b', CONTEXT_LEVELS.TENANT, '/ctx-system/ctx-tenant-b', 'tenant-b');
const CB = ctx('ctx-course-b', CONTEXT_LEVELS.COURSE, '/ctx-system/ctx-tenant-b/ctx-course-b');
const TP = ctx('ctx-tenant-platform', CONTEXT_LEVELS.TENANT, '/ctx-system/ctx-tenant-platform', 'tenant-platform');
const CP = ctx('ctx-course-p', CONTEXT_LEVELS.COURSE, '/ctx-system/ctx-tenant-platform/ctx-course-p');
const ALL_CONTEXTS = [S, TB, CB, TP, CP];
const byId = new Map(ALL_CONTEXTS.map((c) => [c.id, c]));

const SITE_ADMINS = ['user-admin'];
const ASSIGNMENTS = [
  { userId: 'user-outsider', roleId: 'role-teacherx', contextId: S.id },
  { userId: 'user-member', roleId: 'role-teacherx', contextId: CB.id },
  { userId: 'user-intruder', roleId: 'role-teacherx', contextId: CB.id },
];
const ALLOW = 1;
const OVERRIDES = [
  { roleId: 'role-teacherx', capability: 'files:view', contextId: S.id, permission: ALLOW },
  { roleId: 'role-teacherx', capability: 'files:view', contextId: CB.id, permission: ALLOW },
];
const ROLES: Record<string, { id: string; shortName: string }> = {
  user: { id: 'role-user', shortName: 'user' },
  guest: { id: 'role-guest', shortName: 'guest' },
};


const TENANT_ROWS = [
  { id: 'tenant-b', kind: 'center', status: 'active' },
  { id: 'tenant-platform', kind: 'platform', status: 'active' },
];
const MEMBERSHIP_ROWS = [{ tenantId: 'tenant-b', userId: 'user-member', status: 'active' }];

const COLUMN_FIELDS: Record<string, Record<string, string>> = {
  tenants: { id: 'id', kind: 'kind', status: 'status' },
  tenant_memberships: { tenant_id: 'tenantId', user_id: 'userId', status: 'status' },
};

function makeRlsDb(): CentreDb {
  const visible = (rowTenantId: string): boolean => {
    const store = tenantAls.getStore();
    return store?.platform === true || store?.tenantId === rowTenantId;
  };
  const selectFrom = (table: string) => {
    const wheres: { column: string; op: string; value: unknown }[] = [];
    let columns: string[] = [];
    const run = (): Record<string, unknown>[] => {
      const fields = COLUMN_FIELDS[table];
      const source = table === 'tenants' ? TENANT_ROWS : table === 'tenant_memberships' ? MEMBERSHIP_ROWS : [];
      const tenantField = table === 'tenants' ? 'id' : 'tenantId';
      const matched = (source as Record<string, unknown>[]).filter((row) => {
        if (!visible(String(row[tenantField]))) return false;
        return wheres.every(({ column, op, value }) => {
          const actual = row[fields[column]];
          if (op === 'in') return (value as unknown[]).includes(actual);
          return actual === value;
        });
      });
      return matched.map((row) => {
        const out: Record<string, unknown> = {};
        for (const column of columns) {
          const [sourceColumn, alias] = column.split(' as ');
          out[alias ?? sourceColumn] = row[fields[sourceColumn]];
        }
        return out;
      });
    };
    const builder = {
      select: (cols: string[]) => {
        columns = cols;
        return builder;
      },
      where: (column: string, op: string, value: unknown) => {
        wheres.push({ column, op, value });
        return builder;
      },
      execute: async () => run(),
      executeTakeFirst: async () => run()[0],
    };
    return builder;
  };
  return { selectFrom } as unknown as CentreDb;
}


interface GateReads {
  getTenantGateInfo(tenantId: string): Promise<{ kind: string; status: string } | undefined>;
  getTenantGateInfos(tenantIds: string[]): Promise<{ id: string; kind: string; status: string }[]>;
  getMembershipStatus(tenantId: string, userId: string): Promise<string | undefined>;
  getMembershipStatuses(tenantIds: string[], userId: string): Promise<{ tenantId: string; status: string }[]>;
}

function gateReadsOf(repo: AccessRepository): GateReads {
  return {
    getTenantGateInfo: (tenantId) => repo.getTenantGateInfo(tenantId),
    getTenantGateInfos: (tenantIds) => repo.getTenantGateInfos(tenantIds),
    getMembershipStatus: (tenantId, userId) => repo.getMembershipStatus(tenantId, userId),
    getMembershipStatuses: (tenantIds, userId) => repo.getMembershipStatuses(tenantIds, userId),
  };
}

function makeEvaluator(gate: GateReads): PermissionEvaluator {
  const repo = {
    async getConfigValue(key: string) {
      return key === 'siteadmins' ? SITE_ADMINS : undefined;
    },
    async getContextsByIds(ids: string[]) {
      return ids.map((id) => byId.get(id)).filter(Boolean) as ContextRow[];
    },
    ...gate,
    async getAssignmentsForUserInContexts(userId: string, contextIds: string[]) {
      return ASSIGNMENTS.filter((a) => a.userId === userId && contextIds.includes(a.contextId));
    },
    async getRoleByShortname(shortName: string) {
      return ROLES[shortName];
    },
    async getOverridesForRoles(roleIds: string[], capability: string, contextIds: string[]) {
      return OVERRIDES.filter((o) => roleIds.includes(o.roleId) && o.capability === capability && contextIds.includes(o.contextId));
    },
    async getOverridesForRolesInContexts(roleIds: string[], contextIds: string[]) {
      return OVERRIDES.filter((o) => roleIds.includes(o.roleId) && contextIds.includes(o.contextId));
    },
  };
  const contexts = {
    async getContext(id: string) {
      const row = byId.get(id);
      if (!row) throw new Error(`context ${id} missing`);
      return row;
    },
    async getPathContexts(c: ContextRow) {
      const ids = c.path.split('/').filter(Boolean);
      return ids.slice().reverse().map((id) => byId.get(id)!).filter(Boolean);
    },
    pathVersionStamp(pathContexts: ContextRow[]) {
      return pathContexts.map((c) => `${c.id}:${c.version}`).join('|');
    },
  };
  const cacheStore = new Map<string, unknown>();
  const cache = {
    async get(key: string) {
      return cacheStore.get(key);
    },
    async set(key: string, value: unknown) {
      cacheStore.set(key, value);
    },
  };
  return new PermissionEvaluator(
    repo as unknown as AccessRepository,
    contexts as unknown as ContextsService,
    cache as unknown as Cache,
    { getOrThrow: () => 'postgres://user:pass@localhost:5432/giaokhoa_test_api' } as unknown as ConfigService,
  );
}

const inForeignSession = <T>(fn: () => Promise<T>): Promise<T> => tenantAls.run({ tenantId: 'tenant-other' }, fn);


describe('AccessRepository — repository KHÔNG tự lập ngữ cảnh platform (ranh giới issue #651, mô phỏng FORCE RLS)', () => {
  const repo = new AccessRepository(makeRlsDb());

  it('đọc trực tiếp trong phiên tenant khác thì dữ kiện cổng bị RLS che — repository không tự lập ngữ cảnh', async () => {
    await inForeignSession(async () => {
      await expect(repo.getTenantGateInfo('tenant-b')).resolves.toBeUndefined();
      await expect(repo.getMembershipStatus('tenant-b', 'user-member')).resolves.toBeUndefined();
      await expect(repo.getTenantGateInfos(['tenant-b', 'tenant-platform'])).resolves.toEqual([]);
      await expect(repo.getMembershipStatuses(['tenant-b'], 'user-member')).resolves.toEqual([]);
    });
  });

  it('đọc trực tiếp trong ngữ cảnh platform thì thấy đủ dữ kiện cổng — truy vấn của repository vẫn đúng, chỉ khác ngữ cảnh', async () => {
    await tenantAls.run({ platform: true }, async () => {
      await expect(repo.getTenantGateInfo('tenant-b')).resolves.toEqual({ kind: 'center', status: 'active' });
      await expect(repo.getMembershipStatus('tenant-b', 'user-member')).resolves.toBe('active');
      await expect(repo.getMembershipStatus('tenant-b', 'user-admin')).resolves.toBeUndefined();
      await expect(repo.getTenantGateInfos(['tenant-b', 'tenant-platform'])).resolves.toEqual([
        { id: 'tenant-b', kind: 'center', status: 'active' },
        { id: 'tenant-platform', kind: 'platform', status: 'active' },
      ]);
      await expect(repo.getMembershipStatuses(['tenant-b'], 'user-member')).resolves.toEqual([
        { tenantId: 'tenant-b', status: 'active' },
      ]);
    });
  });

  it('vẫn đọc được khi phiên bao quanh là chính tenant đích (hồi quy)', async () => {
    await tenantAls.run({ tenantId: 'tenant-b' }, async () => {
      await expect(repo.getTenantGateInfo('tenant-b')).resolves.toEqual({ kind: 'center', status: 'active' });
    });
  });

  it('tenant thật sự không tồn tại vẫn trả undefined trong ngữ cảnh platform — undefined chỉ còn nghĩa này', async () => {
    await tenantAls.run({ platform: true }, async () => {
      await expect(repo.getTenantGateInfo('tenant-missing')).resolves.toBeUndefined();
    });
  });
});

describe('PermissionEvaluator — cổng tenant khi phiên của người gọi là tenant khác', () => {
  const evaluator = makeEvaluator(gateReadsOf(new AccessRepository(makeRlsDb())));

  it('site admin không có membership tại tenant đích bị chặn trong cây tenant đích', async () => {
    await inForeignSession(async () => {
      await expect(evaluator.hasCapability('user-admin', 'files:view', CB.id)).resolves.toBe(false);
    });
  });

  it('gán vai ngoài cây (tại context hệ thống) không chảy vào cây tenant đích', async () => {
    await inForeignSession(async () => {
      await expect(evaluator.hasCapability('user-outsider', 'files:view', CB.id)).resolves.toBe(false);
    });
  });

  it('phép phân giải theo lô: đích trong cây tenant đích rỗng với site admin và với gán ngoài cây', async () => {
    await inForeignSession(async () => {
      const admin = await evaluator.resolveCapabilitiesForContexts('user-admin', [CB], byId);
      expect(admin.get(CB.id)).toEqual([]);
      const outsider = await evaluator.resolveCapabilitiesForContexts('user-outsider', [CB], byId);
      expect(outsider.get(CB.id)).toEqual([]);
    });
  });

  it('thành viên active có gán vai trong cây vẫn đạt capability; có gán trong cây nhưng không membership thì bị chặn', async () => {
    await inForeignSession(async () => {
      await expect(evaluator.hasCapability('user-member', 'files:view', CB.id)).resolves.toBe(true);
      await expect(evaluator.hasCapability('user-intruder', 'files:view', CB.id)).resolves.toBe(false);
      const member = await evaluator.resolveCapabilitiesForContexts('user-member', [CB], byId);
      expect(member.get(CB.id)).toContain('files:view');
    });
  });

  it('ngoài cây tenant lối tắt site admin giữ nguyên; cây tenant platform không bị thu hẹp', async () => {
    await inForeignSession(async () => {
      await expect(evaluator.hasCapability('user-admin', 'files:view', S.id)).resolves.toBe(true);
      await expect(evaluator.hasCapability('user-admin', 'files:view', CP.id)).resolves.toBe(true);
    });
  });
});

describe('PermissionEvaluator — fail-closed khi dữ kiện cổng không xác minh được', () => {
  const unverifiableGate: GateReads = {
    async getTenantGateInfo() {
      return undefined;
    },
    async getTenantGateInfos() {
      return [];
    },
    async getMembershipStatus() {
      return undefined;
    },
    async getMembershipStatuses() {
      return [];
    },
  };
  const evaluator = makeEvaluator(unverifiableGate);

  it('site admin bị chặn trong cây tenant không xác minh được (không lối tắt)', async () => {
    await expect(evaluator.hasCapability('user-admin', 'files:view', CB.id)).resolves.toBe(false);
  });

  it('gán vai ngoài cây không được công nhận trong cây tenant không xác minh được', async () => {
    await expect(evaluator.hasCapability('user-outsider', 'files:view', CB.id)).resolves.toBe(false);
    await expect(evaluator.hasCapabilityFromRealAssignment('user-outsider', 'files:view', CB.id)).resolves.toBe(false);
  });

  it('phép phân giải theo lô trả rỗng cho đích trong cây tenant không xác minh được', async () => {
    const admin = await evaluator.resolveCapabilitiesForContexts('user-admin', [CB], byId);
    expect(admin.get(CB.id)).toEqual([]);
  });

  it('context ngoài cây tenant không đổi: lối tắt site admin vẫn áp dụng', async () => {
    await expect(evaluator.hasCapability('user-admin', 'files:view', S.id)).resolves.toBe(true);
  });
});

describe('FilesService.createSignedUrl — chuỗi khai thác đầu-cuối qua cổng tenant', () => {
  const evaluator = makeEvaluator(gateReadsOf(new AccessRepository(makeRlsDb())));
  const createDownloadTarget = vi.fn((_file: FileRow) => ({ url: 'https://example.invalid/signed', expiresAt: 1 }));
  const fileRow = { id: 'file-b', contextId: CB.id, storageDomain: 'bank-system', contentHash: 'hash-b' } as unknown as FileRow;
  const service = new FilesService(
    {
      async getById(id: string) {
        return id === 'file-b' ? fileRow : undefined;
      },
    } as unknown as FilesRepository,
    {} as ObjectStorage,
    evaluator,
    { createDownloadTarget } as unknown as FileSigningService,
    {} as unknown as Queue,
  );

  it('site admin không membership xin URL ký của file thuộc tenant khác → bị từ chối, không sinh URL', async () => {
    await inForeignSession(async () => {
      await expect(service.createSignedUrl('file-b', 'user-admin')).rejects.toBeInstanceOf(ForbiddenException);
    });
    expect(createDownloadTarget).not.toHaveBeenCalled();
  });

  it('thành viên của tenant đích có capability vẫn được cấp URL ký (hồi quy)', async () => {
    await inForeignSession(async () => {
      await expect(service.createSignedUrl('file-b', 'user-member')).resolves.toEqual({
        url: 'https://example.invalid/signed',
        expiresAt: 1,
      });
    });
    expect(createDownloadTarget).toHaveBeenCalledTimes(1);
  });
});
