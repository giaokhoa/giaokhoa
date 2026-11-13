import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FileSigningService } from './file-signing.service';
import { contentKey, LocalObjectStorage, sha256Hex, type ObjectStorage } from './storage';
import { S3ObjectStorage } from './storage-s3';
import { createObjectStorage } from './storage-factory';
import { fileDomainForSpace, LEGACY_FILE_DOMAIN, SYSTEM_FILE_DOMAIN } from '@giaokhoa/db';

const DOMAIN_A = fileDomainForSpace('11111111-1111-7111-8111-111111111111');
const DOMAIN_B = fileDomainForSpace('22222222-2222-7222-8222-222222222222');
const DOMAIN_PUBLIC = fileDomainForSpace('33333333-3333-7333-8333-333333333333');

/** Config giả tối thiểu cho các adapter/service — giá trị ở đây là fixture test, không phải khoá thật. */
function fakeConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Missing config ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

function s3Error(name: string, httpStatusCode: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
}

/**
 * Double S3 trong bộ nhớ cho tầng test hợp đồng: cài đặt đúng ngữ nghĩa
 * Head/Put/Get/Delete theo key mà adapter dùng, không cần mạng/MinIO.
 */
class FakeS3Client {
  readonly objects = new Map<string, Buffer>();
  readonly sent: string[] = [];
  async send(command: unknown): Promise<unknown> {
    if (command instanceof HeadObjectCommand) {
      this.sent.push('head');
      if (!this.objects.has(command.input.Key as string)) throw s3Error('NotFound', 404);
      return {};
    }
    if (command instanceof PutObjectCommand) {
      this.sent.push('put');
      this.objects.set(command.input.Key as string, Buffer.from(command.input.Body as Buffer));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      this.sent.push('get');
      const data = this.objects.get(command.input.Key as string);
      if (!data) throw s3Error('NoSuchKey', 404);
      return { Body: Readable.from([data]) };
    }
    if (command instanceof DeleteObjectCommand) {
      this.sent.push('delete');
      this.objects.delete(command.input.Key as string);
      return {};
    }
    throw new Error('FakeS3Client: unexpected command');
  }
}

const S3_TEST_CONFIG = {
  FILE_STORAGE_S3_BUCKET: 'bucket-test',
  FILE_STORAGE_S3_ACCESS_KEY_ID: 'fixture-access-key',
  FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret-key',
};

function makeS3Storage(): { storage: S3ObjectStorage; fake: FakeS3Client } {
  const fake = new FakeS3Client();
  const storage = new S3ObjectStorage(fakeConfig(S3_TEST_CONFIG), fake as unknown as S3Client);
  return { storage, fake };
}

/**
 * Bộ test HỢP ĐỒNG của port ObjectStorage — chạy nguyên vẹn cho mọi adapter:
 * vòng put/get/delete/exists, và ngữ nghĩa dedup (put trùng hash
 * KHÔNG ghi đè nội dung đã lưu). Bố cục key nội bộ và số lần gọi adapter
 * là chi tiết triển khai — không khẳng định ở đây (rà soát #219).
 */
function storageContract(name: string, make: () => Promise<{ storage: ObjectStorage; cleanup: () => Promise<void> }>): void {
  describe(`Hợp đồng ObjectStorage — ${name}`, () => {
    const dataA = Buffer.from('noi-dung-phieu-A');
    const dataB = Buffer.from('noi-dung-khac-B');
    const hash = sha256Hex(dataA);

    it('put → exists=true và get trả đúng các byte', async () => {
      const { storage, cleanup } = await make();
      try {
        expect(await storage.exists(DOMAIN_A, hash)).toBe(false);
        await storage.put(DOMAIN_A, hash, dataA);
        expect(await storage.exists(DOMAIN_A, hash)).toBe(true);
        expect((await storage.get(DOMAIN_A, hash)).equals(dataA)).toBe(true);
      } finally { await cleanup(); }
    });

    it('put với hash đã có là no-op khử trùng (không bao giờ ghi đè)', async () => {
      const { storage, cleanup } = await make();
      try {
        await storage.put(DOMAIN_A, hash, dataA);
        await storage.put(DOMAIN_A, hash, dataB);
        expect((await storage.get(DOMAIN_A, hash)).equals(dataA)).toBe(true);
      } finally { await cleanup(); }
    });

    it('delete xoá object; get sau đó ném lỗi', async () => {
      const { storage, cleanup } = await make();
      try {
        await storage.put(DOMAIN_A, hash, dataA);
        await storage.delete(DOMAIN_A, hash);
        expect(await storage.exists(DOMAIN_A, hash)).toBe(false);
        await expect(storage.get(DOMAIN_A, hash)).rejects.toThrow();
      } finally { await cleanup(); }
    });

    it('A/B/công cộng/ngân hàng giữ byte độc lập dù cùng hash; xoá A không đụng miền còn lại', async () => {
      const { storage, cleanup } = await make();
      const domains = [DOMAIN_A, DOMAIN_B, DOMAIN_PUBLIC, SYSTEM_FILE_DOMAIN];
      try {
        for (const domain of domains) await storage.put(domain, hash, dataA);
        for (const domain of domains) expect(await storage.exists(domain, hash)).toBe(true);
        await storage.delete(DOMAIN_A, hash);
        expect(await storage.exists(DOMAIN_A, hash)).toBe(false);
        for (const domain of domains.slice(1)) {
          expect((await storage.get(domain, hash)).equals(dataA)).toBe(true);
        }
      } finally { await cleanup(); }
    });

    it('từ chối traversal và không cho ghi/xoá vùng legacy', async () => {
      const { storage, cleanup } = await make();
      try {
        await expect(storage.put('../evil', hash, dataA)).rejects.toThrow();
        await expect(storage.put(LEGACY_FILE_DOMAIN, hash, dataA)).rejects.toThrow();
        await expect(storage.delete(LEGACY_FILE_DOMAIN, hash)).rejects.toThrow();
        expect(() => storage.keyFor(DOMAIN_A, '../escape')).toThrow();
      } finally { await cleanup(); }
    });

    it('get trên hash thiếu ném lỗi', async () => {
      const { storage, cleanup } = await make();
      try {
        await expect(storage.get(DOMAIN_A, sha256Hex(Buffer.from('khong-ton-tai')))).rejects.toThrow();
      } finally { await cleanup(); }
    });
  });
}

storageContract('LocalObjectStorage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'giaokhoa-files-contract-'));
  const storage = new LocalObjectStorage(fakeConfig({ FILE_STORAGE_DIR: dir }));
  return { storage, cleanup: () => rm(dir, { recursive: true, force: true }) };
});

storageContract('S3ObjectStorage (in-memory S3 double)', async () => {
  const { storage } = makeS3Storage();
  return { storage, cleanup: async () => undefined };
});

describe('Đặc thù S3ObjectStorage', () => {
  it('presignGetUrl cấp URL đã ký mang content key và TTL (ký offline)', async () => {
    const storage = new S3ObjectStorage(fakeConfig({
      ...S3_TEST_CONFIG,
      FILE_STORAGE_S3_ENDPOINT: 'https://s3.example.test',
      FILE_STORAGE_S3_REGION: 'us-east-1',
    }));
    const hash = sha256Hex(Buffer.from('presign-me'));
    const url = await storage.presignGetUrl(DOMAIN_A, hash, 300, { fileName: 'phieu.png', mimeType: 'image/png' });
    expect(url).toContain(contentKey(DOMAIN_A, hash));
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=300');
  });

  it('constructor lỗi nhanh và nêu tên các biến env thiếu (chỉ tên)', () => {
    expect(() => new S3ObjectStorage(fakeConfig({ FILE_STORAGE_S3_BUCKET: 'bucket-test' })))
      .toThrow(/FILE_STORAGE_S3_ACCESS_KEY_ID/);
    expect(() => new S3ObjectStorage(fakeConfig({}))).toThrow(/FILE_STORAGE_S3_BUCKET/);
  });
});

describe('Hàm createObjectStorage (chọn driver theo env)', () => {
  it('mặc định dùng adapter local khi FILE_STORAGE_DRIVER chưa đặt', () => {
    expect(createObjectStorage(fakeConfig({ FILE_STORAGE_DIR: '/tmp/x' }))).toBeInstanceOf(LocalObjectStorage);
  });

  it('chọn adapter S3 khi driver=s3 với cấu hình đầy đủ', () => {
    expect(createObjectStorage(fakeConfig({ FILE_STORAGE_DRIVER: 's3', ...S3_TEST_CONFIG }))).toBeInstanceOf(S3ObjectStorage);
  });

  it('lỗi nhanh khi driver=s3 nhưng thiếu env S3 bắt buộc', () => {
    expect(() => createObjectStorage(fakeConfig({ FILE_STORAGE_DRIVER: 's3' }))).toThrow(/FILE_STORAGE_S3_BUCKET/);
  });

  it('lỗi nhanh với driver lạ thay vì lặng lẽ fallback', () => {
    expect(() => createObjectStorage(fakeConfig({ FILE_STORAGE_DRIVER: 'gcs' }))).toThrow(/FILE_STORAGE_DRIVER/);
  });
});

describe('Đích tải xuống của FileSigningService', () => {
  const signingConfig = fakeConfig({ JWT_SECRET: 'fixture-jwt-secret-for-tests-only', FILE_SIGNED_URL_TTL_SECONDS: 300 });
  const file = { id: '11111111-1111-7111-8111-111111111111', storageDomain: DOMAIN_A, contentHash: sha256Hex(Buffer.from('sign-me')), fileName: 'phieu.png', mimeType: 'image/png' };

  it('adapter local (không có khả năng presign) → URL API HMAC, kiểm chứng được bằng verify()', async () => {
    const signing = new FileSigningService(signingConfig, new LocalObjectStorage(fakeConfig({ FILE_STORAGE_DIR: '/tmp/x' })));
    const target = await signing.createDownloadTarget(file);
    expect(target.url.startsWith(`/api/v1/files/${file.id}/download?sig=`)).toBe(true);
    const token = decodeURIComponent(target.url.split('sig=')[1]);
    expect(() => signing.verify(file.id, DOMAIN_A, token)).not.toThrow();
  });

  it('HMAC đã cấp ở A không hợp lệ tại B dù file ID trùng', async () => {
    const signing = new FileSigningService(signingConfig);
    const target = await signing.createDownloadTarget(file);
    const token = decodeURIComponent(target.url.split('sig=')[1]);
    expect(() => signing.verify(file.id, DOMAIN_B, token)).toThrow();
  });

  it('không inject storage nào → URL API HMAC (cách dựng tương thích ngược)', async () => {
    const signing = new FileSigningService(signingConfig);
    const target = await signing.createDownloadTarget(file);
    expect(target.url.startsWith(`/api/v1/files/${file.id}/download?sig=`)).toBe(true);
  });

  it('adapter S3 → URL đã ký tới kho lưu, không phải đường tải xuống của API', async () => {
    const s3 = new S3ObjectStorage(fakeConfig({
      ...S3_TEST_CONFIG,
      FILE_STORAGE_S3_ENDPOINT: 'https://s3.example.test',
      FILE_STORAGE_S3_REGION: 'us-east-1',
    }));
    const signing = new FileSigningService(signingConfig, s3);
    const target = await signing.createDownloadTarget(file);
    expect(target.url).toContain('X-Amz-Signature=');
    expect(target.url).toContain(contentKey(DOMAIN_A, file.contentHash));
    expect(target.url).not.toContain('/api/v1/files/');
    expect(target.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
