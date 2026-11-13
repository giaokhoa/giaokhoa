import type { Kysely } from 'kysely';
import { Migrator, type MigrationResult } from 'kysely/migration';
import { FrozenSqlProvider } from './frozen-sql-provider';
import { installUuidv7Shim, type MigrationStoreKey } from './stores';

export interface ApplyStoreMigrationsResult {
  shim: 'installed' | 'skipped-pg18';
  results: MigrationResult[];
}

export async function applyStoreMigrations<DB>(
  db: Kysely<DB>,
  store: MigrationStoreKey,
  migrationsDir: string,
  options?: { allowUnorderedMigrations?: boolean },
): Promise<ApplyStoreMigrationsResult> {
  const shim = await installUuidv7Shim(db);
  const migrator = new Migrator({
    db,
    provider: new FrozenSqlProvider(migrationsDir),
    allowUnorderedMigrations: options?.allowUnorderedMigrations ?? false,
  });
  const { error, results } = await migrator.migrateToLatest();
  const settled = results ?? [];
  if (error || settled.some((result) => result.status === 'Error')) {
    throw new Error(
      `Áp migration cho kho ${store} thất bại: ${error ? (error as Error).message ?? String(error) : 'có migration báo Error'}`,
    );
  }
  return { shim, results: settled };
}
