
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

  constructor(private readonly deps: SpacePoolManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  getHandle(databaseName: string, create: (databaseName: string) => SpacePoolHandle<TDatabase>): SpacePoolHandle<TDatabase> {
    return this.acquire(databaseName, undefined, create);
  }

  getHandleForIdentity(
    databaseName: string,
    identity: string,
    create: (databaseName: string) => SpacePoolHandle<TDatabase>,
  ): SpacePoolHandle<TDatabase> {
    return this.acquire(databaseName, identity, create);
  }

  private acquire(
    databaseName: string,
    identity: string | undefined,
    create: (databaseName: string) => SpacePoolHandle<TDatabase>,
  ): SpacePoolHandle<TDatabase> {
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
      this.entries.delete(databaseName);
      void existing.handle.pool.end().catch(() => undefined);
      this.deps.onPoolClosed?.(databaseName);
    }
    if (this.entries.size >= (this.deps.maxPools ?? Number.POSITIVE_INFINITY)) {
      throw new Error(`Đã đạt trần pool kho riêng (${this.deps.maxPools}); từ chối mở thêm kho ${databaseName}`);
    }
    const handle = create(databaseName);
    const entry: PoolEntry<TDatabase> = { handle, lastUsedAt: this.now(), identity };
    this.entries.set(databaseName, entry);
    handle.pool.on?.('acquire', () => {
      entry.lastUsedAt = this.now();
    });
    return handle;
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
    const closed: string[] = [];
    for (const [databaseName, entry] of [...this.entries]) {
      if (at - entry.lastUsedAt < this.deps.idleTimeoutMs) continue;
      const { pool } = entry.handle;
      if (pool.totalCount !== pool.idleCount) continue;
      this.entries.delete(databaseName);
      let closedCleanly = false;
      try {
        await pool.end();
        closedCleanly = true;
      } catch {
      }
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
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(entries.map((entry) => entry.handle.pool.end().catch(() => undefined)));
  }
}
