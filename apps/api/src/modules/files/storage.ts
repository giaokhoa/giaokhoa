import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertFileStorageDomain, fileContentKey } from '@giaokhoa/db';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectStorage {
  put(domain: string, contentHash: string, data: Buffer): Promise<void>;
  get(domain: string, contentHash: string): Promise<Buffer>;
  delete(domain: string, contentHash: string): Promise<void>;
  exists(domain: string, contentHash: string): Promise<boolean>;
  keyFor(domain: string, contentHash: string): string;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export const contentKey = fileContentKey;

export interface PresignedDownloadStorage {
  presignGetUrl(
    domain: string, contentHash: string, expiresInSeconds: number,
    opts?: { fileName?: string; mimeType?: string },
  ): Promise<string>;
}

export function supportsPresignedDownloads(storage: ObjectStorage): storage is ObjectStorage & PresignedDownloadStorage {
  return typeof (storage as Partial<PresignedDownloadStorage>).presignGetUrl === 'function';
}

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
