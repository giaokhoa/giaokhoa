import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { Migrator, type MigrationProvider } from 'kysely/migration';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestDatabase, dropTestDatabase, withDatabase } from '../test-support/build-test-database';
import { FrozenSqlProvider, listMigrationNames } from './frozen-sql-provider';
import { getAppliedMigrations } from './journal';
import { installUuidv7Shim, MIGRATION_STORES, UUIDV7_SHIM } from './stores';
import { verifyStore } from './verify';

const adminUrl =
  process.env.GIAOKHOA_DB_TEST_ADMIN_URL ??
  (process.env.DATABASE_URL ? withDatabase(process.env.DATABASE_URL, 'postgres') : 'postgres://postgres:postgres@localhost:5432/postgres');

const CENTRE_DB = 'giaokhoa_db_migrate_n2_centre';
const STRANGE_DB = 'giaokhoa_db_migrate_n2_strange';
const PROD_DB = 'giaokhoa_db_migrate_n2_prod';
const T2_DB = 'giaokhoa_db_migrate_n2_t2';
const T3_DB = 'giaokhoa_db_migrate_n2_t3';

const CP_CARRIERS: string[] = MIGRATION_STORES['control-plane'].carrierNames;

function packageMigrationsDir(store: 'centre' | 'control-plane' | 'system-bank'): string {
  return join(process.cwd(), 'migrations', store);
}

function providerOnly(migrationsDir: string, names: readonly string[]): MigrationProvider {
  const inner = new FrozenSqlProvider(migrationsDir);
  return {
    async getMigrations() {
      const all = await inner.getMigrations();
      return Object.fromEntries(Object.entries(all).filter(([name]) => names.includes(name)));
    },
  };
}

async function registryCreatedAtDefault(dbUrl: string): Promise<string | null> {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const result = await client.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'space_registry_history' AND column_name = 'created_at'`,
    );
    return result.rows[0]?.column_default ?? null;
  } finally {
    await client.end();
  }
}

async function freshDatabase(name: string): Promise<string> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  return withDatabase(adminUrl, name);
}

async function mockLegacyJournal(dbUrl: string, names: string[]): Promise<void> {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query(
      'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at numeric, name text)',
    );
    for (const name of names) {
      await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at, name) VALUES ($1, $2, $3)', [
        `mock-hash-${name}`,
        0,
        name,
      ]);
    }
  } finally {
    await client.end();
  }
}

async function mockKyselyJournal(dbUrl: string, names: string[]): Promise<void> {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS kysely_migration (name varchar(255) PRIMARY KEY, timestamp varchar(255) NOT NULL)');
    for (const name of names) {
      await client.query('INSERT INTO kysely_migration (name, timestamp) VALUES ($1, $2)', [
        name,
        new Date(0).toISOString(),
      ]);
    }
  } finally {
    await client.end();
  }
}

async function kyselyNames(dbUrl: string): Promise<string[]> {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const result = await client.query<{ name: string }>('SELECT name FROM kysely_migration ORDER BY name');
    return result.rows.map((row) => row.name);
  } finally {
    await client.end();
  }
}

async function tableExists(dbUrl: string, table: string): Promise<boolean> {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const result = await client.query('SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2', [
      'public',
      table,
    ]);
    return result.rows.length > 0;
  } finally {
    await client.end();
  }
}

async function countPublic(dbUrl: string, kind: 'tables' | 'policies' | 'indexes'): Promise<number> {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    if (kind === 'tables') {
      const result = await client.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('kysely_migration', 'kysely_migration_lock')`,
      );
      return result.rows[0].n as number;
    }
    if (kind === 'policies') {
      const result = await client.query(
        `SELECT count(*)::int AS n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public'`,
      );
      return result.rows[0].n as number;
    }
    const result = await client.query(
      `SELECT count(*)::int AS n FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN pg_namespace ns ON ns.oid = ic.relnamespace
       JOIN pg_class tc ON tc.oid = i.indrelid
       WHERE ns.nspname = 'public'
         AND tc.relname NOT IN ('kysely_migration', 'kysely_migration_lock')
         AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)`,
    );
    return result.rows[0].n as number;
  } finally {
    await client.end();
  }
}

describe('bộ máy migration của package cho ba kho', () => {
  let centreUrl = '';

  beforeAll(async () => {
    centreUrl = await buildTestDatabase({ adminUrl, database: CENTRE_DB, store: 'centre' });
  }, 300_000);

  afterAll(async () => {
    await dropTestDatabase(adminUrl, CENTRE_DB).catch(() => undefined);
    await dropTestDatabase(adminUrl, STRANGE_DB).catch(() => undefined);
    await dropTestDatabase(adminUrl, PROD_DB).catch(() => undefined);
    await dropTestDatabase(adminUrl, T2_DB).catch(() => undefined);
    await dropTestDatabase(adminUrl, T3_DB).catch(() => undefined);
  });

  it('áp đủ carrier kho trung tâm trên database trống với đúng số đếm kỳ vọng', async () => {
    const verifyPool = new Pool({ connectionString: centreUrl });
    const verifyDb = new Kysely({ dialect: new PostgresDialect({ pool: verifyPool }) });
    const result = await verifyStore(verifyDb, 'centre');
    await verifyDb.destroy().catch(() => undefined);
    expect(result.ok).toBe(true);
    expect(result.tables).toBe(204);
    expect(result.policies).toBe(25);
    expect(result.indexes).toBe(425);
    expect(result.journalRows).toBe(MIGRATION_STORES.centre.expected.journalRows);
    expect(await countPublic(centreUrl, 'tables')).toBe(204);
    expect(await countPublic(centreUrl, 'policies')).toBe(25);
    expect(await countPublic(centreUrl, 'indexes')).toBe(425);

  });

  it('hàm đọc nhật ký chỉ đọc kysely_migration: database trống trả tập rỗng, nhật ký cũ bị bỏ qua, nhật ký Kysely trả đúng tập tên', async () => {
    const carrierNames = [...CP_CARRIERS];
    const fresh = await freshDatabase('giaokhoa_db_migrate_n2_dual');
    try {
      const empty = new Client({ connectionString: fresh });
      await empty.connect();
      try {
        expect(await getAppliedMigrations(empty)).toEqual([]);
      } finally {
        await empty.end();
      }
      await mockLegacyJournal(fresh, carrierNames);
      const legacyOnly = new Client({ connectionString: fresh });
      await legacyOnly.connect();
      try {
        expect(await getAppliedMigrations(legacyOnly)).toEqual([]);
      } finally {
        await legacyOnly.end();
      }
      const migrated = new Client({ connectionString: centreUrl });
      await migrated.connect();
      try {
        expect(await getAppliedMigrations(migrated)).toEqual(listMigrationNames(packageMigrationsDir('centre')));
      } finally {
        await migrated.end();
      }
    } finally {
      await dropTestDatabase(adminUrl, 'giaokhoa_db_migrate_n2_dual').catch(() => undefined);
    }
  });

  it('tên lạ trong nhật ký Kysely làm runner CLI thoát mã khác 0', async () => {
    const strangeUrl = await freshDatabase(STRANGE_DB);
    await mockKyselyJournal(strangeUrl, ['99999999999999_ten_la_khong_thuoc_bo_migration']);
    const run = spawnSync(
      process.execPath,
      [join(process.cwd(), 'dist', 'migrate', 'run.js'), 'control-plane'],
      { env: { ...process.env, DATABASE_URL: strangeUrl, CONTROL_PLANE_DATABASE_URL: strangeUrl }, encoding: 'utf8' },
    );
    expect(run.status).not.toBe(0);
  });

  it('database có nhật ký chỉ gồm carrier và migration native đang chờ: migrateToLatest áp native, chạy lại là no-op', async () => {
    const dir = packageMigrationsDir('control-plane');
    const allNames = listMigrationNames(dir);
    const nativeNames = allNames.filter((name) => !CP_CARRIERS.includes(name));
    expect(nativeNames).toHaveLength(2);
    expect(nativeNames).toContain('20261113043200_remove_business_directories');
    const prodUrl = await freshDatabase(PROD_DB);
    const pool = new Pool({ connectionString: prodUrl });
    const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    try {
      await installUuidv7Shim(db);
      const carrierMigrator = new Migrator({ db, provider: providerOnly(dir, CP_CARRIERS) });
      const firstRun = await carrierMigrator.migrateToLatest();
      expect(firstRun.error).toBeUndefined();
      expect(await kyselyNames(prodUrl)).toEqual([...CP_CARRIERS].sort());
      expect(await registryCreatedAtDefault(prodUrl)).toContain('now()');

      const migrator = new Migrator({ db, provider: new FrozenSqlProvider(dir) });
      const { error, results } = await migrator.migrateToLatest();
      expect(error).toBeUndefined();
      expect((results ?? []).map((r) => r.migrationName)).toEqual(nativeNames);
      expect((results ?? []).every((r) => r.status === 'Success')).toBe(true);
      expect(await kyselyNames(prodUrl)).toEqual([...allNames].sort());
      expect(await registryCreatedAtDefault(prodUrl)).toContain('clock_timestamp()');
      const verified = await verifyStore(db, 'control-plane');
      expect(verified.ok).toBe(true);

      const again = await migrator.migrateToLatest();
      expect(again.error).toBeUndefined();
      expect(again.results ?? []).toHaveLength(0);
      expect(await kyselyNames(prodUrl)).toEqual([...allNames].sort());
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  it('down() của carrier ném lỗi tường minh thay vì chế tác SQL ngược', async () => {
    const provider = new FrozenSqlProvider(packageMigrationsDir('control-plane'));
    const migrations = await provider.getMigrations();
    const first = Object.values(migrations)[0]!;
    await expect(first.down!(null as unknown as Kysely<unknown>)).rejects.toThrow(/không có down/);
  });

  it('chuỗi shim uuidv7 trong package khớp từng byte với hằng trong centre-provision', () => {
    const provisionPath = join(process.cwd(), '..', '..', 'apps', 'api', 'src', 'modules', 'tenants', 'centre-provision.ts');
    const source = readFileSync(provisionPath, 'utf8');
    const match = source.match(/UUIDV7_SHIM\s*=\s*`([\s\S]*?)`;/);
    expect(match).not.toBeNull();
    expect(UUIDV7_SHIM).toBe(match![1]);
  });

  it('shim được cài ngoài carrier: hàm uuidv7() gọi được mà không ghi vào nhật ký', async () => {
    const shimUrl = await freshDatabase('giaokhoa_db_migrate_n2_shim');
    const pool = new Pool({ connectionString: shimUrl });
    const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    try {
      await installUuidv7Shim(db);
      const check = new Client({ connectionString: shimUrl });
      await check.connect();
      try {
        const fn = await check.query("SELECT uuidv7() AS id");
        expect(fn.rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      } finally {
        await check.end();
      }
    } finally {
      await db.destroy().catch(() => undefined);
      await dropTestDatabase(adminUrl, 'giaokhoa_db_migrate_n2_shim').catch(() => undefined);
    }
  });

  it('T-2: migration thứ hai lỗi thì toàn bộ lượt migrate rollback (độ hạt transaction)', async () => {
    const t2Url = await freshDatabase(T2_DB);
    const pool = new Pool({ connectionString: t2Url });
    const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    const provider: MigrationProvider = {
      async getMigrations() {
        return {
          '0001_tao_bang': {
            async up(db2: Kysely<unknown>) {
              await db2.schema.createTable('t2_first').addColumn('id', 'integer').execute();
            },
          },
          '0002_co_y_loi': {
            async up() {
              throw new Error('loi co y cua T-2');
            },
          },
        };
      },
    };
    try {
      const migrator = new Migrator({ db, provider });
      const { error, results } = await migrator.migrateToLatest();
      expect(error).toBeDefined();
      console.log('T-2 results:', JSON.stringify(results?.map((r) => ({ name: r.migrationName, status: r.status }))));
      console.log('T-2 bang t2_first ton tai:', await tableExists(t2Url, 't2_first'));
      console.log('T-2 dong kysely_migration:', await kyselyNames(t2Url).catch(() => ['<bang chua ton tai>']));
      expect(await tableExists(t2Url, 't2_first')).toBe(false);
      expect(await kyselyNames(t2Url).catch(() => [] as string[])).toEqual([]);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  it('T-3: kill tiến trình đang migrate rồi chạy lại ngay thì khoá tự giải phóng', async () => {
    const t3Url = await freshDatabase(T3_DB);
    const childCode = `
const { Pool } = require('pg');
const { Kysely, PostgresDialect, sql } = require('kysely');
const { Migrator } = require('kysely/migration');
(async () => {
  const pool = new Pool({ connectionString: process.env.MIGRATE_T3_URL });
  const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
  const m = new Migrator({ db, provider: { getMigrations: async () => ({
    '0001_sleep': { async up(d) { await sql\`select pg_sleep(120)\`.execute(d); } },
    '0002_probe': { async up(d) { await d.schema.createTable('t3_probe').addColumn('id', 'integer').execute(); } },
  }) } });
  const r = await m.migrateToLatest();
  console.log(JSON.stringify(r));
  await db.destroy();
})().catch((e) => { console.error(e); process.exit(1); });
`;
    const child: ChildProcess = spawn(process.execPath, ['-e', childCode], {
      env: { ...process.env, MIGRATE_T3_URL: t3Url },
      cwd: process.cwd(),
    });
    const watcher = new Client({ connectionString: t3Url });
    await watcher.connect();
    try {
      let sleeping = false;
      for (let i = 0; i < 150 && !sleeping; i++) {
        const found = await watcher.query(
          "SELECT 1 FROM pg_stat_activity WHERE query ILIKE '%pg_sleep%' AND state = 'active'",
        );
        sleeping = found.rows.length > 0;
        if (!sleeping) await new Promise((r) => setTimeout(r, 200));
      }
      expect(sleeping).toBe(true);
    } finally {
      await watcher.end();
    }
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));
    const started = Date.now();
    const pool = new Pool({ connectionString: t3Url });
    const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    try {
      const migrator = new Migrator({
        db,
        provider: {
          async getMigrations() {
            return {
              '0002_probe': {
                async up(db2: Kysely<unknown>) {
                  await db2.schema.createTable('t3_probe').addColumn('id', 'integer').execute();
                },
              },
            };
          },
        },
      });
      const { error } = await migrator.migrateToLatest();
      expect(error).toBeUndefined();
      const elapsed = Date.now() - started;
      console.log('T-3 thoi gian chay lai (ms):', elapsed);
      expect(elapsed).toBeLessThan(120_000);
      expect(await tableExists(t3Url, 't3_probe')).toBe(true);
      expect(await kyselyNames(t3Url)).toEqual(['0002_probe']);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  }, 300_000);

  it('nâng cấp context cá nhân/trường/tổ bằng chứng cứ tenant, từ chối bản mơ hồ và áp RLS với role không BYPASSRLS', async () => {
    const database = 'giaokhoa_db_material_upgrade_16';
    const url = await freshDatabase(database);
    const pool = new Pool({ connectionString: url, max: 1 });
    const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    const role = `g16_migration_${process.pid}`;
    const tenantA = '01961300-0000-7000-8000-000000000001';
    const platform = '01961300-0000-7000-8000-000000000002';
    const contextA = '01961300-0000-7000-8000-000000000003';
    const contextPersonal = '01961300-0000-7000-8000-000000000004';
    const tenantB = '01961300-0000-7000-8000-000000000005';
    const root = '01961300-0000-7000-8000-000000000006';
    const cohortId = '01961300-0000-7000-8000-000000000007';
    const creatorA = '01961300-0000-7000-8000-000000000008';
    const creatorB = '01961300-0000-7000-8000-000000000009';
    const creatorAmbiguous = '01961300-0000-7000-8000-00000000000a';
    const creatorPlatform = '01961300-0000-7000-8000-00000000000b';
    let createdRole = false;
    try {
      const dir = packageMigrationsDir('centre');
      const priorNames = listMigrationNames(dir).filter((name) => name !== '20261113160000_system_material_references');
      const before = await new Migrator({ db, provider: providerOnly(dir, priorNames) }).migrateToLatest();
      expect(before.error).toBeUndefined();
      await sql`insert into tenants (id, name, slug, kind) values
        (${tenantA}, 'Trung tâm A', 'upgrade-a', 'school'),
        (${tenantB}, 'Trung tâm B', 'upgrade-b', 'school'),
        (${platform}, 'Trang chính', 'upgrade-platform', 'platform')`.execute(db);
      await sql`insert into users (id, username, email) values
        (${creatorA}, 'upgrade-a', 'upgrade-a@school.test'),
        (${creatorB}, 'upgrade-b', 'upgrade-b@school.test'),
        (${creatorAmbiguous}, 'upgrade-ambiguous', 'upgrade-ambiguous@school.test'),
        (${creatorPlatform}, 'upgrade-platform', 'upgrade-platform@school.test')`.execute(db);
      await sql`insert into tenant_memberships (tenant_id, user_id) values
        (${tenantA}, ${creatorA}), (${tenantB}, ${creatorB}),
        (${tenantA}, ${creatorAmbiguous}), (${tenantB}, ${creatorAmbiguous}),
        (${platform}, ${creatorPlatform})`.execute(db);
      await sql`insert into context (id, context_level, instance_id, path, depth) values
        (${root}, 10, null, ${'/' + root}, 1),
        (${contextA}, 20, ${tenantA}, ${'/' + root + '/' + contextA}, 2),
        (${contextPersonal}, 30, ${creatorA}, ${'/' + root + '/' + contextPersonal}, 2)`.execute(db);
      await sql`insert into cohort (id, tenant_id, name, context_id) values
        (${cohortId}, ${tenantA}, 'Tổ A', ${root})`.execute(db);
      const personal = await sql<{ id: string }>`insert into content_bank_content (name, context_id, creator_id)
        values ('Cá nhân A trước nâng cấp', ${contextPersonal}, ${creatorA}) returning id`.execute(db);
      await sql`insert into content_bank_content (name, context_id, creator_id, scope, space_id) values
        ('Neo tenant A', ${contextA}, ${creatorA}, 'personal', null),
        ('Trường A cũ', ${root}, ${creatorA}, 'school', null),
        ('Trường B cũ', ${root}, ${creatorB}, 'school', null),
        ('Tổ A cũ', ${root}, ${creatorAmbiguous}, 'org', ${cohortId}),
        ('Trang chính có chủ', ${root}, ${creatorPlatform}, 'personal', null),
        ('Chưa xác định được chủ', ${root}, ${creatorAmbiguous}, 'school', null)`.execute(db);
      await sql`insert into files (content_hash, context_id, component, file_area, item_id, file_name, file_size)
        values (${'a'.repeat(64)}, ${contextPersonal}, 'core_contentbank', 'content', ${personal.rows[0]!.id}, 'old.pdf', 4)`.execute(db);
      await sql.raw(`CREATE ROLE "${role}" NOLOGIN NOBYPASSRLS`).execute(db);
      createdRole = true;
      await sql.raw(`GRANT USAGE, CREATE ON SCHEMA public TO "${role}"`).execute(db);
      await sql.raw(`GRANT ALL ON ALL TABLES IN SCHEMA public TO "${role}"`).execute(db);
      await sql.raw(`ALTER TABLE content_bank_content OWNER TO "${role}"`).execute(db);
      await sql.raw(`ALTER TABLE resources OWNER TO "${role}"`).execute(db);
      await sql.raw(`SET ROLE "${role}"`).execute(db);
      await sql`select set_config('app.platform', 'off', false), set_config('app.tenant_id', '', false)`.execute(db);
      expect((await sql`select id from tenants`.execute(db)).rows).toEqual([]);

      const ambiguous = await new Migrator({ db, provider: new FrozenSqlProvider(dir) }).migrateToLatest();
      expect(String(ambiguous.error)).toContain('contentbank.legacy_owner_unresolved');
      expect((await sql<{ count: number }>`select count(*)::int as count from information_schema.columns
        where table_name = 'content_bank_content' and column_name = 'tenant_id'`.execute(db)).rows[0]?.count).toBe(0);
      await sql`delete from content_bank_content where name = 'Chưa xác định được chủ'`.execute(db);
      const upgrade = await new Migrator({ db, provider: new FrozenSqlProvider(dir) }).migrateToLatest();
      expect(upgrade.error).toBeUndefined();
      expect((await sql<{ value: string }>`select current_setting('app.platform', true) as value`.execute(db)).rows[0]?.value).toBe('off');
      expect((await sql`select id from content_bank_content`.execute(db)).rows).toEqual([]);
      await sql`select set_config('app.tenant_id', ${tenantA}, false)`.execute(db);
      expect((await sql<{ name: string }>`select name from content_bank_content order by name`.execute(db)).rows.map((x) => x.name)).toEqual([
        'Cá nhân A trước nâng cấp', 'Neo tenant A', 'Tổ A cũ', 'Trường A cũ',
      ]);
      expect((await sql<{ item_id: string }>`select item_id from files where item_id = ${personal.rows[0]!.id}`.execute(db)).rows).toEqual([{ item_id: personal.rows[0]!.id }]);
      await sql`select set_config('app.tenant_id', ${tenantB}, false)`.execute(db);
      expect((await sql<{ name: string }>`select name from content_bank_content`.execute(db)).rows).toEqual([{ name: 'Trường B cũ' }]);
      await sql`select set_config('app.tenant_id', ${platform}, false)`.execute(db);
      expect((await sql<{ name: string }>`select name from content_bank_content`.execute(db)).rows).toEqual([{ name: 'Trang chính có chủ' }]);
    } finally {
      await sql`RESET ROLE`.execute(db);
      await db.destroy();
      await dropTestDatabase(adminUrl, database);
      if (createdRole) {
        const admin = new Client({ connectionString: adminUrl });
        await admin.connect();
        try { await admin.query(`DROP ROLE "${role}"`); } finally { await admin.end(); }
      }
    }
  });

});
