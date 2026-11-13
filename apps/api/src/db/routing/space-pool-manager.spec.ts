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

describe('Trình quản lý pool theo database', () => {
  it('tạo lười: chưa lấy handle thì chưa tạo pool nào; lấy lại cùng kho dùng lại đúng handle đã tạo', async () => {
    const { manager, create, created } = makeManager();
    expect(manager.size).toBe(0);
    expect(created()).toBe(0);
    const first = await manager.getHandle('kho_a', create);
    const second = await manager.getHandle('kho_a', create);
    expect(second).toBe(first);
    expect(created()).toBe(1);
    expect(manager.size).toBe(1);
  });

  it('mỗi kho một pool riêng: lấy handle của kho khác thì tạo thêm pool', async () => {
    const { manager, create, created } = makeManager();
    await manager.getHandle('kho_a', create);
    await manager.getHandle('kho_b', create);
    expect(created()).toBe(2);
    expect(manager.size).toBe(2);
  });

  it('pool chưa quá ngưỡng nhàn rỗi thì vòng quét không đóng', async () => {
    const { manager, create, advance } = makeManager(1_000);
    await manager.getHandle('kho_a', create);
    advance(999);
    await expect(manager.closeIdlePools()).resolves.toEqual([]);
    expect(manager.size).toBe(1);
  });

  it('pool nhàn rỗi quá ngưỡng và không còn kết nối đang mượn thì bị đóng và gỡ khỏi sổ', async () => {
    const { manager, create, advance, closedNotifications } = makeManager(1_000);
    const handle = await manager.getHandle('kho_a', create);
    (handle.pool as FakePool).totalCount = 2;
    (handle.pool as FakePool).idleCount = 2;
    advance(1_000);
    await expect(manager.closeIdlePools()).resolves.toEqual(['kho_a']);
    expect((handle.pool as FakePool).ended).toBe(true);
    expect(manager.size).toBe(0);
    expect(closedNotifications).toEqual(['kho_a']);
    const recreated = await manager.getHandle('kho_a', create);
    expect(recreated).not.toBe(handle);
    expect(manager.size).toBe(1);
  });

  it('pool còn kết nối đang được mượn thì vòng quét không đóng, dù đã quá ngưỡng nhàn rỗi', async () => {
    const { manager, create, advance } = makeManager(1_000);
    const handle = await manager.getHandle('kho_a', create);
    (handle.pool as FakePool).totalCount = 2;
    (handle.pool as FakePool).idleCount = 1;
    advance(5_000);
    await expect(manager.closeIdlePools()).resolves.toEqual([]);
    expect(manager.size).toBe(1);
    (handle.pool as FakePool).idleCount = 2;
    await expect(manager.closeIdlePools()).resolves.toEqual(['kho_a']);
  });

  it('hoạt động mượn kết nối từ pool làm mới mốc traffic: pool đang được dùng liên tục không bị coi là nhàn rỗi', async () => {
    const { manager, create, advance } = makeManager(1_000);
    const handle = await manager.getHandle('kho_a', create);
    advance(900);
    (handle.pool as FakePool).acquire();
    advance(900);
    await expect(manager.closeIdlePools()).resolves.toEqual([]);
    advance(101);
    await expect(manager.closeIdlePools()).resolves.toEqual(['kho_a']);
  });

  it('tổng kết nối cộng đúng số kết nối của mọi pool đang sống', async () => {
    const { manager, create } = makeManager();
    const a = await manager.getHandle('kho_a', create);
    const b = await manager.getHandle('kho_b', create);
    (a.pool as FakePool).totalCount = 3;
    (b.pool as FakePool).totalCount = 2;
    expect(manager.totalConnections()).toBe(5);
  });

  it('lấy handle theo danh tính: cùng danh tính thì dùng lại pool, đổi danh tính thì pool cũ bị đóng và thay bằng pool mới mang danh tính mới', async () => {
    const { manager, create, created, closedNotifications } = makeManager();
    const first = await manager.getHandleForIdentity('kho_a', 'identity-1', create);
    const same = await manager.getHandleForIdentity('kho_a', 'identity-1', create);
    expect(same).toBe(first);
    expect(created()).toBe(1);
    const replaced = await manager.getHandleForIdentity('kho_a', 'identity-2', create);
    expect(replaced).not.toBe(first);
    expect(created()).toBe(2);
    expect(manager.size).toBe(1);
    expect(closedNotifications).toEqual(['kho_a']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((first.pool as FakePool).ended).toBe(true);
    expect((replaced.pool as FakePool).ended).toBe(false);
  });

  it('lấy handle không kèm danh tính vẫn dùng lại pool đang sống; pool tạo không kèm danh tính thì nhận danh tính ở lần lấy kèm danh tính đầu tiên thay vì bị thay', async () => {
    const { manager, create, created } = makeManager();
    const withIdentity = await manager.getHandleForIdentity('kho_a', 'identity-1', create);
    const plain = await manager.getHandle('kho_a', create);
    expect(plain).toBe(withIdentity);
    expect(created()).toBe(1);
    const untracked = await manager.getHandle('kho_b', create);
    const adopted = await manager.getHandleForIdentity('kho_b', 'identity-9', create);
    expect(adopted).toBe(untracked);
    expect(created()).toBe(2);
    const replaced = await manager.getHandleForIdentity('kho_b', 'identity-10', create);
    expect(replaced).not.toBe(untracked);
    expect(created()).toBe(3);
  });

  it('pool đóng lỗi vẫn giữ slot và không phát tín hiệu đã đóng, đồng thời vòng quét vẫn đóng được kho khác', async () => {
    const { manager, create, closedNotifications, advance } = makeManager();
    const brokenPool = new FakePool();
    brokenPool.end = async () => {
      throw new Error('không đóng được pool');
    };
    await manager.getHandle('kho_a', (databaseName) => ({
      databaseName,
      pool: brokenPool,
      db: `db:${databaseName}`,
    }));
    await manager.getHandle('kho_b', create);
    advance(2_000);
    await expect(manager.closeIdlePools()).resolves.toEqual(['kho_b']);
    expect(closedNotifications).toEqual(['kho_b']);
    expect(manager.size).toBe(1);
    await expect(manager.getHandle('kho_a', create)).rejects.toThrow(/chưa thể đóng an toàn/);
  });

  it('closeAll đóng mọi pool đang sống và dọn sổ về rỗng', async () => {
    const { manager, create } = makeManager();
    const a = await manager.getHandle('kho_a', create);
    const b = await manager.getHandle('kho_b', create);
    await manager.closeAll();
    expect((a.pool as FakePool).ended).toBe(true);
    expect((b.pool as FakePool).ended).toBe(true);
    expect(manager.size).toBe(0);
    expect(manager.totalConnections()).toBe(0);
  });
  it('khi đạt trần thu hồi pool nhàn rỗi đã hết TTL mà không chờ chu kỳ quét', async () => {
    let now = 0;
    const closed: string[] = [];
    const manager = new SpacePoolManager<string>({
      idleTimeoutMs: 1_000, maxPools: 2, now: () => now,
      onPoolClosed: (databaseName) => closed.push(databaseName),
    });
    const pools = new Map<string, FakePool>();
    const create = (databaseName: string): SpacePoolHandle<string> => {
      const pool = new FakePool();
      pool.totalCount = 2;
      pool.idleCount = 2;
      pools.set(databaseName, pool);
      return { databaseName, pool, db: databaseName };
    };
    await manager.getHandleForIdentity('a', 'a', create);
    now = 100;
    await manager.getHandleForIdentity('b', 'b', create);
    now = 1_200;
    const third = await manager.getHandleForIdentity('c', 'c', create);
    expect(third.databaseName).toBe('c');
    expect(manager.size).toBe(2);
    expect(closed).toEqual(['a']);
    expect(pools.get('a')?.ended).toBe(true);
    expect(pools.get('b')?.ended).toBe(false);
  });

  it('rotation kho A đang chờ end không chặn truy vấn kho B hoặc mở kho C còn chỗ', async () => {
    const manager = new SpacePoolManager<string>({ idleTimeoutMs: 1000, maxPools: 3 });
    const draining = new FakePool();
    let finishDrain!: () => void;
    draining.end = () => new Promise<void>((resolve) => { finishDrain = resolve; });
    const create = (databaseName: string): SpacePoolHandle<string> => ({
      databaseName,
      pool: new FakePool(),
      db: databaseName,
    });

    await manager.getHandleForIdentity('a', 'version-1', (databaseName) => ({
      databaseName, pool: draining, db: databaseName,
    }));
    const b = await manager.getHandleForIdentity('b', 'version-1', create);
    const rotatedA = manager.getHandleForIdentity('a', 'version-2', create);

    const available = Promise.all([
      manager.getHandleForIdentity('b', 'version-1', create),
      manager.getHandleForIdentity('c', 'version-1', create),
    ]);
    try {
      const progress = await Promise.race([
        available.then(() => 'ready'),
        new Promise<string>((resolve) => setTimeout(() => resolve('blocked'), 300)),
      ]);
      expect(progress).toBe('ready');
      const [againB, c] = await available;
      expect(againB).toBe(b);
      expect(c.databaseName).toBe('c');
      expect(manager.size).toBe(3);
    } finally {
      finishDrain();
    }
    const nextA = await rotatedA;
    expect(nextA.databaseName).toBe('a');
    expect(nextA.pool).not.toBe(draining);
    expect(manager.size).toBe(3);
  });

  it('yêu cầu đồng thời không mở vượt ngân sách trong lúc pool cũ đang đóng', async () => {
    let now = 0;
    const manager = new SpacePoolManager<string>({ idleTimeoutMs: 100, maxPools: 1, now: () => now });
    const retiring = new FakePool();
    retiring.totalCount = 1;
    retiring.idleCount = 1;
    let finishDrain!: () => void;
    retiring.end = () => new Promise<void>((resolve) => { finishDrain = resolve; });
    await manager.getHandle('old', (databaseName) => ({
      databaseName, pool: retiring, db: databaseName,
    }));
    now = 200;
    let created = 0;
    const create = (databaseName: string) => {
      created += 1;
      return { databaseName, pool: new FakePool(), db: databaseName };
    };
    const first = manager.getHandle('new-a', create);
    const second = manager.getHandle('new-b', create);
    await expect(second).rejects.toThrow(/trần pool kho riêng/);
    expect(manager.size).toBe(1);
    expect(created).toBe(0);
    finishDrain();
    const result = await first;
    expect(result.databaseName).toBe('new-a');
    expect(manager.size).toBe(1);
    expect(created).toBe(1);
  });

  it('tắt manager khi pool đang drain không gọi end lần hai hoặc mở pool mới', async () => {
    const manager = new SpacePoolManager<string>({ idleTimeoutMs: 1000, maxPools: 1 });
    const pool = new FakePool();
    let finishDrain!: () => void;
    let endCalls = 0;
    pool.end = () => {
      endCalls += 1;
      return new Promise<void>((resolve) => { finishDrain = resolve; });
    };
    await manager.getHandleForIdentity('a', 'first', (databaseName) => ({
      databaseName, pool, db: databaseName,
    }));
    let created = 0;
    const rotate = manager.getHandleForIdentity('a', 'second', (databaseName) => {
      created += 1;
      return { databaseName, pool: new FakePool(), db: databaseName };
    });
    const outcome = rotate.then(
      () => 'resolved',
      (error: unknown) => error instanceof Error ? error.message : String(error),
    );
    const closing = manager.closeAll();
    expect(endCalls).toBe(1);
    finishDrain();
    await closing;
    expect(await outcome).toMatch(/closed/);
    expect(created).toBe(0);
    expect(manager.size).toBe(0);
  });

  it('đóng pool cũ thất bại giữ slot và báo lỗi chính xác thay vì từ chối giả một lần', async () => {
    let now = 0;
    const errors: string[] = [];
    const closed: string[] = [];
    const manager = new SpacePoolManager<string>({
      idleTimeoutMs: 100,
      maxPools: 1,
      now: () => now,
      onPoolClosed: (name) => closed.push(name),
      onPoolCloseError: (name) => errors.push(name),
    });
    const failing = new FakePool();
    failing.totalCount = 1;
    failing.idleCount = 1;
    failing.end = async () => { throw new Error('I/O failure'); };
    await manager.getHandle('a', (databaseName) => ({
      databaseName, pool: failing, db: databaseName,
    }));
    now = 200;
    const create = (databaseName: string) => ({
      databaseName, pool: new FakePool(), db: databaseName,
    });
    await expect(manager.getHandle('b', create)).rejects.toThrow(/Không thể đóng pool kho riêng/);
    expect(manager.size).toBe(1);
    expect(errors).toEqual(['a']);
    expect(closed).toEqual([]);
    await expect(manager.getHandle('b', create)).rejects.toThrow(/trần pool kho riêng/);
    await expect(manager.getHandle('a', create)).rejects.toThrow(/chưa thể đóng an toàn/);
    expect(manager.size).toBe(1);
  });

  it('không ngắt kết nối đang mượn khi trần pool đã đầy', async () => {
    let now = 0;
    const manager = new SpacePoolManager<string>({ idleTimeoutMs: 100, maxPools: 1, now: () => now });
    const pool = new FakePool();
    pool.totalCount = 2;
    pool.idleCount = 1;
    const create = (name: string) => ({ databaseName: name, pool: new FakePool(), db: name });
    await manager.getHandleForIdentity('active', 'id', (name) => ({ databaseName: name, pool, db: name }));
    now = 200;
    await expect(manager.getHandleForIdentity('next', 'id', create)).rejects.toThrow(/trần pool kho riêng/);
    expect(pool.ended).toBe(false);
    pool.idleCount = 2;
    const next = await manager.getHandleForIdentity('next', 'id', create);
    expect(next.databaseName).toBe('next');
    expect(pool.ended).toBe(true);
  });

  it('không mở pool mới trước khi kết thúc đóng pool cũ', async () => {
    let now = 0;
    const manager = new SpacePoolManager<string>({ idleTimeoutMs: 100, maxPools: 1, now: () => now });
    const pool = new FakePool();
    pool.totalCount = 1;
    pool.idleCount = 1;
    let release!: () => void;
    pool.end = () => new Promise<void>((resolve) => { release = resolve; });
    await manager.getHandle('old', (databaseName) => ({ databaseName, pool, db: databaseName }));
    now = 101;
    let createCount = 0;
    const creation = manager.getHandle('new', (databaseName) => {
      createCount += 1;
      return { databaseName, pool: new FakePool(), db: databaseName };
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(createCount).toBe(0);
    release();
    await expect(creation).resolves.toHaveProperty('databaseName', 'new');
    expect(createCount).toBe(1);
    expect(manager.size).toBe(1);
  });

  it('không mở vượt số pool kho riêng tối đa; tái dùng pool cũ không tính thêm', async () => {
    const manager = new SpacePoolManager({ idleTimeoutMs: 60_000, maxPools: 1 });
    const pool = { totalCount: 0, idleCount: 0, end: async () => {}, on: () => {} };
    const make = (databaseName: string) => ({ databaseName, pool, db: databaseName });
    expect((await manager.getHandle('kho-a', make)).databaseName).toBe('kho-a');
    expect((await manager.getHandle('kho-a', make)).databaseName).toBe('kho-a');
    await expect(manager.getHandle('kho-b', make)).rejects.toThrow(/trần pool kho riêng/);
    expect(manager.size).toBe(1);
  });

});
