import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_FILE_DOMAIN } from '@giaokhoa/db';
import type { FileRow } from '@giaokhoa/db/repositories/files';
import { FilesService } from './files.service';

const FILE_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const CONTENT_HASH = 'a'.repeat(64);

describe('FilesService.deleteFile — xoá file hết tham chiếu thì xếp job dọn orphan', () => {
  function buildService() {
    const file = {
      id: FILE_ID, contentHash: CONTENT_HASH, storageDomain: SYSTEM_FILE_DOMAIN,
      contextId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd', component: 'question',
      fileArea: 'content', itemId: null, filePath: '/', fileName: 'a.png',
    } as FileRow;
    const repo = {
      getById: vi.fn(async () => file),
      deleteById: vi.fn(async () => undefined),
      countByHash: vi.fn(async () => 0),
    };
    const cleanupQueue = { add: vi.fn(async (_name: string, _data: Record<string, unknown>, _options: Record<string, unknown>) => ({})) };
    const service = new FilesService(repo as never, {} as never, {} as never, {} as never, cleanupQueue as never);
    return { service, repo, cleanupQueue };
  }

  it('xoá file không còn tham chiếu: job cleanup-orphan được xếp với removeOnFail và không gắn spaceSlug khi chạy ngoài ALS', async () => {
    const { service, cleanupQueue } = buildService();
    const result = await service.deleteFile(FILE_ID);
    expect(result).toEqual({ deleted: true, contentHash: CONTENT_HASH, refcount: 0 });
    expect(cleanupQueue.add).toHaveBeenCalledTimes(1);
    const data = cleanupQueue.add.mock.calls[0]![1] as Record<string, unknown>;
    const options = cleanupQueue.add.mock.calls[0]![2] as Record<string, unknown>;
    expect(cleanupQueue.add.mock.calls[0]![0]).toBe('cleanup-orphan');
    expect(data).toEqual({ contentHash: CONTENT_HASH, storageDomain: SYSTEM_FILE_DOMAIN });
    expect(data).not.toHaveProperty('spaceSlug');
    expect(options).toEqual({
      jobId: `orphan-${SYSTEM_FILE_DOMAIN}-${CONTENT_HASH}-${FILE_ID}`,
      attempts: 3, removeOnFail: true,
    });
  });
});
