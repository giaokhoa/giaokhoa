import { sql, type Kysely } from 'kysely';
import { MIGRATION_STORES, type MigrationStoreKey } from './stores';

export interface VerifyResult {
  store: MigrationStoreKey;
  tables: number;
  policies: number | null;
  indexes: number | null;
  journalRows: number;
  ok: boolean;
  mismatches: string[];
}

async function countOne<DB>(db: Kysely<DB>, query: string): Promise<number> {
  const { rows } = await sql.raw(query).execute(db) as { rows: Array<{ count: string }> };
  return Number(rows[0]?.count ?? 0);
}

export async function verifyStore<DB>(db: Kysely<DB>, store: MigrationStoreKey): Promise<VerifyResult> {
  const expected = MIGRATION_STORES[store].expected;
  const tables = await countOne(
    db,
    `select count(*)::text as count from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and c.relkind = 'r' and c.relname not in ('kysely_migration', 'kysely_migration_lock')`,
  );
  const policies =
    expected.policies === undefined
      ? null
      : await countOne(
          db,
          `select count(*)::text as count from pg_policies where schemaname = 'public' and tablename not in ('kysely_migration', 'kysely_migration_lock')`,
        );
  const indexes =
    expected.indexes === undefined
      ? null
      : await countOne(
          db,
          `select count(*)::text as count from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_namespace ns on ns.oid = ic.relnamespace join pg_class tc on tc.oid = i.indrelid where ns.nspname = 'public' and tc.relname not in ('kysely_migration', 'kysely_migration_lock') and not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid)`,
        );
  const journalRows = await countOne(db, `select count(*)::text as count from kysely_migration`);
  const mismatches: string[] = [];
  if (tables !== expected.tables) mismatches.push(`bảng: đếm được ${tables}, kỳ vọng ${expected.tables}`);
  if (policies !== null && policies !== expected.policies) {
    mismatches.push(`policy RLS: đếm được ${policies}, kỳ vọng ${expected.policies}`);
  }
  if (indexes !== null && indexes !== expected.indexes) {
    mismatches.push(`index: đếm được ${indexes}, kỳ vọng ${expected.indexes}`);
  }
  if (journalRows !== expected.journalRows) {
    mismatches.push(`dòng kysely_migration: đếm được ${journalRows}, kỳ vọng ${expected.journalRows}`);
  }
  return { store, tables, policies, indexes, journalRows, ok: mismatches.length === 0, mismatches };
}
