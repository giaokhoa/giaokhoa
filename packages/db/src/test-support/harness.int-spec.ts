import { Client, Pool } from 'pg';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CentreDb, CentreTx } from '../client';
import {
  buildTestDatabase,
  dropTestDatabase,
  withDatabase,
} from './build-test-database';
import { createTestKysely } from './create-test-kysely';
import {
  runInTestPlatformContext,
  runInTestTenantContext,
  TestTenantPool,
} from './tenant-context';

const TEST_DATABASE = 'giaokhoa_db_kysely_smoke';
const TEST_ROLE = 'giaokhoa_db_kysely_smoke';
const TEST_ROLE_PASSWORD = 'giaokhoa_db_kysely_smoke_pw';

const adminUrl =
  process.env.GIAOKHOA_DB_TEST_ADMIN_URL ??
  (process.env.DATABASE_URL ? withDatabase(process.env.DATABASE_URL, 'postgres') : undefined);

let tenantPool: TestTenantPool;
let db: CentreDb;
let tenantAId: string;
let tenantBId: string;

async function createTenantRow(handle: CentreDb | CentreTx, slug: string): Promise<string> {
  const row = await handle
    .insertInto('tenants')
    .values({ slug, name: `Trung tâm ${slug}`, kind: 'centre' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function listVisibleTenantSlugs(handle: CentreDb | CentreTx): Promise<string[]> {
  const rows = await handle.selectFrom('tenants').select('slug').orderBy('slug').execute();
  return rows.map((row) => row.slug);
}

beforeAll(async () => {
  if (!adminUrl) {
    throw new Error(
      'Thiếu kết nối quản trị cho spec khói Kysely: đặt GIAOKHOA_DB_TEST_ADMIN_URL hoặc DATABASE_URL.',
    );
  }
  const adminStoreUrl = await buildTestDatabase({
    adminUrl,
    database: TEST_DATABASE,
    store: 'centre',
  });

  const admin = new Client({ connectionString: adminStoreUrl });
  await admin.connect();
  try {
    await admin.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${TEST_ROLE}') THEN
           CREATE ROLE "${TEST_ROLE}" LOGIN NOSUPERUSER PASSWORD '${TEST_ROLE_PASSWORD}';
         END IF;
       END $$;`,
    );
    await admin.query(`ALTER ROLE "${TEST_ROLE}" WITH LOGIN NOSUPERUSER PASSWORD '${TEST_ROLE_PASSWORD}'`);
    await admin.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${TEST_ROLE}"`);
    await admin.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${TEST_ROLE}"`);
  } finally {
    await admin.end();
  }

  const roleUrl = new URL(adminStoreUrl);
  roleUrl.username = TEST_ROLE;
  roleUrl.password = TEST_ROLE_PASSWORD;

  tenantPool = new TestTenantPool({ connectionString: roleUrl.toString() });
  db = createTestKysely(tenantPool).centre;

  tenantAId = await runInTestPlatformContext(() => createTenantRow(db, 'smoke-alpha'));
  tenantBId = await runInTestPlatformContext(() => createTenantRow(db, 'smoke-beta'));
}, 180_000);

afterAll(async () => {
  if (tenantPool) await tenantPool.end();
  if (adminUrl) {
    await dropTestDatabase(adminUrl, TEST_DATABASE);
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${TEST_ROLE}"`);
    } finally {
      await admin.end();
    }
  }
}, 60_000);

describe('khung Kysely của @giaokhoa/db', () => {
  it('chỉ cho thấy dòng của đúng tenant trong ngữ cảnh tenant, qua Kysely trên pool gắn GUC', async () => {
    await expect(runInTestTenantContext(tenantAId, () => listVisibleTenantSlugs(db))).resolves.toEqual([
      'smoke-alpha',
    ]);
    await expect(runInTestTenantContext(tenantBId, () => listVisibleTenantSlugs(db))).resolves.toEqual([
      'smoke-beta',
    ]);
  });

  it('cho thấy mọi dòng trong ngữ cảnh platform và fail-closed ngoài mọi ngữ cảnh', async () => {
    await expect(runInTestPlatformContext(() => listVisibleTenantSlugs(db))).resolves.toEqual([
      'smoke-alpha',
      'smoke-beta',
    ]);
    await expect(listVisibleTenantSlugs(db)).resolves.toEqual([]);
  });

  it('rollback sạch khi giao dịch qua handle CentreTx truyền vào repository mẫu ném lỗi', async () => {
    await expect(
      runInTestPlatformContext(() =>
        db.transaction().execute(async (trx) => {
          await createTenantRow(trx, 'smoke-rollback');
          throw new Error('rollback-marker');
        }),
      ),
    ).rejects.toThrow('rollback-marker');
    await expect(runInTestPlatformContext(() => listVisibleTenantSlugs(db))).resolves.toEqual([
      'smoke-alpha',
      'smoke-beta',
    ]);
  });

  it('ghi dữ liệu khi giao dịch qua handle CentreTx hoàn tất', async () => {
    await runInTestPlatformContext(() =>
      db.transaction().execute(async (trx) => {
        await createTenantRow(trx, 'smoke-committed');
      }),
    );
    await expect(runInTestPlatformContext(() => listVisibleTenantSlugs(db))).resolves.toContain(
      'smoke-committed',
    );
  });

  it('sinh hai handle độc lập từ hai pool: huỷ một handle không ảnh hưởng handle còn lại', async () => {
    const otherPool = new Pool({ connectionString: tenantPool.options.connectionString });
    const other = createTestKysely(otherPool).centre;
    expect(other).not.toBe(db);
    const probe = await sql<{ one: number }>`select 1 as one`.execute(other);
    expect(probe.rows[0]?.one).toBe(1);
    await other.destroy();
    await expect(runInTestPlatformContext(() => listVisibleTenantSlugs(db))).resolves.toContain(
      'smoke-alpha',
    );
  });
});
