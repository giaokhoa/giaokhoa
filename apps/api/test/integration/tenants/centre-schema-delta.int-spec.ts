import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureCentreSchemaDelta } from '../../../src/modules/tenants/centre-schema-delta-ensure';

const RUN_SUFFIX = Math.random().toString(36).slice(2, 8);
const BIZ_DATABASE = `giaokhoa_test_bizdelta_611_${RUN_SUFFIX}`;
const CP_DATABASE = `giaokhoa_test_cpdelta_611_${RUN_SUFFIX}`;

const UUIDV7_SHIM = `CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$ DECLARE ts_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; b bytea; BEGIN b := decode(lpad(to_hex(ts_ms), 12, '0'), 'hex') || gen_random_bytes(10); b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112); b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128); RETURN encode(b, 'hex')::uuid; END; $$ LANGUAGE plpgsql VOLATILE`;

function clusterUrl(database: string): string {
  const base = new URL(process.env.DATABASE_URL!);
  base.pathname = `/${database}`;
  return base.toString();
}

function quoted(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function withClient<T>(connectionString: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function applySqlFile(connectionString: string, filePath: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    const version = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    if (Number(version.rows[0]!.server_version_num) < 180000) {
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await client.query(UUIDV7_SHIM);
    }
    const sqlText = readFileSync(filePath, 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.query(trimmed);
    }
  });
}

function findBaselineFile(): string {
  const outDir = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'centre');
  const baselines = readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('_baseline'))
    .map((entry) => entry.name);
  expect(baselines).toHaveLength(1);
  return join(outDir, baselines[0]!, 'migration.sql');
}

async function applyControlPlaneMigrations(connectionString: string): Promise<void> {
  const outDir = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'control-plane');
  const folders = readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    await applySqlFile(connectionString, join(outDir, folder, 'migration.sql'));
  }
}

describe('Ensure delta schema trung tâm (tích hợp)', () => {
  beforeAll(async () => {
    await withClient(clusterUrl('postgres'), async (admin) => {
      await admin.query(`CREATE DATABASE ${quoted(BIZ_DATABASE)}`);
      await admin.query(`CREATE DATABASE ${quoted(CP_DATABASE)}`);
    });
    await applySqlFile(clusterUrl(BIZ_DATABASE), findBaselineFile());
    await applyControlPlaneMigrations(clusterUrl(CP_DATABASE));
    await withClient(clusterUrl(BIZ_DATABASE), async (client) => {
      await client.query('DROP TABLE IF EXISTS centre_identity, centre_invites, program_package_installs CASCADE');
    });
    await withClient(clusterUrl(CP_DATABASE), async (client) => {
      await client.query('DROP INDEX IF EXISTS space_registry_database_name_dedicated_unique');
    });
  }, 180000);

  afterAll(async () => {
    await withClient(clusterUrl('postgres'), async (admin) => {
      await admin.query(`DROP DATABASE IF EXISTS ${quoted(BIZ_DATABASE)} WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS ${quoted(CP_DATABASE)} WITH (FORCE)`);
    });
  });

  it('ensure tạo đủ đối tượng delta còn thiếu trên database đã áp baseline cũ', async () => {
    const report = await ensureCentreSchemaDelta({
      businessDatabaseUrl: clusterUrl(BIZ_DATABASE),
      controlPlaneDatabaseUrl: clusterUrl(CP_DATABASE),
      log: () => undefined,
    });
    expect(report.business.created).toEqual(
      expect.arrayContaining([
        'centre_identity',
        'centre_invites',
        'program_package_installs',
        'centre_invites_tenant_id_idx',
        'centre_invites_user_id_idx',
        'centre_identity_tenant_id_tenants_id_fkey',
        'centre_invites_tenant_id_tenants_id_fkey',
        'centre_invites_user_id_users_id_fkey',
        'program_package_installs_tenant_id_tenants_id_fkey',
        'tenant_isolation on centre_identity',
        'tenant_isolation on centre_invites',
        'tenant_isolation on program_package_installs',
      ]),
    );
    expect(report.controlPlane?.created).toEqual(['space_registry_database_name_dedicated_unique']);

    await withClient(clusterUrl(BIZ_DATABASE), async (client) => {
      const tables = await client.query<{ relname: string }>(
        `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('centre_identity', 'centre_invites', 'program_package_installs')`,
      );
      expect(tables.rows.map((r) => r.relname).sort()).toEqual([
        'centre_identity',
        'centre_invites',
        'program_package_installs',
      ]);
      const indexes = await client.query<{ relname: string }>(
        `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname IN ('centre_invites_tenant_id_idx', 'centre_invites_user_id_idx')`,
      );
      expect(indexes.rows.map((r) => r.relname).sort()).toEqual([
        'centre_invites_tenant_id_idx',
        'centre_invites_user_id_idx',
      ]);
      const constraints = await client.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE conname IN ('centre_identity_tenant_id_tenants_id_fkey', 'centre_invites_tenant_id_tenants_id_fkey', 'centre_invites_user_id_users_id_fkey', 'program_package_installs_tenant_id_tenants_id_fkey')`,
      );
      expect(constraints.rows.map((r) => r.conname).sort()).toEqual([
        'centre_identity_tenant_id_tenants_id_fkey',
        'centre_invites_tenant_id_tenants_id_fkey',
        'centre_invites_user_id_users_id_fkey',
        'program_package_installs_tenant_id_tenants_id_fkey',
      ]);
      const rls = await client.query<{ relname: string; relforcerowsecurity: boolean; polqual: string }>(
        `SELECT c.relname, c.relforcerowsecurity, pg_get_expr(p.polqual, p.polrelid) AS polqual FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_policy p ON p.polrelid = c.oid WHERE n.nspname = 'public' AND c.relname IN ('centre_identity', 'centre_invites', 'program_package_installs') AND p.polname = 'tenant_isolation'`,
      );
      expect(rls.rows).toHaveLength(3);
      for (const row of rls.rows) {
        expect(row.relforcerowsecurity).toBe(true);
        expect(row.polqual).toContain('app.platform');
        expect(row.polqual).toContain('app.tenant_id');
      }
      await client.query(`SELECT set_config('app.platform', 'on', false)`);
      const tenant = await client.query<{ id: string }>(
        `INSERT INTO tenants (slug, name, kind) VALUES ($1, $2, 'center') RETURNING id`,
        [`trung-tam-delta-${RUN_SUFFIX}`, 'Trung tâm delta'],
      );
      const identity = await client.query(
        `INSERT INTO centre_identity (tenant_id, display_name) VALUES ($1, $2) RETURNING id`,
        [tenant.rows[0]!.id, 'Trung tâm delta'],
      );
      expect(identity.rows).toHaveLength(1);
    });
    await withClient(clusterUrl(CP_DATABASE), async (client) => {
      const index = await client.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'space_registry_database_name_dedicated_unique' AND c.relkind = 'i'`,
      );
      expect(index.rowCount).toBe(1);
    });
  });

  it('chạy lại ensure lần hai là no-op: không tạo thêm đối tượng nào', async () => {
    const countObjects = async (): Promise<number> => {
      return withClient(clusterUrl(BIZ_DATABASE), async (client) => {
        const result = await client.query<{ c: string }>(
          `SELECT COUNT(*) AS c FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('centre_identity', 'centre_invites', 'program_package_installs', 'centre_invites_tenant_id_idx', 'centre_invites_user_id_idx')`,
        );
        const policies = await client.query<{ c: string }>(
          `SELECT COUNT(*) AS c FROM pg_policy WHERE polname = 'tenant_isolation'`,
        );
        return Number(result.rows[0]!.c) + Number(policies.rows[0]!.c);
      });
    };
    const before = await countObjects();
    const report = await ensureCentreSchemaDelta({
      businessDatabaseUrl: clusterUrl(BIZ_DATABASE),
      controlPlaneDatabaseUrl: clusterUrl(CP_DATABASE),
      log: () => undefined,
    });
    expect(report.business.created).toEqual([]);
    expect(report.controlPlane?.created).toEqual([]);
    expect(await countObjects()).toBe(before);
  });

  it('vắng URL control plane thì ensure chỉ chạy phần kho nghiệp vụ và không lỗi', async () => {
    const report = await ensureCentreSchemaDelta({
      businessDatabaseUrl: clusterUrl(BIZ_DATABASE),
      log: () => undefined,
    });
    expect(report.controlPlane).toBeNull();
    expect(report.business.created).toEqual([]);
  });
});
