import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withDatabase } from '@giaokhoa/db/test-support';
import { DedicatedTestCentres, type DedicatedTestCentre } from '../../support/dedicated-test-centres';
import { Client } from 'pg';





import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  STRONG_PASSWORD,
  createTestApp,
  createUserViaApi,
  http,
  login,
  roleIdByShortname,
  uniqueName,
} from '../../support/identity-access-helpers';

describe('Cô lập tenant (TENANT-0, #168)', () => {
  let app: INestApplication;
  let dedicated: DedicatedTestCentres;
  let spaceA: DedicatedTestCentre;
  let spaceB: DedicatedTestCentre;
  let teacherTokenB = '';
  let teacherIdB = '';
  let pgA: Client;
  let pgB: Client;
  let adminZero = '';
  let adminA = '';
  let adminB = '';
  let tenantA = '';
  let tenantB = '';
  let categoryA = '';
  let courseA = '';
  let courseB = '';
  let categoryB = '';
  let cohortB = '';
  let bankSchoolA = '';
  let bankSchoolB = '';
  let linkA = '';
  let linkB = '';
  let teacherId = '';
  let teacherUsername = '';
  let memberAOnlyUsername = '';
  let teacherTokenA = '';
  let teacherRefreshA = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const must = async (res: { status: number; body: unknown }, what: string) => {
    if (res.status < 200 || res.status >= 300) throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as never;
  };

  beforeAll(async () => {
    dedicated = new DedicatedTestCentres();
    await dedicated.provision([
      `tenant-a-${randomUUID().slice(0, 8)}`,
      `tenant-b-${randomUUID().slice(0, 8)}`,
    ]);
    app = await createTestApp();
    adminZero = (await login(app, 'admin', 'Admin123!')).accessToken;
    [spaceA, spaceB] = await dedicated.activate(app);
    tenantA = spaceA.space.tenantId!;
    tenantB = spaceB.space.tenantId!;
    await dedicated.grantCentreManager(app, spaceA);
    await dedicated.grantCentreManager(app, spaceB);
    adminA = spaceA.adminToken;
    adminB = spaceB.adminToken;

    const teacher = await dedicated.createUser(app, spaceA, 'tenantTeacherA');
    const teacherB = await dedicated.createUser(app, spaceB, 'tenantTeacherB');
    teacherId = teacher.id;
    teacherUsername = teacher.username;
    teacherTokenA = teacher.token;
    teacherTokenB = teacherB.token;
    teacherIdB = teacherB.id;
    const memberAOnly = await dedicated.createUser(app, spaceA, 'tenantOnlyA');
    memberAOnlyUsername = memberAOnly.username;
    const guardianAUser = await dedicated.createUser(app, spaceA, 'tenantGuardianA');
    const studentAUser = await dedicated.createUser(app, spaceA, 'tenantStudentA');
    const guardianBUser = await dedicated.createUser(app, spaceB, 'tenantGuardianB');
    const studentBUser = await dedicated.createUser(app, spaceB, 'tenantStudentB');
    await dedicated.grantCentreManager(app, spaceA, teacherId);

    const seedTenantContent = async (token: string, marker: string) => {
      const category = await must(await http(app).post('/api/v1/courses/categories').set(auth(token)).send({ name: `Danh mục ${marker}` }), 'create category') as { id: string };
      const cls = await must(await http(app).post('/api/v1/classes').set(auth(token)).send({ name: `Lớp ${marker}` }), 'create class') as { id: string };
      const course = await must(await http(app).post('/api/v1/courses').set(auth(token)).send({
        fullName: `Khoá ${marker}`, shortName: uniqueName('C').toUpperCase(), category: category.id, classId: cls.id,
      }), 'create course') as { id: string };
      const cohort = await must(await http(app).post('/api/v1/cohorts').set(auth(token)).send({ name: `Cohort ${marker}`, categoryId: category.id }), 'create cohort') as { id: string };
      return { categoryId: category.id, courseId: course.id, cohortId: cohort.id };
    };
    const inA = await seedTenantContent(adminA, 'A');
    categoryA = inA.categoryId; courseA = inA.courseId;
    const inB = await seedTenantContent(adminB, 'B');
    categoryB = inB.categoryId; courseB = inB.courseId; cohortB = inB.cohortId;
    linkA = (await must(await http(app).post('/api/v1/guardian-links').set(auth(adminA)).send({
      guardianUserId: guardianAUser.id, studentUserId: studentAUser.id, relationship: 'cha',
    }), 'create guardian link A') as { id: string }).id;
    linkB = (await must(await http(app).post('/api/v1/guardian-links').set(auth(adminB)).send({
      guardianUserId: guardianBUser.id, studentUserId: studentBUser.id, relationship: 'mẹ',
    }), 'create guardian link B') as { id: string }).id;

    const schoolBankOf = async (token: string) => {
      const banks = await must(await http(app).get('/api/v1/question-banks').set(auth(token)), 'list banks') as { id: string; scope: string; tenantId: string | null }[];
      const school = banks.filter((b) => b.scope === 'school');
      expect(school).toHaveLength(1);
      return school[0]!;
    };
    bankSchoolA = (await schoolBankOf(adminA)).id;
    bankSchoolB = (await schoolBankOf(adminB)).id;
    const access = await http(app).post('/api/v1/auth/token').set('Host', spaceA.host)
      .send({ username: teacherUsername, password: STRONG_PASSWORD });
    expect(access.status).toBe(201);
    teacherRefreshA = access.body.refreshToken as string;
    const adminUrl = withDatabase(process.env.DATABASE_URL!, 'postgres');
    pgA = new Client({ connectionString: withDatabase(adminUrl, spaceA.space.databaseName) });
    pgB = new Client({ connectionString: withDatabase(adminUrl, spaceB.space.databaseName) });
    await pgA.connect(); await pgB.connect();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await app?.get<Pool>('SHARED_CENTRE_KYSELY').end();
    await pgA?.end(); await pgB?.end();
    await dedicated?.cleanup();
  });

  it('(6) trang chính tồn tại, không cho tạo trường mới trong kho chung', async () => {
    const tenants = await must(await http(app).get('/api/v1/tenants').set(auth(adminZero)), 'list tenants') as { slug: string }[];
    const slugs = tenants.map((t) => t.slug);
    expect(slugs).toContain('trang-chinh');
    const deniedSlug = uniqueName('shared-forbidden').toLowerCase();
    const denied = await http(app).post('/api/v1/tenants').set(auth(adminZero))
      .send({ slug: deniedSlug, name: 'Trường không được tạo mới', kind: 'school' });
    expect(denied.status).toBe(400);
    expect((denied.body as { code?: string }).code).toBe('centre.provision_required');
    const afterwards = await must(await http(app).get('/api/v1/tenants').set(auth(adminZero)), 'list tenants after denied create') as { slug: string }[];
    expect(afterwards.map((t) => t.slug)).not.toContain(deniedSlug);
    const mine = await must(await http(app).get('/api/v1/auth/tenants').set(auth(adminZero)), 'my tenants') as { slug: string }[];
    const mineSlugs = mine.map((t) => t.slug);
    expect(mineSlugs).toEqual(['trang-chinh']);
  });

  it('(1) đọc chéo tenant bằng id đoán → 404 đồng nhất', async () => {
    const course = await http(app).get(`/api/v1/courses/${courseB}`).set(auth(teacherTokenA));
    expect(course.status).toBe(404);
    const category = await http(app).get(`/api/v1/courses/categories/${categoryB}`).set(auth(teacherTokenA));
    expect(category.status).toBe(404);
    const cohort = await http(app).get(`/api/v1/cohorts/${cohortB}`).set(auth(teacherTokenA));
    expect(cohort.status).toBe(404);
    const bank = await http(app).get(`/api/v1/question-banks/${bankSchoolB}`).set(auth(teacherTokenA));
    expect(bank.status).toBe(404);
    const courses = await must(await http(app).get('/api/v1/courses').set(auth(teacherTokenA)), 'list courses A') as { id: string }[];
    expect(courses.map((c) => c.id)).toContain(courseA);
    expect(courses.map((c) => c.id)).not.toContain(courseB);
    const links = await must(await http(app).get('/api/v1/guardian-links').set(auth(adminA)), 'list links A') as { id: string }[];
    expect(links.map((l) => l.id)).toContain(linkA);
    expect(links.map((l) => l.id)).not.toContain(linkB);
    const revoke = await http(app).delete(`/api/v1/guardian-links/${linkB}`).set(auth(adminA));
    expect(revoke.status).toBe(404);
    const memberToken = await dedicated.login(app, spaceA, memberAOnlyUsername);
    const usersB = await http(app).get(`/api/v1/tenants/${tenantB}/users`).set(auth(memberToken));
    expect(usersB.status).toBe(404);
  });

  it('(2) cấu hình tenant A đổi không chạm B và platform', async () => {
    const put = await http(app).put('/api/v1/site-config/tenant-settings/core/fullname').set(auth(adminA)).send({ value: 'Trường A (spec)' });
    expect(put.status).toBe(200);
    const inA = await must(await http(app).get('/api/v1/site-config/tenant-settings').set(auth(adminA)), 'tenant settings A') as { name: string; value: unknown; source: string }[];
    expect(inA.find((s) => s.name === 'fullname')?.value).toBe('Trường A (spec)');
    expect(inA.find((s) => s.name === 'fullname')?.source).toBe('database');
    const inB = await must(await http(app).get('/api/v1/site-config/tenant-settings').set(auth(adminB)), 'tenant settings B') as { name: string; value: unknown }[];
    expect(inB.find((s) => s.name === 'fullname')?.value).not.toBe('Trường A (spec)');
    const platform = await must(await http(app).get('/api/v1/site-config').set(auth(adminZero)), 'platform settings') as { name: string; value: unknown }[];
    expect(platform.find((s) => s.name === 'fullname')?.value).not.toBe('Trường A (spec)');
    const platformOnly = await http(app).put('/api/v1/site-config/tenant-settings/core/sitepolicy').set(auth(adminA)).send({ value: 'x' });
    expect(platformOnly.status).toBe(400);
    expect((platformOnly.body as { code?: string }).code).toBe('site_config.platform_only');
  });

  it('(3) mỗi tenant đúng một bank trường; bank platform tenant_id NULL', async () => {
    expect(bankSchoolA).not.toBe(bankSchoolB);
    const banksA = await must(await http(app).get('/api/v1/question-banks').set(auth(adminA)), 'banks A') as { scope: string; tenantId: string | null }[];
    expect(banksA.find((b) => b.scope === 'school')?.tenantId).toBe(tenantA);
    const banksB = await must(await http(app).get('/api/v1/question-banks').set(auth(adminB)), 'banks B') as { scope: string; tenantId: string | null }[];
    expect(banksB.find((b) => b.scope === 'school')?.tenantId).toBe(tenantB);
    const banksPlatform = await must(await http(app).get('/api/v1/question-banks').set(auth(adminZero)), 'banks platform session') as { scope: string; tenantId: string | null }[];
    const platformBank = banksPlatform.find((b) => b.scope === 'platform');
    expect(platformBank).toBeDefined();
    expect(platformBank?.tenantId).toBeNull();
  });

  it('(4) không thể switch token giữa hai hostname dedicated; quyền manager A không lan sang B', async () => {
    const current = await must(await http(app).get('/api/v1/tenants/current').set(auth(teacherTokenA)), 'current tenant') as { id: string };
    expect(current.id).toBe(tenantA);
    const membersA = await http(app).get(`/api/v1/tenants/${tenantA}/members`).set(auth(teacherTokenA));
    expect(membersA.status).toBe(200);
    const rejected = await http(app).post(`/api/v1/auth/switch-tenant/${tenantB}`).set(auth(teacherTokenA));
    expect([403, 404]).toContain(rejected.status);
    expect((await http(app).get('/api/v1/tenants/current')
      .set('Host', spaceB.host).set(auth(teacherTokenA))).status).toBe(401);
    const unprivilegedB = await http(app).get(`/api/v1/tenants/${tenantB}/members`).set(auth(teacherTokenB));
    expect(unprivilegedB.status).toBe(403);
    expect((await http(app).get(`/api/v1/tenants/${tenantB}/members`).set(auth(adminB))).status).toBe(200);
    const staleCurrent = await must(await http(app).get('/api/v1/tenants/current').set(auth(teacherTokenA)), 'original A session') as { id: string };
    expect(staleCurrent.id).toBe(tenantA);
    const staleRefresh = await http(app).post('/api/v1/auth/refresh').send({ refreshToken: teacherRefreshA });
    expect(staleRefresh.status).toBe(401);
  });

  it('(5) RLS fail-closed và cách ly vật lý: mỗi DB chỉ chứa course của chính nó', async () => {
    const role = `tenant_spec_${randomUUID().slice(0, 8)}`;
    await pgA.query(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
    try {
      for (const pg of [pgA, pgB]) await pg.query(`GRANT SELECT ON course, course_categories TO ${role}`);
      for (const [pg, mine, other, tenant, wrongTenant] of [
        [pgA, courseA, courseB, tenantA, tenantB],
        [pgB, courseB, courseA, tenantB, tenantA],
      ] as const) {
        await pg.query('BEGIN');
        try {
          await pg.query(`SET ROLE ${role}`);
          expect((await pg.query('SELECT id FROM course WHERE id = ANY($1)', [[mine, other]])).rows).toEqual([]);
          await pg.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
          expect((await pg.query('SELECT id FROM course WHERE id = ANY($1)', [[mine, other]])).rows).toEqual([{ id: mine }]);
          await pg.query("SELECT set_config('app.tenant_id', $1, true)", [wrongTenant]);
          expect((await pg.query('SELECT id FROM course WHERE id = ANY($1)', [[mine, other]])).rows).toEqual([]);
          await pg.query("SELECT set_config('app.platform', 'on', true)");
          expect((await pg.query('SELECT id FROM course WHERE id = ANY($1)', [[mine, other]])).rows).toEqual([{ id: mine }]);
        } finally {
          await pg.query('ROLLBACK');
          await pg.query('RESET ROLE');
        }
      }
    } finally {
      await pgA.query(`DROP OWNED BY ${role}`).catch(() => undefined);
      await pgB.query(`DROP OWNED BY ${role}`).catch(() => undefined);
      await pgA.query(`DROP ROLE IF EXISTS ${role}`);
    }
  });

  it('(7) N2: vai site admin platform không cấp quyền cho tài khoản ở kho A', async () => {
    const support = await createUserViaApi(app, adminZero);
    const contexts = await must(await http(app).get('/api/v1/access/contexts').set(auth(adminZero)), 'list contexts') as { id: string; contextLevel: number }[];
    const systemCtx = contexts.find((c) => c.contextLevel === 10);
    if (!systemCtx) throw new Error('system context missing');
    const managerRole = await roleIdByShortname(app, adminZero, 'manager');
    await must(await http(app).post('/api/v1/access/assignments').set(auth(adminZero)).send({
      userId: support.id, roleId: managerRole, contextId: systemCtx.id,
    }), 'assign support platform manager');
    const platformToken = (await login(app, support.username, STRONG_PASSWORD)).accessToken;
    expect((await http(app).get('/api/v1/tenants').set(auth(platformToken))).status).toBe(200);
    const crossHost = await http(app).post('/api/v1/courses/categories').set('Host', spaceA.host)
      .set(auth(platformToken)).send({ name: 'Không được cấp từ platform' });
    expect(crossHost.status).toBe(401);
    const centreRegular = await dedicated.createUser(app, spaceA, 'noManager');
    const createCat = await http(app).post('/api/v1/courses/categories').set(auth(centreRegular.token))
      .send({ name: 'Danh mục N2 không được phép' });
    expect(createCat.status).toBe(403);
    const patchCat = await http(app).patch(`/api/v1/courses/categories/${categoryA}`).set(auth(centreRegular.token))
      .send({ name: 'Đổi tên trái phép' });
    expect(patchCat.status).toBe(403);
    const membersFromPlatform = await http(app).get(`/api/v1/tenants/${tenantA}/members`).set(auth(platformToken));
    expect([403, 404]).toContain(membersFromPlatform.status);
  });

  it('(8) N3: SQL không GUC, sai GUC hoặc GUC rỗng thấy 0 hàng ở cả A lẫn B', async () => {
    const marker = `tenant_spec_${randomUUID().slice(0, 8)}`;
    for (const [pg, userId, tenant, label] of [
      [pgA, teacherId, tenantA, 'A'], [pgB, teacherIdB, tenantB, 'B'],
    ] as const) {
      await pg.query(
        `INSERT INTO notifications (user_id_to, subject, full_message, small_message, component, event_type, tenant_id)
         VALUES ($1, $2, 'x', 'x', 'core_spec', 'tenant_spec', $3)`,
        [userId, `${marker}-${label}`, tenant],
      );
    }
    const role = `tenant_spec_fc_${randomUUID().slice(0, 8)}`;
    await pgA.query(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
    try {
      for (const pg of [pgA, pgB]) await pg.query(`GRANT SELECT ON course, notifications TO ${role}`);
      for (const [pg, mine, tenant, wrongTenant, label] of [
        [pgA, courseA, tenantA, tenantB, 'A'],
        [pgB, courseB, tenantB, tenantA, 'B'],
      ] as const) {
        await pg.query('BEGIN');
        try {
          await pg.query(`SET ROLE ${role}`);
          const courses = async () => (await pg.query('SELECT id FROM course WHERE id = $1', [mine])).rows;
          const notifications = async () => (await pg.query<{subject: string}>(
            "SELECT subject FROM notifications WHERE event_type = 'tenant_spec' AND subject LIKE $1", [`${marker}%`])).rows;
          expect(await courses()).toEqual([]);
          expect(await notifications()).toEqual([]);
          await pg.query("SELECT set_config('app.tenant_id', '', true)");
          expect(await courses()).toEqual([]);
          await pg.query("SELECT set_config('app.tenant_id', $1, true)", [wrongTenant]);
          expect(await courses()).toEqual([]);
          expect(await notifications()).toEqual([]);
          await pg.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
          expect(await courses()).toEqual([{ id: mine }]);
          expect(await notifications()).toEqual([{ subject: `${marker}-${label}` }]);
        } finally {
          await pg.query('ROLLBACK');
          await pg.query('RESET ROLE');
        }
      }
    } finally {
      await pgA.query(`DROP OWNED BY ${role}`).catch(() => undefined);
      await pgB.query(`DROP OWNED BY ${role}`).catch(() => undefined);
      await pgA.query(`DROP ROLE IF EXISTS ${role}`);
    }
  });

  it('(9) notifications API A/B ở đúng hostname chỉ thấy thông báo của DB mình', async () => {
    const itemsIn = async (token: string) => {
      const res = await must(await http(app).get('/api/v1/notifications/items?eventType=tenant_spec&limit=50')
        .set(auth(token)), 'notification items') as { items: { subject: string }[] };
      return res.items.map((i) => i.subject);
    };
    const inA = await itemsIn(teacherTokenA);
    expect(inA.some((value) => value.endsWith('-A'))).toBe(true);
    expect(inA.some((value) => value.endsWith('-B'))).toBe(false);
    const inB = await itemsIn(teacherTokenB);
    expect(inB.some((value) => value.endsWith('-B'))).toBe(true);
    expect(inB.some((value) => value.endsWith('-A'))).toBe(false);
  });

  it('(10) đáp ứng người dùng của tenant chỉ gồm đúng 7 trường hồ sơ, không chứa passwordHash', async () => {
    const expectedKeys = ['deleted', 'email', 'firstName', 'id', 'lastName', 'suspended', 'username'];

    const list = await http(app).get(`/api/v1/tenants/${tenantA}/users`).set(auth(adminA));
    expect(list.status).toBe(200);
    const rows = list.body as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(expectedKeys);
    }
    expect(JSON.stringify(list.body)).not.toContain('passwordHash');
    expect(JSON.stringify(list.body)).not.toContain('password_hash');
    const teacherRow = rows.find((r) => r.id === teacherId);
    expect(teacherRow?.username).toBe(teacherUsername);
    expect(teacherRow?.suspended).toBe(false);
    expect(teacherRow?.deleted).toBe(false);

    const username = uniqueName('tuser');
    const created = await http(app).post(`/api/v1/tenants/${tenantA}/users`).set(auth(adminA)).send({
      username, email: `${username}@example.com`, password: STRONG_PASSWORD, firstName: 'Tenant', lastName: 'User',
    });
    expect(created.status).toBe(201);
    const createdBody = created.body as Record<string, unknown>;
    expect(Object.keys(createdBody).sort()).toEqual(expectedKeys);
    expect(createdBody.username).toBe(username);
    expect(createdBody.email).toBe(`${username}@example.com`);
    expect(createdBody.firstName).toBe('Tenant');
    expect(createdBody.lastName).toBe('User');
    expect(JSON.stringify(created.body)).not.toContain('passwordHash');
    expect(JSON.stringify(created.body)).not.toContain('password_hash');

    const after = await must(await http(app).get(`/api/v1/tenants/${tenantA}/users`).set(auth(adminA)), 'list tenant users after create') as Record<string, unknown>[];
    const createdRow = after.find((r) => r.id === createdBody.id);
    expect(createdRow).toBeDefined();
    expect(Object.keys(createdRow!).sort()).toEqual(expectedKeys);
  });

  it('(11) quét sâu các bề mặt trả dữ liệu người dùng: không bề mặt nào chứa passwordHash', async () => {
    const containsKeyDeep = (value: unknown, key: string): boolean => {
      if (Array.isArray(value)) return value.some((v) => containsKeyDeep(v, key));
      if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>)
          .some(([k, v]) => k === key || containsKeyDeep(v, key));
      }
      return false;
    };
    const surfaces: { name: string; body: unknown }[] = [];
    const tokenRes = await http(app).post('/api/v1/auth/token').set('Host', spaceA.host).send({ username: teacherUsername, password: STRONG_PASSWORD });
    expect(tokenRes.status).toBe(201);
    surfaces.push({ name: 'POST /auth/token', body: tokenRes.body });
    const me = await http(app).get('/api/v1/users/me').set(auth(adminA));
    expect(me.status).toBe(200);
    surfaces.push({ name: 'GET /users/me', body: me.body });
    const profile = await http(app).get(`/api/v1/users/${teacherId}`).set(auth(adminA));
    expect(profile.status).toBe(200);
    surfaces.push({ name: 'GET /users/:id', body: profile.body });
    const userList = await http(app).get('/api/v1/users').query({ page: 1, pageSize: 5 }).set(auth(adminA));
    expect(userList.status).toBe(200);
    surfaces.push({ name: 'GET /users', body: userList.body });
    const members = await http(app).get(`/api/v1/tenants/${tenantA}/members`).set(auth(adminA));
    expect(members.status).toBe(200);
    surfaces.push({ name: 'GET /tenants/:tenantId/members', body: members.body });
    for (const surface of surfaces) {
      expect(containsKeyDeep(surface.body, 'passwordHash'), surface.name).toBe(false);
      expect(JSON.stringify(surface.body), surface.name).not.toContain('password_hash');
    }
  });
});
