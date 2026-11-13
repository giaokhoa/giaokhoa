import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOwnershipTransferQuery } from '../../../src/modules/fleet/runtime-roles';

const SCRATCH_DATABASE = 'giaokhoa_test_ownership_603';
const MIGRATOR_ROLE = 'giaokhoa_migrator_test_603';

const ADMIN_ROLE = decodeURIComponent(new URL(process.env.DATABASE_URL!).username || 'postgres');

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

async function listTransferStatements(): Promise<string[]> {
  const query = buildOwnershipTransferQuery(ADMIN_ROLE, MIGRATOR_ROLE);
  const rows = await withClient(clusterUrl(SCRATCH_DATABASE), async (client) => {
    const result = await client.query<{ statement: string }>(query);
    return result.rows;
  });
  return rows.map((row) => row.statement);
}

beforeAll(async () => {
  await withClient(clusterUrl('postgres'), async (client) => {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${SCRATCH_DATABASE}' AND pid <> pg_backend_pid()`,
    );
    await client.query(`DROP DATABASE IF EXISTS ${quoted(SCRATCH_DATABASE)}`);
    await client.query(`DROP ROLE IF EXISTS ${quoted(MIGRATOR_ROLE)}`);
    await client.query(`CREATE ROLE ${quoted(MIGRATOR_ROLE)}`);
    await client.query(`CREATE DATABASE ${quoted(SCRATCH_DATABASE)} OWNER ${quoted(ADMIN_ROLE)}`);
  });
  await withClient(clusterUrl(SCRATCH_DATABASE), async (client) => {
    await client.query(`CREATE SCHEMA drizzle`);
    await client.query(`CREATE TABLE drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY)`);
    await client.query(`CREATE TABLE public.identity_tbl (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, note TEXT)`);
    await client.query(`CREATE SEQUENCE public.standalone_seq`);
    await client.query(`CREATE TABLE public.plain_tbl (id INTEGER PRIMARY KEY)`);
  });
}, 30000);

afterAll(async () => {
  await withClient(clusterUrl('postgres'), async (client) => {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${SCRATCH_DATABASE}' AND pid <> pg_backend_pid()`,
    );
    await client.query(`DROP DATABASE IF EXISTS ${quoted(SCRATCH_DATABASE)}`);
    await client.query(`DROP ROLE IF EXISTS ${quoted(MIGRATOR_ROLE)}`);
  });
});

describe('Chuyển chủ sở hữu đối tượng sang role migration không liệt kê sequence gắn cột (issue #603)', () => {
  it('danh sách chuyển chủ loại cả hai sequence gắn cột (serial và identity) nhưng giữ sequence rời', async () => {
    const statements = await listTransferStatements();
    expect(statements.some((s) => s.includes('__drizzle_migrations_id_seq'))).toBe(false);
    expect(statements.some((s) => s.includes('identity_tbl_id_seq'))).toBe(false);
    expect(statements.some((s) => s.includes('standalone_seq'))).toBe(true);
    expect(statements.some((s) => s.includes('__drizzle_migrations'))).toBe(true);
    expect(statements.some((s) => s.includes('identity_tbl'))).toBe(true);
    expect(statements.some((s) => s.includes('plain_tbl'))).toBe(true);
  });

  it('chạy toàn bộ câu lệnh theo thứ tự trả về không lỗi và mọi đối tượng về chủ migration', async () => {
    const statements = await listTransferStatements();
    await withClient(clusterUrl(SCRATCH_DATABASE), async (client) => {
      for (const statement of statements) {
        await client.query(statement);
      }
    });
    const owners = await withClient(clusterUrl(SCRATCH_DATABASE), async (client) => {
      const result = await client.query<{ relname: string; relkind: string; owner: string }>(
        `SELECT c.relname, c.relkind, r.rolname AS owner FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner WHERE ns.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'S', 'i') ORDER BY c.relname`,
      );
      return result.rows;
    });
    expect(owners.length).toBeGreaterThan(0);
    for (const row of owners) {
      expect(row.owner).toBe(MIGRATOR_ROLE);
    }
    const byName = new Map(owners.map((row) => [row.relname, row]));
    expect(byName.get('__drizzle_migrations_id_seq')?.owner).toBe(MIGRATOR_ROLE);
    expect(byName.get('identity_tbl_id_seq')?.owner).toBe(MIGRATOR_ROLE);
    expect(byName.get('standalone_seq')?.owner).toBe(MIGRATOR_ROLE);
  });
});
