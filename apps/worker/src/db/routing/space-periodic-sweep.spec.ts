import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { tenantAls } from '../tenant-als';
import { SpaceDatabaseService } from './space-database.service';

/**
 * Hồi quy issue #11: mọi lượt quét định kỳ phải xem shared + từng kho
 * dedicated với định danh registry bất biến, ngay cả khi user/tenant/
 * outbox UUID trùng nhau; lỗi một kho không được ngăn kho khác.
 */
describe('SpaceDatabaseService.sweepSharedAndDedicated', () => {
  const registry = [
    { id: 'space-a', slug: 'a', storageMode: 'dedicated', status: 'active' },
    { id: 'space-b', slug: 'b', storageMode: 'dedicated', status: 'active' },
    { id: 'space-shared', slug: 'c', storageMode: 'shared', status: 'active' },
    { id: 'space-closed', slug: 'closed', storageMode: 'dedicated', status: 'closed' },
  ];
  const config = { get: (key: string) => key === 'SPACE_SWEEP_CONCURRENCY' ? 2 : undefined } as ConfigService;
  const spaceDb = new SpaceDatabaseService(config);
  let onPrepare: (slug: string) => Promise<string>;
  const list = vi.spyOn(spaceDb, 'listRegisteredSpaces');
  const resolve = vi.spyOn(spaceDb, 'resolveTarget');
  const open = vi.spyOn(spaceDb, 'withSpaceKysely');
  const handled: string[] = [];

  beforeEach(() => {
    handled.length = 0;
    onPrepare = async (slug) => registry.find((s) => s.slug === slug)!.id;
    list.mockResolvedValue(registry as never);
    resolve.mockImplementation(async (slug) => {
      const entry = registry.find((s) => s.slug === slug)!;
      return {
        slug, spaceId: entry.id, status: entry.status,
        mode: entry.storageMode, databaseName: slug, schemaVersion: 'v1',
        connectionRole: 'test', connectionString: 'postgres://test',
      } as never;
    });
    open.mockImplementation(async (slug, fn) => {
      const id = await onPrepare(slug);
      return tenantAls.run({ platform: true, spaceSlug: slug, spaceId: id }, () => fn({} as never));
    });
  });
  afterAll(async () => { await spaceDb.onModuleDestroy(); });

  const task = async (): Promise<string[]> => {
    const id = tenantAls.getStore()?.spaceId ?? 'shared';
    handled.push(id);
    return [`${id}:user-same-uuid`];
  };
  const merge = (a: string[], b: string[]) => [...a, ...b];

  it('quét đúng 3 kho dù UUID nội bộ trùng; không chạy shared lần thứ hai', async () => {
    const result = await spaceDb.sweepSharedAndDedicated(task, merge);
    expect(result).toEqual([
      'shared:user-same-uuid', 'space-a:user-same-uuid', 'space-b:user-same-uuid',
    ]);
    expect(handled).toEqual(['shared', 'space-a', 'space-b']);
    expect(open).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(4);
  });

  it('A lỗi: B vẫn chạy, trả failed cho BullMQ retry; lượt sau không trộn phạm vi', async () => {
    let failedOnce = false;
    onPrepare = async (slug) => {
      if (slug === 'a' && !failedOnce) {
        failedOnce = true;
        throw new Error('A chưa mở được');
      }
      return registry.find((s) => s.slug === slug)!.id;
    };
    const committed = new Set<string>();
    const idempotentTask = async () => {
      const id = tenantAls.getStore()?.spaceId ?? 'shared';
      committed.add(`${id}:same-outbox-uuid`);
      handled.push(id);
      return [id];
    };
    await expect(spaceDb.sweepSharedAndDedicated(idempotentTask, merge)).rejects.toThrow('A chưa mở được');
    expect(handled).toEqual(['shared', 'space-b']);
    await spaceDb.sweepSharedAndDedicated(idempotentTask, merge);
    expect(committed).toEqual(new Set([
      'shared:same-outbox-uuid', 'space-a:same-outbox-uuid', 'space-b:same-outbox-uuid',
    ]));
  });

  it('slug chuyển sang một identity khác giữa resolve và chuẩn bị: callback không chạy trong kho lạ', async () => {
    onPrepare = async (slug) => slug === 'a' ? 'space-reassigned-to-b' : 'space-b';
    await expect(spaceDb.sweepSharedAndDedicated(task, merge))
      .rejects.toThrow('Prepared identity changed for a');
    expect(handled).toEqual(['shared', 'space-b']);
  });

  it('shared lỗi vẫn quét A/B, sau đó đánh dấu job thất bại để retry', async () => {
    const failingShared = async () => {
      const id = tenantAls.getStore()?.spaceId ?? 'shared';
      if (id === 'shared') throw new Error('Kho chung chưa đọc được');
      handled.push(id);
      return [id];
    };
    await expect(spaceDb.sweepSharedAndDedicated(failingShared, merge)).rejects.toThrow('Kho chung chưa đọc được');
    expect(handled).toEqual(['space-a', 'space-b']);
  });

  it('control plane không đọc được: fail-closed thay vì báo thành công giả', async () => {
    list.mockRejectedValue(new Error('registry unavailable'));
    await expect(spaceDb.sweepSharedAndDedicated(task, merge)).rejects.toThrow('registry unavailable');
    expect(handled).toEqual(['shared']);
  });

  it('lượt B bị thu hồi/chuyển chế độ giữa snapshot và chạy: vẫn quét A, không đọc B', async () => {
    resolve.mockImplementation(async (slug) => ({
      slug, spaceId: slug === 'a' ? 'space-a' : 'space-b',
      status: slug === 'b' ? 'closed' : 'active',
      mode: 'dedicated', databaseName: slug, schemaVersion: 'v1',
      connectionRole: 'test', connectionString: 'postgres://test',
    }));
    await expect(spaceDb.sweepSharedAndDedicated(task, merge))
      .rejects.toThrow('Space identity changed for b');
    expect(handled).toEqual(['shared', 'space-a']);
  });
});