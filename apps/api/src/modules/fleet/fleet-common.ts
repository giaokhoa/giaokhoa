import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import type { Client } from 'pg';
import { getAppliedMigrations, getLatestAppliedMigration } from '@giaokhoa/db';

export type FleetSpace = {
  id: string;
  slug: string;
  kind: 'platform' | 'center';
  storageMode?: string;
  status: string;
  databaseName: string;
  secretRef: string | null;
  registryVersion: string | null;
  lastBackupAt: Date | null;
  lastRestoreAt: Date | null;
};

export function fleetArchiveMemoryBudgetBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FLEET_ARCHIVE_MAX_IN_MEMORY_MB ?? '128';
  const mb = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(mb) || mb < 1 || mb > 2048) {
    throw new Error('FLEET_ARCHIVE_MAX_IN_MEMORY_MB must be an integer from 1 to 2048');
  }
  return mb * 1024 * 1024;
}

export type BackupKind = 'scheduled' | 'pre-migration';

export function orderSpacesIntoWaves(spaces: FleetSpace[], waveSize: number): FleetSpace[][] {
  const bySlug = (a: FleetSpace, b: FleetSpace) => a.slug.localeCompare(b.slug);
  const active = spaces.filter((space) => space.status === 'active');
  const platforms = active.filter((space) => space.kind === 'platform').sort(bySlug);
  const centers = active.filter((space) => space.kind === 'center').sort(bySlug);
  const waves: FleetSpace[][] = [];
  if (platforms.length > 0) waves.push(platforms);
  if (centers.length > 0) {
    waves.push([centers[0]!]);
    const size = Math.max(1, Math.floor(waveSize) || 1);
    for (let i = 1; i < centers.length; i += size) {
      waves.push(centers.slice(i, i + size));
    }
  }
  return waves;
}

export function pickRestoreCandidate(spaces: FleetSpace[]): FleetSpace | null {
  const candidates = spaces
    .filter((space) => space.status === 'active')
    .sort((a, b) => {
      const at = a.lastRestoreAt?.getTime() ?? 0;
      const bt = b.lastRestoreAt?.getTime() ?? 0;
      if (at !== bt) return at - bt;
      return a.slug.localeCompare(b.slug);
    });
  return candidates[0] ?? null;
}

export function isBackupOverdue(lastBackupAt: Date | null, now: Date, maxAgeHours: number): boolean {
  if (!lastBackupAt) return true;
  return now.getTime() - lastBackupAt.getTime() > maxAgeHours * 3_600_000;
}

export function newFleetRunId(at: Date): string {
  return `fleet-${at.toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(2).toString('hex')}`;
}

export function formatBackupTimestamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');
}

export function backupFileName(kind: BackupKind, runId: string, at: Date, encrypted: boolean): string {
  return `${kind}-${runId}-${formatBackupTimestamp(at)}.dump${encrypted ? '.enc' : ''}`;
}

const BACKUP_FILE_PATTERN = /^(scheduled|pre-migration)-([a-z0-9-]+)-(\d{8}T\d{6})\.dump(\.enc)?$/;

export function parseBackupFileName(fileName: string): { kind: BackupKind; runId: string; encrypted: boolean } | null {
  const match = BACKUP_FILE_PATTERN.exec(fileName);
  if (!match) return null;
  return {
    kind: match[1] as BackupKind,
    runId: match[2]!,
    encrypted: match[4] === '.enc',
  };
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

const ENCRYPTION_MAGIC = Buffer.from('GKHBK1', 'ascii');
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1 } as const;

export function encryptBackup(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([ENCRYPTION_MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackup(data: Buffer, passphrase: string): Buffer {
  if (!isEncryptedBackup(data)) throw new Error('backup payload is not in the encrypted fleet format');
  const salt = data.subarray(6, 22);
  const iv = data.subarray(22, 34);
  const tag = data.subarray(34, 50);
  const ciphertext = data.subarray(50);
  const key = scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function isEncryptedBackup(data: Buffer): boolean {
  return data.length > ENCRYPTION_MAGIC.length && data.subarray(0, ENCRYPTION_MAGIC.length).equals(ENCRYPTION_MAGIC);
}

export function retargetUrl(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

export function resolveSpaceConnectionUrl(space: FleetSpace, env: NodeJS.ProcessEnv): string {
  const refName = space.secretRef?.startsWith('env:') ? space.secretRef.slice('env:'.length) : 'DATABASE_URL';
  const base = env[refName];
  if (!base) throw new Error(`secret reference of space ${space.slug} points at unset variable ${refName}`);
  const parsed = new URL(base);
  const migrationUrl = env.MIGRATION_DATABASE_URL;
  if (migrationUrl) {
    const migration = new URL(migrationUrl);
    parsed.username = migration.username;
    parsed.password = migration.password;
  }
  parsed.pathname = `/${encodeURIComponent(space.databaseName)}`;
  return parsed.toString();
}

export function resolveDumpConnectionUrl(space: FleetSpace, env: NodeJS.ProcessEnv): string {
  const adminUrl = env.DATABASE_ADMIN_URL;
  if (adminUrl) return retargetUrl(adminUrl, space.databaseName);
  return resolveSpaceConnectionUrl(space, env);
}

export function buildPgToolArgs(url: string): {
  args: string[];
  password: string;
} {
  const parsed = new URL(url);
  return {
    args: [
      '-h',
      parsed.hostname,
      '-p',
      parsed.port || '5432',
      '-U',
      decodeURIComponent(parsed.username),
      '-d',
      decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    ],
    password: decodeURIComponent(parsed.password),
  };
}

export function runPgTool(
  binary: string,
  url: string,
  extraArgs: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Buffer> {
  const { args, password } = buildPgToolArgs(url);
  const binDir = env.FLEET_PG_BIN_DIR;
  const command = binDir ? join(binDir, binary) : binary;
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args, ...extraArgs],
      { env: { ...env, PGPASSWORD: password }, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const tail = stderr.toString().trim().slice(-2000);
          reject(new Error(`${binary} failed: ${tail || error.message}`));
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

export function resolveCentreMigrationsDir(): string {
  try {
    const require = createRequire(__filename);
    return join(dirname(require.resolve('@giaokhoa/db')), '..', 'migrations', 'centre');
  } catch {
    return join(process.cwd(), 'node_modules', '@giaokhoa', 'db', 'migrations', 'centre');
  }
}

export function listMigrationFolders(migrationsDir: string): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        return statSync(join(migrationsDir, name, 'migration.sql')).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

export async function readDatabaseSchemaVersion(client: Client): Promise<string | null> {
  return getLatestAppliedMigration(client);
}

export async function readDatabaseAppliedMigrations(client: Client): Promise<string[]> {
  return getAppliedMigrations(client);
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export type StoredBackup = { path: string; encrypted: boolean; sha256: string };

export async function dumpDatabaseToFile(options: {
  url: string;
  dir: string;
  kind: BackupKind;
  runId: string;
  at: Date;
  encryptionKey?: string;
  snapshot?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<StoredBackup> {
  const env = options.env ?? process.env;
  if (!options.encryptionKey) {
    throw new Error(
      'FLEET_BACKUP_ENCRYPTION_KEY is required: fleet backups are always encrypted, plaintext backups are not supported',
    );
  }
  mkdirSync(options.dir, { recursive: true });
  const plainPath = join(options.dir, backupFileName(options.kind, options.runId, options.at, false));
  try {
    await runPgTool(
      'pg_dump',
      options.url,
      ['-Fc', ...(options.snapshot ? ['--snapshot', options.snapshot] : []), '-f', plainPath],
      env,
    );
  } catch (error) {
    if (existsSync(plainPath)) unlinkSync(plainPath);
    throw error;
  }
  const finalPath = join(options.dir, backupFileName(options.kind, options.runId, options.at, true));
  try {
    if (statSync(plainPath).size > fleetArchiveMemoryBudgetBytes(env)) {
      throw new Error('fleet.archive_memory_budget_exceeded: database dump is too large for in-memory encryption');
    }
    const encrypted = encryptBackup(readFileSync(plainPath), options.encryptionKey);
    writeFileSync(finalPath, encrypted);
    const digest = sha256Hex(readFileSync(finalPath));
    writeFileSync(`${finalPath}.sha256`, `${digest}\n`);
    return { path: finalPath, encrypted: true, sha256: digest };
  } catch (error) {
    if (existsSync(finalPath)) unlinkSync(finalPath);
    throw error;
  } finally {
    if (existsSync(plainPath)) unlinkSync(plainPath);
  }
}

export function readVerifiedBackupFile(path: string, encryptionKey?: string): Buffer {
  const sidecarPath = `${path}.sha256`;
  let expected: string;
  try {
    expected = readFileSync(sidecarPath, 'utf8').trim();
  } catch {
    throw new Error(`backup checksum file is missing for ${basename(path)}`);
  }
  if (statSync(path).size > fleetArchiveMemoryBudgetBytes()) {
    throw new Error('fleet.archive_memory_budget_exceeded: encrypted component is too large to read');
  }
  const stored = readFileSync(path);
  if (sha256Hex(stored) !== expected) {
    throw new Error(`backup checksum mismatch for ${basename(path)}`);
  }
  if (path.endsWith('.enc')) {
    if (!encryptionKey) throw new Error('backup is encrypted but no encryption key is configured');
    return decryptBackup(stored, encryptionKey);
  }
  return stored;
}
