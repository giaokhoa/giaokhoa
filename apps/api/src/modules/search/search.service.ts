import { Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { sql, type SqlBool } from '@giaokhoa/db';
import { SearchRepository, type SearchDocRow } from '@giaokhoa/db/repositories/search';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { ContextsService } from '../access/contexts.service';

export interface SearchArea {
  name: string;
  fetch(itemId: string): Promise<{ title: string; content: string; contextId: string; ownerId?: string; privilegedContent?: string } | null>;
  listIds(): Promise<string[]>;
  audienceCheck?(itemId: string, userId: string): Promise<boolean>;
}

export const SEARCH_ENGINE = Symbol('SEARCH_ENGINE');
export interface SearchEngine {
  query(q: string): Promise<SearchDocRow[]>;
}

@Injectable()
export class PostgresSearchEngine implements SearchEngine {
  constructor(private readonly repo: SearchRepository) {}
  async query(q: string): Promise<SearchDocRow[]> { return this.repo.queryEngine(q); }
}

@Injectable()
export class SearchService {
  private readonly areas = new Map<string, SearchArea>();

  constructor(
    private readonly repo: SearchRepository,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
  ) {
    this.registerBuiltinAreas();
  }

  registerArea(area: SearchArea): void { this.areas.set(area.name, area); }
  listAreas(): string[] { return [...this.areas.keys()]; }

  private registerBuiltinAreas(): void {
    const db = this.repo.dbHandle;
    this.registerArea({
      name: 'courses',
      fetch: async (itemId) => {
        const c = await db
          .selectFrom('course')
          .select(['id', 'visible', 'full_name as fullName', 'short_name as shortName', 'summary'])
          .where('id', '=', itemId)
          .executeTakeFirst();
        if (!c || !c.visible) return null;
        const ctx = await this.contexts.getByLevelInstance(50, itemId);
        if (!ctx) return null;
        return { title: c.fullName, content: `${c.shortName} ${c.summary}`, contextId: ctx.id };
      },
      listIds: async () => (await db.selectFrom('course').select('id').execute()).map((r) => r.id),
    });
    this.registerArea({
      name: 'users',
      fetch: async (itemId) => {
        const u = await db
          .selectFrom('users')
          .select(['id', 'suspended', 'deleted', 'is_guest as isGuest', 'first_name as firstName', 'last_name as lastName', 'username', 'email'])
          .where('id', '=', itemId)
          .executeTakeFirst();
        if (!u || u.suspended || u.deleted || u.isGuest) return null;
        const ctx = await this.contexts.getByLevelInstance(30, itemId);
        const sys = ctx ?? (await this.contexts.ensureSystemContext());
        return { title: `${u.firstName} ${u.lastName}`.trim() || u.username, content: u.username, contextId: sys.id, ownerId: u.id, privilegedContent: `${u.username} ${u.email}` };
      },
      listIds: async () => (await db.selectFrom('users').select('id')
        .where('suspended', '=', false).where('deleted', '=', false).execute()).map((r) => r.id),
    });
    this.registerArea({
      name: 'contentbank',
      fetch: async (itemId) => {
        const c = await db
          .selectFrom('content_bank_content')
          .select(['id', 'visibility', 'name', 'content_type as contentType', 'context_id as contextId', 'creator_id as creatorId'])
          .where('id', '=', itemId)
          .executeTakeFirst();
        if (!c || c.visibility !== 'public') return null;
        return { title: c.name, content: `${c.name} ${c.contentType}`, contextId: c.contextId, ownerId: c.creatorId };
      },
      listIds: async () => (await db.selectFrom('content_bank_content').select('id')
        .where('visibility', '=', 'public').execute()).map((r) => r.id),
    });
  }

  async indexItem(area: string, itemId: string): Promise<boolean> {
    const provider = this.areas.get(area);
    if (!provider) return false;
    const doc = await provider.fetch(itemId);
    if (!doc) { await this.repo.remove(area, itemId); return false; }
    await this.repo.upsert({ area, itemId, title: doc.title, content: doc.content, contextId: doc.contextId, ownerId: doc.ownerId ?? null });
    return true;
  }

  async reindexAll(): Promise<{ indexed: number }> {
    let indexed = 0;
    for (const [name, provider] of this.areas) {
      for (const id of await provider.listIds()) if (await this.indexItem(name, id)) indexed++;
    }
    return { indexed };
  }

  async purgeOwner(ownerId: string): Promise<void> { await this.repo.removeByOwner(ownerId); }

  @OnEvent('course_created')
  async onCourseCreated(p: { courseId?: string }): Promise<void> { if (p.courseId) await this.indexItem('courses', p.courseId); }
  @OnEvent('user_suspended')
  async onUserSuspended(p: { userId?: string }): Promise<void> { if (p.userId) await this.purgeOwner(p.userId); }
  @OnEvent('user_deleted')
  async onUserDeleted(p: { userId?: string }): Promise<void> { if (p.userId) await this.purgeOwner(p.userId); }

  private async canManageUsers(userId: string): Promise<boolean> {
    if (await this.evaluator.isSiteAdmin(userId)) return true;
    const system = await this.contexts.ensureSystemContext();
    return this.evaluator.hasCapability(userId, 'user:update', system.id);
  }

  private async addEmailCandidates(q: string, candidates: SearchDocRow[]): Promise<SearchDocRow[]> {
    const tokens = q.split(/\s+/).filter((token) => token.includes('@'));
    if (!tokens.length) return candidates;
    const seen = new Set(candidates.map((d) => `${d.area}:${d.itemId}`));
    const extra: SearchDocRow[] = [];
    const db = this.repo.dbHandle;
    for (const token of tokens) {
      const rows = await db
        .selectFrom('users')
        .select(['id', 'suspended', 'deleted', 'is_guest as isGuest'])
        .where(sql<SqlBool>`lower(email) = ${token.toLowerCase()}`)
        .execute();
      for (const u of rows) {
        if (u.suspended || u.deleted || u.isGuest) continue;
        const key = `users:${u.id}`;
        if (seen.has(key)) continue;
        const doc = await this.repo.get('users', u.id);
        if (!doc) continue;
        seen.add(key);
        extra.push(doc);
      }
    }
    return [...candidates, ...extra];
  }

  async search(userId: string, q: string): Promise<SearchDocRow[]> {
    const manageUsers = await this.canManageUsers(userId);
    let candidates = await this.repo.queryEngine(q);
    if (manageUsers) candidates = await this.addEmailCandidates(q, candidates);
    const out: SearchDocRow[] = [];
    const areaCapability: Record<string, string> = {
      courses: 'course:view',
      users: 'user:viewdetails',
      contentbank: 'contentbank:viewcontent',
    };
    for (const doc of candidates) {
      const capability = areaCapability[doc.area] ?? 'course:view';
      let allowed = false;
      try {
        allowed = await this.evaluator.hasCapability(userId, capability, doc.contextId);
      } catch (err) {
        if (!(err instanceof NotFoundException)) throw err;
      }
      if (!allowed) continue;
      const provider = this.areas.get(doc.area);
      if (provider) {
        const fresh = await provider.fetch(doc.itemId);
        if (!fresh) continue;
        if (fresh.contextId !== doc.contextId) continue;
        if (provider.audienceCheck && !(await provider.audienceCheck(doc.itemId, userId))) continue;
        if (fresh.privilegedContent !== undefined) {
          if (manageUsers) {
            out.push({ ...doc, content: fresh.privilegedContent });
            continue;
          }
          if (!(await this.repo.matchesContent(fresh.title, fresh.content, q))) continue;
          out.push({ ...doc, content: fresh.content });
          continue;
        }
      }
      out.push(doc);
    }
    return out;
  }

  async indexRaw(v: { area: string; itemId: string; title: string; content: string; contextId: string; ownerId?: string }): Promise<SearchDocRow> {
    return this.repo.upsert(v);
  }
  async removeDoc(area: string, itemId: string): Promise<void> { return this.repo.remove(area, itemId); }
  async listDocs(): Promise<SearchDocRow[]> { return this.repo.listAll(); }
  async countDocs(): Promise<number> { return this.repo.countAll(); }
  async ping(): Promise<boolean> { await sql`select 1`.execute(this.repo.dbHandle); return true; }
}
