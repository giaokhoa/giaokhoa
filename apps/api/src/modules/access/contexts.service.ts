import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { AccessRepository, type ContextRow } from '@giaokhoa/db/repositories/access';
import type { CentreTx } from '@giaokhoa/db';
import { CONTEXT_LEVELS } from './domain/capabilities';

@Injectable()
export class ContextsService {
  constructor(private readonly repo: AccessRepository) {}

  async ensureSystemContext(tx?: CentreTx): Promise<ContextRow> {
    const existing = await this.repo.getContextByLevelInstance(CONTEXT_LEVELS.SYSTEM, null, tx);
    if (existing) return existing;
    const row = await this.repo.insertContext({ contextLevel: CONTEXT_LEVELS.SYSTEM, instanceId: null, path: '', depth: 0 }, tx);
    const path = `/${row.id}`;
    await this.repo.updateContextPath(row.id, path, 1, tx);
    return { ...row, path, depth: 1 };
  }

  async ensureTenantContext(tenantId: string): Promise<ContextRow> {
    const existing = await this.repo.getContextByLevelInstance(CONTEXT_LEVELS.TENANT, tenantId);
    if (existing) return existing;
    const system = await this.ensureSystemContext();
    return this.createContext(CONTEXT_LEVELS.TENANT, tenantId, system.id);
  }

  async getTenantContext(tenantId: string): Promise<ContextRow | undefined> {
    return this.getByLevelInstance(CONTEXT_LEVELS.TENANT, tenantId);
  }

  async createContext(contextLevel: number, instanceId: string, parentId?: string, tx?: CentreTx): Promise<ContextRow> {
    const existing = await this.repo.getContextByLevelInstance(contextLevel, instanceId, tx);
    if (existing) return existing;
    const parent = contextLevel === CONTEXT_LEVELS.SYSTEM
      ? undefined
      : await this.repo.getContextById(parentId ?? (await this.ensureSystemContext(tx)).id, tx);
    if (contextLevel !== CONTEXT_LEVELS.SYSTEM && !parent) throw new BadRequestException({ message: 'Parent context not found', code: 'access.parent_context_not_found' });
    const row = await this.repo.insertContext({ contextLevel, instanceId, path: '', depth: 0 }, tx);
    const path = parent ? `${parent.path}/${row.id}` : `/${row.id}`;
    const depth = parent ? parent.depth + 1 : 1;
    await this.repo.updateContextPath(row.id, path, depth, tx);
    return { ...row, path, depth };
  }

  async getContext(id: string, tx?: CentreTx): Promise<ContextRow> {
    const row = uuidIdSchema.safeParse(id).success ? await this.repo.getContextById(id, tx) : undefined;
    if (!row) throw new NotFoundException({ message: `Context ${id} not found`, code: 'access.context_not_found' });
    return row;
  }
  async getByLevelInstance(contextLevel: number, instanceId: string): Promise<ContextRow | undefined> {
    if (!uuidIdSchema.safeParse(instanceId).success) return undefined;
    return this.repo.getContextByLevelInstance(contextLevel, instanceId);
  }
  async getByLevelInstances(contextLevel: number, instanceIds: string[]): Promise<ContextRow[]> {
    const valid = instanceIds.filter((id) => uuidIdSchema.safeParse(id).success);
    if (!valid.length) return [];
    return this.repo.getContextsByLevelInstances(contextLevel, valid);
  }
  async getContextsByIds(ids: string[]): Promise<ContextRow[]> { return this.repo.getContextsByIds(ids); }
  async listContexts(): Promise<ContextRow[]> { return this.repo.listContexts(); }
  async deleteContext(id: string): Promise<void> { await this.repo.deleteContext(id); }
  async deleteByLevelInstance(contextLevel: number, instanceId: string): Promise<void> {
    const row = await this.repo.getContextByLevelInstance(contextLevel, instanceId);
    if (row) await this.repo.deleteContext(row.id);
  }

  async getPathContexts(ctx: ContextRow): Promise<ContextRow[]> {
    const ids = ctx.path.split('/').filter(Boolean);
    const rows = await this.repo.getContextsByIds(ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.slice().reverse().map((id) => byId.get(id)!).filter(Boolean);
  }

  async reparentContext(id: string, newParentId: string): Promise<void> {
    const ctx = await this.getContext(id);
    const parent = await this.getContext(newParentId);
    const oldPath = ctx.path;
    const newPath = `${parent.path}/${ctx.id}`;
    const depthDelta = parent.depth + 1 - ctx.depth;
    const all = await this.repo.listContexts();
    for (const c of all) {
      if (c.path === oldPath || c.path.startsWith(`${oldPath}/`)) {
        await this.repo.updateContextPath(c.id, newPath + c.path.slice(oldPath.length), c.depth + depthDelta);
      }
    }
  }

  async markContextDirty(contextId: string, tx?: CentreTx): Promise<void> {
    const ctx = await this.repo.getContextById(contextId, tx);
    if (ctx) await this.repo.bumpContextVersions(ctx.path, tx);
  }
  pathVersionStamp(pathContexts: ContextRow[]): string {
    return pathContexts.map((c) => `${c.id}:${c.version}`).join('|');
  }
}
