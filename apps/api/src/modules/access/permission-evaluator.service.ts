import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { tenantAls } from '../tenants/tenant-als';
import { AccessRepository, type ContextRow } from '@giaokhoa/db/repositories/access';
import { ContextsService } from './contexts.service';
import { CAPABILITY_DEFINITIONS, CONTEXT_LEVELS } from './domain/capabilities';
import { aggregateRoleResults, evaluateSingleRole, type RoleOverridePoint } from './domain/permission';

interface TenantGate {
  allowed: boolean;
  assignmentScope: Set<string> | null;
}

const ACCESS_CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class PermissionEvaluator {
  private readonly sharedDatabaseName: string;

  constructor(
    private readonly repo: AccessRepository,
    private readonly contexts: ContextsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Inject(ConfigService) config: ConfigService,
    @Optional() @Inject(SpaceDatabaseService) private readonly spaceDb?: SpaceDatabaseService,
  ) {
    let databaseName = 'default';
    try {
      databaseName = new URL(config.getOrThrow<string>('DATABASE_URL')).pathname.replace(/^\//, '') || 'default';
    } catch {
    }
    this.sharedDatabaseName = databaseName;
  }

  private siteAdminsCacheKey(): string {
    return `access:siteadmins:${this.spaceDb?.currentContextDatabaseName() ?? this.sharedDatabaseName}`;
  }

  private accessCacheScope(): string {
    return this.spaceDb?.currentContextDatabaseName() ?? this.sharedDatabaseName;
  }

  async isSiteAdmin(userId: string): Promise<boolean> {
    const raw = await this.siteAdminsConfig();
    return Array.isArray(raw) && raw.map((v) => String(v)).includes(userId);
  }

  async isPlatformSiteAdmin(userId: string): Promise<boolean> {
    const raw = await tenantAls.run({ platform: true }, async () => this.siteAdminsConfig());
    if (!Array.isArray(raw)) return false;
    return raw.map((v) => String(v)).includes(userId);
  }
  async listSiteAdmins(): Promise<string[]> {
    const raw = await this.siteAdminsConfig();
    return Array.isArray(raw) ? raw.map((v) => String(v)) : [];
  }
  async setSiteAdmins(userIds: string[]): Promise<void> {
    await this.repo.setConfigValue('siteadmins', userIds);
    await this.cache.set(this.siteAdminsCacheKey(), userIds, ACCESS_CACHE_TTL_MS);
  }

  private async siteAdminsConfig(): Promise<unknown> {
    const cacheKey = this.siteAdminsCacheKey();
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached !== undefined) return cached === null ? undefined : cached;
    const raw = await this.repo.getConfigValue('siteadmins');
    await this.cache.set(cacheKey, raw ?? null, ACCESS_CACHE_TTL_MS);
    return raw;
  }

  private async tenantGate(userId: string, pathContexts: ContextRow[]): Promise<TenantGate> {
    const tenantCtx = pathContexts.find((c) => c.contextLevel === CONTEXT_LEVELS.TENANT);
    if (!tenantCtx?.instanceId) return { allowed: true, assignmentScope: null };
    const info = await this.tenantGateInfo(tenantCtx);
    if (!info) return { allowed: false, assignmentScope: null };
    if (info.kind !== 'school' && info.kind !== 'center') return { allowed: true, assignmentScope: null };
    if (info.status !== 'active') return { allowed: false, assignmentScope: null };
    const status = await this.membershipStatus(tenantCtx, userId);
    if (status !== 'active') return { allowed: false, assignmentScope: null };
    const scope = new Set(
      pathContexts.filter((c) => c.path.startsWith(tenantCtx.path)).map((c) => c.id),
    );
    return { allowed: true, assignmentScope: scope };
  }

  private platformScope<T>(fn: () => Promise<T>): Promise<T> {
    const spaceSlug = tenantAls.getStore()?.spaceSlug;
    return tenantAls.run({ platform: true, ...(spaceSlug ? { spaceSlug, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle } : {}) }, fn);
  }

  private async tenantGateInfo(tenantCtx: ContextRow): Promise<{ kind: string; status: string } | undefined> {
    const cacheKey = `access:${this.accessCacheScope()}:gateinfo:${tenantCtx.instanceId}:v${tenantCtx.version}`;
    const cached = await this.cache.get<{ kind: string; status: string }>(cacheKey);
    if (cached !== undefined && cached !== null) return cached;
    const info = await this.platformScope(() => this.repo.getTenantGateInfo(tenantCtx.instanceId!));
    if (info) await this.cache.set(cacheKey, info, ACCESS_CACHE_TTL_MS);
    return info;
  }

  private async membershipStatus(tenantCtx: ContextRow, userId: string): Promise<string | undefined> {
    const cacheKey = `access:${this.accessCacheScope()}:member:${tenantCtx.instanceId}:${userId}:v${tenantCtx.version}`;
    const cached = await this.cache.get<string | null>(cacheKey);
    if (cached !== undefined) return cached ?? undefined;
    const status = await this.platformScope(() => this.repo.getMembershipStatus(tenantCtx.instanceId!, userId));
    await this.cache.set(cacheKey, status ?? null, ACCESS_CACHE_TTL_MS);
    return status;
  }

  async hasCapability(userId: string, capability: string, contextId: string, opts?: { isGuest?: boolean }): Promise<boolean> {
    const target = await this.contexts.getContext(contextId);
    const pathContexts = await this.contexts.getPathContexts(target);
    const stamp = this.contexts.pathVersionStamp(pathContexts);
    const cacheKey = `access:${this.accessCacheScope()}:${userId}:${capability}:${contextId}:${stamp}:${opts?.isGuest ? 'g' : 'u'}`;
    const cached = await this.cache.get<boolean>(cacheKey);
    const gate = await this.tenantGate(userId, pathContexts);
    if (!gate.allowed) return false;
    if (gate.assignmentScope === null && (await this.isSiteAdmin(userId))) return true;
    if (cached !== undefined && cached !== null) return cached;
    const result = await this.evaluate(userId, capability, pathContexts, opts, gate.assignmentScope);
    await this.cache.set(cacheKey, result, ACCESS_CACHE_TTL_MS);
    return result;
  }

  private async evaluate(userId: string, capability: string, pathContexts: { id: string }[], opts?: { isGuest?: boolean }, assignmentScope?: Set<string> | null): Promise<boolean> {
    const pathIds = pathContexts.map((c) => c.id);
    const allAssignments = await this.repo.getAssignmentsForUserInContexts(userId, pathIds);
    const assignments = assignmentScope ? allAssignments.filter((a) => assignmentScope.has(a.contextId)) : allAssignments;
    const roleIds = new Set<string>(assignments.map((a) => a.roleId));
    const systemId = pathIds[pathIds.length - 1];
    const defaultRole = await this.repo.getRoleByShortname(opts?.isGuest ? 'guest' : 'user');
    if (defaultRole && systemId !== undefined) roleIds.add(defaultRole.id);
    if (roleIds.size === 0) return false;

    const overrides = await this.repo.getOverridesForRoles([...roleIds], capability, pathIds);
    const roleResults: number[] = [];
    for (const roleId of roleIds) {
      const points: RoleOverridePoint[] = [];
      for (const contextId of pathIds) {
        const o = overrides.find((x) => x.roleId === roleId && x.contextId === contextId);
        if (o) points.push({ contextId, permission: o.permission });
      }
      roleResults.push(evaluateSingleRole(points));
    }
    return aggregateRoleResults(roleResults);
  }

  async resolveCapabilitiesForContexts(
    userId: string,
    targets: ContextRow[],
    contextRowsById: Map<string, ContextRow>,
    opts?: { isGuest?: boolean },
  ): Promise<Map<string, string[]>> {
    const resolved = new Map<string, string[]>();
    if (targets.length === 0) return resolved;

    const known = new Map(contextRowsById);
    const pathIdsByTarget = new Map<string, string[]>();
    const missingIds = new Set<string>();
    for (const target of targets) {
      const ids = target.path.split('/').filter(Boolean).reverse();
      pathIdsByTarget.set(target.id, ids);
      for (const id of ids) if (!known.has(id)) missingIds.add(id);
    }
    if (missingIds.size > 0) {
      for (const row of await this.repo.getContextsByIds([...missingIds])) known.set(row.id, row);
    }
    const pathContextsOf = (targetId: string): ContextRow[] =>
      (pathIdsByTarget.get(targetId) ?? []).map((id) => known.get(id)!).filter(Boolean);

    const tenantIds = new Set<string>();
    for (const target of targets) {
      const tenantCtx = pathContextsOf(target.id).find((c) => c.contextLevel === CONTEXT_LEVELS.TENANT);
      if (tenantCtx?.instanceId) tenantIds.add(tenantCtx.instanceId);
    }
    const gateInfoByTenant = new Map(
      (await this.platformScope(() => this.repo.getTenantGateInfos([...tenantIds]))).map((info) => [info.id, info]),
    );
    const membershipByTenant = new Map(
      (await this.platformScope(() => this.repo.getMembershipStatuses([...tenantIds], userId))).map((m) => [m.tenantId, m.status]),
    );
    const gateByTarget = new Map<string, TenantGate>();
    for (const target of targets) {
      const pathContexts = pathContextsOf(target.id);
      const tenantCtx = pathContexts.find((c) => c.contextLevel === CONTEXT_LEVELS.TENANT);
      if (!tenantCtx?.instanceId) {
        gateByTarget.set(target.id, { allowed: true, assignmentScope: null });
        continue;
      }
      const info = gateInfoByTenant.get(tenantCtx.instanceId);
      if (!info) {
        gateByTarget.set(target.id, { allowed: false, assignmentScope: null });
        continue;
      }
      if (info.kind !== 'school' && info.kind !== 'center') {
        gateByTarget.set(target.id, { allowed: true, assignmentScope: null });
        continue;
      }
      if (info.status !== 'active' || membershipByTenant.get(tenantCtx.instanceId) !== 'active') {
        gateByTarget.set(target.id, { allowed: false, assignmentScope: null });
        continue;
      }
      const scope = new Set(pathContexts.filter((c) => c.path.startsWith(tenantCtx.path)).map((c) => c.id));
      gateByTarget.set(target.id, { allowed: true, assignmentScope: scope });
    }

    const toEvaluate: ContextRow[] = [];
    let needsAdminCheck = false;
    for (const target of targets) {
      const gate = gateByTarget.get(target.id)!;
      if (!gate.allowed) {
        resolved.set(target.id, []);
      } else {
        if (gate.assignmentScope === null) needsAdminCheck = true;
        toEvaluate.push(target);
      }
    }
    const isAdmin = needsAdminCheck ? await this.isSiteAdmin(userId) : false;
    const evaluated: ContextRow[] = [];
    for (const target of toEvaluate) {
      const gate = gateByTarget.get(target.id)!;
      if (gate.assignmentScope === null && isAdmin) {
        resolved.set(target.id, CAPABILITY_DEFINITIONS.map((def) => def.name));
      } else {
        evaluated.push(target);
      }
    }
    if (evaluated.length === 0) return resolved;

    const unionPathIds = [...new Set(evaluated.flatMap((t) => pathIdsByTarget.get(t.id) ?? []))];
    const allAssignments = await this.repo.getAssignmentsForUserInContexts(userId, unionPathIds);
    const defaultRole = await this.repo.getRoleByShortname(opts?.isGuest ? 'guest' : 'user');
    const roleIds = new Set<string>(allAssignments.map((a) => a.roleId));
    if (defaultRole) roleIds.add(defaultRole.id);
    const allOverrides = await this.repo.getOverridesForRolesInContexts([...roleIds], unionPathIds);
    const overrideByKey = new Map<string, number>();
    for (const o of allOverrides) overrideByKey.set(`${o.roleId}|${o.capability}|${o.contextId}`, o.permission);

    for (const target of evaluated) {
      const gate = gateByTarget.get(target.id)!;
      const pathIds = pathIdsByTarget.get(target.id) ?? [];
      const pathIdSet = new Set(pathIds);
      const targetRoleIds = new Set<string>();
      for (const a of allAssignments) {
        if (!pathIdSet.has(a.contextId)) continue;
        if (gate.assignmentScope && !gate.assignmentScope.has(a.contextId)) continue;
        targetRoleIds.add(a.roleId);
      }
      if (defaultRole) targetRoleIds.add(defaultRole.id);
      const capabilities: string[] = [];
      if (targetRoleIds.size > 0) {
        for (const def of CAPABILITY_DEFINITIONS) {
          const roleResults: number[] = [];
          for (const roleId of targetRoleIds) {
            const points: RoleOverridePoint[] = [];
            for (const contextId of pathIds) {
              const permission = overrideByKey.get(`${roleId}|${def.name}|${contextId}`);
              if (permission !== undefined) points.push({ contextId, permission });
            }
            roleResults.push(evaluateSingleRole(points));
          }
          if (aggregateRoleResults(roleResults)) capabilities.push(def.name);
        }
      }
      resolved.set(target.id, capabilities);
    }
    return resolved;
  }

  async hasCapabilityFromRealAssignment(
    userId: string,
    capability: string,
    contextId: string,
    opts?: { excludeArchetypes?: string[] },
  ): Promise<boolean> {
    const target = await this.contexts.getContext(contextId);
    const pathContexts = await this.contexts.getPathContexts(target);
    const gate = await this.tenantGate(userId, pathContexts);
    if (!gate.allowed) return false;
    if (gate.assignmentScope === null && (await this.isSiteAdmin(userId))) return true;
    const pathIds = pathContexts.map((c) => c.id);
    const allAssignments = await this.repo.getAssignmentsForUserInContexts(userId, pathIds);
    const assignments = gate.assignmentScope ? allAssignments.filter((a) => gate.assignmentScope!.has(a.contextId)) : allAssignments;
    const roleIds = new Set<string>();
    for (const a of assignments) {
      if (opts?.excludeArchetypes?.length) {
        const roleRow = await this.repo.getRoleById(a.roleId);
        if (roleRow?.archetype && opts.excludeArchetypes.includes(roleRow.archetype)) continue;
      }
      roleIds.add(a.roleId);
    }
    if (roleIds.size === 0) return false;
    const overrides = await this.repo.getOverridesForRoles([...roleIds], capability, pathIds);
    const roleResults: number[] = [];
    for (const roleId of roleIds) {
      const points: RoleOverridePoint[] = [];
      for (const cid of pathIds) {
        const o = overrides.find((x) => x.roleId === roleId && x.contextId === cid);
        if (o) points.push({ contextId: cid, permission: o.permission });
      }
      roleResults.push(evaluateSingleRole(points));
    }
    return aggregateRoleResults(roleResults);
  }

  async hasCapabilityFromRealAssignmentAnywhere(userId: string, capability: string): Promise<boolean> {
    if (await this.isSiteAdmin(userId)) return true;
    const assignments = await this.repo.listAssignments({ userId });
    const contextIds = [...new Set(assignments.map((a) => a.contextId))];
    for (const contextId of contextIds) {
      if (await this.hasCapabilityFromRealAssignment(userId, capability, contextId)) return true;
    }
    return false;
  }

  async requireCapability(userId: string, capability: string, contextId: string, opts?: { isGuest?: boolean }): Promise<void> {
    if (!(await this.hasCapability(userId, capability, contextId, opts))) {
      throw new ForbiddenException({ message: `Missing capability ${capability} in context ${contextId}`, code: 'access.capability_denied' });
    }
  }
}
