import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { fileDomainForSpace, SYSTEM_FILE_DOMAIN } from '@giaokhoa/db';
import type { Queue } from 'bullmq';
import { QueueEvents } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { FileCleanupProcessor } from '../../../src/processors/file-cleanup.processor';
import {
  bootWorkerModuleAsOrdinaryRole,
  type OrdinaryWorkerModuleHarness,
} from '../../support/ordinary-worker-module';

const STORAGE = '/tmp/giaokhoa-worker-test-files';
const DOMAIN_B = fileDomainForSpace('bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb');

describe('Worker file-cleanup: tách miền sở hữu khi cùng content hash', () => {
  let context: INestApplicationContext;
  let harness: OrdinaryWorkerModuleHarness;
  let db: OrdinaryWorkerModuleHarness['adminDb'];
  let events: QueueEvents;
  const content = Buffer.from('orphan-domain-10-' + Date.now());
  const hash = createHash('sha256').update(content).digest('hex');
  const suffix = join(hash.slice(0, 2), hash.slice(2, 4), hash);
  const physicalSystem = join(STORAGE, SYSTEM_FILE_DOMAIN, suffix);
  const physicalB = join(STORAGE, DOMAIN_B, suffix);

  beforeAll(async () => {
    harness = await bootWorkerModuleAsOrdinaryRole();
    context = harness.context;
    db = harness.adminDb as never;
    await mkdir(join(physicalSystem, '..'), { recursive: true });
    await mkdir(join(physicalB, '..'), { recursive: true });
    await writeFile(physicalSystem, content);
    await writeFile(physicalB, content);
    await db.insertInto('files').values([
      {
        content_hash: hash, storage_domain: SYSTEM_FILE_DOMAIN,
        context_id: '01900000-0000-7000-8000-0000000000aa',
        component: 'core_user', file_area: 'profile',
        item_id: null, file_path: '/', file_name: 'system.txt', file_size: content.length,
      },
      {
        content_hash: hash, storage_domain: DOMAIN_B,
        context_id: '01900000-0000-7000-8000-0000000000aa',
        component: 'core_user', file_area: 'profile',
        item_id: null, file_path: '/', file_name: 'centre-b.txt', file_size: content.length,
      },
    ]).execute();
    events = new QueueEvents('file-cleanup', { connection: { host: 'localhost', port: 6379 } });
    await events.waitUntilReady();
  });

  afterAll(async () => {
    await events?.close();
    if (db) await db.deleteFrom('files').where('content_hash', '=', hash).execute();
    await rm(physicalSystem, { force: true });
    await rm(physicalB, { force: true });
    await harness?.close();
  });

  it('giữ byte hệ thống khi vẫn còn metadata trong miền hệ thống', async () => {
    const processor = context.get(FileCleanupProcessor);
    const result = await processor.process({ data: { contentHash: hash, storageDomain: SYSTEM_FILE_DOMAIN } } as never);
    expect(result.removed).toBe(false);
    expect(result.refcount).toBe(1);
    expect(existsSync(physicalSystem)).toBe(true);
    expect(existsSync(physicalB)).toBe(true);
  });

  it('job BullMQ thật xoá byte miền hệ thống khi không còn ref, không đụng metadata/byte miền B', async () => {
    await db.deleteFrom('files').where('content_hash', '=', hash)
      .where('storage_domain', '=', SYSTEM_FILE_DOMAIN).execute();
    const queue = context.get<Queue>(getQueueToken('file-cleanup'));
    const job = await queue.add('cleanup-orphan', { contentHash: hash, storageDomain: SYSTEM_FILE_DOMAIN }, {
      jobId: 'issue-10-system-' + hash, attempts: 1,
    });
    const result = await job.waitUntilFinished(events, 15000) as {
      contentHash: string; storageDomain: string; removed: boolean; refcount: number;
    };
    expect(result).toMatchObject({ contentHash: hash, storageDomain: SYSTEM_FILE_DOMAIN, removed: true, refcount: 0 });
    expect(existsSync(physicalSystem)).toBe(false);
    expect(await readFile(physicalB)).toEqual(content);
    const b = await db.selectFrom('files').select('id').where('content_hash', '=', hash)
      .where('storage_domain', '=', DOMAIN_B).execute();
    expect(b).toHaveLength(1);
  });

  it('hai vòng thêm/xóa metadata và byte cùng miền/hash đều có job thật hoàn tất dù job cũ còn trong Redis', async () => {
    const queue = context.get<Queue>(getQueueToken('file-cleanup'));
    const completedIds: string[] = [];
    for (const round of [1, 2]) {
      await writeFile(physicalSystem, content);
      const record = await db.insertInto('files').values({
        content_hash: hash, storage_domain: SYSTEM_FILE_DOMAIN,
        context_id: '01900000-0000-7000-8000-0000000000aa',
        component: 'core_user', file_area: 'profile',
        item_id: null, file_path: '/', file_name: 'cycle-' + round + '.txt',
        file_size: content.length,
      }).returning('id').executeTakeFirstOrThrow();
      expect(existsSync(physicalSystem)).toBe(true);
      await db.deleteFrom('files').where('id', '=', record.id).execute();

      const jobId = ['orphan', SYSTEM_FILE_DOMAIN, hash, record.id].join('-');
      const job = await queue.add('cleanup-orphan', {
        contentHash: hash, storageDomain: SYSTEM_FILE_DOMAIN,
      }, { jobId, attempts: 1 });
      const result = await job.waitUntilFinished(events, 15000) as { removed: boolean; refcount: number };
      expect(result).toMatchObject({ removed: true, refcount: 0 });
      expect(existsSync(physicalSystem)).toBe(false);
      expect(await queue.getJob(jobId)).toBeDefined();
      completedIds.push(jobId);
    }
    expect(completedIds[0]).not.toBe(completedIds[1]);
    expect(await readFile(physicalB)).toEqual(content);
  });

  it('job thiếu miền, miền giả và job mang sai chủ đều bị từ chối trước khi xoá byte B', async () => {
    const processor = context.get(FileCleanupProcessor);
    await expect(processor.process({ data: { contentHash: hash } } as never))
      .rejects.toThrow('file.cleanup_domain_required');
    await expect(processor.process({ data: { contentHash: hash, storageDomain: '../other' } } as never))
      .rejects.toThrow('file.invalid_storage_domain');
    await expect(processor.process({ data: { contentHash: hash, storageDomain: DOMAIN_B } } as never))
      .rejects.toThrow('file.cleanup_space_required');
    const spy = vi.spyOn(harness.spaceDb, 'resolveTarget').mockResolvedValue({
      spaceId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
    } as never);
    try {
      await expect(processor.process({ data: {
        contentHash: hash, storageDomain: DOMAIN_B, spaceSlug: 'trung-tam-b',
      } } as never)).rejects.toThrow('file.cleanup_domain_mismatch');
    } finally { spy.mockRestore(); }
    expect(await readFile(physicalB)).toEqual(content);
  });
});
