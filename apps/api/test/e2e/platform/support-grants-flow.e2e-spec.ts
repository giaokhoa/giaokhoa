import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSpaceProvision, type SpaceProvisionResult } from '../../../src/modules/tenants/space-provision-runner';
import { TenantsService } from '../../../src/modules/tenants/tenants.service';
import { createTestApp, createUserViaApi, http, adminToken, STRONG_PASSWORD, grantTenantManagerFixture, seedTenantMembershipFixture } from '../../support/identity-access-helpers';

const suffix = Math.random().toString(36).slice(2, 8);
const cpDatabase = `giaokhoa_test_cp_support19_${suffix}`;
const slugA = `support-a-${suffix}`;
const slugB = `support-b-${suffix}`;
const hostA = `${slugA}.test.local`;
const hostB = `${slugB}.test.local`;
const dbPassword = 'Test-only-19-Database!';
const actorId = '22222222-2222-4222-8222-222222222222';
const migrationsDir = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'centre');
const cpMigrationsDir = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'control-plane');

function connection(database: string, username?: string, password?: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  if (username) url.username = username;
  if (password) url.password = password;
  return url.toString();
}

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); }
  finally { await client.end(); }
}

async function initControlPlane() {
  await withClient(connection(cpDatabase), async (client) => {
    const folders = readdirSync(cpMigrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const folder of folders) {
      const sqlText = readFileSync(join(cpMigrationsDir, folder, 'migration.sql'), 'utf8');
      for (const statement of sqlText.split('--> statement-breakpoint')) {
        if (statement.trim()) await client.query(statement);
      }
    }
  });
}

function draft(recipientId: string, scopes: Array<'classes:read' | 'courses:read'>) {
  return {
    recipientId, scopes, reason: 'Hỗ trợ kiểm tra lỗi lớp của trung tâm A',
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  };
}

describe('Hỗ trợ hữu hạn: HTTP thật giữa trung tâm A, B và nhân sự platform', () => {
  let app: INestApplication;
  let a: SpaceProvisionResult;
  let b: SpaceProvisionResult;
  let adminA = '';
  let adminB = '';
  let supportToken = '';
  let otherToken = '';
  let staffId = '';
  let supportGrantId = '';
  let classId = '';

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const centreDb = (space: SpaceProvisionResult) =>
    connection(space.databaseName, space.connectionRole, dbPassword);

  beforeAll(async () => {
    await withClient(connection('postgres'), async (client) => {
      await client.query(`CREATE DATABASE "${cpDatabase}"`);
    });
    await initControlPlane();
    const env = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL!,
      CONTROL_PLANE_DATABASE_URL: connection(cpDatabase),
      SPACE_PROVISION_DB_PASSWORD: dbPassword,
    };
    a = await runSpaceProvision({
      slug: slugA, name: 'Trung tâm hỗ trợ A', adminUsername: `admina19${suffix}`,
      adminEmail: `admin-a-19-${suffix}@example.com`,
      databasePassword: dbPassword, actorId, migrationsDir, env, log: () => undefined,
    });
    b = await runSpaceProvision({
      slug: slugB, name: 'Trung tâm hỗ trợ B', adminUsername: `adminb19${suffix}`,
      adminEmail: `admin-b-19-${suffix}@example.com`,
      databasePassword: dbPassword, actorId, migrationsDir, env, log: () => undefined,
    });
    process.env.CONTROL_PLANE_DATABASE_URL = connection(cpDatabase);
    process.env[a.secretEnvVar] = centreDb(a);
    process.env[b.secretEnvVar] = centreDb(b);
    app = await createTestApp();

    for (const [space, slug] of [[a, slugA], [b, slugB]] as const) {
      const activate = await http(app).post('/api/v1/centres/activate-invite')
        .send({ slug, token: space.inviteToken, password: STRONG_PASSWORD });
      expect(activate.status, JSON.stringify(activate.body)).toBe(201);
    }
    const aLogin = await http(app).post('/api/v1/auth/token').set('Host', hostA)
      .send({ username: `admina19${suffix}`, password: STRONG_PASSWORD });
    const bLogin = await http(app).post('/api/v1/auth/token').set('Host', hostB)
      .send({ username: `adminb19${suffix}`, password: STRONG_PASSWORD });
    expect(aLogin.status, JSON.stringify(aLogin.body)).toBe(201);
    expect(bLogin.status, JSON.stringify(bLogin.body)).toBe(201);
    adminA = aLogin.body.accessToken as string;
    adminB = bLogin.body.accessToken as string;

    const platformAdmin = await adminToken(app);
    const staff = await createUserViaApi(app, platformAdmin);
    const other = await createUserViaApi(app, platformAdmin);
    staffId = staff.id;
    const platformTenant = await app.get(TenantsService, { strict: false }).platformTenant();
    await seedTenantMembershipFixture(app, platformTenant.id, staff.id);
    await seedTenantMembershipFixture(app, platformTenant.id, other.id);
    const supportLogin = await http(app).post('/api/v1/auth/support/login')
      .send({ username: staff.username, password: STRONG_PASSWORD });
    const otherLogin = await http(app).post('/api/v1/auth/support/login')
      .send({ username: other.username, password: STRONG_PASSWORD });
    expect(supportLogin.status, JSON.stringify(supportLogin.body)).toBe(201);
    expect(otherLogin.status, JSON.stringify(otherLogin.body)).toBe(201);
    supportToken = supportLogin.body.accessToken as string;
    otherToken = otherLogin.body.accessToken as string;

    classId = await withClient(centreDb(a), async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const cohort = await client.query<{ id: string }>(
        "INSERT INTO cohort (tenant_id, name, context_id, component, visible) VALUES ($1, 'Cohort hỗ trợ A', $2, 'class', false) RETURNING id",
        [a.tenantId, randomUUID()],
      );
      const cls = await client.query<{ id: string }>(
        "INSERT INTO classes (tenant_id, name, code, owner_id, cohort_id) VALUES ($1, 'Lớp hỗ trợ A', 'SP19A', $2, $3) RETURNING id",
        [a.tenantId, a.adminUserId, cohort.rows[0]!.id],
      );
      return cls.rows[0]!.id;
    });
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (a) delete process.env[a.secretEnvVar];
    if (b) delete process.env[b.secretEnvVar];
    delete process.env.CONTROL_PLANE_DATABASE_URL;
    await withClient(connection('postgres'), async (client) => {
      for (const space of [a, b]) {
        if (!space) continue;
        await client.query(`DROP DATABASE IF EXISTS "${space.databaseName}" WITH (FORCE)`);
        await client.query(`DROP ROLE IF EXISTS "${space.connectionRole}"`);
      }
      await client.query(`DROP DATABASE IF EXISTS "${cpDatabase}" WITH (FORCE)`);
    }).catch(() => undefined);
  });

  it('không grant, support token hợp lệ bị từ chối ở cả A và B', async () => {
    for (const slug of [slugA, slugB]) {
      const res = await http(app).get(`/api/v1/support-centres/${slug}/classes`).set(authed(supportToken));
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.code).toBe('support.access_denied');
    }
  });

  it('người không quản trị không thể cấp quyền tại A', async () => {
    const denied = await http(app).post('/api/v1/support-grants').set('Host', hostA)
      .set(authed(supportToken)).send(draft(staffId, ['classes:read']));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('auth.audience_denied');
  });

  it('tài khoản nghiệp vụ legacy trong kho chung nhưng không có membership platform không được hỗ trợ', async () => {
    const platformAdmin = await adminToken(app);
    const legacy = await createUserViaApi(app, platformAdmin);
    const login = await http(app).post('/api/v1/auth/support/login')
      .send({ username: legacy.username, password: STRONG_PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('auth.support_staff_required');
    const grant = await http(app).post('/api/v1/support-grants')
      .set('Host', hostA).set(authed(adminA)).send(draft(legacy.id, ['classes:read']));
    expect(grant.status).toBe(400);
    expect(grant.body.code).toBe('support.invalid_recipient');
  });

  it('không thể cấp grant cho tài khoản chỉ tồn tại trong kho của trung tâm', async () => {
    const denied = await http(app).post('/api/v1/support-grants').set('Host', hostA)
      .set(authed(adminA)).send(draft(a.adminUserId!, ['classes:read']));
    expect(denied.status, JSON.stringify(denied.body)).toBe(400);
    expect(denied.body.code).toBe('support.invalid_recipient');
  });

  it('quản trị A cấp grant và đúng recipient được xem đúng lớp ở A, không có quyền ở B', async () => {
    const create = await http(app).post('/api/v1/support-grants').set('Host', hostA)
      .set(authed(adminA)).send(draft(staffId, ['classes:read']));
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    expect(create.body).toMatchObject({ recipientId: staffId, tenantId: a.tenantId, scopes: ['classes:read'], status: 'active' });
    supportGrantId = create.body.id as string;
    const allowed = await http(app).get(`/api/v1/support-centres/${slugA}/classes`).set(authed(supportToken));
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    expect(allowed.body).toContainEqual({ id: classId, name: 'Lớp hỗ trợ A', code: 'SP19A', status: 'active' });
    const wrongScope = await http(app).get(`/api/v1/support-centres/${slugA}/courses`).set(authed(supportToken));
    expect(wrongScope.status).toBe(403);
    const wrongPerson = await http(app).get(`/api/v1/support-centres/${slugA}/classes`).set(authed(otherToken));
    expect(wrongPerson.status).toBe(403);
    const wrongCentre = await http(app).get(`/api/v1/support-centres/${slugB}/classes`).set(authed(supportToken));
    expect(wrongCentre.status).toBe(403);
    const myGrants = await http(app).get(`/api/v1/support-centres/${slugA}/my-grants`).set(authed(supportToken));
    expect(myGrants.status).toBe(200);
    expect(myGrants.body).toContainEqual(expect.objectContaining({ id: supportGrantId }));
  });

  it('thu hồi grant có hiệu lực ngay với chính support token; audit A có đủ vết, B không thấy grant A', async () => {
    const revoke = await http(app).post(`/api/v1/support-grants/${supportGrantId}/revoke`)
      .set('Host', hostA).set(authed(adminA));
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(201);
    expect(revoke.body.status).toBe('revoked');
    const after = await http(app).get(`/api/v1/support-centres/${slugA}/classes`).set(authed(supportToken));
    expect(after.status).toBe(403);
    const auditA = await http(app).get('/api/v1/support-grants/audit').set('Host', hostA).set(authed(adminA));
    expect(auditA.status, JSON.stringify(auditA.body)).toBe(200);
    const actions = (auditA.body as Array<{ action: string; grantId: string | null }>).map((row) => row.action);
    expect(actions).toContain('grant_created');
    expect(actions).toContain('access_allowed');
    expect(actions).toContain('grant_revoked');
    expect(actions).toContain('access_denied');
    const auditB = await http(app).get('/api/v1/support-grants/audit').set('Host', hostB).set(authed(adminB));
    expect(auditB.status, JSON.stringify(auditB.body)).toBe(200);
    expect((auditB.body as Array<{ grantId: string | null }>).every((row) => row.grantId !== supportGrantId)).toBe(true);
  });

  it('hết hạn chặn request kế tiếp không cần đăng nhập lại và trả trạng thái expired', async () => {
    const create = await http(app).post('/api/v1/support-grants').set('Host', hostA)
      .set(authed(adminA)).send(draft(staffId, ['courses:read']));
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const id = create.body.id as string;
    const before = await http(app).get(`/api/v1/support-centres/${slugA}/courses`).set(authed(supportToken));
    expect(before.status).toBe(200);
    await withClient(centreDb(a), async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      await client.query(
        "UPDATE support_grants SET created_at = now()-interval '2 days', expires_at = now()-interval '1 day' WHERE id = $1",
        [id],
      );
    });
    const after = await http(app).get(`/api/v1/support-centres/${slugA}/courses`).set(authed(supportToken));
    expect(after.status).toBe(403);
    const list = await http(app).get('/api/v1/support-grants').set('Host', hostA).set(authed(adminA));
    expect(list.status).toBe(200);
    expect(list.body).toContainEqual(expect.objectContaining({ id, status: 'expired' }));
  });

  it('trung tâm legacy ở kho chung: cấp, sử dụng, thu hồi vẫn cách ly theo tenant và audit qua HTTP', async () => {
    const sharedSlug = `support-shared-${suffix}`;
    const platformAdmin = await adminToken(app);
    let sharedTenant = '';
    try {
      const created = await withClient(process.env.DATABASE_URL!, async (client) => {
        await client.query("SELECT set_config('app.platform', 'on', false)");
        const result = await client.query<{ id: string }>(
          "INSERT INTO tenants (slug, name, kind, status) VALUES ($1, 'Legacy support shared', 'center', 'active') RETURNING id",
          [sharedSlug],
        );
        return result.rows[0]!.id;
      });
      sharedTenant = created;
      const sharedDatabase = new URL(process.env.DATABASE_URL!).pathname.slice(1);
      await withClient(connection(cpDatabase), async (client) => {
        await client.query(
          `INSERT INTO space_registry (slug, name, kind, status, database_name, storage_mode, connection_role_ref, schema_version)
           VALUES ($1, 'Legacy support shared', 'center', 'active', $2, 'shared', 'shared', 'v1')`,
          [sharedSlug, sharedDatabase],
        );
      });
      await grantTenantManagerFixture(app, platformAdmin, sharedTenant);
      const switched = await http(app).post(`/api/v1/auth/switch-tenant/${sharedTenant}`)
        .set(authed(platformAdmin));
      expect(switched.status, JSON.stringify(switched.body)).toBe(201);
      const centreToken = switched.body.accessToken as string;
      const issued = await http(app).post('/api/v1/support-grants')
        .set('Host', `${sharedSlug}.test.local`).set(authed(centreToken))
        .send(draft(staffId, ['classes:read']));
      expect(issued.status, JSON.stringify(issued.body)).toBe(201);
      expect(issued.body.tenantId).toBe(sharedTenant);
      const grantedId = issued.body.id as string;

      const allowed = await http(app).get(`/api/v1/support-centres/${sharedSlug}/classes`)
        .set(authed(supportToken));
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
      const aFromShared = await http(app).get(`/api/v1/support-centres/${slugA}/classes`)
        .set(authed(supportToken));
      expect(aFromShared.status).toBe(403);
      const outOfScope = await http(app).get(`/api/v1/support-centres/${sharedSlug}/courses`)
        .set(authed(supportToken));
      expect(outOfScope.status).toBe(403);
      const other = await http(app).get(`/api/v1/support-centres/${sharedSlug}/classes`)
        .set(authed(otherToken));
      expect(other.status).toBe(403);

      const revoked = await http(app).post(`/api/v1/support-grants/${grantedId}/revoke`)
        .set('Host', `${sharedSlug}.test.local`).set(authed(centreToken));
      expect(revoked.status).toBe(201);
      expect(revoked.body.status).toBe('revoked');
      const denied = await http(app).get(`/api/v1/support-centres/${sharedSlug}/classes`)
        .set(authed(supportToken));
      expect(denied.status).toBe(403);
      const audit = await http(app).get('/api/v1/support-grants/audit')
        .set('Host', `${sharedSlug}.test.local`).set(authed(centreToken));
      expect(audit.status).toBe(200);
      expect((audit.body as Array<{ action: string }>).map((item) => item.action))
        .toEqual(expect.arrayContaining(['grant_created', 'access_allowed', 'grant_revoked', 'access_denied']));
      const auditA = await http(app).get('/api/v1/support-grants/audit')
        .set('Host', hostA).set(authed(adminA));
      expect(auditA.status).toBe(200);
      expect((auditA.body as Array<{ grantId: string | null }>).every((item) => item.grantId !== grantedId)).toBe(true);
    } finally {
      if (sharedTenant) {
        await withClient(process.env.DATABASE_URL!, async (client) => {
          await client.query("SELECT set_config('app.platform', 'on', false)");
          await client.query('DELETE FROM support_access_events WHERE tenant_id = $1', [sharedTenant]);
          await client.query('DELETE FROM support_grants WHERE tenant_id = $1', [sharedTenant]);
          await client.query('DELETE FROM role_assignments WHERE context_id IN (SELECT id FROM context WHERE context_level = 20 AND instance_id = $1)', [sharedTenant]);
          await client.query('DELETE FROM tenant_memberships WHERE tenant_id = $1', [sharedTenant]);
          await client.query('DELETE FROM context WHERE context_level = 20 AND instance_id = $1', [sharedTenant]);
          await client.query('DELETE FROM tenants WHERE id = $1', [sharedTenant]);
        });
      }
    }
  });


  it('kết thúc membership platform chặn ngay support token cũ dù grant còn hạn', async () => {
    const grant = await http(app).post('/api/v1/support-grants').set('Host', hostA)
      .set(authed(adminA)).send(draft(staffId, ['classes:read']));
    expect(grant.status, JSON.stringify(grant.body)).toBe(201);
    const active = await http(app).get(`/api/v1/support-centres/${slugA}/classes`).set(authed(supportToken));
    expect(active.status).toBe(200);
    await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const platform = await client.query<{ id: string }>("SELECT id FROM tenants WHERE slug = 'trang-chinh'");
      await client.query(
        "UPDATE tenant_memberships SET status = 'ended', ended_at = now() WHERE tenant_id = $1 AND user_id = $2",
        [platform.rows[0]!.id, staffId],
      );
    });
    const denied = await http(app).get(`/api/v1/support-centres/${slugA}/classes`).set(authed(supportToken));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('support.access_denied');
    const audit = await http(app).get('/api/v1/support-grants/audit').set('Host', hostA).set(authed(adminA));
    expect(audit.status).toBe(200);
    expect((audit.body as Array<{ action: string }>).map((event) => event.action)).toContain('access_denied');
    const relogin = await http(app).post('/api/v1/auth/support/login')
      .send({ username: (await withClient(process.env.DATABASE_URL!, async (client) => {
        await client.query("SELECT set_config('app.platform', 'on', false)");
        const row = await client.query<{ username: string }>('SELECT username FROM users WHERE id = $1', [staffId]);
        return row.rows[0]!.username;
      })), password: STRONG_PASSWORD });
    expect(relogin.status).toBe(403);
    expect(relogin.body.code).toBe('auth.support_staff_required');
  });

});
