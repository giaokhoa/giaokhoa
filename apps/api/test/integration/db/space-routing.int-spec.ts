import type { ConfigService } from '@nestjs/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCentreKysely, sql, type CentreDb } from '@giaokhoa/db';
import { SpaceRoutingError } from '../../../src/db/routing/space-connection-resolver';
import { emitSpaceRegistryChanged } from '../../../src/db/routing/space-routing-events';
import { SpaceDatabaseService } from '../../../src/db/routing/space-database.service';
import { TenantAwarePool } from '../../../src/db/tenant-pool';
import { ControlPlaneConnection } from '../../../src/modules/control-plane/control-plane.connection';
import { tenantAls } from '../../../src/modules/tenants/tenant-als';

const CP_DATABASE = 'giaokhoa_test_cp_581';
const CP_ROLE = 'giaokhoa_cp_test_581';
const CP_PASSWORD = 'cp-test-581';
const CENTRE_A_DATABASE = 'giaokhoa_test_centre_a_581';
const CENTRE_A_ROLE = 'giaokhoa_centre_a_581_app';
const CENTRE_A_PASSWORD = 'centre-a-581';
const CENTRE_B_DATABASE = 'giaokhoa_test_centre_b_581';
const CENTRE_B_ROLE = 'giaokhoa_centre_b_581_app';
const CENTRE_B_PASSWORD = 'centre-b-581';
const CENTRE_A_SLUG = 'trung-tam-a-581';
const CENTRE_B_SLUG = 'trung-tam-b-581';
const SHARED_SLUG = 'trang-chinh';
const TENANT_A_ID = '01958100-0000-7000-8000-0000000000a1';
const TENANT_B_ID = '01958100-0000-7000-8000-0000000000b2';
const SHARED_TENANT_ID = '01958100-0000-7000-8000-0000000000c3';
const CENTRE_A2_ROLE = 'giaokhoa_centre_a2_581_app';
const CENTRE_A2_PASSWORD = 'centre-a2-581';
const REVOKED_MARKER_ID = '01958100-0000-7000-8000-0000000000f6';
const POOL_MAX = 2;
const POOL_IDLE_TIMEOUT_MS = 600;

const UUIDV7_SHIM = `CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$ DECLARE ts_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; b bytea; BEGIN b := decode(lpad(to_hex(ts_ms), 12, '0'), 'hex') || gen_random_bytes(10); b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112); b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128); RETURN encode(b, 'hex')::uuid; END; $$ LANGUAGE plpgsql VOLATILE`;

function clusterUrl(database: string, username?: string, secret?: string): string {
  const base = new URL(process.env.DATABASE_URL!);
  base.pathname = `/${database}`;
  if (username) base.username = username;
  if (secret) base.password = secret;
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

async function applySqlFile(connectionString: string, filePath: string, withUuidShim: boolean): Promise<void> {
  await withClient(connectionString, async (client) => {
    if (withUuidShim) {
      const version = await client.query<{ server_version_num: string }>('SHOW server_version_num');
      if (Number(version.rows[0]!.server_version_num) < 180000) {
        await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
        await client.query(UUIDV7_SHIM);
      }
    }
    const sql = readFileSync(filePath, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.query(trimmed);
    }
  });
}

async function applyControlPlaneMigrations(connectionString: string): Promise<void> {
  const outDir = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'control-plane');
  const folders = readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    await applySqlFile(connectionString, join(outDir, folder, 'migration.sql'), true);
  }
}

async function applyBusinessBaseline(connectionString: string): Promise<void> {
  const baseline = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'centre', '20261025163710_baseline', 'migration.sql');
  await applySqlFile(connectionString, baseline, true);
}

function fakeConfig(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

async function countConnections(database: string, role: string): Promise<number> {
  return withClient(clusterUrl('postgres'), async (admin) => {
    const result = await admin.query<{ count: string }>(
      'SELECT count(*) FROM pg_stat_activity WHERE datname = $1 AND usename = $2',
      [database, role],
    );
    return Number(result.rows[0]!.count);
  });
}

describe('Khung định tuyến kết nối theo trung tâm (integration)', () => {
  let service: SpaceDatabaseService;
  let controlPlane: ControlPlaneConnection;
  let sharedPool: TenantAwarePool;
  let sharedKysely: CentreDb;
  let businessDatabase: string;
  let businessRole: string;

  beforeAll(async () => {
    const businessUrl = new URL(process.env.DATABASE_URL!);
    businessDatabase = decodeURIComponent(businessUrl.pathname.replace(/^\//, ''));
    businessRole = decodeURIComponent(businessUrl.username);

    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_A_DATABASE, CENTRE_B_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_A_ROLE, CENTRE_B_ROLE, CENTRE_A2_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
      await admin.query(`CREATE ROLE ${CP_ROLE} LOGIN PASSWORD '${CP_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${CENTRE_A_ROLE} LOGIN PASSWORD '${CENTRE_A_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${CENTRE_B_ROLE} LOGIN PASSWORD '${CENTRE_B_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${CENTRE_A2_ROLE} LOGIN PASSWORD '${CENTRE_A2_PASSWORD}'`);
      await admin.query(`CREATE DATABASE ${CP_DATABASE} OWNER ${CP_ROLE}`);
      await admin.query(`CREATE DATABASE ${CENTRE_A_DATABASE} OWNER ${CENTRE_A_ROLE}`);
      await admin.query(`CREATE DATABASE ${CENTRE_B_DATABASE} OWNER ${CENTRE_B_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CP_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CP_DATABASE} TO ${CP_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CENTRE_A_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CENTRE_A_DATABASE} TO ${CENTRE_A_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CENTRE_B_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CENTRE_B_DATABASE} TO ${CENTRE_B_ROLE}`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CENTRE_A_DATABASE} TO ${CENTRE_A2_ROLE}`);
    });

    await applyControlPlaneMigrations(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD));
    await applyBusinessBaseline(clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD));
    await applyBusinessBaseline(clusterUrl(CENTRE_B_DATABASE, CENTRE_B_ROLE, CENTRE_B_PASSWORD));

    process.env.SPACE_TEST_A_581_URL = clusterUrl('postgres', CENTRE_A_ROLE, CENTRE_A_PASSWORD);
    process.env.SPACE_TEST_B_581_URL = clusterUrl('postgres', CENTRE_B_ROLE, CENTRE_B_PASSWORD);
    process.env.SPACE_TEST_A2_581_URL = clusterUrl('postgres', CENTRE_A2_ROLE, CENTRE_A2_PASSWORD);

    controlPlane = new ControlPlaneConnection(
      fakeConfig({
        CONTROL_PLANE_DATABASE_URL: clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD),
        DATABASE_SSL: false,
      }),
    );
    if (!controlPlane.kysely) throw new Error('Control plane chưa được cấu hình trong ca kiểm chứng');
    await controlPlane.kysely.insertInto('space_registry').values([
      {
        slug: CENTRE_A_SLUG,
        name: 'Trung tâm A 581',
        kind: 'center',
        status: 'active',
        database_name: CENTRE_A_DATABASE,
        storage_mode: 'dedicated',
        connection_role_ref: CENTRE_A_ROLE,
        secret_ref: 'env:SPACE_TEST_A_581_URL',
        schema_version: 'v1',
      },
      {
        slug: CENTRE_B_SLUG,
        name: 'Trung tâm B 581',
        kind: 'center',
        status: 'active',
        database_name: CENTRE_B_DATABASE,
        storage_mode: 'dedicated',
        connection_role_ref: CENTRE_B_ROLE,
        secret_ref: 'env:SPACE_TEST_B_581_URL',
        schema_version: 'v1',
      },
      {
        slug: SHARED_SLUG,
        name: 'Trang chính',
        kind: 'platform',
        status: 'active',
        database_name: businessDatabase,
        storage_mode: 'shared',
        connection_role_ref: businessRole,
        secret_ref: 'env:DATABASE_URL',
        schema_version: 'v1',
      },
    ]).execute();

    service = new SpaceDatabaseService(
      fakeConfig({
        SPACE_DB_POOL_MAX: POOL_MAX,
        SPACE_DB_POOL_IDLE_TIMEOUT_MS: POOL_IDLE_TIMEOUT_MS,
        SPACE_ROUTING_CACHE_TTL_MS: 60_000,
        DATABASE_SSL: false,
      }),
      controlPlane,
    );
    sharedPool = new TenantAwarePool({ connectionString: process.env.DATABASE_URL! });
    sharedKysely = createCentreKysely(sharedPool);
    service.bindSharedKysely(sharedKysely);
  }, 180_000);

  afterAll(async () => {
    await service.onModuleDestroy();
    await sharedPool.end().catch(() => undefined);
    await controlPlane.onModuleDestroy();
    delete process.env.SPACE_TEST_A_581_URL;
    delete process.env.SPACE_TEST_B_581_URL;
    delete process.env.SPACE_TEST_A2_581_URL;
    await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query('DELETE FROM tenants WHERE id = ANY($1)', [[SHARED_TENANT_ID, REVOKED_MARKER_ID]]);
    }).catch(() => undefined);
    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_A_DATABASE, CENTRE_B_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_A_ROLE, CENTRE_B_ROLE, CENTRE_A2_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
    });
  });

  it('cùng một thao tác ghi/đọc dưới ngữ cảnh hai trung tâm rơi vào hai kho khác nhau', async () => {
    await service.withSpaceKysely(
      CENTRE_A_SLUG,
      async () => {
        await service.routedKysely
          .insertInto('tenants')
          .values({ id: TENANT_A_ID, slug: CENTRE_A_SLUG, name: 'Trung tâm A 581', kind: 'center' })
          .execute();
        const rows = await service.routedKysely.selectFrom('tenants').selectAll().where('id', '=', TENANT_A_ID).execute();
        expect(rows).toHaveLength(1);
      },
      { tenantId: TENANT_A_ID },
    );
    await service.withSpaceKysely(
      CENTRE_B_SLUG,
      async () => {
        await service.routedKysely
          .insertInto('tenants')
          .values({ id: TENANT_B_ID, slug: CENTRE_B_SLUG, name: 'Trung tâm B 581', kind: 'center' })
          .execute();
        const rows = await service.routedKysely.selectFrom('tenants').selectAll().where('id', '=', TENANT_B_ID).execute();
        expect(rows).toHaveLength(1);
      },
      { tenantId: TENANT_B_ID },
    );

    const readTenantIdsDirectly = async (database: string, role: string, password: string): Promise<string[]> =>
      withClient(clusterUrl(database, role, password), async (client) => {
        await client.query("SELECT set_config('app.platform', 'on', false)");
        const result = await client.query<{ id: string }>('SELECT id FROM tenants ORDER BY id');
        return result.rows.map((row) => row.id);
      });
    expect(await readTenantIdsDirectly(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD)).toEqual([TENANT_A_ID]);
    expect(await readTenantIdsDirectly(CENTRE_B_DATABASE, CENTRE_B_ROLE, CENTRE_B_PASSWORD)).toEqual([TENANT_B_ID]);
  });

  it('role của kho này bị từ chối ngay ở bước mở kết nối vào kho kia, cả hai chiều', async () => {
    for (const [database, role, password] of [
      [CENTRE_B_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD],
      [CENTRE_A_DATABASE, CENTRE_B_ROLE, CENTRE_B_PASSWORD],
    ] as const) {
      const client = new Client({ connectionString: clusterUrl(database, role, password) });
      let connectError: unknown;
      try {
        await client.connect();
      } catch (err) {
        connectError = err;
      } finally {
        await client.end().catch(() => undefined);
      }
      expect(connectError).toBeInstanceOf(Error);
      expect((connectError as Error).message).toMatch(/permission denied for database/);
    }
    const database = await withClient(clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD), async (client) => {
      const result = await client.query<{ current_database: string }>('SELECT current_database()');
      return result.rows[0]!.current_database;
    });
    expect(database).toBe(CENTRE_A_DATABASE);
  });

  it('sổ vừa đổi trạng thái: đệm vẫn giữ kết quả cũ cho tới khi sự kiện vô hiệu hoá được phát, sau đó phân giải thấy ngay trạng thái mới', async () => {
    const before = await service.resolveTarget(CENTRE_A_SLUG);
    expect(before.status).toBe('active');
    await withClient(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD), async (client) => {
      await client.query('UPDATE space_registry SET status = $1 WHERE slug = $2', ['suspended', CENTRE_A_SLUG]);
    });
    const cached = await service.resolveTarget(CENTRE_A_SLUG);
    expect(cached.status).toBe('active');
    emitSpaceRegistryChanged(CENTRE_A_SLUG);
    const fresh = await service.resolveTarget(CENTRE_A_SLUG);
    expect(fresh.status).toBe('suspended');
    await withClient(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD), async (client) => {
      await client.query('UPDATE space_registry SET status = $1 WHERE slug = $2', ['active', CENTRE_A_SLUG]);
    });
    emitSpaceRegistryChanged(CENTRE_A_SLUG);
  });

  it('pool của kho không còn traffic bị đóng sau ngưỡng nhàn rỗi, và lần dùng sau tạo lại pool hoạt động bình thường', async () => {
    await new Promise((resolve) => setTimeout(resolve, POOL_IDLE_TIMEOUT_MS + 1_800));
    await expect(countConnections(CENTRE_A_DATABASE, CENTRE_A_ROLE)).resolves.toBe(0);
    const rows = await service.withSpaceKysely(
      CENTRE_A_SLUG,
      () => service.routedKysely.selectFrom('tenants').selectAll().where('id', '=', TENANT_A_ID).execute(),
      { tenantId: TENANT_A_ID },
    );
    expect(rows).toHaveLength(1);
  });

  it('trung tâm kho riêng đã chuẩn bị mà pool bị đóng vì nhàn rỗi: truy vấn qua handle định tuyến trong ngữ cảnh còn mang slug bị từ chối thay vì rơi về kho chung', async () => {
    await service.getKyselyForSpace(CENTRE_A_SLUG);
    const pinnedScope = service.preparedSpaceScope(CENTRE_A_SLUG);
    const probeBefore = await tenantAls.run({ spaceSlug: CENTRE_A_SLUG, ...pinnedScope, tenantId: TENANT_A_ID }, async () => {
      const result = await sql<{ db: string }>`SELECT current_database() AS db`.execute(service.routedKysely);
      return result.rows[0]!.db;
    });
    expect(probeBefore).toBe(CENTRE_A_DATABASE);

    await new Promise((resolve) => setTimeout(resolve, POOL_IDLE_TIMEOUT_MS + 1_800));
    await expect(countConnections(CENTRE_A_DATABASE, CENTRE_A_ROLE)).resolves.toBe(0);

    let readError: unknown;
    await tenantAls.run({ spaceSlug: CENTRE_A_SLUG, ...pinnedScope, tenantId: TENANT_A_ID }, async () => {
      try {
        await sql`SELECT 1`.execute(service.routedKysely);
      } catch (err) {
        readError = err;
      }
    });
    expect(readError).toBeInstanceOf(SpaceRoutingError);
    expect((readError as SpaceRoutingError).code).toBe('space_routing.prepared_revoked');

    let writeError: unknown;
    await tenantAls.run({ spaceSlug: CENTRE_A_SLUG, ...pinnedScope, tenantId: REVOKED_MARKER_ID }, async () => {
      try {
        await service.routedKysely
          .insertInto('tenants')
          .values({ id: REVOKED_MARKER_ID, slug: 'dau-ghi-bi-thu-hoi-581', name: 'Dòng ghi ca thu hồi 581', kind: 'center' })
          .execute();
      } catch (err) {
        writeError = err;
      }
    });
    expect(writeError).toBeInstanceOf(SpaceRoutingError);
    const markerInShared = await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const result = await client.query<{ id: string }>('SELECT id FROM tenants WHERE id = $1', [REVOKED_MARKER_ID]);
      return result.rows.map((row) => row.id);
    });
    expect(markerInShared).toEqual([]);

    await service.getKyselyForSpace(CENTRE_A_SLUG);
    const repinnedScope = service.preparedSpaceScope(CENTRE_A_SLUG);
    const probeAfter = await tenantAls.run({ spaceSlug: CENTRE_A_SLUG, ...repinnedScope, tenantId: TENANT_A_ID }, async () => {
      const result = await sql<{ db: string }>`SELECT current_database() AS db`.execute(service.routedKysely);
      return result.rows[0]!.db;
    });
    expect(probeAfter).toBe(CENTRE_A_DATABASE);
  });

  it('tổng kết nối mở vào một kho không vượt trần cấu hình khi nhiều phiên chạy đồng thời', async () => {
    const db = await service.getKyselyForSpace(CENTRE_B_SLUG);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transactions = Array.from({ length: 4 }, () =>
      tenantAls.run({ tenantId: TENANT_B_ID }, () =>
        db.transaction().execute(async (trx) => {
          await sql`SELECT 1`.execute(trx);
          await gate;
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const open = await countConnections(CENTRE_B_DATABASE, CENTRE_B_ROLE);
    expect(open).toBeGreaterThan(0);
    expect(open).toBeLessThanOrEqual(POOL_MAX);
    release();
    await Promise.all(transactions);
  });

  it('registry shared bị từ chối trước khi truy cập dữ liệu, không sinh tenant ở platform', async () => {
    await expect(service.getKyselyForSpace(SHARED_SLUG)).rejects.toMatchObject({
      code: 'space_routing.shared_not_supported',
    });
    await expect(service.withSpaceKysely(SHARED_SLUG, async () => {
      throw new Error('Unexpected database access');
    })).rejects.toMatchObject({ code: 'space_routing.shared_not_supported' });
    const inShared = await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const result = await client.query<{ id: string }>('SELECT id FROM tenants WHERE id = $1', [SHARED_TENANT_ID]);
      return result.rows.map((row) => row.id);
    });
    expect(inShared).toEqual([]);
  });

  it('handle định tuyến uỷ thác về kho của trung tâm trong ngữ cảnh mang slug của trung tâm đó, và về kho chung ngoài ngữ cảnh', async () => {
    await service.getKyselyForSpace(CENTRE_A_SLUG);
    const pinnedScope = service.preparedSpaceScope(CENTRE_A_SLUG);
    const routed = await tenantAls.run({ spaceSlug: CENTRE_A_SLUG, ...pinnedScope, tenantId: TENANT_A_ID }, async () => {
      const rows = await service.routedKysely.selectFrom('tenants').selectAll().execute();
      return rows.map((row) => row.id);
    });
    expect(routed).toEqual([TENANT_A_ID]);
    const unrouted = await tenantAls.run({ tenantId: TENANT_A_ID }, async () => {
      const rows = await service.routedKysely.selectFrom('tenants').selectAll().where('id', '=', TENANT_A_ID).execute();
      return rows;
    });
    expect(unrouted).toHaveLength(0);
  });

  it('sổ đổi role và bí mật của một kho sau khi pool đã tạo: lần lấy handle kế tiếp kết nối bằng role mới của sổ, pool cũ bị thay', async () => {
    const dbBefore = await service.getKyselyForSpace(CENTRE_A_SLUG);
    const userBefore = await sql<{ u: string }>`SELECT current_user AS u`.execute(dbBefore);
    expect(userBefore.rows[0]!.u).toBe(CENTRE_A_ROLE);

    await withClient(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD), async (client) => {
      await client.query('UPDATE space_registry SET connection_role_ref = $1, secret_ref = $2 WHERE slug = $3', [
        CENTRE_A2_ROLE,
        'env:SPACE_TEST_A2_581_URL',
        CENTRE_A_SLUG,
      ]);
    });
    emitSpaceRegistryChanged(CENTRE_A_SLUG);

    const target = await service.resolveTarget(CENTRE_A_SLUG);
    expect(target.connectionRole).toBe(CENTRE_A2_ROLE);

    const dbAfter = await service.getKyselyForSpace(CENTRE_A_SLUG);
    expect(dbAfter).not.toBe(dbBefore);
    const userAfter = await sql<{ u: string }>`SELECT current_user AS u`.execute(dbAfter);
    expect(userAfter.rows[0]!.u).toBe(CENTRE_A2_ROLE);

    await withClient(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD), async (client) => {
      await client.query('UPDATE space_registry SET connection_role_ref = $1, secret_ref = $2 WHERE slug = $3', [
        CENTRE_A_ROLE,
        'env:SPACE_TEST_A_581_URL',
        CENTRE_A_SLUG,
      ]);
    });
    emitSpaceRegistryChanged(CENTRE_A_SLUG);
  });
});
