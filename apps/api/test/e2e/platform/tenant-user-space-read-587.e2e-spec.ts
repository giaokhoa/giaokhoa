import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createControlPlaneKysely } from '@giaokhoa/db/control-plane';
import { SpaceDatabaseService } from '../../../src/db/routing/space-database.service';
import { PermissionEvaluator } from '../../../src/modules/access/permission-evaluator.service';
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

/**
 * Kiểm chứng HTTP về cô lập dữ liệu trung tâm (issue #9).
 *
 * Hai trung tâm có database, role, Host và siteadmins riêng trên
 * PostgreSQL thật; cùng username/email không kết nối tài khoản.
 * Control plane có registry vận hành nhưng không có thư mục
 * user hoặc mã tham gia. Quản trị platform được phép đọc sổ
 * vận hành nhưng không được đọc hồ sơ tại địa chỉ A hoặc B;
 * quản trị địa phương vẫn thao tác qua HTTP với chính kho mình.
 * Test giữ cache Redis giữa các lượt chạy để phát hiện rò cache
 * theo tên database, không xoá cache để làm bài test xanh.
 */
// Cô lập cache giữa các lượt chạy: khoá cache `siteadmins` của evaluator mang tên database của kho đang được đọc, nên mọi kho bài test này dựng đều mang tên duy nhất theo lượt chạy
// (RUN_SUFFIX) — khoá cache của lượt chạy này vì thế cũng duy
// nhất, lượt chạy sau không bao giờ trúng mục cache của lượt trước dù Redis được giữ nguyên, và bài test không cần (cũng không được) xoá khoá cache bằng tay để xanh. (Kho của lượt trước còn sót trên cụm được dọn ở beforeAll — chỉ database, không đụng tới Redis.)
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

/** Dựng URL kết nối tới một database trên cùng cụm với database nghiệp vụ test. */
function clusterUrl(database: string, username?: string, secret?: string): string {
  const base = new URL(process.env.DATABASE_URL!);
  base.pathname = `/${database}`;
  if (username) base.username = username;
  if (secret) base.password = secret;
  return base.toString();
}

/** Bọc một định danh Postgres trong dấu nháy kép cho các câu lệnh quản trị của ca test. */
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

/** Áp một file migration SQL (tách theo dấu phân đoạn của file) lên một database qua kết nối cho trước. */
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

/** Áp bộ migration riêng của control plane từ rỗng (đọc chính các file SQL đã sinh trong repo). */
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

/** Áp baseline nghiệp vụ vào kho riêng bằng kết nối của chính role chủ kho đó. */
async function applyBusinessBaseline(connectionString: string): Promise<void> {
  const baseline = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'centre', '20261025163710_baseline', 'migration.sql');
  await applySqlFile(connectionString, baseline, true);
}

/** Đếm dòng theo một cột định danh trong một bảng ở một kho (nền platform tường minh). */
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
    // Cấp phát control plane + kho riêng trên cụm test: role
    // riêng cho từng kho, CONNECT của PUBLIC bị thu hồi.
    await withClient(clusterUrl('postgres'), async (admin) => {
      // Dọn các kho của những lượt chạy trước còn sót lại: tên
      // kho mang hậu tố lượt chạy nên lượt này không gặp lại
      // đúng tên cũ; không dọn thì kho cũ còn giữ vai trò chủ
      // kho, bước DROP ROLE ở dưới vấp phụ thuộc và cả bài sập
      // trước ca đầu tiên. Chỉ dọn đúng tiền tố tên kho của bài
      // test này — Redis và mọi khoá cache không bị đụng tới,
      // nên điều kiện "chạy lại trên cùng một Redis giữ nguyên"
      // vẫn nguyên vẹn.
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

    // Dòng đăng ký kho riêng trong sổ, ghi trước khi ứng dụng
    // khởi động như các spec kho riêng trước.
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

    // Dữ kiện nền của trung tâm ghi THẲNG vào kho riêng, theo
    // đúng các bước nền của pipeline cấp phát: context hệ
    // thống, dòng tenant (id sinh tại kho đích), context
    // tenant. Kho chung không nhận bất kỳ dòng nào của trung
    // tâm này.
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

    // Quản trị đầu tiên của trung tâm: tạo bằng chính service
    // của ứng dụng bên trong kho của trung tâm, membership
    // trong cùng kho, và định danh quản trị nằm trong cấu hình
    // `siteadmins` của chính kho đó — đúng trạng thái pipeline
    // cấp phát để lại (quản trị của một kho là site admin của
    // kho đó, không có gán vai archetype nào được gieo thêm).
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
    // Tiền điều kiện của ca: kho chung không có dòng tenant của
    // trung tâm này — đúng trạng thái sau cấp phát.
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

    // Tài khoản chỉ tồn tại trong kho đích, không ở kho chung.
    expect(await countRows(centreUrl(), 'users', 'id', createdBody.id)).toBe(1);
    expect(await countRows(process.env.DATABASE_URL!, 'users', 'id', createdBody.id)).toBe(0);
    expect(await countRows(centreUrl(), 'tenant_memberships', 'user_id', createdBody.id)).toBe(1);

    // Control plane không còn bảng thư mục hay định danh tài khoản trung tâm.
    const directoryTables = await withClient(cpUrl(), async (client) => {
      const result = await client.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('space_membership_directory', 'space_join_code_directory')",
      );
      return result.rows;
    });
    expect(directoryTables).toHaveLength(0);

    // Ba lượt đọc quản trị tại địa chỉ của trung tâm đọc tại
    // kho đích: chi tiết tenant đúng slug, danh sách người
    // dùng gồm quản trị + người vừa tạo, danh sách thành viên
    // gồm cả hai membership.
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

  it('quản trị platform không được quyền quản trị nghiệp vụ kho riêng dù cache danh tính đã ấm', async () => {
    const evaluator = app.get(PermissionEvaluator, { strict: false });
    const spaceDb = app.get(SpaceDatabaseService, { strict: false });

    // Danh sách site admin của kho chung đọc thẳng từ kho chung
    // làm mốc đối chiếu: chứa quản trị platform đã seed, không
    // chứa quản trị của trung tâm kho riêng.
    const sharedAdmins = await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const result = await client.query<{ value: unknown }>("SELECT value FROM config WHERE key = 'siteadmins'");
      return Array.isArray(result.rows[0]?.value) ? (result.rows[0]!.value as unknown[]).map((v) => String(v)) : [];
    });
    expect(sharedAdmins.length).toBeGreaterThan(0);
    expect(sharedAdmins).not.toContain(centreAdminId);
    const sharedAdminId = sharedAdmins[0]!;

    // Chiều kho chung → kho riêng: nạp cache bằng lượt đọc ở
    // ngữ cảnh platform trước (đúng thứ tự làm ca (a) đỏ trước
    // TĐ6), rồi chấm trong ngữ cảnh kho riêng qua chính
    // evaluator của ứng dụng — quản trị kho riêng phải được
    // nhận diện từ danh sách kho riêng; quản trị platform
    // phải bị từ chối tại kho trung tâm.
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

    // Chiều kho riêng → kho chung: cache của kho riêng vừa được
    // nạp ở lượt trên; quay lại ngữ cảnh platform, kết quả phải
    // y nguyên — danh sách của kho riêng không rò sang kho
    // chung.
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
    // Chặn trước khi đọc bản ghi nghiệp vụ, kể cả với đường nộp bài và báo cáo điểm.
    for (const path of [
      `/api/v1/assignments/${randomUUID()}/submissions`,
      `/api/v1/courses/${randomUUID()}/gradebook/report`,
    ]) {
      const denied = await http(app).get(path).set('Host', HOST).set(auth(adminToken));
      expect([401, 403]).toContain(denied.status);
    }
  });

  it('cổng đăng nhập platform ghim kho chung: quản trị trung tâm gọi tại địa chỉ trung tâm mình vẫn bị 403 auth.platform_admin_required', async () => {
    // Quản trị trung tâm xác thực được tại địa chỉ của trung
    // tâm (tài khoản và mật khẩu nằm trong kho riêng) nhưng
    // cổng platform chỉ đối chiếu danh sách vận hành kho chung.
    const res = await http(app)
      .post('/api/v1/auth/platform/login')
      .set('Host', HOST)
      .send({ username: centreAdminUsername, password: STRONG_PASSWORD });
    expect(res.status).toBe(403);
    expect((res.body as { code?: string }).code).toBe('auth.platform_admin_required');
    expect((res.body as { accessToken?: string }).accessToken).toBeUndefined();

    // Vẫn kiểm chứng mật khẩu thực sự ở kho trung tâm trước cổng
    // platform: sai mật khẩu phải 401, không trả 403 cho mọi payload.
    const wrongPassword = await http(app)
      .post('/api/v1/auth/platform/login')
      .set('Host', HOST)
      .send({ username: centreAdminUsername, password: 'WrongPassword!1234' });
    expect(wrongPassword.status).toBe(401);
    expect((wrongPassword.body as { code?: string }).code).toBe('auth.invalid_credentials');
  });

  it('nhân sự platform không được cấp tài khoản hoặc xem hồ sơ của trường thuộc kho chung', async () => {
    const slug = `truong-td6-${RUN_SUFFIX}`;
    const tenantRes = await http(app)
      .post('/api/v1/tenants')
      .set(auth(adminToken))
      .send({ name: 'Trường TĐ6 (spec 587)', slug, kind: 'school' });
    expect(tenantRes.status).toBe(201);
    const sharedTenantId = (tenantRes.body as { id: string }).id;

    const username = uniqueName('giaovienchung');
    const created = await http(app)
      .post(`/api/v1/tenants/${sharedTenantId}/users`)
      .set(auth(adminToken))
      .send({
        username,
        email: `${username}@example.com`,
        password: STRONG_PASSWORD,
        firstName: 'GiaoVien',
        lastName: 'Chung',
      });
    expect(created.status).toBe(403);
    expect(await countRows(process.env.DATABASE_URL!, 'users', 'username', username)).toBe(0);

    const list = await http(app)
      .get(`/api/v1/tenants/${sharedTenantId}/users`)
      .set(auth(adminToken));
    expect(list.status).toBe(403);
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
