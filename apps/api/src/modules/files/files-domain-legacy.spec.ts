import { describe, expect, it, vi } from 'vitest';
import { LEGACY_FILE_DOMAIN } from '@giaokhoa/db';
import type { FileRow } from '@giaokhoa/db/repositories/files';
import { tenantAls } from '../tenants/tenant-als';
import { FilesService } from './files.service';

const TENANT_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const FILE_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';

/**
 * Context legacy của hai tenant trong CÙNG database: không được
 * dùng cờ legacy như một quyền đọc chung vượt host hoặc phiên.
 */
describe('FilesService: miền legacy theo chủ context ở kho dùng chung', () => {
  function setup() {
    const file = {
      id: FILE_ID, storageDomain: LEGACY_FILE_DOMAIN,
      contextId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
      contentHash: '0'.repeat(64),
    } as FileRow;
    const repo = {
      getById: vi.fn(async () => file),
      getContextTenantId: vi.fn(async (): Promise<string | null> => TENANT_A),
    };
    const query = {
      select: () => query,
      where: () => query,
      executeTakeFirst: async () => {
        // Tra cứu danh tính tenant trong scope platform trên handle đã
        // định tuyến; tuyệt đối không nâng quyền caller ra ngoài đoạn này.
        expect(tenantAls.getStore()?.platform).toBe(true);
        const slug = tenantAls.getStore()?.spaceSlug;
        return slug === 'centre-a' ? { id: TENANT_A, kind: 'centre' }
          : slug === 'centre-b' ? { id: TENANT_B, kind: 'centre' } : undefined;
      },
    };
    const spaceDb = {
      resolveTarget: vi.fn(async () => ({ mode: 'shared', spaceId: TENANT_A })),
      routedKysely: { selectFrom: () => query },
    };
    const service = new FilesService(repo as never, {} as never, {} as never,
      {} as never, {} as never, spaceDb as never);
    return { service, repo };
  }

  it('đọc legacy ở host A khi context thuộc tenant A và không phát quyền platform ra ngoài', async () => {
    const { service } = setup();
    const file = await tenantAls.run({ tenantId: TENANT_A, spaceSlug: 'centre-a' },
      () => service.getFile(FILE_ID));
    expect(file.id).toBe(FILE_ID);
    expect(tenantAls.getStore()?.platform).toBeUndefined();
  });

  it('host B không đọc được file legacy thuộc tenant A dù file id/hash vẫn đúng', async () => {
    const { service } = setup();
    await tenantAls.run({ tenantId: TENANT_B, spaceSlug: 'centre-b' }, async () => {
      await expect(service.getFile(FILE_ID)).rejects.toMatchObject({ response: { code: 'file.not_found' } });
    });
  });

  it('context toàn cục không được dùng để đọc trên host trung tâm kho chung', async () => {
    const { service, repo } = setup();
    repo.getContextTenantId.mockResolvedValueOnce(null);
    await tenantAls.run({ tenantId: TENANT_A, spaceSlug: 'centre-a' }, async () => {
      await expect(service.getFile(FILE_ID)).rejects.toMatchObject({ response: { code: 'file.not_found' } });
    });
  });

  it('host gốc chỉ cho tenant A đọc context A; tenant B và khách ẩn danh bị từ chối', async () => {
    const { service } = setup();
    await expect(tenantAls.run({ tenantId: TENANT_A }, () => service.getFile(FILE_ID)))
      .resolves.toMatchObject({ id: FILE_ID });
    await expect(tenantAls.run({ tenantId: TENANT_B }, () => service.getFile(FILE_ID)))
      .rejects.toMatchObject({ response: { code: 'file.not_found' } });
    await expect(tenantAls.run({}, () => service.getFile(FILE_ID)))
      .rejects.toMatchObject({ response: { code: 'file.not_found' } });
  });
});
