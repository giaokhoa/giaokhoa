/**
 * CLI phục hồi trọn kho trong môi trường cô lập. Chỉ tạo database MỚI
 * và thư mục file MỚI do người vận hành chỉ định; không tự liên kết
 * tài khoản, cập nhật registry hay đưa dữ kiện vào kho B/công cộng.
 * Manifest và mọi file được xác minh trước thao tác tạo database.
 */
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { Client } from 'pg';
import { quoteIdentifier } from '../control-plane/control-plane-provision';
import { FleetRegistryWriter } from './fleet-registry-writer';
import { parseBackupFileName, retargetUrl, runPgTool } from './fleet-common';
import { readVerifiedSpaceArchive, restoreArchiveFilesToLocalDir, verifyRestoredFileMetadata } from './fleet-space-archive';

/** Tìm bản chụp đã hoàn tất mới nhất của đúng kho; không chọn tệp sidecar. */
function newestBackup(dir: string): string {
  const files = readdirSync(dir)
    .filter((name) => parseBackupFileName(name) !== null)
    .map((name) => ({ name, modified: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified);
  if (!files[0]) throw new Error('no backup archive found for source space');
  return join(dir, files[0].name);
}

export type FleetRestoreOptions = {
  slug: string;
  expectedSpaceId: string;
  targetDatabase: string;
  targetFilesDir: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
};

/**
 * Phục hồi từ manifest trong database mới và vùng file mới.
 * @returns Tên đích và số file đã khôi phục.
 * @throws Error nếu đích chồng kho sống, tệp lỗi, hoặc tạo/kiểm tra
 * database thất bại; đích dở được xoá, nguồn không hề bị ghi.
 */
export async function runFleetRestore(options: FleetRestoreOptions): Promise<{
  database: string;
  filesDir: string;
  fileCount: number;
}> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((value: string) => console.log(value));
  const adminUrl = env.DATABASE_ADMIN_URL;
  const backupDir = env.FLEET_BACKUP_DIR;
  if (!adminUrl || !backupDir || !env.FLEET_BACKUP_ENCRYPTION_KEY) {
    throw new Error('DATABASE_ADMIN_URL, FLEET_BACKUP_DIR and FLEET_BACKUP_ENCRYPTION_KEY are required');
  }
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(options.targetDatabase) || !/^[0-9a-f-]{36}$/.test(options.expectedSpaceId)) {
    throw new Error('invalid target database or expected space id');
  }
  const output = resolve(options.targetFilesDir);
  const sourceRoot = resolve(env.FILE_STORAGE_DIR ?? './data/files');
  if (
    output === sourceRoot ||
    output.startsWith(sourceRoot + sep) ||
    sourceRoot.startsWith(output + sep) ||
    existsSync(output)
  ) {
    throw new Error('restore file directory must be new and isolated from live file storage');
  }
  const writer = new FleetRegistryWriter(env);
  let archive: ReturnType<typeof readVerifiedSpaceArchive>;
  try {
    const spaces = await writer.listFleetSpaces();
    const space = spaces.find((entry) => entry.slug === options.slug);
    if (!space || space.kind !== 'center' || space.id !== options.expectedSpaceId) {
      throw new Error('source space identity is not a registered centre');
    }
    if (
      spaces.some(
        (entry) => entry.databaseName === options.targetDatabase && (entry.id !== space.id || entry.status !== 'closed'),
      )
    ) {
      throw new Error('target database is registered to an active or different space');
    }
    const dumpPath = newestBackup(join(backupDir, space.slug));
    archive = readVerifiedSpaceArchive(dumpPath, space, env.FLEET_BACKUP_ENCRYPTION_KEY);
    log('Verified archive for ' + space.slug + ': ' + basename(dumpPath));
  } finally {
    await writer.close();
  }

  const admin = new Client({
    connectionString: retargetUrl(adminUrl, 'postgres'),
  });
  const dumpPlainPath = join(backupDir, '.restore-isolated-' + process.pid + '-' + Date.now() + '.dump');
  const staging = mkdtempSync(join(dirname(output), '.fleet-restore-'));
  let connected = false;
  let created = false;
  try {
    await admin.connect();
    connected = true;
    const db = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [options.targetDatabase]);
    if (db.rowCount !== 0) throw new Error('restore target database already exists');
    await admin.query('CREATE DATABASE ' + quoteIdentifier(options.targetDatabase));
    created = true;
    writeFileSync(dumpPlainPath, archive.dump, { mode: 0o600 });
    const targetUrl = retargetUrl(adminUrl, options.targetDatabase);
    await runPgTool('pg_restore', targetUrl, ['--exit-on-error', '--no-owner', '--no-privileges', dumpPlainPath], env);
    const check = new Client({ connectionString: targetUrl });
    await check.connect();
    try {
      await verifyRestoredFileMetadata(check, archive.manifest);
      // Chỉ miền legacy được đổi về miền riêng của chính A trong
      // database ĐÍCH đã phục hồi; database nguồn giữ nguyên.
      const count = await restoreArchiveFilesToLocalDir(archive.files, options.expectedSpaceId, staging);
      if (count !== archive.manifest.files.length) throw new Error('not all files were restored');
      const ownDomain = 'space-' + options.expectedSpaceId;
      if (archive.files.some((file) => file.domain === 'legacy')) {
        await check.query('UPDATE public.files SET storage_domain = $1 WHERE storage_domain = $2', [ownDomain, 'legacy']);
      }
    } finally {
      await check.end();
    }
    renameSync(staging, output);
    log('Isolated restore completed: ' + options.targetDatabase + ', ' + archive.files.length + ' file(s)');
    return {
      database: options.targetDatabase,
      filesDir: output,
      fileCount: archive.files.length,
    };
  } catch (error) {
    if (created && connected) {
      await admin
        .query('DROP DATABASE IF EXISTS ' + quoteIdentifier(options.targetDatabase) + ' WITH (FORCE)')
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (connected) await admin.end().catch(() => undefined);
    if (existsSync(dumpPlainPath)) unlinkSync(dumpPlainPath);
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}

/** Điểm vào CLI, xác nhận nguồn bằng ID sổ, đích phải trống và tách biệt. */
if (require.main === module) {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!process.argv[i]?.startsWith('--') || !process.argv[i + 1]) {
      console.error('Usage: fleet:restore --slug <slug> --space-id <uuid> --database <new_db> --files-dir <new_dir>');
      process.exit(1);
    }
    args.set(process.argv[i]!.slice(2), process.argv[i + 1]!);
  }
  runFleetRestore({
    slug: args.get('slug') ?? '',
    expectedSpaceId: args.get('space-id') ?? '',
    targetDatabase: args.get('database') ?? '',
    targetFilesDir: args.get('files-dir') ?? '',
  }).catch((error: unknown) => {
    console.error('fleet restore failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
