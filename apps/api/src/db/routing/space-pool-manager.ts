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
  state: 'ready' | 'closing' | 'failed';
  closing?: Promise<void>;
}

export interface SpacePoolManagerDeps {
  idleTimeoutMs: number;
  maxPools?: number;
  now?: () => number;
  onPoolClosed?: (databaseName: string) => void;
  onPoolCloseError?: (databaseName: string, error: unknown) => void;
}

export class SpacePoolManager<TDatabase> {
  private readonly entries = new Map<string, PoolEntry<TDatabase>>();
  private readonly now: () => number;
  private sweepTimer: NodeJS.Timeout | null = null;
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

  private async closeEntry(databaseName: string, entry: PoolEntry<TDatabase>): Promise<void> {
    if (entry.state === 'closing' && entry.closing) return entry.closing;
    if (entry.state === 'failed') throw new Error('Không thể đóng pool kho riêng: ' + databaseName);
    entry.state = 'closing';
    const closing = (async () => {
      try {
        await entry.handle.pool.end();
      } catch (error) {
        entry.state = 'failed';
        this.deps.onPoolCloseError?.(databaseName, error);
        throw new Error('Không thể đóng pool kho riêng: ' + databaseName, { cause: error });
      }
      if (this.entries.get(databaseName) === entry) {
        this.entries.delete(databaseName);
        this.deps.onPoolClosed?.(databaseName);
      }
    })();
    entry.closing = closing;
    return closing;
  }

  private async acquire(
    databaseName: string,
    identity: string | undefined,
    create: (databaseName: string) => SpacePoolHandle<TDatabase>,
  ): Promise<SpacePoolHandle<TDatabase>> {
    while (true) {
      if (this.disposed) throw new Error('Space pool manager has been closed');
      const existing = this.entries.get(databaseName);
      if (existing?.state === 'closing') {
        await existing.closing;
        continue;
      }
      if (existing?.state === 'failed') {
        throw new Error('Pool kho riêng chưa thể đóng an toàn: ' + databaseName);
      }
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
        await this.closeEntry(databaseName, existing);
        continue;
      }

      const maxPools = this.deps.maxPools ?? Number.POSITIVE_INFINITY;
      if (this.entries.size >= maxPools) {
        const at = this.now();
        const candidate = [...this.entries].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
          .find(([, entry]) => entry.state === 'ready'
            && at - entry.lastUsedAt >= this.deps.idleTimeoutMs
            && entry.handle.pool.totalCount === entry.handle.pool.idleCount);
        if (!candidate) {
          throw new Error('Đã đạt trần pool kho riêng (' + this.deps.maxPools + '); từ chối mở thêm kho ' + databaseName);
        }
        await this.closeEntry(candidate[0], candidate[1]);
        continue;
      }

      const handle = create(databaseName);
      const entry: PoolEntry<TDatabase> = {
        handle,
        lastUsedAt: this.now(),
        identity,
        state: 'ready',
      };
      this.entries.set(databaseName, entry);
      handle.pool.on?.('acquire', () => {
        entry.lastUsedAt = this.now();
      });
      return handle;
    }
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
    if (this.disposed) return [];
    const closed: string[] = [];
    const candidates = [...this.entries].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    for (const [databaseName, entry] of candidates) {
      if (this.entries.get(databaseName) !== entry || entry.state !== 'ready') continue;
      if (at - entry.lastUsedAt < this.deps.idleTimeoutMs) continue;
      const { pool } = entry.handle;
      if (pool.totalCount !== pool.idleCount) continue;
      try {
        await this.closeEntry(databaseName, entry);
        closed.push(databaseName);
      } catch {
      }
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
    this.disposed = true;
    const entries = [...this.entries.values()];
    await Promise.all(entries.map((entry) => (
      entry.state === 'closing' && entry.closing
        ? entry.closing.catch(() => undefined)
        : entry.handle.pool.end().catch(() => undefined)
    )));
    this.entries.clear();
  }
}
