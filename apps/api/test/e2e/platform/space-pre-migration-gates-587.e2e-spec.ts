import { JwtService } from '@nestjs/jwt';
import { INestApplication, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createControlPlaneKysely } from '@giaokhoa/db/control-plane';
import { seedLegacyCentreInShared } from '../../support/pre-migration-tenant.fixture';

const BETTER_AUTH_SECRET = 'test-better-auth-secret-at-least-32-chars';
process.env.BETTER_AUTH_ENABLED = 'true';
process.env.BETTER_AUTH_SECRET = BETTER_AUTH_SECRET;
process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'http://localhost:5173';

type Helpers = typeof import('../../support/identity-access-helpers');
let helpers: Helpers;

async function createMountedTestApp(): Promise<INestApplication> {
  const { Test } = await import('@nestjs/testing');
  const { AppModule } = await import('../../../src/app.module');
  const { enableTrustedProxy } = await import('../../../src/common/client-ip');
  const { ProblemDetailsFilter } = await import('../../../src/common/problem-details.filter');
  const { mountBetterAuth } = await import('../../../src/modules/auth/better-auth/better-auth.mount');
  const { BetterAuthService: BetterAuthServiceClass } = await import(
    '../../../src/modules/auth/better-auth/better-auth.service'
  );
  const { SpaceDatabaseService: SpaceDatabaseServiceClass } = await import(
    '../../../src/db/routing/space-database.service'
  );
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  enableTrustedProxy(app as NestExpressApplication);
  const betterAuth = app.get(BetterAuthServiceClass);
  const spaceDb = app.get(SpaceDatabaseServiceClass, { strict: false });
  mountBetterAuth(app as NestExpressApplication, betterAuth.requireAuth(), spaceDb);
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  return app;
}

function sessionCookieFrom(setCookie: string[] | undefined): string {
  const raw = (setCookie ?? []).find((value) => value.includes('better-auth.session_token='));
  if (!raw) throw new Error(`no Better Auth session cookie in: ${JSON.stringify(setCookie)}`);
  return raw.split(';')[0]!;
}

function signedBetterAuthCookie(token: string): string {
  const signature = createHmac('sha256', BETTER_AUTH_SECRET).update(token).digest('base64');
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

const CP_DATABASE = 'giaokhoa_test_cp_587';
const CP_ROLE = 'giaokhoa_cp_test_587';
const CP_PASSWORD = 'cp-test-587';
const CENTRE_A_DATABASE = 'giaokhoa_test_centre_a_587';
const CENTRE_A_ROLE = 'giaokhoa_centre_a_587_app';
const CENTRE_A_PASSWORD = 'centre-a-test-587';
const RUN_SUFFIX = Math.random().toString(36).slice(2, 8);
const CENTRE_A_SLUG = `trung-tam-a-587-${RUN_SUFFIX}`;
const HOST_A = `${CENTRE_A_SLUG}.test.local`;
const CENTRE_A_FIRST_NAME = 'DauAnKhoA587';

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

async function copyMemberToCentre(userId: string, tenantId: string, marker: string | null): Promise<void> {
  const centreUrl = clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD);
  await copyRow(process.env.DATABASE_URL!, centreUrl, 'users', 'id', userId);
  const membershipRow = await withClient(process.env.DATABASE_URL!, async (client) => {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    const result = await client.query<{ id: string }>(
      'SELECT id FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, userId],
    );
    return result.rows[0];
  });
  if (!membershipRow) throw new Error('membership của tài khoản ở tenant A không tồn tại');
  await copyRow(process.env.DATABASE_URL!, centreUrl, 'tenant_memberships', 'id', membershipRow.id);
  if (marker !== null) {
    await withClient(centreUrl, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      await client.query('UPDATE users SET first_name = $1 WHERE id = $2', [marker, userId]);
    });
  }
}

async function countRows(
  connectionString: string,
  table: string,
  column: string,
  value: string,
): Promise<number> {
  return withClient(connectionString, async (client) => {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    const result = await client.query<{ count: string }>(
      `SELECT count(*) FROM ${quoted(table)} WHERE ${quoted(column)} = $1`,
      [value],
    );
    return Number(result.rows[0]!.count);
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1];
  if (!segment) throw new Error('access token không có phần payload');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('Các cổng tiền di trú ở kho riêng (đầu-cuối, issue #587)', () => {
  let app: INestApplication;
  let adminToken = '';
  let tenantAId = '';
  let registryAId = '';
  let teacherTokenA = '';
  let teacherUsername = '';
  let teacherId = '';
  let betterAuthSessionToken = '';
  let revokedTokenA = '';
  let dedicatedOnlyId = '';
  let dedicatedOnlyUsername = '';
  let dedicatedOnlyBaId = '';
  let dedicatedOnlyBaUsername = '';
  let sharedOnlyBaId = '';
  let sharedOnlyBaUsername = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const must = async (res: { status: number; body: unknown }, what: string) => {
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body as never;
  };

  beforeAll(async () => {
    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_A_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_A_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
      await admin.query(`CREATE ROLE ${CP_ROLE} LOGIN PASSWORD '${CP_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${CENTRE_A_ROLE} LOGIN PASSWORD '${CENTRE_A_PASSWORD}'`);
      await admin.query(`CREATE DATABASE ${CP_DATABASE} OWNER ${CP_ROLE}`);
      await admin.query(`CREATE DATABASE ${CENTRE_A_DATABASE} OWNER ${CENTRE_A_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CP_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CP_DATABASE} TO ${CP_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CENTRE_A_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CENTRE_A_DATABASE} TO ${CENTRE_A_ROLE}`);
    });
    await applyControlPlaneMigrations(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD));
    await applyBusinessBaseline(clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD));

    process.env.CONTROL_PLANE_DATABASE_URL = clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD);
    process.env.SPACE_TEST_A_587_URL = clusterUrl('postgres', CENTRE_A_ROLE, CENTRE_A_PASSWORD);

    const cpPool = new Pool({ connectionString: clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD) });
    const cpDb = createControlPlaneKysely(cpPool);
    try {
      const inserted = await cpDb
        .insertInto('space_registry')
        .values([
          {
            slug: CENTRE_A_SLUG,
            name: 'Trung tâm A 587',
            kind: 'center',
            status: 'active',
            database_name: CENTRE_A_DATABASE,
            storage_mode: 'dedicated',
            connection_role_ref: CENTRE_A_ROLE,
            secret_ref: 'env:SPACE_TEST_A_587_URL',
            schema_version: 'v1',
          },
        ])
        .returning('id')
        .execute();
      registryAId = inserted[0]!.id;
    } finally {
      await cpDb.destroy();
    }

    helpers = await import('../../support/identity-access-helpers');
    app = await createMountedTestApp();
    adminToken = (await helpers.login(app, 'admin', 'Admin123!')).accessToken;

    tenantAId = await seedLegacyCentreInShared({ slug: CENTRE_A_SLUG, name: 'Trung tâm A (spec 587)' });
    await copyRow(
      process.env.DATABASE_URL!,
      clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD),
      'tenants',
      'id',
      tenantAId,
    );

    const teacher = await helpers.createUserViaApi(app, adminToken);
    teacherUsername = teacher.username;
    teacherId = teacher.id;
    await helpers.seedTenantMembershipFixture(app, tenantAId, teacher.id);
    await copyMemberToCentre(teacher.id, tenantAId, CENTRE_A_FIRST_NAME);

    betterAuthSessionToken = `ba587-${RUN_SUFFIX}-${randomUUID()}`;
    await withClient(clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD), async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      await client.query(
        `INSERT INTO "session" (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [betterAuthSessionToken, teacherId],
      );
    });

    const teacherLoginA = (await must(
      await helpers.http(app).post('/api/v1/auth/token').set('Host', HOST_A)
        .send({ username: teacherUsername, password: helpers.STRONG_PASSWORD }),
      'login teacher at centre A',
    )) as { accessToken: string };
    teacherTokenA = teacherLoginA.accessToken;

    const dedicatedOnly = await helpers.createUserViaApi(app, adminToken);
    dedicatedOnlyId = dedicatedOnly.id;
    dedicatedOnlyUsername = dedicatedOnly.username;
    await helpers.seedTenantMembershipFixture(app, tenantAId, dedicatedOnlyId);
    await copyMemberToCentre(dedicatedOnlyId, tenantAId, null);
    await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      await client.query('DELETE FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2', [
        tenantAId,
        dedicatedOnlyId,
      ]);
      await client.query('DELETE FROM users WHERE id = $1', [dedicatedOnlyId]);
    });

    const { CredentialBridgeService: BridgeClass } = await import(
      '../../../src/modules/auth/better-auth/credential-bridge.service'
    );
    const bridge = app.get(BridgeClass);
    const baUsername = helpers.uniqueName('bauser587');
    const baCreated = await bridge.createUserWithCredential({
      email: `${baUsername}@example.com`,
      username: baUsername,
      firstName: 'Test',
      lastName: 'User',
      password: helpers.STRONG_PASSWORD,
    });
    dedicatedOnlyBaId = baCreated.id;
    dedicatedOnlyBaUsername = baUsername;
    await helpers.seedTenantMembershipFixture(app, tenantAId, dedicatedOnlyBaId);
    await copyMemberToCentre(dedicatedOnlyBaId, tenantAId, 'DauAnKhoBA587');
    await copyRow(
      process.env.DATABASE_URL!,
      clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD),
      'account',
      'user_id',
      dedicatedOnlyBaId,
    );
    await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      await client.query('DELETE FROM account WHERE user_id = $1', [dedicatedOnlyBaId]);
      await client.query('DELETE FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2', [
        tenantAId,
        dedicatedOnlyBaId,
      ]);
      await client.query('DELETE FROM users WHERE id = $1', [dedicatedOnlyBaId]);
    });

    const sharedBaUsername = helpers.uniqueName('sharedba587');
    const sharedBaCreated = await bridge.createUserWithCredential({
      email: `${sharedBaUsername}@example.com`,
      username: sharedBaUsername,
      firstName: 'Test',
      lastName: 'User',
      password: helpers.STRONG_PASSWORD,
    });
    sharedOnlyBaId = sharedBaCreated.id;
    sharedOnlyBaUsername = sharedBaUsername;

    const revoked = await helpers.createUserViaApi(app, adminToken);
    await helpers.seedTenantMembershipFixture(app, tenantAId, revoked.id);
    await copyMemberToCentre(revoked.id, tenantAId, null);
    const revokedLoginA = (await must(
      await helpers.http(app).post('/api/v1/auth/token').set('Host', HOST_A)
        .send({ username: revoked.username, password: helpers.STRONG_PASSWORD }),
      'login revocable user at centre A',
    )) as { accessToken: string };
    revokedTokenA = revokedLoginA.accessToken;
  }, 300_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    delete process.env.SPACE_TEST_A_587_URL;
    delete process.env.CONTROL_PLANE_DATABASE_URL;
    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_A_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_A_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
    }).catch(() => undefined);
  });

  it('token mang claim của trung tâm kho riêng đọc được hồ sơ từ kho đích', async () => {
    expect(decodeJwtPayload(teacherTokenA)['centre_id']).toBe(registryAId);
    expect(decodeJwtPayload(teacherTokenA)['tid']).toBe(tenantAId);

    const res = await helpers.http(app).get('/api/v1/users/me').set('Host', HOST_A).set(auth(teacherTokenA));

    expect(res.status).toBe(200);
    expect((res.body as { firstName?: string }).firstName).toBe(CENTRE_A_FIRST_NAME);
  });

  it('token JWT cũ không claim của tài khoản chỉ còn ở kho riêng bị từ chối 401 auth.centre_mismatch', async () => {
    expect(await countRows(process.env.DATABASE_URL!, 'users', 'id', dedicatedOnlyId)).toBe(0);
    expect(await countRows(process.env.DATABASE_URL!, 'tenant_memberships', 'user_id', dedicatedOnlyId)).toBe(0);
    const centreUrl = clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD);
    expect(await countRows(centreUrl, 'users', 'id', dedicatedOnlyId)).toBe(1);
    expect(await countRows(centreUrl, 'tenant_memberships', 'user_id', dedicatedOnlyId)).toBe(1);

    const jwtService = app.get(JwtService);
    const oldToken = await jwtService.signAsync({
      sub: dedicatedOnlyId,
      username: dedicatedOnlyUsername,
      sid: randomUUID(),
      tid: tenantAId,
    });

    const res = await helpers.http(app).get('/api/v1/users/me').set('Host', HOST_A).set(auth(oldToken));

    expect(res.status).toBe(401);
    expect((res.body as { code?: string }).code).toBe('auth.centre_mismatch');
  });

  it('thành viên đã bị thu hồi ở kho đích bị từ chối 401 tenant.membership_inactive', async () => {
    const revokedUserId = decodeJwtPayload(revokedTokenA)['sub'] as string;
    const centreUrl = clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD);
    await withClient(centreUrl, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      await client.query("UPDATE tenant_memberships SET status = 'ended' WHERE tenant_id = $1 AND user_id = $2", [
        tenantAId,
        revokedUserId,
      ]);
    });

    const res = await helpers.http(app).get('/api/v1/users/me').set('Host', HOST_A).set(auth(revokedTokenA));

    expect(res.status).toBe(401);
    expect((res.body as { code?: string }).code).toBe('tenant.membership_inactive');
  });

  it('đăng nhập Better Auth tại địa chỉ kho riêng của tài khoản chỉ ở kho riêng ghi phiên vào kho đích', async () => {
    expect(await countRows(process.env.DATABASE_URL!, 'users', 'id', dedicatedOnlyBaId)).toBe(0);
    expect(await countRows(process.env.DATABASE_URL!, 'account', 'user_id', dedicatedOnlyBaId)).toBe(0);
    const centreUrl = clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD);
    expect(await countRows(centreUrl, 'users', 'id', dedicatedOnlyBaId)).toBe(1);
    expect(await countRows(centreUrl, 'account', 'user_id', dedicatedOnlyBaId)).toBe(1);

    const signIn = await helpers
      .http(app)
      .post('/api/v1/auth/sign-in/username')
      .set('Host', HOST_A)
      .set('Origin', 'http://localhost:5173')
      .send({ username: dedicatedOnlyBaUsername, password: helpers.STRONG_PASSWORD });
    expect(signIn.status).toBe(200);

    expect(await countRows(centreUrl, 'session', 'user_id', dedicatedOnlyBaId)).toBe(1);
    expect(await countRows(process.env.DATABASE_URL!, 'session', 'user_id', dedicatedOnlyBaId)).toBe(0);

    const me = await helpers
      .http(app)
      .get('/api/v1/users/me')
      .set('Host', HOST_A)
      .set('Cookie', sessionCookieFrom(signIn.headers['set-cookie'] as unknown as string[]));
    expect(me.status).toBe(200);
    expect((me.body as { firstName?: string }).firstName).toBe('DauAnKhoBA587');
  });

  it('phiên cookie Better Auth ở kho riêng đọc được hồ sơ qua địa chỉ của chính trung tâm', async () => {
    const me = await helpers
      .http(app)
      .get('/api/v1/users/me')
      .set('Host', HOST_A)
      .set('Cookie', signedBetterAuthCookie(betterAuthSessionToken));

    expect(me.status).toBe(200);
    expect((me.body as { firstName?: string }).firstName).toBe(CENTRE_A_FIRST_NAME);
  });

  it('tài khoản chỉ ở kho chung bị từ chối khi đăng nhập Better Auth tại địa chỉ của trung tâm kho riêng', async () => {
    expect(await countRows(process.env.DATABASE_URL!, 'users', 'id', sharedOnlyBaId)).toBe(1);
    expect(await countRows(process.env.DATABASE_URL!, 'account', 'user_id', sharedOnlyBaId)).toBe(1);
    const centreUrl = clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD);
    expect(await countRows(centreUrl, 'users', 'id', sharedOnlyBaId)).toBe(0);
    expect(await countRows(centreUrl, 'account', 'user_id', sharedOnlyBaId)).toBe(0);

    const signIn = await helpers
      .http(app)
      .post('/api/v1/auth/sign-in/username')
      .set('Host', HOST_A)
      .set('Origin', 'http://localhost:5173')
      .send({ username: sharedOnlyBaUsername, password: helpers.STRONG_PASSWORD });
    expect(signIn.status).toBe(401);
    expect((signIn.body as { code?: string }).code).toBe('INVALID_USERNAME_OR_PASSWORD');

    expect(await countRows(centreUrl, 'session', 'user_id', sharedOnlyBaId)).toBe(0);
    expect(await countRows(process.env.DATABASE_URL!, 'session', 'user_id', sharedOnlyBaId)).toBe(0);
  });

  it('đăng nhập Better Auth tại địa chỉ platform giữ nguyên hành vi: tài khoản kho chung vào được, tài khoản chỉ ở kho riêng bị từ chối', async () => {
    const centreUrl = clusterUrl(CENTRE_A_DATABASE, CENTRE_A_ROLE, CENTRE_A_PASSWORD);

    const sharedSignIn = await helpers
      .http(app)
      .post('/api/v1/auth/sign-in/username')
      .set('Origin', 'http://localhost:5173')
      .send({ username: sharedOnlyBaUsername, password: helpers.STRONG_PASSWORD });
    expect(sharedSignIn.status).toBe(200);
    expect(await countRows(process.env.DATABASE_URL!, 'session', 'user_id', sharedOnlyBaId)).toBe(1);
    expect(await countRows(centreUrl, 'session', 'user_id', sharedOnlyBaId)).toBe(0);

    const dedicatedSignIn = await helpers
      .http(app)
      .post('/api/v1/auth/sign-in/username')
      .set('Origin', 'http://localhost:5173')
      .send({ username: dedicatedOnlyBaUsername, password: helpers.STRONG_PASSWORD });
    expect(dedicatedSignIn.status).toBe(401);
    expect((dedicatedSignIn.body as { code?: string }).code).toBe('INVALID_USERNAME_OR_PASSWORD');
  });
});
