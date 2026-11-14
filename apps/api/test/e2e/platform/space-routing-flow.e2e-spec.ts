import { INestApplication } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createControlPlaneKysely } from '@giaokhoa/db/control-plane';
import { TenantsRepository } from '@giaokhoa/db/repositories/tenants';
import { ContextsService } from '../../../src/modules/access/contexts.service';
import { tenantAls } from '../../../src/modules/tenants/tenant-als';
import { emitSpaceRegistryChanged } from '../../../src/db/routing/space-routing-events';
import {
  STRONG_PASSWORD,
  createTestApp,
  createUserViaApi,
  seedTenantMembershipFixture,
  http,
  login,
} from '../../support/identity-access-helpers';

const CP_DATABASE = 'giaokhoa_test_cp_582';
const CP_ROLE = 'giaokhoa_cp_test_582';
const CP_PASSWORD = 'cp-test-582';
const CENTRE_A_DATABASE = 'giaokhoa_test_centre_a_582';
const CENTRE_A_ROLE = 'giaokhoa_centre_a_582_app';
const CENTRE_A_PASSWORD = 'centre-a-582';
const CENTRE_B_DATABASE = 'giaokhoa_test_centre_b_582';
const CENTRE_B_ROLE = 'giaokhoa_centre_b_582_app';
const CENTRE_B_PASSWORD = 'centre-b-582';
const RUN_SUFFIX = Math.random().toString(36).slice(2, 8);
const CENTRE_A_SLUG = `trung-tam-a-${RUN_SUFFIX}`;
const CENTRE_B_SLUG = `trung-tam-b-${RUN_SUFFIX}`;
const HOST_A = `${CENTRE_A_SLUG}.test.local`;
const HOST_B = `${CENTRE_B_SLUG}.test.local`;
const SHARED_SLUG = 'truong-mac-dinh';
const HOST_SHARED = `${SHARED_SLUG}.test.local`;
const CENTRE_A_FIRST_NAME = 'DauAnKhoA582';

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
    const sqlText = readFileSync(filePath, 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
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

function decodeJwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1];
  if (!segment) throw new Error('access token không có phần payload');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function copyRow(
  sourceUrl: string,
  targetUrl: string,
  table: string,
  whereColumn: string,
  whereValue: string,
): Promise<void> {
  const row = await withClient(sourceUrl, async (client) => {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    const result = await client.query(`SELECT * FROM ${quoted(table)} WHERE ${quoted(whereColumn)} = $1`, [
      whereValue,
    ]);
    return result.rows[0] as Record<string, unknown> | undefined;
  });
  if (!row) throw new Error(`Không tìm thấy dòng nguồn ${table}.${whereColumn}=${whereValue}`);
  const columns = Object.keys(row);
  await withClient(targetUrl, async (client) => {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO ${quoted(table)} (${columns.map(quoted).join(', ')}) VALUES (${placeholders})`,
      columns.map((column) => row[column]),
    );
  });
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

async function countFamilies(connectionString: string, userId: string): Promise<number> {
  return withClient(connectionString, async (client) => {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    const result = await client.query<{ count: string }>(
      'SELECT count(*) FROM refresh_token_family WHERE user_id = $1',
      [userId],
    );
    return Number(result.rows[0]!.count);
  });
}

describe('Định tuyến theo trung tâm ở tầng API (đầu-cuối)', () => {
  let app: INestApplication;
  let adminToken = '';
  let tenantAId = '';
  let tenantBId = '';
  let registryAId = '';
  let teacherId = '';
  let teacherUsername = '';
  let teacherTokenA = '';
  let sharedOnlyUsername = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const must = async (res: { status: number; body: unknown }, what: string) => {
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body as never;
  };

  beforeAll(async () => {
    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_A_DATABASE, CENTRE_B_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_A_ROLE, CENTRE_B_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
      await admin.query(`CREATE ROLE ${CP_ROLE} LOGIN PASSWORD '${CP_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${CENTRE_A_ROLE} LOGIN PASSWORD '${CENTRE_A_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${CENTRE_B_ROLE} LOGIN PASSWORD '${CENTRE_B_PASSWORD}'`);
      await admin.query(`CREATE DATABASE ${CP_DATABASE} OWNER ${CP_ROLE}`);
      await admin.query(`CREATE DATABASE ${CENTRE_A_DATABASE} OWNER ${CENTRE_A_ROLE}`);
      await admin.query(`CREATE DATABASE ${CENTRE_B_DATABASE} OWNER ${CENTRE_B_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CP_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CP_DATABASE} TO ${CP_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CENTRE_A_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CENTRE_A_DATABASE} TO ${CENTRE_A_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CENTRE_B_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CENTRE_B_DATABASE} TO ${CENTRE_B_ROLE}`);
    });
    await applyControlPlaneMigrations(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD));
    await applyBusinessBaseline(clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD));
    await applyBusinessBaseline(clusterUrl(CENTRE_B_DATABASE, CENTRE_B_ROLE, CENTRE_B_PASSWORD));

    process.env.CONTROL_PLANE_DATABASE_URL = clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD);
    process.env.SPACE_TEST_A_582_URL = clusterUrl('postgres', CENTRE_A_ROLE, CENTRE_A_PASSWORD);
    process.env.SPACE_TEST_B_582_URL = clusterUrl('postgres', CENTRE_B_ROLE, CENTRE_B_PASSWORD);

    app = await createTestApp();

    const platformDbUrl = new URL(process.env.DATABASE_URL!);
    const platformDbName = decodeURIComponent(platformDbUrl.pathname.replace(/^\//, ''));
    const platformRole = decodeURIComponent(platformDbUrl.username);

    const cpPool = new Pool({ connectionString: clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD) });
    const cpDb = createControlPlaneKysely(cpPool);
    try {
      const inserted = await cpDb
        .insertInto('space_registry')
        .values([
          {
            slug: CENTRE_A_SLUG,
            name: 'Trung tâm A 582',
            kind: 'center',
            status: 'active',
            database_name: CENTRE_A_DATABASE,
            storage_mode: 'dedicated',
            connection_role_ref: CENTRE_A_ROLE,
            secret_ref: 'env:SPACE_TEST_A_582_URL',
            schema_version: 'v1',
          },
          {
            slug: CENTRE_B_SLUG,
            name: 'Trung tâm B 582',
            kind: 'center',
            status: 'active',
            database_name: CENTRE_B_DATABASE,
            storage_mode: 'dedicated',
            connection_role_ref: CENTRE_B_ROLE,
            secret_ref: 'env:SPACE_TEST_B_582_URL',
            schema_version: 'v1',
          },
          {
            slug: SHARED_SLUG,
            name: 'Trung tâm legacy 582',
            kind: 'center',
            status: 'active',
            database_name: platformDbName,
            storage_mode: 'shared',
            connection_role_ref: platformRole,
            secret_ref: 'env:DATABASE_URL',
            schema_version: 'v1',
          },
        ])
        .returning(['id', 'slug'])
        .execute();
      registryAId = inserted.find((row) => row.slug === CENTRE_A_SLUG)!.id;
    } finally {
      await cpDb.destroy();
    }

    adminToken = (await login(app, 'admin', 'Admin123!')).accessToken;

    const tenantsRepo = app.get(TenantsRepository, { strict: false });
    const contexts = app.get(ContextsService, { strict: false });
    const seedCentre = (slug: string, name: string) => tenantAls.run({ platform: true }, async () => {
      const row = await tenantsRepo.insertTenant({ slug, name, kind: 'center', status: 'active', plan: null });
      await contexts.ensureTenantContext(row.id);
      return row.id;
    });
    tenantAId = await seedCentre(CENTRE_A_SLUG, 'Trung tâm A 582');
    tenantBId = await seedCentre(CENTRE_B_SLUG, 'Trung tâm B 582');
    await copyRow(process.env.DATABASE_URL!, clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD), 'tenants', 'id', tenantAId);
    await copyRow(process.env.DATABASE_URL!, clusterUrl(CENTRE_B_DATABASE, CENTRE_B_ROLE, CENTRE_B_PASSWORD), 'tenants', 'id', tenantBId);

    const teacher = await createUserViaApi(app, adminToken);
    teacherId = teacher.id;
    teacherUsername = teacher.username;
    await seedTenantMembershipFixture(app, tenantAId, teacherId);
    await copyRow(process.env.DATABASE_URL!, clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD), 'users', 'id', teacherId);
    const membershipRow = await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const result = await client.query<{ id: string }>(
        'SELECT id FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2',
        [tenantAId, teacherId],
      );
      return result.rows[0];
    });
    if (!membershipRow) throw new Error('membership của giáo viên ở tenant A không tồn tại');
    await copyRow(
      process.env.DATABASE_URL!,
      clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD),
      'tenant_memberships',
      'id',
      membershipRow.id,
    );
    await withClient(clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD), async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      await client.query('UPDATE users SET first_name = $1 WHERE id = $2', [CENTRE_A_FIRST_NAME, teacherId]);
    });

    const teacherAtA = (await must(
      await http(app).post('/api/v1/auth/token').set('Host', HOST_A)
        .send({ username: teacherUsername, password: STRONG_PASSWORD }),
      'login teacher at A',
    )) as { accessToken: string };
    teacherTokenA = teacherAtA.accessToken;

    const sharedOnly = await createUserViaApi(app, adminToken);
    sharedOnlyUsername = sharedOnly.username;

  }, 300_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    delete process.env.SPACE_TEST_A_582_URL;
    delete process.env.SPACE_TEST_B_582_URL;
    delete process.env.CONTROL_PLANE_DATABASE_URL;
    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_A_DATABASE, CENTRE_B_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_A_ROLE, CENTRE_B_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
    }).catch(() => undefined);
  });

  it('token tại A chỉ mang centre_id của A, phiên admin platform không giả làm phiên trung tâm', async () => {
    expect(decodeJwtPayload(teacherTokenA)['centre_id']).toBe(registryAId);
    expect(decodeJwtPayload(teacherTokenA)['tid']).toBe(tenantAId);
    const { SpaceDatabaseService } = await import('../../../src/db/routing/space-database.service');
    const platform = await app.get(SpaceDatabaseService, { strict: false }).resolveTarget('trang-chinh');
    expect(decodeJwtPayload(adminToken)['centre_id']).toBe(platform.spaceId);
  });

  it('API chặn tạo cả school và center trong kho platform, không ghi thêm tenant', async () => {
    const before = await must(await http(app).get('/api/v1/tenants').set(auth(adminToken)), 'read tenant registry');
    for (const kind of ['school', 'center']) {
      const rejected = await http(app).post('/api/v1/tenants').set(auth(adminToken))
        .send({ name: 'Trung tâm legacy', slug: `legacy-${kind}-${RUN_SUFFIX}`, kind });
      expect(rejected.status).toBe(400);
      expect(rejected.body).toMatchObject({ code: 'centre.provision_required' });
    }
    const after = await must(await http(app).get('/api/v1/tenants').set(auth(adminToken)), 'read tenant registry after rejection');
    expect(after).toEqual(before);
  });

  it('token của trung tâm A tới địa chỉ của trung tâm B bị từ chối 401 auth.centre_mismatch trước tầng dữ kiện — không một kết nối nào vào kho B', async () => {
    expect(await countConnections(CENTRE_B_DATABASE, CENTRE_B_ROLE)).toBe(0);

    const res = await http(app)
      .get('/api/v1/users/me')
      .set('Host', HOST_B)
      .set(auth(teacherTokenA));

    expect(res.status).toBe(401);
    expect((res.body as { code?: string }).code).toBe('auth.centre_mismatch');
    expect(await countConnections(CENTRE_B_DATABASE, CENTRE_B_ROLE)).toBe(0);
  });

  it('đăng nhập tại địa chỉ của trung tâm A tạo family refresh trong kho A chứ không ở kho chung, và hồ sơ đọc tại địa chỉ A mang dữ kiện của kho A', async () => {
    const familiesInSharedBefore = await countFamilies(process.env.DATABASE_URL!, teacherId);
    const familiesInABefore = await countFamilies(clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD), teacherId);

    const res = await http(app)
      .post('/api/v1/auth/token')
      .set('Host', HOST_A)
      .send({ username: teacherUsername, password: STRONG_PASSWORD });
    expect(res.status).toBe(201);
    const loginPayload = decodeJwtPayload((res.body as { accessToken: string }).accessToken);
    expect(loginPayload['centre_id']).toBe(registryAId);

    expect(
      await countFamilies(clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD), teacherId),
    ).toBeGreaterThan(familiesInABefore);
    expect(await countFamilies(process.env.DATABASE_URL!, teacherId)).toBe(familiesInSharedBefore);

    const meAtA = await http(app).get('/api/v1/users/me').set('Host', HOST_A).set(auth(teacherTokenA));
    expect(meAtA.status).toBe(200);
    expect((meAtA.body as { firstName?: string }).firstName).toBe(CENTRE_A_FIRST_NAME);
    const meAtApex = await http(app).get('/api/v1/users/me').set(auth(teacherTokenA));
    expect(meAtApex.status).toBe(401);
    expect((meAtApex.body as { code?: string }).code).toBe('auth.centre_mismatch');
  });

  it('tài khoản chỉ tồn tại ở kho chung đăng nhập tại địa chỉ của trung tâm A thì thất bại vì kho A không có tài khoản đó', async () => {
    const res = await http(app)
      .post('/api/v1/auth/token')
      .set('Host', HOST_A)
      .send({ username: sharedOnlyUsername, password: STRONG_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('trung tâm đình chỉ từ chối nghiệp vụ kể cả nhân sự platform, dữ kiện vẫn nguyên', async () => {
    await withClient(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD), async (client) => {
      await client.query('UPDATE space_registry SET status = $1 WHERE slug = $2', ['suspended', CENTRE_A_SLUG]);
    });
    emitSpaceRegistryChanged(CENTRE_A_SLUG);
    try {
      const blocked = await http(app).get('/api/v1/users/me').set('Host', HOST_A).set(auth(teacherTokenA));
      expect(blocked.status).toBe(403);
      expect((blocked.body as { code?: string }).code).toBe('space.not_active');

      const operations = await http(app).get('/api/v1/users/me').set('Host', HOST_A).set(auth(adminToken));
      expect(operations.status).toBe(401);
      expect(operations.body).toMatchObject({ code: 'auth.centre_mismatch' });

      const tenantRows = await withClient(
        clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD),
        async (client) => {
          await client.query("SELECT set_config('app.platform', 'on', false)");
          const result = await client.query<{ count: string }>(
            'SELECT count(*) FROM tenants WHERE id = $1',
            [tenantAId],
          );
          return Number(result.rows[0]!.count);
        },
      );
      expect(tenantRows).toBe(1);
    } finally {
      await withClient(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD), async (client) => {
        await client.query('UPDATE space_registry SET status = $1 WHERE slug = $2', ['active', CENTRE_A_SLUG]);
      });
      emitSpaceRegistryChanged(CENTRE_A_SLUG);
    }
  });

  it('registry legacy shared bị từ chối trên HTTP với đúng mã lỗi, không trả dữ liệu platform', async () => {
    const atShared = await http(app).get(`/api/v1/centres/${SHARED_SLUG}/identity`).set('Host', HOST_SHARED);
    expect(atShared.status).toBe(403);
    expect(atShared.body).toMatchObject({ code: 'space_routing.shared_not_supported' });
    const atRoot = await http(app).get(`/api/v1/centres/${SHARED_SLUG}/identity`);
    expect(atRoot.status).toBe(403);
    expect(atRoot.body).toMatchObject({ code: 'space_routing.shared_not_supported' });
    const protectedRequest = await http(app).get('/api/v1/users/me').set('Host', HOST_SHARED).set(auth(adminToken));
    expect(protectedRequest.status).toBe(401);
    expect(protectedRequest.body).toMatchObject({ code: 'auth.unauthenticated' });
  });

  it('cùng userId ở A/B có chỉ mục tìm kiếm và cache quyền riêng; HTTP chỉ trả nội dung kho của Host', async () => {
    await seedTenantMembershipFixture(app, tenantBId, teacherId);
    await copyRow(process.env.DATABASE_URL!, clusterUrl(CENTRE_B_DATABASE, CENTRE_B_ROLE, CENTRE_B_PASSWORD), 'users', 'id', teacherId);
    const membershipB = await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const result = await client.query<{ id: string }>(
        'SELECT id FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2',
        [tenantBId, teacherId],
      );
      return result.rows[0];
    });
    expect(membershipB).toBeDefined();
    await copyRow(
      process.env.DATABASE_URL!,
      clusterUrl(CENTRE_B_DATABASE, CENTRE_B_ROLE, CENTRE_B_PASSWORD),
      'tenant_memberships', 'id', membershipB!.id,
    );
    const bName = 'DauAnKhoB11';
    await withClient(clusterUrl(CENTRE_B_DATABASE, CENTRE_B_ROLE, CENTRE_B_PASSWORD), async (client) => {
      await client.query('UPDATE users SET first_name = $1 WHERE id = $2', [bName, teacherId]);
    });

    const { SearchService } = await import('../../../src/modules/search/search.service');
    const { PermissionEvaluator } = await import('../../../src/modules/access/permission-evaluator.service');
    const { SpaceDatabaseService } = await import('../../../src/db/routing/space-database.service');
    const spaceDb = app.get(SpaceDatabaseService, { strict: false });
    const search = app.get(SearchService, { strict: false });
    const permissions = app.get(PermissionEvaluator, { strict: false });
    await spaceDb.withSpaceKysely(CENTRE_A_SLUG, async () => {
      await permissions.setSiteAdmins([teacherId]);
      expect(await permissions.isSiteAdmin(teacherId)).toBe(true);
      expect(await search.indexItem('users', teacherId)).toBe(true);
    }, { tenantId: tenantAId });
    await spaceDb.withSpaceKysely(CENTRE_B_SLUG, async () => {
      expect(await permissions.isSiteAdmin(teacherId)).toBe(false);
      await permissions.setSiteAdmins([teacherId]);
      expect(await search.indexItem('users', teacherId)).toBe(true);
    }, { tenantId: tenantBId });

    const bToken = (await must(
      await http(app).post('/api/v1/auth/token').set('Host', HOST_B)
        .send({ username: teacherUsername, password: STRONG_PASSWORD }),
      'login teacher at B for search isolation',
    )) as { accessToken: string };
    const path = `/api/v1/search?q=${encodeURIComponent(teacherUsername)}`;
    const [fromA, fromB] = await Promise.all([
      http(app).get(path).set('Host', HOST_A).set(auth(teacherTokenA)),
      http(app).get(path).set('Host', HOST_B).set(auth(bToken.accessToken)),
    ]);
    expect(fromA.status).toBe(200);
    expect(fromB.status).toBe(200);
    const docsA = fromA.body as Array<{ itemId: string; title: string }>;
    const docsB = fromB.body as Array<{ itemId: string; title: string }>;
    expect(docsA.find((item) => item.itemId === teacherId)?.title).toContain(CENTRE_A_FIRST_NAME);
    expect(docsB.find((item) => item.itemId === teacherId)?.title).toContain(bName);
    expect(JSON.stringify(docsA)).not.toContain(bName);
    expect(JSON.stringify(docsB)).not.toContain(CENTRE_A_FIRST_NAME);
  });

});
