
export interface ManagedPool {
  readonly totalCount: number;
  readonly idleCount: number;
  end(): Promise<void>;
  on?(event: 'acquire', listener: () => void): unknown;
}

export interface SpacePoolHandle<TDatabase> {
  databaseName: string;
  pool: ManagedPool;
  db: TDatabase;
}

interface PoolEntry<TDatabase> {
  handle: SpacePoolHandle<TDatabase>;
  lastUsedAt: number;
  identity?: string;
}

export interface SpacePoolManagerDeps {
  idleTimeoutMs: number;





  maxPools?: number;

  now?: () => number;
  onPoolClosed?: (databaseName: string) => void;
}

export class SpacePoolManager<TDatabase> {
  private readonly entries = new Map<string, PoolEntry<TDatabase>>();
  private readonly now: () => number;
  private sweepTimer: NodeJS.Timeout | null = null;
  private pending: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly deps: SpacePoolManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  async getHandle(
    databaseName: string,
    create: (databaseName: string) => SpacePoolHandle<TDatabase>,
  ): Promise<SpacePoolHandle<TDatabase>> {
    return this.acquire(databaseName, undefined, create);
  }

  async getHandleForIdentity(
    databaseName: string,
    identity: string,
    create: (databaseName: string) => SpacePoolHandle<TDatabase>,
  ): Promise<SpacePoolHandle<TDatabase>> {
    return this.acquire(databaseName, identity, create);
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.pending;
    let unlock!: () => void;
    this.pending = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      unlock();
    }
  }

  private async acquire(
    databaseName: string,
    identity: string | undefined,
    create: (databaseName: string) => SpacePoolHandle<TDatabase>,
  ): Promise<SpacePoolHandle<TDatabase>> {
    return this.exclusive(async () => {
      if (this.disposed) throw new Error('Space pool manager has been closed');
      const existing = this.entries.get(databaseName);
      if (existing) {
        if (identity === undefined || existing.identity === identity) {
          existing.lastUsedAt = this.now();
          return existing.handle;
        }
        if (existing.identity === undefined) {
          existing.identity = identity;
          existing.lastUsedAt = this.now();
          return existing.handle;
        }
        await existing.handle.pool.end();
        this.entries.delete(databaseName);
        this.deps.onPoolClosed?.(databaseName);
      }

      const maxPools = this.deps.maxPools ?? Number.POSITIVE_INFINITY;
      if (this.entries.size >= maxPools) {
        const released = await this.closeIdlePoolsLocked(this.now(), 1);
        if (released.length === 0) {
          throw new Error(`Đã đạt trần pool kho riêng (${this.deps.maxPools}); từ chối mở thêm kho ${databaseName}`);
        }
      }

      const handle = create(databaseName);
      const entry: PoolEntry<TDatabase> = { handle, lastUsedAt: this.now(), identity };
      this.entries.set(databaseName, entry);
      handle.pool.on?.('acquire', () => {
        entry.lastUsedAt = this.now();
      });
      return handle;
    });
  }

  get size(): number {
    return this.entries.size;
  }

  totalConnections(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.handle.pool.totalCount;
    return total;
  }

  async closeIdlePools(at: number = this.now()): Promise<string[]> {
    return this.exclusive(() => this.closeIdlePoolsLocked(at));
  }

  private async closeIdlePoolsLocked(at: number, limit = Number.POSITIVE_INFINITY): Promise<string[]> {
    const closed: string[] = [];
    const candidates = [...this.entries].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    for (const [databaseName, entry] of candidates) {
      if (closed.length >= limit) break;
      if (at - entry.lastUsedAt < this.deps.idleTimeoutMs) continue;
      const { pool } = entry.handle;
      if (pool.totalCount !== pool.idleCount) continue;
      let closedCleanly = false;
      try {
        await pool.end();
        closedCleanly = true;
      } catch {
      }
      this.entries.delete(databaseName);
      if (closedCleanly) closed.push(databaseName);
      this.deps.onPoolClosed?.(databaseName);
    }
    return closed;
  }

  startIdleSweeper(intervalMs: number): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      void this.closeIdlePools().catch(() => undefined);
    }, intervalMs);
    this.sweepTimer.unref?.();
  }

  stopIdleSweeper(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  async closeAll(): Promise<void> {
    this.stopIdleSweeper();
    await this.exclusive(async () => {
      this.disposed = true;
      const entries = [...this.entries.values()];
      this.entries.clear();
      await Promise.all(entries.map((entry) => entry.handle.pool.end().catch(() => undefined)));
    });
  }
}
