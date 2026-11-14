import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createControlPlaneKysely } from '@giaokhoa/db/control-plane';
import { SpaceDatabaseService } from '../../../src/db/routing/space-database.service';
import { PermissionEvaluator } from '../../../src/modules/access/permission-evaluator.service';
import { RolesService } from '../../../src/modules/access/roles.service';
import { ContextsService } from '../../../src/modules/access/contexts.service';
import { tenantAls } from '../../../src/modules/tenants/tenant-als';
import { TenantsService } from '../../../src/modules/tenants/tenants.service';
import { UsersService } from '../../../src/modules/users/users.service';
import {
  STRONG_PASSWORD,
  createTestApp,
  http,
  login,
  uniqueName,
} from '../../support/identity-access-helpers';

const RUN_SUFFIX = Math.random().toString(36).slice(2, 8);
const CP_DATABASE = `giaokhoa_test_cp_td6_${RUN_SUFFIX}`;
const CP_ROLE = 'giaokhoa_cp_test_td6';
const CP_PASSWORD = 'cp-test-td6';
const CENTRE_DATABASE = `giaokhoa_test_centre_td6_${RUN_SUFFIX}`;
const CENTRE_ROLE = 'giaokhoa_centre_td6_app';
const CENTRE_PASSWORD = 'centre-test-td6';
const CENTRE_SLUG = `trung-tam-td6-${RUN_SUFFIX}`;
const HOST = `${CENTRE_SLUG}.test.local`;

const CENTRE_B_DATABASE = 'giaokhoa_test_centre_td6_b_' + RUN_SUFFIX;
const CENTRE_B_ROLE = 'giaokhoa_centre_td6b_app';
const CENTRE_B_PASSWORD = 'centre-test-td6b';
const CENTRE_B_SLUG = 'trung-tam-td6-b-' + RUN_SUFFIX;
const HOST_B = CENTRE_B_SLUG + '.test.local';
const SECOND_PASSWORD = 'SecondStrong123!';

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

async function countRows(connectionString: string, table: string, column: string, value: string): Promise<number> {
  return withClient(connectionString, async (client) => {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    const result = await client.query<{ count: string }>(
      `SELECT count(*) FROM ${quoted(table)} WHERE ${quoted(column)} = $1`,
      [value],
    );
    return Number(result.rows[0]!.count);
  });
}

describe('Phân tách quyền vận hành và dữ liệu trung tâm qua HTTP (issue #9)', () => {
  let app: INestApplication;
  let adminToken = '';
  let tenantId = '';
  let centreAdminId = '';
  let centreAdminUsername = '';
  let centreAdminToken = '';
  let tenantBId = '';
  let centreBAdminId = '';
  let centreBAdminUsername = '';
  let centreBAdminToken = '';

  const centreUrl = () => clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD);
  const centreBUrl = () => clusterUrl(CENTRE_B_DATABASE, CENTRE_B_ROLE, CENTRE_B_PASSWORD);
  const cpUrl = () => clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const loginAt = async (host: string, username: string, password: string) => {
    const res = await http(app).post('/api/v1/auth/token').set('Host', host).send({ username, password });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`login at ${host} failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body as { accessToken: string; refreshToken: string };
  };

  beforeAll(async () => {
    await withClient(clusterUrl('postgres'), async (admin) => {
      const leftovers = await admin.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname ~ '^giaokhoa_test_(cp|centre)_td6_'",
      );
      for (const row of leftovers.rows) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(row.datname)} WITH (FORCE)`);
      }
      for (const database of [CP_DATABASE, CENTRE_DATABASE, CENTRE_B_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_ROLE, CENTRE_B_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
      await admin.query(`CREATE ROLE ${quoted(CP_ROLE)} LOGIN PASSWORD '${CP_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${quoted(CENTRE_ROLE)} LOGIN PASSWORD '${CENTRE_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${quoted(CENTRE_B_ROLE)} LOGIN PASSWORD '${CENTRE_B_PASSWORD}'`);
      await admin.query(`CREATE DATABASE ${quoted(CP_DATABASE)} OWNER ${quoted(CP_ROLE)}`);
      await admin.query(`CREATE DATABASE ${quoted(CENTRE_DATABASE)} OWNER ${quoted(CENTRE_ROLE)}`);
      await admin.query(`CREATE DATABASE ${quoted(CENTRE_B_DATABASE)} OWNER ${quoted(CENTRE_B_ROLE)}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${quoted(CP_DATABASE)} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${quoted(CP_DATABASE)} TO ${quoted(CP_ROLE)}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${quoted(CENTRE_DATABASE)} FROM PUBLIC`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${quoted(CENTRE_B_DATABASE)} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${quoted(CENTRE_DATABASE)} TO ${quoted(CENTRE_ROLE)}`);
      await admin.query(`GRANT CONNECT ON DATABASE ${quoted(CENTRE_B_DATABASE)} TO ${quoted(CENTRE_B_ROLE)}`);
    });
    await applyControlPlaneMigrations(cpUrl());
    await applyBusinessBaseline(centreUrl());
    await applyBusinessBaseline(centreBUrl());

    process.env.CONTROL_PLANE_DATABASE_URL = cpUrl();
    process.env.SPACE_TEST_TD6_URL = clusterUrl('postgres', CENTRE_ROLE, CENTRE_PASSWORD);
    process.env.SPACE_TEST_TD6B_URL = clusterUrl('postgres', CENTRE_B_ROLE, CENTRE_B_PASSWORD);

    const cpPool = new Pool({ connectionString: cpUrl() });
    const cpDb = createControlPlaneKysely(cpPool);
    try {
      await cpDb.insertInto('space_registry').values([
        {
          slug: CENTRE_SLUG,
          name: 'Trung tâm TĐ6',
          kind: 'center',
          status: 'active',
          database_name: CENTRE_DATABASE,
          storage_mode: 'dedicated',
          connection_role_ref: CENTRE_ROLE,
          secret_ref: 'env:SPACE_TEST_TD6_URL',
          schema_version: 'v1',
        },
        {
          slug: CENTRE_B_SLUG,
          name: 'Trung tâm B TĐ6',
          kind: 'center',
          status: 'active',
          database_name: CENTRE_B_DATABASE,
          storage_mode: 'dedicated',
          connection_role_ref: CENTRE_B_ROLE,
          secret_ref: 'env:SPACE_TEST_TD6B_URL',
          schema_version: 'v1',
        },
      ]).execute();
    } finally {
      await cpDb.destroy();
    }

    await withClient(centreUrl(), async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const system = await client.query<{ id: string }>(
        "INSERT INTO context (context_level, instance_id, path, depth) VALUES (10, NULL, '', 0) RETURNING id",
      );
      const systemContextId = system.rows[0]!.id;
      await client.query('UPDATE context SET path = $1, depth = 1 WHERE id = $2', [`/${systemContextId}`, systemContextId]);
      const tenant = await client.query<{ id: string }>(
        "INSERT INTO tenants (slug, name, kind, status, plan) VALUES ($1, $2, 'center', 'active', NULL) RETURNING id",
        [CENTRE_SLUG, 'Trung tâm TĐ6 (spec 587)'],
      );
      tenantId = tenant.rows[0]!.id;
      const tenantContext = await client.query<{ id: string }>(
        "INSERT INTO context (context_level, instance_id, path, depth) VALUES (20, $1, '', 0) RETURNING id",
        [tenantId],
      );
      const tenantContextId = tenantContext.rows[0]!.id;
      await client.query('UPDATE context SET path = $1, depth = 2 WHERE id = $2', [
        `/${systemContextId}/${tenantContextId}`,
        tenantContextId,
      ]);
    });

    await withClient(centreBUrl(), async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const system = await client.query<{ id: string }>(
        "INSERT INTO context (context_level, instance_id, path, depth) VALUES (10, NULL, '', 0) RETURNING id",
      );
      const systemContextId = system.rows[0]!.id;
      await client.query('UPDATE context SET path = $1, depth = 1 WHERE id = $2', [`/${systemContextId}`, systemContextId]);
      const tenant = await client.query<{ id: string }>(
        "INSERT INTO tenants (slug, name, kind, status, plan) VALUES ($1, $2, 'center', 'active', NULL) RETURNING id",
        [CENTRE_B_SLUG, 'Trung tâm B TĐ6 (spec 9)'],
      );
      tenantBId = tenant.rows[0]!.id;
      const tenantContext = await client.query<{ id: string }>(
        "INSERT INTO context (context_level, instance_id, path, depth) VALUES (20, $1, '', 0) RETURNING id",
        [tenantBId],
      );
      const tenantContextId = tenantContext.rows[0]!.id;
      await client.query('UPDATE context SET path = $1, depth = 2 WHERE id = $2', [
        `/${systemContextId}/${tenantContextId}`,
        tenantContextId,
      ]);
    });

    app = await createTestApp();
    adminToken = (await login(app, 'admin', 'Admin123!')).accessToken;

    const spaceDb = app.get(SpaceDatabaseService, { strict: false });
    const users = app.get(UsersService, { strict: false });
    const tenants = app.get(TenantsService, { strict: false });
    centreAdminUsername = uniqueName('admintd6');
    const adminUser = await spaceDb.withSpaceKysely(
      CENTRE_SLUG,
      async () => {
        const user = await users.createUser({
          username: centreAdminUsername,
          email: `${centreAdminUsername}@example.com`,
          password: STRONG_PASSWORD,
          firstName: 'QuanTri',
          lastName: 'Td6',
        });
        await tenants.ensureActiveMembership(tenantId, user.id);
        return user;
      },
      { tenantId },
    );
    centreAdminId = adminUser.id;
    await withClient(centreUrl(), async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      await client.query('INSERT INTO config (key, value) VALUES ($1, $2::jsonb)', [
        'siteadmins',
        JSON.stringify([centreAdminId]),
      ]);
    });
    centreAdminToken = (await loginAt(HOST, centreAdminUsername, STRONG_PASSWORD)).accessToken;
    centreBAdminUsername = centreAdminUsername;
    const adminUserB = await spaceDb.withSpaceKysely(
      CENTRE_B_SLUG,
      async () => {
        const user = await users.createUser({
          username: centreBAdminUsername,
          email: `${centreBAdminUsername}@example.com`,
          password: SECOND_PASSWORD,
          firstName: 'QuanTri',
          lastName: 'Td6',
        });
        await tenants.ensureActiveMembership(tenantBId, user.id);
        return user;
      },
      { tenantId: tenantBId },
    );
    centreBAdminId = adminUserB.id;
    await withClient(centreBUrl(), async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      await client.query('INSERT INTO config (key, value) VALUES ($1, $2::jsonb)', [
        'siteadmins',
        JSON.stringify([centreBAdminId]),
      ]);
    });
    centreBAdminToken = (await loginAt(HOST_B, centreBAdminUsername, SECOND_PASSWORD)).accessToken;
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.SPACE_TEST_TD6_URL;
    delete process.env.SPACE_TEST_TD6B_URL;
  });

  it('trung tâm chỉ có ở kho riêng: quản trị trung tâm tạo được người dùng qua endpoint thật và mọi lượt đọc quản trị thấy dữ kiện tại kho đích', async () => {
    expect(await countRows(process.env.DATABASE_URL!, 'tenants', 'id', tenantId)).toBe(0);
    expect(await countRows(process.env.DATABASE_URL!, 'tenants', 'slug', CENTRE_SLUG)).toBe(0);

    const username = uniqueName('giaovientd6');
    const created = await http(app)
      .post(`/api/v1/tenants/${tenantId}/users`)
      .set('Host', HOST)
      .set(auth(centreAdminToken))
      .send({
        username,
        email: `${username}@example.com`,
        password: STRONG_PASSWORD,
        firstName: 'GiaoVien',
        lastName: 'Td6',
      });
    expect(created.status).toBe(201);
    const createdBody = created.body as { id: string; username: string };
    expect(createdBody.username).toBe(username);

    expect(await countRows(centreUrl(), 'users', 'id', createdBody.id)).toBe(1);
    expect(await countRows(process.env.DATABASE_URL!, 'users', 'id', createdBody.id)).toBe(0);
    expect(await countRows(centreUrl(), 'tenant_memberships', 'user_id', createdBody.id)).toBe(1);

    const directoryTables = await withClient(cpUrl(), async (client) => {
      const result = await client.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('space_membership_directory', 'space_join_code_directory')",
      );
      return result.rows;
    });
    expect(directoryTables).toHaveLength(0);

    const detail = await http(app).get(`/api/v1/tenants/${tenantId}`).set('Host', HOST).set(auth(centreAdminToken));
    expect(detail.status).toBe(200);
    expect((detail.body as { slug: string }).slug).toBe(CENTRE_SLUG);

    const userList = await http(app)
      .get(`/api/v1/tenants/${tenantId}/users`)
      .set('Host', HOST)
      .set(auth(centreAdminToken));
    expect(userList.status).toBe(200);
    const usernames = (userList.body as { username: string }[]).map((u) => u.username);
    expect(usernames).toContain(centreAdminUsername);
    expect(usernames).toContain(username);

    const memberList = await http(app)
      .get(`/api/v1/tenants/${tenantId}/members`)
      .set('Host', HOST)
      .set(auth(centreAdminToken));
    expect(memberList.status).toBe(200);
    const memberIds = (memberList.body as { userId: string }[]).map((m) => m.userId);
    expect(memberIds).toContain(centreAdminId);
    expect(memberIds).toContain(createdBody.id);
  });

  it('quản trị A/B thêm, đình chỉ và kích hoạt thành viên chỉ trong kho mình; platform và token chéo bị chặn', async () => {
    const spaceDb = app.get(SpaceDatabaseService, { strict: false });
    const users = app.get(UsersService, { strict: false });
    const candidate = async (slug: string, tid: string, label: string) => {
      const username = uniqueName(label);
      return spaceDb.withSpaceKysely(slug, () => users.createUser({
        username,
        email: username + '@example.com',
        password: STRONG_PASSWORD,
        firstName: 'Nguoi',
        lastName: 'Moi',
      }), { tenantId: tid });
    };
    const userA = await candidate(CENTRE_SLUG, tenantId, 'hoivienA');
    const userB = await candidate(CENTRE_B_SLUG, tenantBId, 'hoivienB');

    const addA = await http(app).post(`/api/v1/tenants/${tenantId}/members`)
      .set('Host', HOST).set(auth(centreAdminToken)).send({ userId: userA.id });
    expect(addA.status, JSON.stringify(addA.body)).toBe(201);
    expect(addA.body.status).toBe('active');

    const suspended = await http(app).patch(`/api/v1/tenants/${tenantId}/members/${userA.id}`)
      .set('Host', HOST).set(auth(centreAdminToken)).send({ status: 'suspended' });
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    expect(suspended.body.status).toBe('suspended');

    const restored = await http(app).patch(`/api/v1/tenants/${tenantId}/members/${userA.id}`)
      .set('Host', HOST).set(auth(centreAdminToken)).send({ status: 'active' });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body.status).toBe('active');

    const addB = await http(app).post(`/api/v1/tenants/${tenantBId}/members`)
      .set('Host', HOST_B).set(auth(centreBAdminToken)).send({ userId: userB.id });
    expect(addB.status, JSON.stringify(addB.body)).toBe(201);
    expect(addB.body.status).toBe('active');

    expect(await countRows(centreUrl(), 'tenant_memberships', 'user_id', userA.id)).toBe(1);
    expect(await countRows(centreBUrl(), 'tenant_memberships', 'user_id', userA.id)).toBe(0);
    expect(await countRows(process.env.DATABASE_URL!, 'tenant_memberships', 'user_id', userA.id)).toBe(0);
    expect(await countRows(centreBUrl(), 'tenant_memberships', 'user_id', userB.id)).toBe(1);
    expect(await countRows(centreUrl(), 'tenant_memberships', 'user_id', userB.id)).toBe(0);
    expect(await countRows(process.env.DATABASE_URL!, 'tenant_memberships', 'user_id', userB.id)).toBe(0);

    for (const token of [adminToken, centreBAdminToken]) {
      const deniedAdd = await http(app).post(`/api/v1/tenants/${tenantId}/members`)
        .set('Host', HOST).set(auth(token)).send({ userId: userA.id });
      expect([401, 403]).toContain(deniedAdd.status);
      const deniedPatch = await http(app).patch(`/api/v1/tenants/${tenantId}/members/${userA.id}`)
        .set('Host', HOST).set(auth(token)).send({ status: 'ended' });
      expect([401, 403]).toContain(deniedPatch.status);
    }
    const check = await http(app).get(`/api/v1/tenants/${tenantId}/members`)
      .set('Host', HOST).set(auth(centreAdminToken));
    expect(check.status).toBe(200);
    expect((check.body as { userId: string; status: string }[])
      .find((member) => member.userId === userA.id)?.status).toBe('active');
  });

  it('hai trung tâm có tài khoản cùng tên/email nhưng không liên kết, không đọc chéo và không dùng chung mật khẩu', async () => {
    expect(await countRows(process.env.DATABASE_URL!, 'tenants', 'slug', CENTRE_B_SLUG)).toBe(0);
    expect(await countRows(centreUrl(), 'users', 'username', centreAdminUsername)).toBe(1);
    expect(await countRows(centreBUrl(), 'users', 'username', centreAdminUsername)).toBe(1);
    expect(centreBAdminId).not.toBe(centreAdminId);

    const wrongBPassword = await http(app)
      .post('/api/v1/auth/token')
      .set('Host', HOST_B)
      .send({ username: centreAdminUsername, password: STRONG_PASSWORD });
    expect(wrongBPassword.status).toBe(401);

    const wrongAPassword = await http(app)
      .post('/api/v1/auth/token')
      .set('Host', HOST)
      .send({ username: centreAdminUsername, password: SECOND_PASSWORD });
    expect(wrongAPassword.status).toBe(401);

    const ownB = await http(app).get('/api/v1/tenants/' + tenantBId + '/users')
      .set('Host', HOST_B).set(auth(centreBAdminToken));
    expect(ownB.status).toBe(200);

    const ownA = await http(app).get('/api/v1/tenants/' + tenantId + '/users')
      .set('Host', HOST).set(auth(centreAdminToken));
    expect(ownA.status).toBe(200);

    const crossedA = await http(app).get('/api/v1/tenants/' + tenantId + '/users')
      .set('Host', HOST_B).set(auth(centreBAdminToken));
    expect(crossedA.status).not.toBe(200);
    const crossedB = await http(app).get('/api/v1/tenants/' + tenantBId + '/users')
      .set('Host', HOST).set(auth(centreAdminToken));
    expect(crossedB.status).not.toBe(200);

    const reusedToken = await http(app).get('/api/v1/tenants/' + tenantBId + '/users')
      .set('Host', HOST_B).set(auth(centreAdminToken));
    expect([401, 403]).toContain(reusedToken.status);

    const username = uniqueName('giaovienb');
    const createdB = await http(app).post('/api/v1/tenants/' + tenantBId + '/users')
      .set('Host', HOST_B).set(auth(centreBAdminToken))
      .send({
        username,
        email: username + '@example.com',
        password: SECOND_PASSWORD,
        firstName: 'GiaoVien',
        lastName: 'TrungTamB',
      });
    expect(createdB.status).toBe(201);
    expect(await countRows(centreBUrl(), 'users', 'username', username)).toBe(1);
    expect(await countRows(centreUrl(), 'users', 'username', username)).toBe(0);
    expect(await countRows(process.env.DATABASE_URL!, 'users', 'username', username)).toBe(0);

    const tables = await withClient(cpUrl(), async (client) =>
      (await client.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('space_membership_directory','space_join_code_directory')",
      )).rows,
    );
    expect(tables).toHaveLength(0);
  });

  it('mã tham gia trùng chuỗi tại A/B chỉ phân giải và kết nạp vào lớp trong kho của Host', async () => {
    const spaceDb = app.get(SpaceDatabaseService, { strict: false });
    const users = app.get(UsersService, { strict: false });
    const tenants = app.get(TenantsService, { strict: false });
    const roles = app.get(RolesService, { strict: false });
    const contexts = app.get(ContextsService, { strict: false });

    for (const [slug, tid, adminId] of [
      [CENTRE_SLUG, tenantId, centreAdminId],
      [CENTRE_B_SLUG, tenantBId, centreBAdminId],
    ] as const) {
      await tenantAls.run({ platform: true }, () =>
        spaceDb.withSpaceKysely(slug, async () => {
          await roles.seedDefaults();
          const manager = await roles.getRoleByShortname('manager');
          if (!manager) throw new Error('Thiếu vai manager của kho trung tâm');
          const ctx = await contexts.ensureTenantContext(tid);
          await roles.assignRole(adminId, manager.id, ctx.id);
        }, { tenantId: tid }),
      );
    }

    const createOpenClass = async (host: string, token: string, name: string) => {
      const created = await http(app).post('/api/v1/classes')
        .set('Host', host).set(auth(token)).send({ name });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = (created.body as { id: string }).id;
      const updated = await http(app).patch(`/api/v1/classes/${id}`)
        .set('Host', host).set(auth(token))
        .send({ allowSelfReport: true, joinAutoApprove: true });
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      return id;
    };
    const classA = await createOpenClass(HOST, centreAdminToken, 'Lớp chỉ ở A');
    const classB = await createOpenClass(HOST_B, centreBAdminToken, 'Lớp chỉ ở B');
    const classAOnly = await createOpenClass(HOST, centreAdminToken, 'Lớp A có mã khác');

    const sharedCode = 'SHR' + RUN_SUFFIX.toUpperCase();
    const onlyACode = 'ONE' + RUN_SUFFIX.toUpperCase();
    for (const [url, classId, code] of [
      [centreUrl(), classA, sharedCode],
      [centreBUrl(), classB, sharedCode],
      [centreUrl(), classAOnly, onlyACode],
    ]) {
      await withClient(url, async (client) => {
        await client.query("SELECT set_config('app.platform', 'on', false)");
        await client.query('UPDATE classes SET join_code = $1 WHERE id = $2', [code, classId]);
      });
    }

    const studentIn = async (slug: string, tid: string, host: string, label: string) => {
      const username = uniqueName(label);
      await spaceDb.withSpaceKysely(slug, async () => {
        const student = await users.createUser({
          username, email: username + '@example.com', password: STRONG_PASSWORD,
          firstName: 'Hoc', lastName: 'Sinh',
        });
        await tenants.ensureActiveMembership(tid, student.id);
      }, { tenantId: tid });
      return (await loginAt(host, username, STRONG_PASSWORD)).accessToken;
    };
    const studentA = await studentIn(CENTRE_SLUG, tenantId, HOST, 'studentA');
    const studentB = await studentIn(CENTRE_B_SLUG, tenantBId, HOST_B, 'studentB');

    const previewA = await http(app).get('/api/v1/classes/join-preview')
      .query({ code: sharedCode }).set('Host', HOST).set(auth(studentA));
    expect(previewA.status, JSON.stringify(previewA.body)).toBe(200);
    expect(previewA.body.classId).toBe(classA);
    const previewB = await http(app).get('/api/v1/classes/join-preview')
      .query({ code: sharedCode }).set('Host', HOST_B).set(auth(studentB));
    expect(previewB.status, JSON.stringify(previewB.body)).toBe(200);
    expect(previewB.body.classId).toBe(classB);
    expect(classA).not.toBe(classB);

    const joinedA = await http(app).post('/api/v1/classes/join')
      .set('Host', HOST).set(auth(studentA)).send({ joinCode: sharedCode });
    expect(joinedA.status, JSON.stringify(joinedA.body)).toBe(201);
    expect(joinedA.body).toMatchObject({ outcome: 'joined', class: { id: classA } });
    const joinedB = await http(app).post('/api/v1/classes/join')
      .set('Host', HOST_B).set(auth(studentB)).send({ joinCode: sharedCode });
    expect(joinedB.status, JSON.stringify(joinedB.body)).toBe(201);
    expect(joinedB.body).toMatchObject({ outcome: 'joined', class: { id: classB } });

    const aOnly = await http(app).get('/api/v1/classes/join-preview')
      .query({ code: onlyACode }).set('Host', HOST).set(auth(studentA));
    expect(aOnly.status).toBe(200);
    expect(aOnly.body.classId).toBe(classAOnly);
    const deniedPreview = await http(app).get('/api/v1/classes/join-preview')
      .query({ code: onlyACode }).set('Host', HOST_B).set(auth(studentB));
    expect(deniedPreview.status).toBe(404);
    expect(deniedPreview.body.code).toBe('class.join_code_invalid');
    const deniedJoin = await http(app).post('/api/v1/classes/join')
      .set('Host', HOST_B).set(auth(studentB)).send({ joinCode: onlyACode });
    expect(deniedJoin.status).toBe(404);
    expect(deniedJoin.body.code).toBe('class.join_code_invalid');

    const wrongHostToken = await http(app).post('/api/v1/classes/join')
      .set('Host', HOST_B).set(auth(studentA)).send({ joinCode: sharedCode });
    expect([401, 403]).toContain(wrongHostToken.status);
    const membershipCount = async (url: string, classId: string) => withClient(url, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const result = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM cohort_members cm JOIN classes c ON c.cohort_id = cm.cohort_id WHERE c.id = $1',
        [classId],
      );
      return result.rows[0]!.count;
    });
    expect(await membershipCount(centreUrl(), classA)).toBe(1);
    expect(await membershipCount(centreBUrl(), classB)).toBe(1);
    expect(await membershipCount(centreUrl(), classAOnly)).toBe(0);
  });

  it('quản trị platform không được quyền quản trị nghiệp vụ kho riêng dù cache danh tính đã ấm', async () => {
    const evaluator = app.get(PermissionEvaluator, { strict: false });
    const spaceDb = app.get(SpaceDatabaseService, { strict: false });

    const sharedAdmins = await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const result = await client.query<{ value: unknown }>("SELECT value FROM config WHERE key = 'siteadmins'");
      return Array.isArray(result.rows[0]?.value) ? (result.rows[0]!.value as unknown[]).map((v) => String(v)) : [];
    });
    expect(sharedAdmins.length).toBeGreaterThan(0);
    expect(sharedAdmins).not.toContain(centreAdminId);
    const sharedAdminId = sharedAdmins[0]!;

    await tenantAls.run({ platform: true }, async () => {
      expect(await evaluator.isSiteAdmin(sharedAdminId)).toBe(true);
      expect(await evaluator.isSiteAdmin(centreAdminId)).toBe(false);
    });
    await spaceDb.withSpaceKysely(
      CENTRE_SLUG,
      async () => {
        expect(await evaluator.isSiteAdmin(centreAdminId)).toBe(true);
        expect(await evaluator.isSiteAdmin(sharedAdminId)).toBe(false);
      },
      { tenantId },
    );

    await tenantAls.run({ platform: true }, async () => {
      expect(await evaluator.isSiteAdmin(sharedAdminId)).toBe(true);
      expect(await evaluator.isSiteAdmin(centreAdminId)).toBe(false);
    });
  });

  it('HTTP từ nhân sự platform bị từ chối khi đọc hồ sơ, thành viên và lớp của trung tâm; quản trị trung tâm vẫn được đọc', async () => {
    for (const path of [
      `/api/v1/tenants/${tenantId}`,
      `/api/v1/tenants/${tenantId}/members`,
      `/api/v1/tenants/${tenantId}/users`,
      '/api/v1/classes',
    ]) {
      const denied = await http(app).get(path).set('Host', HOST).set(auth(adminToken));
      expect([401, 403]).toContain(denied.status);
      const allowed = await http(app).get(path).set('Host', HOST).set(auth(centreAdminToken));
      expect(allowed.status, `Quản trị trung tâm phải đọc được ${path}`).toBe(200);
    }
    for (const path of [
      `/api/v1/assignments/${randomUUID()}/submissions`,
      `/api/v1/courses/${randomUUID()}/gradebook/report`,
    ]) {
      const denied = await http(app).get(path).set('Host', HOST).set(auth(adminToken));
      expect([401, 403]).toContain(denied.status);
    }
  });

  it('cổng đăng nhập platform ghim kho chung: quản trị trung tâm gọi tại địa chỉ trung tâm mình vẫn bị 403 auth.platform_admin_required', async () => {
    const res = await http(app)
      .post('/api/v1/auth/platform/login')
      .set('Host', HOST)
      .send({ username: centreAdminUsername, password: STRONG_PASSWORD });
    expect(res.status).toBe(403);
    expect((res.body as { code?: string }).code).toBe('auth.platform_admin_required');
    expect((res.body as { accessToken?: string }).accessToken).toBeUndefined();

    const wrongPassword = await http(app)
      .post('/api/v1/auth/platform/login')
      .set('Host', HOST)
      .send({ username: centreAdminUsername, password: 'WrongPassword!1234' });
    expect(wrongPassword.status).toBe(401);
    expect((wrongPassword.body as { code?: string }).code).toBe('auth.invalid_credentials');
  });

  it('nhân sự platform không được tạo trường ở kho chung để cấp người dùng và xem hồ sơ', async () => {
    const slug = `truong-td6-${RUN_SUFFIX}`;
    const before = await countRows(process.env.DATABASE_URL!, 'tenants', 'slug', slug);
    expect(before).toBe(0);
    const denied = await http(app)
      .post('/api/v1/tenants')
      .set(auth(adminToken))
      .send({ name: 'Trường TĐ6 (spec 587)', slug, kind: 'school' });
    expect(denied.status).toBe(400);
    expect((denied.body as { code?: string }).code).toBe('centre.provision_required');
    expect(await countRows(process.env.DATABASE_URL!, 'tenants', 'slug', slug)).toBe(0);
  });

  it('id tenant không tồn tại ở bất kỳ kho nào: gọi tại địa chỉ kho riêng và tại địa chỉ platform đều vẫn 404 tenant.not_found', async () => {
    const missingId = randomUUID();
    const username = uniqueName('khongtontai');
    const payload = {
      username,
      email: `${username}@example.com`,
      password: STRONG_PASSWORD,
      firstName: 'Khong',
      lastName: 'TonTai',
    };

    const atCentre = await http(app)
      .post(`/api/v1/tenants/${missingId}/users`)
      .set('Host', HOST)
      .set(auth(centreAdminToken))
      .send(payload);
    expect(atCentre.status).toBe(404);
    expect((atCentre.body as { code?: string }).code).toBe('tenant.not_found');

    const atPlatform = await http(app)
      .post(`/api/v1/tenants/${missingId}/users`)
      .set(auth(adminToken))
      .send(payload);
    expect(atPlatform.status).toBe(404);
    expect((atPlatform.body as { code?: string }).code).toBe('tenant.not_found');
  });
});
