import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';
import { fileContentKey, fileDomainForSpace, SYSTEM_FILE_DOMAIN } from '@giaokhoa/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FileCleanupProcessor } from './file-cleanup.processor';
import type { SpaceDatabaseService } from '../db/routing/space-database.service';

const DOMAIN_A = fileDomainForSpace('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa');
const DOMAIN_B = fileDomainForSpace('bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb');
const DOMAIN_PUBLIC = fileDomainForSpace('cccccccc-cccc-7ccc-8ccc-cccccccccccc');
const HASH = 'f'.repeat(64);
const BODY = Buffer.from('s3-same-bytes-for-every-domain-10');
const BUCKET = 'bucket-10';

/**
 * Giao thức S3 chạy qua HTTP thật của AWS SDK tới máy chủ tệp thử nghiệm.
 * Đo byte còn/mất trên máy chủ sau DeleteObject, không chỉ kiểm mock send().
 */
describe('Worker cleanup S3: xoá key đúng miền qua HTTP', () => {
  const objects = new Map<string, Buffer>();
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    requests.push((req.method ?? '') + ' ' + path);
    if (req.method === 'PUT') {
      const parts: Buffer[] = [];
      for await (const chunk of req) parts.push(Buffer.from(chunk));
      objects.set(path, Buffer.concat(parts));
      res.statusCode = 200;
    } else if (req.method === 'DELETE') {
      objects.delete(path);
      res.statusCode = 204;
    } else if (req.method === 'GET') {
      const data = objects.get(path);
      res.statusCode = data ? 200 : 404;
      if (data) res.write(data);
    } else {
      res.statusCode = objects.has(path) ? 200 : 404;
    }
    res.end();
  });
  let client: S3Client;
  let processor: FileCleanupProcessor;
  const key = (domain: string) => '/' + BUCKET + '/' + fileContentKey(domain, HASH);

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const endpoint = 'http://127.0.0.1:' + port;
    const values: Record<string, string> = {
      FILE_STORAGE_DRIVER: 's3', FILE_STORAGE_S3_ENDPOINT: endpoint,
      FILE_STORAGE_S3_REGION: 'us-east-1', FILE_STORAGE_S3_BUCKET: BUCKET,
      FILE_STORAGE_S3_ACCESS_KEY_ID: 'access-test-only',
      FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'secret-test-only',
      FILE_STORAGE_S3_FORCE_PATH_STYLE: 'true',
    };
    client = new S3Client({
      region: values.FILE_STORAGE_S3_REGION, endpoint, forcePathStyle: true,
      credentials: {
        accessKeyId: values.FILE_STORAGE_S3_ACCESS_KEY_ID,
        secretAccessKey: values.FILE_STORAGE_S3_SECRET_ACCESS_KEY,
      },
    });
    const config = { get: (name: string) => values[name] } as ConfigService;
    const select = {
      select: () => select,
      where: () => select,
      executeTakeFirst: async () => ({ n: 0 }),
    };
    const fakeSpaceDb = {
      routedKysely: { selectFrom: () => select },
      resolveTarget: vi.fn(async () => ({ spaceId: DOMAIN_A.slice(6) })),
      withSpaceKysely: vi.fn(async (_slug: string, fn: () => Promise<unknown>) => fn()),
    } as unknown as SpaceDatabaseService;
    processor = new FileCleanupProcessor(fakeSpaceDb, config);
    for (const domain of [DOMAIN_A, DOMAIN_B, DOMAIN_PUBLIC, SYSTEM_FILE_DOMAIN]) {
      await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: fileContentKey(domain, HASH), Body: BODY }));
    }
  });

  afterAll(async () => {
    client?.destroy();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });

  it('xóa miền ngân hàng qua S3 DeleteObject thật, A/B/công cộng còn nguyên', async () => {
    const result = await processor.process({ data: {
      contentHash: HASH, storageDomain: SYSTEM_FILE_DOMAIN,
    } } as never);
    expect(result).toMatchObject({ storageDomain: SYSTEM_FILE_DOMAIN, removed: true, refcount: 0 });
    expect(objects.has(key(SYSTEM_FILE_DOMAIN))).toBe(false);
    for (const domain of [DOMAIN_A, DOMAIN_B, DOMAIN_PUBLIC]) {
      expect(objects.get(key(domain))).toEqual(BODY);
    }
    expect(requests).toContain('DELETE ' + key(SYSTEM_FILE_DOMAIN));
  });

  it('xóa A với slug hợp lệ không đụng byte của B/công cộng', async () => {
    const result = await processor.process({ data: {
      contentHash: HASH, storageDomain: DOMAIN_A, spaceSlug: 'centre-a',
    } } as never);
    expect(result.removed).toBe(true);
    expect(objects.has(key(DOMAIN_A))).toBe(false);
    expect(objects.get(key(DOMAIN_B))).toEqual(BODY);
    expect(objects.get(key(DOMAIN_PUBLIC))).toEqual(BODY);
    expect(requests).toContain('DELETE ' + key(DOMAIN_A));
  });

  it('job mang sai miền không gửi bất kỳ DELETE nào tới S3', async () => {
    const before = requests.filter((r) => r.startsWith('DELETE')).length;
    await expect(processor.process({ data: {
      contentHash: HASH, storageDomain: DOMAIN_B, spaceSlug: 'centre-a',
    } } as never)).rejects.toThrow('file.cleanup_domain_mismatch');
    expect(requests.filter((r) => r.startsWith('DELETE'))).toHaveLength(before);
    expect(objects.get(key(DOMAIN_B))).toEqual(BODY);
  });
});
