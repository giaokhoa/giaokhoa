import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCentreKysely, type CentreDb, type CentreTx } from '@giaokhoa/db';
import type { ControlPlaneDb } from '@giaokhoa/db/control-plane';
import {
  buildTestDatabase,
  dropTestDatabase,
  withDatabase,
} from '@giaokhoa/db/test-support';
import { InjectKysely } from '../../../src/db/inject-kysely';
import { KyselyModule } from '../../../src/db/kysely.module';
import { TenantAwarePool } from '../../../src/db/tenant-pool';
import { tenantAls } from '../../../src/modules/tenants/tenant-als';

const TEST_DATABASE = 'giaokhoa_api_kysely_foundation';
const TEST_ROLE = 'giaokhoa_api_kysely_foundation';
const TEST_ROLE_PASSWORD = 'giaokhoa_api_kysely_foundation_pw';

const baseUrl = process.env.GIAOKHOA_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = baseUrl ? withDatabase(baseUrl, 'postgres') : undefined;

let pool: TenantAwarePool;
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

@Injectable()
class KyselyHandleConsumer {
  constructor(
    @InjectKysely() readonly centre: CentreDb,
    @InjectKysely('control-plane') readonly controlPlane: ControlPlaneDb,
  ) {}
}

beforeAll(async () => {
  if (!adminUrl) {
    throw new Error(
      'Thiếu kết nối quản trị cho spec khung Kysely: GIAOKHOA_TEST_DATABASE_URL/DATABASE_URL chưa được đặt.',
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
    await admin.query(
      `ALTER ROLE "${TEST_ROLE}" WITH LOGIN NOSUPERUSER PASSWORD '${TEST_ROLE_PASSWORD}'`,
    );
    await admin.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${TEST_ROLE}"`);
    await admin.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${TEST_ROLE}"`);
  } finally {
    await admin.end();
  }

  const roleUrl = new URL(adminStoreUrl);
  roleUrl.username = TEST_ROLE;
  roleUrl.password = TEST_ROLE_PASSWORD;

  pool = new TenantAwarePool({ connectionString: roleUrl.toString() });
  db = createCentreKysely(pool);

  tenantAId = await tenantAls.run({ platform: true }, () => createTenantRow(db, 'n1-alpha'));
  tenantBId = await tenantAls.run({ platform: true }, () => createTenantRow(db, 'n1-beta'));
}, 180_000);

afterAll(async () => {
  await pool.end();
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

describe('khung Kysely phía apps/api', () => {
  it('giữ đúng GUC/RLS qua TenantAwarePool thật: mỗi tenant chỉ thấy dòng của mình', async () => {
    await expect(
      tenantAls.run({ tenantId: tenantAId }, () => listVisibleTenantSlugs(db)),
    ).resolves.toEqual(['n1-alpha']);
    await expect(
      tenantAls.run({ tenantId: tenantBId }, () => listVisibleTenantSlugs(db)),
    ).resolves.toEqual(['n1-beta']);
  });

  it('thấy mọi dòng ở ngữ cảnh platform và fail-closed ngoài mọi ngữ cảnh, qua TenantAwarePool thật', async () => {
    await expect(
      tenantAls.run({ platform: true }, () => listVisibleTenantSlugs(db)),
    ).resolves.toEqual(['n1-alpha', 'n1-beta']);
    await expect(listVisibleTenantSlugs(db)).resolves.toEqual([]);
  });

  it('rollback sạch khi giao dịch qua handle CentreTx trên TenantAwarePool thật ném lỗi', async () => {
    await expect(
      tenantAls.run({ platform: true }, () =>
        db.transaction().execute(async (trx) => {
          await createTenantRow(trx, 'n1-rollback');
          throw new Error('rollback-marker');
        }),
      ),
    ).rejects.toThrow('rollback-marker');
    await expect(
      tenantAls.run({ platform: true }, () => listVisibleTenantSlugs(db)),
    ).resolves.toEqual(['n1-alpha', 'n1-beta']);
  });

  it('KyselyModule cấp đúng handle qua @InjectKysely và huỷ instance khi module đóng', async () => {
    const modulePool = new TenantAwarePool({
      connectionString: pool.options.connectionString,
    });
    const moduleControlPlanePool = new TenantAwarePool({
      connectionString: pool.options.connectionString,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        KyselyModule.forRoot({ centre: modulePool, controlPlane: moduleControlPlanePool }),
      ],
      providers: [KyselyHandleConsumer],
    }).compile();

    const consumer = moduleRef.get(KyselyHandleConsumer);
    expect(consumer.centre).toBeDefined();
    expect(consumer.controlPlane).toBeDefined();
    expect(consumer.controlPlane).not.toBe(consumer.centre);
    await expect(
      tenantAls.run({ platform: true }, () => listVisibleTenantSlugs(consumer.centre)),
    ).resolves.toEqual(['n1-alpha', 'n1-beta']);

    await moduleRef.close();
    await expect(modulePool.query('select 1')).rejects.toThrow();
  });
});
