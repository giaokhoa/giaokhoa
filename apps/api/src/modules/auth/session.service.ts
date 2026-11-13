import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SessionCacheService } from '../../infra/cache/session-cache.service';

export interface WebSessionClientInfo { ip?: string; userAgent?: string }

export interface WebSession extends WebSessionClientInfo {
  userId: string;
  username: string;
  createdAt: string;
  lastActivityAt: string;
  loginAs?: { byUserId: string };
  spaceSlug?: string;
}

export interface ListedWebSession { id: string; session: WebSession }

const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class SessionService {
  constructor(private readonly store: SessionCacheService) {}

  private indexKey(userId: string): string { return `webindex:${userId}`; }

  private async indexAdd(userId: string, id: string): Promise<void> {
    const ids = (await this.store.get<string[]>(this.indexKey(userId))) ?? [];
    if (!ids.includes(id)) await this.store.set(this.indexKey(userId), [...ids, id]);
  }

  private async indexRemove(userId: string, id: string): Promise<void> {
    const ids = (await this.store.get<string[]>(this.indexKey(userId))) ?? [];
    const next = ids.filter((x) => x !== id);
    if (next.length === ids.length) return;
    if (next.length === 0) await this.store.delete(this.indexKey(userId));
    else await this.store.set(this.indexKey(userId), next);
  }

  async create(data: Omit<WebSession, 'createdAt' | 'lastActivityAt'>): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.store.set(`web:${id}`, { ...data, createdAt: now, lastActivityAt: now } satisfies WebSession);
    await this.indexAdd(data.userId, id);
    return id;
  }
  async get(id: string): Promise<WebSession | undefined> { return this.store.get<WebSession>(`web:${id}`); }
  async touch(id: string): Promise<void> {
    const session = await this.get(id);
    if (!session) return;
    if (Date.now() - new Date(session.lastActivityAt).getTime() < TOUCH_INTERVAL_MS) return;
    await this.store.set(`web:${id}`, { ...session, lastActivityAt: new Date().toISOString() });
  }
  async destroy(id: string): Promise<void> {
    const session = await this.get(id);
    await this.store.delete(`web:${id}`);
    if (session) await this.indexRemove(session.userId, id);
  }
  async rotate(oldId: string | undefined, data: Omit<WebSession, 'createdAt' | 'lastActivityAt'>): Promise<string> {
    if (oldId) await this.destroy(oldId);
    return this.create(data);
  }
  async listForUser(userId: string): Promise<ListedWebSession[]> {
    const ids = (await this.store.get<string[]>(this.indexKey(userId))) ?? [];
    const alive: ListedWebSession[] = [];
    for (const id of ids) {
      const session = await this.get(id);
      if (session && session.userId === userId) alive.push({ id, session });
    }
    const aliveIds = new Set(alive.map((x) => x.id));
    for (const id of ids) if (!aliveIds.has(id)) await this.indexRemove(userId, id);
    return alive;
  }
  async destroyAllForUser(userId: string): Promise<number> {
    return this.destroyOthersForUser(userId);
  }

  async destroyOthersForUser(userId: string, keepId?: string): Promise<number> {
    const listed = await this.listForUser(userId);
    let destroyed = 0;
    for (const { id } of listed) {
      if (id === keepId) continue;
      await this.destroy(id);
      destroyed += 1;
    }
    return destroyed;
  }
}
