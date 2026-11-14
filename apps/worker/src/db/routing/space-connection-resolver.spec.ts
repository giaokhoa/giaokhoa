import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitSpaceRegistryChanged } from './space-routing-events';
import {
  SpaceConnectionResolver,
  type SpaceRegistryEntry,
} from './space-connection-resolver';


const DEDICATED_ENTRY: SpaceRegistryEntry = {
  kind: 'center',
  id: 'id-dang-ky-a',
  slug: 'trung-tam-a',
  status: 'active',
  databaseName: 'giaokhoa_centre_a',
  storageMode: 'dedicated',
  connectionRoleRef: 'centre_a_app',
  secretRef: 'env:CENTRE_A_URL',
  schemaVersion: 'v3',
};

const SHARED_ENTRY: SpaceRegistryEntry = {
  kind: 'center',
  id: 'id-dang-ky-trang-chinh',
  slug: 'trang-chinh',
  status: 'active',
  databaseName: 'giaokhoa_shared',
  storageMode: 'shared',
  connectionRoleRef: 'giaokhoa_app',
  secretRef: 'env:DATABASE_URL',
  schemaVersion: 'v1',
};

function makeResolver(entries: Record<string, SpaceRegistryEntry>, cacheTtlMs = 1_000) {
  let reads = 0;
  const now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const resolver = new SpaceConnectionResolver({
    cacheTtlMs,
    readRegistry: async (slug) => {
      reads += 1;
      return entries[slug];
    },
    resolveSecretRef: (ref) => (ref === 'env:CENTRE_A_URL' ? 'postgres://centre_a_app:pw@db.internal:5432/postgres' : undefined),
  });
  return {
    resolver,
    reads: () => reads,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CENTRE_A_URL;
});

describe('Bộ phân giải đích kết nối theo trung tâm — bản sao phía worker', () => {
  it('kho riêng phân giải được spaceId, dòng shared legacy bị từ chối', async () => {
    const { resolver } = makeResolver({
      'trung-tam-a': { ...DEDICATED_ENTRY },
      'trang-chinh': { ...SHARED_ENTRY },
    });
    await expect(resolver.resolve('trung-tam-a')).resolves.toMatchObject({ spaceId: 'id-dang-ky-a' });
    await expect(resolver.resolve('trang-chinh')).rejects.toMatchObject({
      code: 'space_routing.shared_not_supported',
    });
    resolver.dispose();
  });

  it('sự kiện đổi sổ vô hiệu hoá đệm của đúng slug đó ngay trong TTL', async () => {
    const entries = { 'trung-tam-a': { ...DEDICATED_ENTRY }, 'trang-chinh': { ...DEDICATED_ENTRY, id: 'id-platform', slug: 'trang-chinh' } };
    const { resolver, reads } = makeResolver(entries);
    await resolver.resolve('trung-tam-a');
    await resolver.resolve('trang-chinh');
    expect(reads()).toBe(2);
    entries['trung-tam-a'] = { ...DEDICATED_ENTRY, status: 'suspended' };
    emitSpaceRegistryChanged('trung-tam-a');
    const resolved = await resolver.resolve('trung-tam-a');
    expect(resolved.status).toBe('suspended');
    expect(reads()).toBe(3);
    await resolver.resolve('trang-chinh');
    expect(reads()).toBe(3);
    resolver.dispose();
  });

  it('sự kiện vô hiệu hoá tới trong lúc lần đọc sổ còn đang chờ thì kết quả cũ không được đệm: lần phân giải kế tiếp đọc lại sổ và trả đích mới', async () => {
    const slug = 'trung-tam-a';
    let currentEntry: SpaceRegistryEntry = { ...DEDICATED_ENTRY };
    let reads = 0;
    let releaseFirstRead: ((entry: SpaceRegistryEntry | undefined) => void) | undefined;
    const resolver = new SpaceConnectionResolver({
      cacheTtlMs: 60_000,
      readRegistry: () => {
        reads += 1;
        if (reads === 1) {
          return new Promise<SpaceRegistryEntry | undefined>((resolveRead) => {
            releaseFirstRead = resolveRead;
          });
        }
        return Promise.resolve(currentEntry);
      },
      resolveSecretRef: (ref) =>
        ref === 'env:CENTRE_A_URL' ? 'postgres://centre_a_app:pw@db.internal:5432/postgres' : undefined,
    });
    const firstResolve = resolver.resolve(slug);
    currentEntry = { ...DEDICATED_ENTRY, status: 'suspended' };
    emitSpaceRegistryChanged(slug);
    releaseFirstRead!({ ...DEDICATED_ENTRY });
    await firstResolve;
    const second = await resolver.resolve(slug);
    expect(second.status).toBe('suspended');
    expect(reads).toBe(2);
    resolver.dispose();
  });
});
