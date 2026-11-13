/**
 * Bản sao lưu trọn kho: chốt cùng một snapshot MVCC cho pg_dump và metadata
 * file, chụp byte bất biến theo miền sở hữu, rồi lưu manifest cùng payload
 * file dưới dạng mã hoá. Bản dump giữ toàn bộ schema/bảng PostgreSQL, không
 * liệt kê bảng nghiệp vụ theo thế hệ migration.
 *
 * Bộ kiểm chứng đối chiếu ID kho, từng đối tượng, băm và kích thước trước
 * khi cho phép phục hồi. Mọi byte tạm/sản phẩm dở được dọn khi lỗi.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { fileDomainForSpace, LEGACY_FILE_DOMAIN, fileContentKey } from '@giaokhoa/db';
import { createObjectStorage } from '../files/storage-factory';
import {
  backupFileName,
  dumpDatabaseToFile,
  encryptBackup,
  readVerifiedBackupFile,
  sha256Hex,
  type BackupKind,
  type FleetSpace,
  type StoredBackup,
} from './fleet-common';

/** Mô tả một byte vật lý trong snapshot; hash luôn kiểm lại từ nội dung thật. */
export type ArchiveFile = {
  domain: string;
  hash: string;
  size: number;
  sha256: string;
};
/** Manifest gắn cả bản dump, tập file và định danh sổ đăng ký không thay đổi. */
export type SpaceArchiveManifest = {
  version: 1;
  spaceId: string;
  slug: string;
  databaseName: string;
  dumpSha256: string;
  payloadSha256: string;
  files: ArchiveFile[];
};
type ArchivePayloadFile = { domain: string; hash: string; data: string };
type ArchivePayload = { version: 1; files: ArchivePayloadFile[] };

/** Tên tệp đi kèm một dump; cả hai tệp đều mã hoá và có SHA-256 riêng. */
export function archiveSidecarPaths(dumpPath: string): {
  manifest: string;
  files: string;
} {
  return {
    manifest: dumpPath + '.manifest.enc',
    files: dumpPath + '.files.enc',
  };
}

/** Dùng một cấu hình riêng từ env của CLI nhưng cùng adapter local/S3 của ứng dụng. */
function storageForEnv(env: NodeJS.ProcessEnv) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return createObjectStorage(config);
}

/** Không bao giờ gộp byte của B/ngân hàng vào bản chụp của A. */
function assertOwnedDomain(domain: string, spaceId: string): void {
  if (domain !== fileDomainForSpace(spaceId) && domain !== LEGACY_FILE_DOMAIN) {
    throw new Error('archive file belongs to another storage domain');
  }
}

/** Ghi một gói mã hoá cùng băm, không để tệp trông hoàn chỉnh nếu ghi hỏng. */
function writeEncryptedSidecar(path: string, data: Buffer, encryptionKey: string): void {
  let createdFile = false;
  let createdHash = false;
  try {
    const encrypted = encryptBackup(data, encryptionKey);
    writeFileSync(path, encrypted, { flag: 'wx', mode: 0o600 });
    createdFile = true;
    writeFileSync(path + '.sha256', sha256Hex(encrypted) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    createdHash = true;
  } catch (error) {
    // Không xoá file được người chạy khác tạo sẵn nếu flag wx từ chối.
    if (createdHash) unlinkSync(path + '.sha256');
    if (createdFile) unlinkSync(path);
    throw error;
  }
}

/** Dọn mọi thành phần của một bản chụp không hoàn chỉnh. */
function removeIncompleteArchive(path: string): void {
  const sidecars = archiveSidecarPaths(path);
  for (const file of [
    path,
    path + '.sha256',
    sidecars.manifest,
    sidecars.manifest + '.sha256',
    sidecars.files,
    sidecars.files + '.sha256',
  ]) {
    if (existsSync(file)) unlinkSync(file);
  }
}

/**
 * Chụp kho đầy đủ dưới một PostgreSQL snapshot và gói byte file mã hoá.
 * @param options - Định danh sổ đăng ký, URL dump quản trị và vùng backup.
 * @returns Tệp dump chỉ được trả khi manifest và file cũng đã ghi toàn vẹn.
 * @throws Error nếu byte thiếu/sai hash, khác miền, hoặc công cụ lỗi.
 */
export async function dumpSpaceArchive(options: {
  space: FleetSpace;
  url: string;
  dir: string;
  kind: BackupKind;
  runId: string;
  at: Date;
  encryptionKey?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<StoredBackup> {
  if (!options.encryptionKey) throw new Error('FLEET_BACKUP_ENCRYPTION_KEY is required');
  const env = options.env ?? process.env;
  const { space } = options;
  const storage = storageForEnv(env);
  const path = join(options.dir, backupFileName(options.kind, options.runId, options.at, true));
  const sidecars = archiveSidecarPaths(path);
  if ([path, path + '.sha256', sidecars.manifest, sidecars.files].some((name) => existsSync(name))) {
    throw new Error('backup archive already exists; refusing to overwrite');
  }
  mkdirSync(options.dir, { recursive: true });
  const lockPath = path + '.lock';
  writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
  const client = new Client({ connectionString: options.url });
  let connected = false;
  let transactionOpen = false;
  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionOpen = true;
    const snapshot = await client.query<{ snapshot: string }>('SELECT pg_export_snapshot() AS snapshot');
    const snapshotId = snapshot.rows[0]?.snapshot;
    if (!snapshotId) throw new Error('PostgreSQL did not export a snapshot');

    // Chọn metadata đúng cùng điểm thời gian với pg_dump; các blob là
    // immutable theo hash, do đó đọc blob sau snapshot vẫn là bản đã chốt.
    const hasFiles = await client.query<{ found: string | null }>("SELECT to_regclass('public.files')::text AS found");
    const rows = hasFiles.rows[0]?.found
      ? (
          await client.query<{
            storage_domain: string;
            content_hash: string;
            file_size: number;
          }>(
            'SELECT DISTINCT storage_domain, content_hash, file_size FROM public.files ORDER BY storage_domain, content_hash, file_size',
          )
        ).rows
      : [];
    const files: ArchiveFile[] = [];
    const payload: ArchivePayload = { version: 1, files: [] };
    const seen = new Map<string, number>();
    for (const row of rows) {
      assertOwnedDomain(row.storage_domain, space.id);
      fileContentKey(row.storage_domain, row.content_hash);
      const key = row.storage_domain + '/' + row.content_hash;
      const previousSize = seen.get(key);
      if (previousSize !== undefined) {
        if (previousSize !== row.file_size) throw new Error('inconsistent file size in snapshot: ' + key);
        continue;
      }
      seen.set(key, row.file_size);
      const bytes = await storage.get(row.storage_domain, row.content_hash);
      if (bytes.length !== row.file_size || sha256Hex(bytes) !== row.content_hash) {
        throw new Error('archive file checksum or size mismatch: ' + key);
      }
      files.push({
        domain: row.storage_domain,
        hash: row.content_hash,
        size: bytes.length,
        sha256: sha256Hex(bytes),
      });
      payload.files.push({
        domain: row.storage_domain,
        hash: row.content_hash,
        data: bytes.toString('base64'),
      });
    }
    const stored = await dumpDatabaseToFile({
      ...options,
      snapshot: snapshotId,
    });
    await client.query('COMMIT');
    transactionOpen = false;

    const sidecars = archiveSidecarPaths(stored.path);
    const payloadBytes = Buffer.from(JSON.stringify(payload));
    const manifest: SpaceArchiveManifest = {
      version: 1,
      spaceId: space.id,
      slug: space.slug,
      databaseName: space.databaseName,
      dumpSha256: sha256Hex(readFileSync(stored.path)),
      payloadSha256: sha256Hex(payloadBytes),
      files,
    };
    writeEncryptedSidecar(sidecars.files, payloadBytes, options.encryptionKey);
    writeEncryptedSidecar(sidecars.manifest, Buffer.from(JSON.stringify(manifest)), options.encryptionKey);
    return stored;
  } catch (error) {
    removeIncompleteArchive(path);
    throw error;
  } finally {
    if (connected) {
      if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
      await client.end().catch(() => undefined);
    }
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}

/**
 * Chỉ trả nội dung sau khi mọi tệp/băm/định danh khớp; thiếu manifest
 * là lỗi bắt buộc, kể cả khi dump database riêng còn đọc được.
 */
export function readVerifiedSpaceArchive(
  dumpPath: string,
  space: FleetSpace,
  encryptionKey?: string,
): {
  dump: Buffer;
  manifest: SpaceArchiveManifest;
  files: { domain: string; hash: string; data: Buffer }[];
} {
  const sidecars = archiveSidecarPaths(dumpPath);
  const dump = readVerifiedBackupFile(dumpPath, encryptionKey);
  const manifestBytes = readVerifiedBackupFile(sidecars.manifest, encryptionKey);
  const payloadBytes = readVerifiedBackupFile(sidecars.files, encryptionKey);
  const manifest = JSON.parse(manifestBytes.toString()) as SpaceArchiveManifest;
  const payload = JSON.parse(payloadBytes.toString()) as ArchivePayload;
  if (
    manifest.version !== 1 ||
    payload.version !== 1 ||
    manifest.spaceId !== space.id ||
    manifest.slug !== space.slug ||
    manifest.databaseName !== space.databaseName ||
    manifest.dumpSha256 !== sha256Hex(readFileSync(dumpPath)) ||
    manifest.payloadSha256 !== sha256Hex(payloadBytes) ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(payload.files) ||
    manifest.files.length !== payload.files.length
  ) {
    throw new Error('archive manifest does not match the source space or payload');
  }
  const files: { domain: string; hash: string; data: Buffer }[] = [];
  const keys = new Set<string>();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const entry = manifest.files[index]!;
    const encoded = payload.files[index]!;
    assertOwnedDomain(entry.domain, space.id);
    fileContentKey(entry.domain, entry.hash);
    const key = entry.domain + '/' + entry.hash;
    if (
      keys.has(key) ||
      entry.domain !== encoded.domain ||
      entry.hash !== encoded.hash ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded.data)
    ) {
      throw new Error('archive file list is invalid or duplicated');
    }
    keys.add(key);
    const data = Buffer.from(encoded.data, 'base64');
    if (data.length !== entry.size || sha256Hex(data) !== entry.hash || sha256Hex(data) !== entry.sha256) {
      throw new Error('archive file payload checksum mismatch: ' + key);
    }
    files.push({ domain: entry.domain, hash: entry.hash, data });
  }
  return { dump, manifest, files };
}

/**
 * Phục hồi byte vào vùng cô lập của lần kiểm thử. File legacy chuyển
 * thành miền của cùng ID trung tâm trong vùng đích, không sửa nguồn.
 */
export async function restoreArchiveFilesToLocalDir(
  files: { domain: string; hash: string; data: Buffer }[],
  spaceId: string,
  dir: string,
): Promise<number> {
  const ownDomain = fileDomainForSpace(spaceId);
  const storage = storageForEnv({
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_DIR: dir,
  });
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    assertOwnedDomain(file.domain, spaceId);
    const targetDomain = file.domain === LEGACY_FILE_DOMAIN ? ownDomain : file.domain;
    await storage.put(targetDomain, file.hash, file.data);
    const restored = await storage.get(targetDomain, file.hash);
    if (sha256Hex(restored) !== file.hash) throw new Error('restored file checksum mismatch');
  }
  return files.length;
}

/** Huỷ vùng tạm cô lập của lượt kiểm thử kể cả khi việc phục hồi lỗi. */
export function removeTemporaryRestoreFiles(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Xác minh rằng toàn bộ metadata file trong database đã phục hồi
 * khớp 1-1 với manifest, bao gồm quan hệ được thêm ở schema mới.
 * Không dùng danh sách bảng học tập legacy để giới hạn pg_dump.
 */
export async function verifyRestoredFileMetadata(client: Client, manifest: SpaceArchiveManifest): Promise<void> {
  const hasFiles = await client.query<{ found: string | null }>("SELECT to_regclass('public.files')::text AS found");
  const rows = hasFiles.rows[0]?.found
    ? (
        await client.query<{
          storage_domain: string;
          content_hash: string;
          file_size: number;
        }>(
          'SELECT DISTINCT storage_domain, content_hash, file_size FROM public.files ORDER BY storage_domain, content_hash, file_size',
        )
      ).rows
    : [];
  const expected = manifest.files.map((entry) => [entry.domain, entry.hash, entry.size].join('/')).sort();
  const actual = rows.map((row) => [row.storage_domain, row.content_hash, row.file_size].join('/')).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('restored file metadata does not match archive manifest');
  }
}
