










import { sql, type Kysely } from 'kysely';

export type MigrationStoreKey = 'centre' | 'control-plane' | 'system-bank';

export interface ExpectedStoreCounts {
  tables: number;
  policies?: number;
  indexes?: number;
  journalRows: number;
}

export interface MigrationStore {
  migrationsDirName: string;
  carrierNames: string[];
  expected: ExpectedStoreCounts;
  connectionEnvVars: string[];
}

export const MIGRATION_STORES: Record<MigrationStoreKey, MigrationStore> = {
  centre: {
    migrationsDirName: 'centre',
    carrierNames: ['20261025163710_baseline'],
    expected: { tables: 204, policies: 25, indexes: 425, journalRows: 6 },

    connectionEnvVars: ['MIGRATION_DATABASE_URL', 'DATABASE_URL'],
  },
  'control-plane': {
    migrationsDirName: 'control-plane',
    carrierNames: ['20261030132145_zippy_impossible_man', '20261101061412_melodic_jubilee'],
    expected: { tables: 4, journalRows: 4 },
    connectionEnvVars: ['CONTROL_PLANE_DATABASE_URL'],
  },
  'system-bank': {
    migrationsDirName: 'system-bank',
    carrierNames: ['20261031025416_unique_scarecrow'],
    expected: { tables: 14, journalRows: 4 },
    connectionEnvVars: ['SYSTEM_BANK_DATABASE_URL'],
  },
};

export const MIGRATION_STORE_KEYS = Object.keys(MIGRATION_STORES) as MigrationStoreKey[];

export function isMigrationStoreKey(value: string): value is MigrationStoreKey {
  return (Object.keys(MIGRATION_STORES) as string[]).includes(value);
}

export const UUIDV7_SHIM = `CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$ DECLARE ts_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; b bytea; BEGIN b := decode(lpad(to_hex(ts_ms), 12, '0'), 'hex') || gen_random_bytes(10); b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112); b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128); RETURN encode(b, 'hex')::uuid; END; $$ LANGUAGE plpgsql VOLATILE`;

export async function installUuidv7Shim<DB>(db: Kysely<DB>): Promise<'installed' | 'skipped-pg18'> {
  const { rows } = await sql<{ server_version_num: string }>`SHOW server_version_num`.execute(db);
  const major = Math.floor(Number(rows[0]?.server_version_num ?? '0') / 10000);
  if (major >= 18) return 'skipped-pg18';
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);
  await sql.raw(UUIDV7_SHIM).execute(db);
  return 'installed';
}
