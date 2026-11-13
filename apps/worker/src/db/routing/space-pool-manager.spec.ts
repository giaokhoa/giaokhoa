import { describe, expect, it } from 'vitest';
import { SpacePoolManager, type ManagedPool, type SpacePoolHandle } from './space-pool-manager';


class FakePool implements ManagedPool {
  totalCount = 0;
  idleCount = 0;
  ended = false;
  private readonly acquireListeners: Array<() => void> = [];

  async end(): Promise<void> {
    this.ended = true;
    this.totalCount = 0;
    this.idleCount = 0;
  }

  on(event: 'acquire', listener: () => void): this {
    if (event === 'acquire') this.acquireListeners.push(listener);
    return this;
  }

  acquire(): void {
    for (const listener of this.acquireListeners) listener();
  }
}

function makeManager(idleTimeoutMs = 1_000) {
  let created = 0;
  let now = 0;
  const closedNotifications: string[] = [];
  const manager = new SpacePoolManager<string>({
    idleTimeoutMs,
    now: () => now,
    onPoolClosed: (databaseName) => closedNotifications.push(databaseName),
  });
  const create = (databaseName: string): SpacePoolHandle<string> => {
    created += 1;
    return { databaseName, pool: new FakePool(), db: `db:${databaseName}` };
  };
  return {
    manager,
    create,
    created: () => created,
    closedNotifications,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('Trình quản lý pool theo database — bản sao phía worker', () => {
  it('pool nhàn rỗi quá ngưỡng và không còn kết nối đang mượn thì bị đóng và gỡ khỏi sổ ở vòng quét', async () => {
    const { manager, create, closedNotifications, advance } = makeManager();
    manager.getHandle('kho_a', create);
    advance(2_000);
    await expect(manager.closeIdlePools()).resolves.toEqual(['kho_a']);
    expect(closedNotifications).toEqual(['kho_a']);
    expect(manager.size).toBe(0);
  });

  it('pool ném lỗi khi đóng ở vòng quét: vẫn nhận thông báo đã đóng, không tính là đóng thành công, và các pool còn lại vẫn được đóng ở cùng vòng', async () => {
    const { manager, create, closedNotifications, advance } = makeManager();
    const brokenPool = new FakePool();
    brokenPool.end = async () => {
      throw new Error('không đóng được pool');
    };
    manager.getHandle('kho_a', (databaseName) => ({
      databaseName,
      pool: brokenPool,
      db: `db:${databaseName}`,
    }));
    manager.getHandle('kho_b', create);
    advance(2_000);
    await expect(manager.closeIdlePools()).resolves.toEqual(['kho_b']);
    expect(closedNotifications).toEqual(['kho_a', 'kho_b']);
    expect(manager.size).toBe(0);
  });
  it('không mở vượt số pool kho riêng tối đa; tái dùng pool cũ không tính thêm', () => {
    const manager = new SpacePoolManager({ idleTimeoutMs: 60_000, maxPools: 1 });
    const pool = { totalCount: 0, idleCount: 0, end: async () => {}, on: () => {} };
    const make = (databaseName: string) => ({ databaseName, pool, db: databaseName });
    expect(manager.getHandle('kho-a', make).databaseName).toBe('kho-a');
    expect(manager.getHandle('kho-a', make).databaseName).toBe('kho-a');
    expect(() => manager.getHandle('kho-b', make)).toThrow(/trần pool kho riêng/);
    expect(manager.size).toBe(1);
  });

});
