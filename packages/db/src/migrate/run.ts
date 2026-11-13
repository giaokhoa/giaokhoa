import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Kysely } from 'kysely';
import { Pool, type PoolConfig } from 'pg';
import {
  createCentreKysely,
  createControlPlaneKysely,
  createSystemBankKysely,
} from '../client';
import { applyStoreMigrations } from './apply';
import { isMigrationStoreKey, MIGRATION_STORES, type MigrationStoreKey } from './stores';
import { verifyStore } from './verify';

function packageRoot(): string {
  try {
    const require = createRequire(__filename);
    return join(dirname(require.resolve('@giaokhoa/db')), '..');
  } catch {
    return join(__dirname, '..', '..');
  }
}

function poolConfigFor(store: MigrationStoreKey): PoolConfig {
  const envVars = MIGRATION_STORES[store].connectionEnvVars;
  const url = envVars.map((name) => process.env[name]).find((value) => value) ?? '';
  if (!url) {
    throw new Error(
      `Thiếu URL kết nối cho kho ${store}: đặt một trong các biến ${envVars.join(', ')} trước khi chạy migrate.`,
    );
  }
  if (process.env.DATABASE_SSL === 'true') {
    const parsed = new URL(url);
    parsed.searchParams.delete('sslmode');
    return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: false } };
  }
  return { connectionString: url };
}

function usage(): number {
  console.error(
    `Cách dùng: node dist/migrate/run.js <kho> [--verify-only]\nKho: centre | control-plane | system-bank\n--verify-only: chỉ hậu kiểm số đếm, không áp migration.`,
  );
  return 1;
}

async function main(argv: string[]): Promise<number> {
  const [storeArg, ...flags] = argv;
  if (!storeArg || !isMigrationStoreKey(storeArg)) return usage();
  const verifyOnly = flags.includes('--verify-only');
  const unknownFlags = flags.filter((flag) => flag !== '--verify-only');
  if (unknownFlags.length > 0) {
    console.error(`Cờ lạ: ${unknownFlags.join(', ')}`);
    return usage();
  }
  const store = storeArg as MigrationStoreKey;
  const migrationsDir = join(packageRoot(), 'migrations', MIGRATION_STORES[store].migrationsDirName);
  const pool = new Pool(poolConfigFor(store));
  switch (store) {
    case 'centre':
      return runWithStoreDb(createCentreKysely(pool), store, migrationsDir, verifyOnly);
    case 'control-plane':
      return runWithStoreDb(createControlPlaneKysely(pool), store, migrationsDir, verifyOnly);
    case 'system-bank':
      return runWithStoreDb(createSystemBankKysely(pool), store, migrationsDir, verifyOnly);
  }
}

async function runWithStoreDb<DB>(
  db: Kysely<DB>,
  store: MigrationStoreKey,
  migrationsDir: string,
  verifyOnly: boolean,
): Promise<number> {
  try {
    if (verifyOnly) {
      const result = await verifyStore(db, store);
      console.log(
        `verify ${store}: bảng=${result.tables} policy=${result.policies ?? '-'} index=${result.indexes ?? '-'} kysely_migration=${result.journalRows}`,
      );
      if (!result.ok) {
        console.error(`verify ${store} LỆCH: ${result.mismatches.join('; ')}`);
        return 1;
      }
      return 0;
    }
    const { shim, results } = await applyStoreMigrations(db, store, migrationsDir);
    console.log(`tiền-migration ${store}: shim uuidv7 ${shim === 'installed' ? 'đã cài (cụm dưới PG18)' : 'bỏ qua (cụm PG18+)'}`);
    for (const result of results) {
      console.log(`migration ${result.migrationName}: ${result.status}`);
    }
    const verified = await verifyStore(db, store);
    console.log(
      `verify ${store}: bảng=${verified.tables} policy=${verified.policies ?? '-'} index=${verified.indexes ?? '-'} kysely_migration=${verified.journalRows}`,
    );
    if (!verified.ok) {
      console.error(`verify ${store} LỆCH: ${verified.mismatches.join('; ')}`);
      return 1;
    }
    return 0;
  } finally {
    await db.destroy().catch(() => undefined);
  }
}


if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

export { packageRoot, poolConfigFor };
