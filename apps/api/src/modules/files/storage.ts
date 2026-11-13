/**
 * Port lưu byte file theo miền sở hữu ổn định và SHA-256.
 * Adapter local và S3 dùng cùng fileContentKey; hash chỉ khử trùng
 * trong một miền, không bao giờ gộp byte giữa các không gian.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertFileStorageDomain, fileContentKey } from '@giaokhoa/db';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** Hợp đồng bắt buộc nhận miền ở mọi thao tác vật lý. */
export interface ObjectStorage {
  /** Ghi nếu chưa có tại đúng miền; từ chối ghi vào vùng legacy. */
  put(domain: string, contentHash: string, data: Buffer): Promise<void>;
  /** Đọc byte theo miền và hash, bao gồm vùng legacy để giữ đường đọc cũ. */
  get(domain: string, contentHash: string): Promise<Buffer>;
  /** Xoá đúng đối tượng của miền, không đụng hash ở miền khác. */
  delete(domain: string, contentHash: string): Promise<void>;
  /** Kiểm tra đối tượng vật lý trong miền được chỉ định. */
  exists(domain: string, contentHash: string): Promise<boolean>;
  /** Khoá tuyệt đối của đối tượng trong miền (dành cho kiểm chứng). */
  keyFor(domain: string, contentHash: string): string;
}

/** Tính dấu SHA-256 của nội dung, không mang thông tin sở hữu. */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Tên khoá tương đối dùng chung local/S3, có gác path traversal. */
export const contentKey = fileContentKey;

/** Năng lực URL trực tiếp có ký; luôn ký trên khoá chứa miền. */
export interface PresignedDownloadStorage {
  presignGetUrl(
    domain: string, contentHash: string, expiresInSeconds: number,
    opts?: { fileName?: string; mimeType?: string },
  ): Promise<string>;
}

/** Xác định adapter có khả năng ký URL trực tiếp. */
export function supportsPresignedDownloads(storage: ObjectStorage): storage is ObjectStorage & PresignedDownloadStorage {
  return typeof (storage as Partial<PresignedDownloadStorage>).presignGetUrl === 'function';
}

/**
 * Adapter local: mỗi miền có thư mục riêng; ghi wx tránh ghi đè
 * khi nhiều metadata trong cùng miền dùng chung hash.
 */
@Injectable()
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;
  constructor(config: ConfigService) { this.root = config.get<string>('FILE_STORAGE_DIR') ?? './data/files'; }
  keyFor(domain: string, contentHash: string): string {
    return join(this.root, fileContentKey(domain, contentHash));
  }
  async put(domain: string, contentHash: string, data: Buffer): Promise<void> {
    assertFileStorageDomain(domain);
    const path = this.keyFor(domain, contentHash);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' }).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw err;
    });
  }
  async get(domain: string, contentHash: string): Promise<Buffer> {
    return readFile(this.keyFor(domain, contentHash));
  }
  async delete(domain: string, contentHash: string): Promise<void> {
    assertFileStorageDomain(domain);
    await rm(this.keyFor(domain, contentHash), { force: true });
  }
  async exists(domain: string, contentHash: string): Promise<boolean> {
    try { await access(this.keyFor(domain, contentHash)); return true; }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }
}
