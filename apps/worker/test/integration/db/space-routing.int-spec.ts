import type { ConfigService } from '@nestjs/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCentreKysely, sql, type CentreDb } from '@giaokhoa/db';
import { createControlPlaneKysely } from '@giaokhoa/db/control-plane';
import { SpaceRoutingError } from '../../../src/db/routing/space-connection-resolver';
import { SpaceDatabaseService } from '../../../src/db/routing/space-database.service';
import { emitSpaceRegistryChanged } from '../../../src/db/routing/space-routing-events';
import { tenantAls } from '../../../src/db/tenant-als';
import { TenantAwarePool } from '../../../src/db/tenant-pool';

const CP_DATABASE = 'giaokhoa_test_cp_581w';
const CP_ROLE = 'giaokhoa_cp_test_581w';
const CP_PASSWORD = 'cp-test-581w';
const CENTRE_DATABASE = 'giaokhoa_test_centre_w_581';
const CENTRE_ROLE = 'giaokhoa_centre_w_581_app';
const CENTRE_PASSWORD = 'centre-w-581';
const CENTRE_SLUG = 'trung-tam-w-581';
const SHARED_SLUG = 'trang-chinh';
const CENTRE_TENANT_ID = '01958100-0000-7000-8000-0000000000d4';
const CENTRE2_ROLE = 'giaokhoa_centre_w2_581_app';
const CENTRE2_PASSWORD = 'centre-w2-581';
const SESSION_ROW_ID = '01958100-0000-7000-8000-0000000000e6';
const REVOKED_MARKER_ID = '01958100-0000-7000-8000-0000000000f7';

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

async function applySqlFile(connectionString: string, filePath: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    const version = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    if (Number(version.rows[0]!.server_version_num) < 180000) {
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await client.query(UUIDV7_SHIM);
    }
    const sql = readFileSync(filePath, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.query(trimmed);
    }
  });
}

describe('Khung định tuyến theo trung tâm phía worker (integration)', () => {
  let service: SpaceDatabaseService;
  let sharedPool: TenantAwarePool;
  let sharedKysely: CentreDb;

  beforeAll(async () => {
    const businessUrl = new URL(process.env.DATABASE_URL!);
    const businessDatabase = decodeURIComponent(businessUrl.pathname.replace(/^\//, ''));
    const businessRole = decodeURIComponent(businessUrl.username);

    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_ROLE, CENTRE2_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
      await admin.query(`CREATE ROLE ${CP_ROLE} LOGIN PASSWORD '${CP_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${CENTRE_ROLE} LOGIN PASSWORD '${CENTRE_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${CENTRE2_ROLE} LOGIN PASSWORD '${CENTRE2_PASSWORD}'`);
      await admin.query(`CREATE DATABASE ${CP_DATABASE} OWNER ${CP_ROLE}`);
      await admin.query(`CREATE DATABASE ${CENTRE_DATABASE} OWNER ${CENTRE_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CP_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CP_DATABASE} TO ${CP_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CENTRE_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CENTRE_DATABASE} TO ${CENTRE_ROLE}`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CENTRE_DATABASE} TO ${CENTRE2_ROLE}`);
    });

    const cpDir = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'control-plane');
    const folders = readdirSync(cpDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const folder of folders) {
      await applySqlFile(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD), join(cpDir, folder, 'migration.sql'));
    }
    await applySqlFile(
      clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD),
      join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'centre', '20261025163710_baseline', 'migration.sql'),
    );

    process.env.SPACE_TEST_W_581_URL = clusterUrl('postgres', CENTRE_ROLE, CENTRE_PASSWORD);
    process.env.SPACE_TEST_W2_581_URL = clusterUrl('postgres', CENTRE2_ROLE, CENTRE2_PASSWORD);
    const cpSeedPool = new Pool({ connectionString: clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD) });
    try {
      const cpDb = createControlPlaneKysely(cpSeedPool);
      await cpDb.insertInto('space_registry').values([
        {
          slug: CENTRE_SLUG,
          name: 'Trung tâm W 581',
          kind: 'center',
          status: 'active',
          database_name: CENTRE_DATABASE,
          storage_mode: 'dedicated',
          connection_role_ref: CENTRE_ROLE,
          secret_ref: 'env:SPACE_TEST_W_581_URL',
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
    } finally {
      await cpSeedPool.end();
    }

    service = new SpaceDatabaseService({
      get: (key: string) =>
        ({
          CONTROL_PLANE_DATABASE_URL: clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD),
          SPACE_DB_POOL_MAX: 2,
          SPACE_DB_POOL_IDLE_TIMEOUT_MS: 60_000,
          SPACE_ROUTING_CACHE_TTL_MS: 60_000,
          DATABASE_SSL: false,
        })[key],
    } as unknown as ConfigService);
    sharedPool = new TenantAwarePool({ connectionString: process.env.DATABASE_URL! });
    sharedKysely = createCentreKysely(sharedPool);
    service.bindSharedKysely(sharedKysely);
  }, 180_000);

  afterAll(async () => {
    await service.onModuleDestroy();
    await sharedPool.end().catch(() => undefined);
    delete process.env.SPACE_TEST_W_581_URL;
    delete process.env.SPACE_TEST_W2_581_URL;
    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_ROLE, CENTRE2_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
    });
  });

  it('phiên theo trung tâm của một tác vụ nền ghi và đọc trong đúng kho riêng của trung tâm', async () => {
    await service.withSpaceKysely(
      CENTRE_SLUG,
      async () => {
        await service.routedKysely
          .insertInto('tenants')
          .values({ id: CENTRE_TENANT_ID, slug: CENTRE_SLUG, name: 'Trung tâm W 581', kind: 'center' })
          .execute();
        const rows = await service.routedKysely.selectFrom('tenants').selectAll().where('id', '=', CENTRE_TENANT_ID).execute();
        expect(rows).toHaveLength(1);
      },
      { tenantId: CENTRE_TENANT_ID },
    );
    const direct = await withClient(clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD), async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const result = await client.query<{ id: string }>('SELECT id FROM tenants ORDER BY id');
      return result.rows.map((row) => row.id);
    });
    expect(direct).toEqual([CENTRE_TENANT_ID]);
  });

  it('phiên theo trung tâm ở chế độ kho chung dùng đúng handle kho chung của worker', async () => {
    const db = await service.getKyselyForSpace(SHARED_SLUG);
    expect(db).toBe(sharedKysely);
    const viaSession = await service.withSpaceKysely(SHARED_SLUG, async () => service.getKyselyForSpace(SHARED_SLUG));
    expect(viaSession).toBe(sharedKysely);
  });

  it('sổ đổi role và bí mật của kho sau khi pool đã tạo: lần lấy handle kế tiếp của worker kết nối bằng role mới của sổ, pool cũ bị thay', async () => {
    const dbBefore = await service.getKyselyForSpace(CENTRE_SLUG);
    const userBefore = await sql<{ u: string }>`SELECT current_user AS u`.execute(dbBefore);
    expect(userBefore.rows[0]!.u).toBe(CENTRE_ROLE);

    await withClient(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD), async (client) => {
      await client.query('UPDATE space_registry SET connection_role_ref = $1, secret_ref = $2 WHERE slug = $3', [
        CENTRE2_ROLE,
        'env:SPACE_TEST_W2_581_URL',
        CENTRE_SLUG,
      ]);
    });
    emitSpaceRegistryChanged(CENTRE_SLUG);
    const target = await service.resolveTarget(CENTRE_SLUG);
    expect(target.connectionRole).toBe(CENTRE2_ROLE);

    const dbAfter = await service.getKyselyForSpace(CENTRE_SLUG);
    expect(dbAfter).not.toBe(dbBefore);
    const userAfter = await sql<{ u: string }>`SELECT current_user AS u`.execute(dbAfter);
    expect(userAfter.rows[0]!.u).toBe(CENTRE2_ROLE);

    await withClient(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD), async (client) => {
      await client.query('UPDATE space_registry SET connection_role_ref = $1, secret_ref = $2 WHERE slug = $3', [
        CENTRE_ROLE,
        'env:SPACE_TEST_W_581_URL',
        CENTRE_SLUG,
      ]);
    });
    emitSpaceRegistryChanged(CENTRE_SLUG);
  });

  it('trung tâm kho riêng đã chuẩn bị mà pool bị đóng vì nhàn rỗi: truy vấn qua handle định tuyến phía worker trong ngữ cảnh còn mang slug bị từ chối thay vì rơi về kho chung', async () => {
    const shortIdleService = new SpaceDatabaseService({
      get: (key: string) =>
        ({
          CONTROL_PLANE_DATABASE_URL: clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD),
          SPACE_DB_POOL_MAX: 2,
          SPACE_DB_POOL_IDLE_TIMEOUT_MS: 600,
          SPACE_ROUTING_CACHE_TTL_MS: 60_000,
          DATABASE_SSL: false,
        })[key],
    } as unknown as ConfigService);
    shortIdleService.bindSharedKysely(sharedKysely);
    try {
      await shortIdleService.withSpaceKysely(
        CENTRE_SLUG,
        async () => {
          await shortIdleService.routedKysely
            .insertInto('tenants')
            .values({ id: SESSION_ROW_ID, slug: 'trung-tam-w-thu-hoi-581', name: 'Trung tâm W ca thu hồi 581', kind: 'center' })
            .execute();
        },
        { tenantId: SESSION_ROW_ID },
      );
      const pinnedScope = shortIdleService.preparedSpaceScope(CENTRE_SLUG);
      const probeBefore = await tenantAls.run({ spaceSlug: CENTRE_SLUG, ...pinnedScope, tenantId: SESSION_ROW_ID }, async () => {
        const result = await sql<{ db: string }>`SELECT current_database() AS db`.execute(shortIdleService.routedKysely);
        return result.rows[0]!.db;
      });
      expect(probeBefore).toBe(CENTRE_DATABASE);

      await new Promise((resolve) => setTimeout(resolve, 600 + 1_800));

      let readError: unknown;
      await tenantAls.run({ spaceSlug: CENTRE_SLUG, ...pinnedScope, tenantId: SESSION_ROW_ID }, async () => {
        try {
          await sql`SELECT 1`.execute(shortIdleService.routedKysely);
        } catch (err) {
          readError = err;
        }
      });
      expect(readError).toBeInstanceOf(SpaceRoutingError);
      expect((readError as SpaceRoutingError).code).toBe('space_routing.prepared_revoked');

      let writeError: unknown;
      await tenantAls.run({ spaceSlug: CENTRE_SLUG, ...pinnedScope, tenantId: REVOKED_MARKER_ID }, async () => {
        try {
          await shortIdleService.routedKysely
            .insertInto('tenants')
            .values({ id: REVOKED_MARKER_ID, slug: 'dau-ghi-w-thu-hoi-581', name: 'Dòng ghi ca thu hồi W 581', kind: 'center' })
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

      await shortIdleService.getKyselyForSpace(CENTRE_SLUG);
      const repinnedScope = shortIdleService.preparedSpaceScope(CENTRE_SLUG);
      const probeAfter = await tenantAls.run({ spaceSlug: CENTRE_SLUG, ...repinnedScope, tenantId: SESSION_ROW_ID }, async () => {
        const result = await sql<{ db: string }>`SELECT current_database() AS db`.execute(shortIdleService.routedKysely);
        return result.rows[0]!.db;
      });
      expect(probeAfter).toBe(CENTRE_DATABASE);
    } finally {
      await shortIdleService.onModuleDestroy();
    }
  });
});
