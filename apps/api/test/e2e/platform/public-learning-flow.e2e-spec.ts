import { INestApplication, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { fileDomainForSpace, LEGACY_FILE_DOMAIN } from '@giaokhoa/db';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../src/modules/files/storage';
import { FileSigningService } from '../../../src/modules/files/file-signing.service';
import { join } from 'node:path';
import { Client } from 'pg';
import http from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SpaceProvisionResult } from '../../../src/modules/tenants/space-provision-runner';

/**
 * Better Auth và công tắc khu công cộng phải có giá trị trước import
 * AppModule: ConfigModule kiểm chứng môi trường khi module được nạp.
 * Các import AppModule/CLI đều được trì hoãn tới beforeAll.
 */
const ROOT_HOST = 'giaokhoa.test';
const ROOT_ORIGIN = 'http://' + ROOT_HOST;
const SFX = Math.random().toString(36).slice(2, 8);
const CENTRE_SLUG = 'trung-tam-8-' + SFX;
const CENTRE_HOST = CENTRE_SLUG + '.' + ROOT_HOST;
const CP_DATABASE = 'giaokhoa_test_cp_8_' + SFX;
const BANK_DATABASE = 'giaokhoa_test_bank_8_' + SFX;
const ADMIN_EMAIL = 'shared-email-8-' + SFX + '@example.com';
const LEARNER_USERNAME = 'hocvien8' + SFX;
const TEACHER_USERNAME = 'giaovien8' + SFX;
const CENTRE_ADMIN_USERNAME = 'admina8' + SFX;
const PASSWORD = 'Password8!Flow';
const NEW_PASSWORD = 'Password8!New';
const DB_PASSWORD = 'Test8PublicDB!';
const ACTOR_ID = '88888888-8888-4888-8888-888888888888';
const ROOT_SECRET = 'test-public-better-auth-secret-long-enough-8';
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'centre');
const CP_MIGRATIONS = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'control-plane');
const BANK_MIGRATIONS = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'system-bank');
const UUID_V7_SHIM = 'CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$ DECLARE ts_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; b bytea; BEGIN b := decode(lpad(to_hex(ts_ms), 12, \'0\'), \'hex\') || gen_random_bytes(10); b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112); b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128); RETURN encode(b, \'hex\')::uuid; END; $$ LANGUAGE plpgsql VOLATILE';

const previousEnv = new Map<string, string | undefined>();
function setTestEnv(key: string, value: string): void {
  if (!previousEnv.has(key)) previousEnv.set(key, process.env[key]);
  process.env[key] = value;
}
setTestEnv('PUBLIC_LEARNING_ENABLED', 'true');
setTestEnv('BETTER_AUTH_ENABLED', 'true');
setTestEnv('BETTER_AUTH_SECRET', ROOT_SECRET);
setTestEnv('BETTER_AUTH_URL', ROOT_ORIGIN);
setTestEnv('BETTER_AUTH_TRUSTED_ORIGINS', ROOT_ORIGIN);
// Bảy lượt đăng ký trong suite để kiểm chứng cả hai failure/retry;
// production giữ hạn mức mặc định 5/phút.
setTestEnv('RATE_LIMIT_REGISTRATION_PER_MINUTE', '7');

function clusterUrl(db: string, username?: string, password?: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/' + db;
  if (username) url.username = username;
  if (password) url.password = password;
  return url.toString();
}

function quoted(identifier: string): string {
  return '"' + identifier.replaceAll('"', '""') + '"';
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function migrateStore(database: string, migrationsDir: string): Promise<void> {
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  await withClient(clusterUrl(database), async (c) => {
    const version = await c.query<{ server_version_num: string }>('SHOW server_version_num');
    if (Number(version.rows[0]!.server_version_num) < 180000) {
      await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await c.query(UUID_V7_SHIM);
    }
    for (const folder of folders) {
      const source = readFileSync(join(migrationsDir, folder, 'migration.sql'), 'utf8');
      for (const statement of source.split('--> statement-breakpoint')) {
        if (statement.trim()) await c.query(statement.trim());
      }
    }
  });
}

async function createMountedTestApp(): Promise<INestApplication> {
  const { Test } = await import('@nestjs/testing');
  const { AppModule } = await import('../../../src/app.module');
  const { enableTrustedProxy } = await import('../../../src/common/client-ip');
  const { ProblemDetailsFilter } = await import('../../../src/common/problem-details.filter');
  const { mountBetterAuth } = await import('../../../src/modules/auth/better-auth/better-auth.mount');
  const { BetterAuthService } = await import('../../../src/modules/auth/better-auth/better-auth.service');
  const { SpaceDatabaseService } = await import('../../../src/db/routing/space-database.service');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  enableTrustedProxy(app as NestExpressApplication);
  mountBetterAuth(
    app as NestExpressApplication,
    app.get(BetterAuthService).requireAuth(),
    app.get(SpaceDatabaseService, { strict: false }),
  );
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  return app;
}

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  const raw = (cookies ?? []).find((entry) => entry.includes('better-auth.session_token='));
  if (!raw) throw new Error('Missing Better Auth cookie: ' + JSON.stringify(res.headers));
  return raw.split(';')[0]!;
}

describe('Khu công cộng #8 — E2E kho riêng, phiên và ranh giới quyền', () => {
  let app: INestApplication;
  let publicSpace: SpaceProvisionResult;
  let centreSpace: SpaceProvisionResult;
  let publicUserId = '';
  let teacherId = '';
  let publicCookie = '';
  let centreCookie = '';
  let centreJwt = '';
  let publicJwt = '';
  let courseId = '';
  let classId = '';

  const storeUrl = (space: SpaceProvisionResult) =>
    clusterUrl(space.databaseName, space.connectionRole, DB_PASSWORD);

  beforeAll(async () => {
    const { runSpaceProvision } = await import('../../../src/modules/tenants/space-provision-runner');
    await withClient(clusterUrl('postgres'), async (admin) => {
      await admin.query('CREATE DATABASE ' + quoted(CP_DATABASE));
      await admin.query('CREATE DATABASE ' + quoted(BANK_DATABASE));
    });
    await migrateStore(CP_DATABASE, CP_MIGRATIONS);
    await migrateStore(BANK_DATABASE, BANK_MIGRATIONS);
    const env = {
      ...process.env,
      CONTROL_PLANE_DATABASE_URL: clusterUrl(CP_DATABASE),
      DATABASE_URL: process.env.DATABASE_URL!,
      SPACE_PROVISION_DB_PASSWORD: DB_PASSWORD,
    };
    publicSpace = await runSpaceProvision({
      kind: 'platform', slug: 'cong-cong', name: 'Khu học tập công cộng',
      adminEmail: 'admin-public-8-' + SFX + '@example.com',
      adminUsername: 'publicadmin8' + SFX,
      actorId: ACTOR_ID, databasePassword: DB_PASSWORD, migrationsDir: MIGRATIONS_DIR,
      env, log: () => undefined,
    });
    centreSpace = await runSpaceProvision({
      slug: CENTRE_SLUG, name: 'Trung tâm 8 A', adminEmail: ADMIN_EMAIL,
      adminUsername: CENTRE_ADMIN_USERNAME,
      actorId: ACTOR_ID, databasePassword: DB_PASSWORD, migrationsDir: MIGRATIONS_DIR,
      env, log: () => undefined,
    });
    setTestEnv('CONTROL_PLANE_DATABASE_URL', clusterUrl(CP_DATABASE));
    setTestEnv('SYSTEM_BANK_DATABASE_URL', clusterUrl(BANK_DATABASE));
    setTestEnv(publicSpace.secretEnvVar, storeUrl(publicSpace));
    setTestEnv(centreSpace.secretEnvVar, storeUrl(centreSpace));
    app = await createMountedTestApp();
  }, 180000);

  afterAll(async () => {
    if (app) await app.close();
    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const space of [publicSpace, centreSpace]) {
        if (space) {
          await admin.query('DROP DATABASE IF EXISTS ' + quoted(space.databaseName) + ' WITH (FORCE)');
          await admin.query('DROP ROLE IF EXISTS ' + quoted(space.connectionRole));
        }
      }
      await admin.query('DROP DATABASE IF EXISTS ' + quoted(CP_DATABASE) + ' WITH (FORCE)');
      await admin.query('DROP DATABASE IF EXISTS ' + quoted(BANK_DATABASE) + ' WITH (FORCE)');
    });
    for (const [key, original] of previousEnv) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  }, 90000);

  it('CLI thật cấp kho, role riêng và tenant platform công cộng; role A không kết nối được kho công cộng', async () => {
    const registry = await withClient(clusterUrl(CP_DATABASE), async (db) =>
      db.query<{ slug: string; kind: string; storage_mode: string }>(
        'SELECT slug, kind, storage_mode FROM space_registry WHERE slug = $1', ['cong-cong'],
      ),
    );
    expect(registry.rows[0]).toMatchObject({ slug: 'cong-cong', kind: 'platform', storage_mode: 'dedicated' });
    const tenant = await withClient(storeUrl(publicSpace), async (db) => {
      await db.query("SELECT set_config('app.platform', 'on', false)");
      return db.query<{ slug: string; kind: string }>('SELECT slug, kind FROM tenants WHERE slug = $1', ['cong-cong']);
    });
    expect(tenant.rows[0]).toMatchObject({ slug: 'cong-cong', kind: 'platform' });
    const privilege = await withClient(clusterUrl('postgres'), async (db) =>
      db.query<{ can_connect: boolean }>('SELECT has_database_privilege($1, $2, $3) AS can_connect',
        [centreSpace.connectionRole, publicSpace.databaseName, 'CONNECT']),
    );
    expect(privilege.rows[0]?.can_connect).toBe(false);
  });

  it('HTTP đăng ký học viên + giáo viên chỉ trong kho công cộng, tài khoản không vào kho A/chung', async () => {
    const learner = await http(app.getHttpServer()).post('/api/v1/auth/public/register')
      .set('Host', ROOT_HOST).send({
        username: LEARNER_USERNAME, email: ADMIN_EMAIL, password: PASSWORD,
        firstName: 'Học', lastName: 'Viên', role: 'student',
      });
    expect(learner.status, JSON.stringify(learner.body)).toBe(201);
    publicUserId = learner.body.id as string;

    const teacher = await http(app.getHttpServer()).post('/api/v1/auth/public/register')
      .set('Host', ROOT_HOST).send({
        username: TEACHER_USERNAME, email: 'teacher8-' + SFX + '@example.com', password: PASSWORD,
        firstName: 'Giáo', lastName: 'Viên', role: 'teacher',
      });
    expect(teacher.status, JSON.stringify(teacher.body)).toBe(201);
    teacherId = teacher.body.id as string;

    const denied = await http(app.getHttpServer()).post('/api/v1/auth/public/register')
      .set('Host', CENTRE_HOST).send({
        username: 'forbidden8' + SFX, email: 'forbidden8@example.com', password: PASSWORD,
        firstName: 'Từ', lastName: 'Chối', role: 'teacher',
      });
    expect(denied.status).toBe(403);

    const pubCount = await withClient(storeUrl(publicSpace), async (db) => db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM users WHERE id IN ($1, $2)', [publicUserId, teacherId],
    ));
    expect(pubCount.rows[0]?.n).toBe('2');
    for (const dbUrl of [process.env.DATABASE_URL!, storeUrl(centreSpace)]) {
      const excluded = await withClient(dbUrl, async (db) => db.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM users WHERE id IN ($1, $2)', [publicUserId, teacherId],
      ));
      expect(excluded.rows[0]?.n).toBe('0');
    }
  });

  it('P2: lỗi ở bước gán quyền được bù toàn bộ và có thể đăng ký lại cùng tài khoản', async () => {
    const { RolesService } = await import('../../../src/modules/access/roles.service');
    const roles = app.get(RolesService);
    const username = 'retry8' + SFX;
    const email = 'retry8-' + SFX + '@example.com';
    const body = {
      username, email, password: PASSWORD, firstName: 'Thử',
      lastName: 'Lại', role: 'teacher',
    };
    let failedUserId = '';
    const injected = vi.spyOn(roles, 'assignRole').mockImplementationOnce(async (userId) => {
      failedUserId = userId;
      throw new Error('test: post-registration role failure');
    });
    let failed;
    try {
      failed = await http(app.getHttpServer()).post('/api/v1/auth/public/register')
        .set('Host', ROOT_HOST).send(body);
    } finally {
      injected.mockRestore();
    }
    expect(failed.status).toBe(500);
    expect(failedUserId).toBeTruthy();

    const state = await withClient(storeUrl(publicSpace), async (db) => {
      await db.query("SELECT set_config('app.platform', 'on', false)");
      return db.query<{ users: string; credentials: string; contexts: string; members: string; roles: string }>(
        "SELECT " +
        "(SELECT count(*)::text FROM users WHERE id = $1 OR username = $2 OR email = $3) AS users, " +
        "(SELECT count(*)::text FROM account WHERE user_id = $1) AS credentials, " +
        "(SELECT count(*)::text FROM context WHERE context_level = 30 AND instance_id = $1) AS contexts, " +
        "(SELECT count(*)::text FROM tenant_memberships WHERE user_id = $1) AS members, " +
        "(SELECT count(*)::text FROM role_assignments WHERE user_id = $1) AS roles",
        [failedUserId, username, email],
      );
    });
    expect(state.rows[0]).toEqual({
      users: '0', credentials: '0', contexts: '0', members: '0', roles: '0',
    });
    const retried = await http(app.getHttpServer()).post('/api/v1/auth/public/register')
      .set('Host', ROOT_HOST).send(body);
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
    const login = await http(app.getHttpServer()).post('/api/v1/auth/sign-in/username')
      .set('Host', ROOT_HOST).set('Origin', ROOT_ORIGIN)
      .send({ username, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
  });

  it('P2: lỗi cập nhật họ ngay trong cầu nối credential cũng được bù trước khi retry', async () => {
    const username = 'lastname8' + SFX;
    const email = 'lastname8-' + SFX + '@example.com';
    const body = {
      username, email, password: PASSWORD, firstName: 'Tên',
      lastName: 'Injected failure', role: 'student',
    };
    // Trigger chỉ cản thao tác UPDATE last_name (sau khi transaction
    // tạo user + credential của Better Auth đã commit). DB test riêng.
    await withClient(storeUrl(publicSpace), async (db) => {
      await db.query("CREATE FUNCTION reject_public_lastname() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN " +
        "IF NEW.username LIKE 'lastname8%' AND NEW.last_name = 'Injected failure' THEN " +
        "RAISE EXCEPTION 'injected lastname failure'; END IF; RETURN NEW; END $$");
      await db.query('CREATE TRIGGER reject_public_lastname_update BEFORE UPDATE OF last_name ' +
        'ON users FOR EACH ROW EXECUTE FUNCTION reject_public_lastname()');
    });
    try {
      const rejected = await http(app.getHttpServer()).post('/api/v1/auth/public/register')
        .set('Host', ROOT_HOST).send(body);
      expect(rejected.status).toBe(500);
      const count = await withClient(storeUrl(publicSpace), async (db) => {
        await db.query("SELECT set_config('app.platform', 'on', false)");
        return db.query<{ users: string; account: string }>(
          "SELECT (SELECT count(*)::text FROM users WHERE username = $1 OR email = $2) AS users, " +
          "(SELECT count(*)::text FROM account WHERE user_id IN " +
          "(SELECT id FROM users WHERE username = $1 OR email = $2)) AS account",
          [username, email],
        );
      });
      expect(count.rows[0]).toEqual({ users: '0', account: '0' });
    } finally {
      await withClient(storeUrl(publicSpace), async (db) => {
        await db.query('DROP TRIGGER IF EXISTS reject_public_lastname_update ON users');
        await db.query('DROP FUNCTION IF EXISTS reject_public_lastname()');
      });
    }
    const retry = await http(app.getHttpServer()).post('/api/v1/auth/public/register')
      .set('Host', ROOT_HOST).send(body);
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
  });

  it('phiên Better Auth ở 2 thiết bị được liệt kê, bảo vệ phiên hiện tại và thu hồi riêng/toàn bộ', async () => {
    const web = app.getHttpServer();
    const signIn = async (agent: string) => {
      const result = await http(web).post('/api/v1/auth/sign-in/username')
        .set('Host', ROOT_HOST).set('Origin', ROOT_ORIGIN).set('User-Agent', agent)
        .send({ username: LEARNER_USERNAME, password: PASSWORD });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      return cookieOf(result);
    };
    const cookie1 = await signIn('issue-8-device-one');
    const cookie2 = await signIn('issue-8-device-two');
    const list = await http(web).get('/api/v1/auth/sessions')
      .set('Host', ROOT_HOST).set('Cookie', cookie1);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const sessions = (list.body.sessions as Array<{
      id: string; kind: string; current: boolean; userAgent: string | null;
    }>).filter((s) => s.kind === 'better-auth');
    const current = sessions.find((s) => s.current);
    const other = sessions.find((s) => s.userAgent === 'issue-8-device-two');
    expect(current?.userAgent).toBe('issue-8-device-one');
    expect(other).toBeDefined();
    expect(other?.current).toBe(false);

    // Chỉ logout được phiên hiện tại; endpoint revoke từ chối xoá nó.
    const cannotRevokeCurrent = await http(web).delete('/api/v1/auth/sessions/' + current!.id)
      .set('Host', ROOT_HOST).set('Cookie', cookie1);
    expect(cannotRevokeCurrent.status).toBe(400);
    expect(cannotRevokeCurrent.body.code).toBe('auth.cannot_revoke_current_session');

    const revoked = await http(web).delete('/api/v1/auth/sessions/' + other!.id)
      .set('Host', ROOT_HOST).set('Cookie', cookie1);
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect(revoked.body.revoked).toBe(1);
    const device2Denied = await http(web).get('/api/v1/users/me')
      .set('Host', ROOT_HOST).set('Cookie', cookie2);
    expect(device2Denied.status).toBe(401);
    const device1Ok = await http(web).get('/api/v1/users/me')
      .set('Host', ROOT_HOST).set('Cookie', cookie1);
    expect(device1Ok.status).toBe(200);

    // Không lộ hoặc thu hồi phiên của user khác trong cùng kho.
    const teacherSignIn = await http(web).post('/api/v1/auth/sign-in/username')
      .set('Host', ROOT_HOST).set('Origin', ROOT_ORIGIN)
      .send({ username: TEACHER_USERNAME, password: PASSWORD });
    expect(teacherSignIn.status).toBe(200);
    const teacherList = await http(web).get('/api/v1/auth/sessions')
      .set('Host', ROOT_HOST).set('Cookie', cookieOf(teacherSignIn));
    expect(teacherList.status).toBe(200);
    const teacherSession = (teacherList.body.sessions as Array<{ id: string; kind: string }>)
      .find((session) => session.kind === 'better-auth');
    expect(teacherSession).toBeDefined();
    const foreign = await http(web).delete('/api/v1/auth/sessions/' + teacherSession!.id)
      .set('Host', ROOT_HOST).set('Cookie', cookie1);
    expect(foreign.status).toBe(404);

    const cookie3 = await signIn('issue-8-device-three');
    const bulk = await http(web).delete('/api/v1/auth/sessions/others')
      .set('Host', ROOT_HOST).set('Cookie', cookie1);
    expect(bulk.status, JSON.stringify(bulk.body)).toBe(200);
    expect(bulk.body.revoked).toBeGreaterThanOrEqual(1);
    const device3Denied = await http(web).get('/api/v1/users/me')
      .set('Host', ROOT_HOST).set('Cookie', cookie3);
    expect(device3Denied.status).toBe(401);
    const device1StillValid = await http(web).get('/api/v1/users/me')
      .set('Host', ROOT_HOST).set('Cookie', cookie1);
    expect(device1StillValid.status).toBe(200);
    const finalList = await http(web).get('/api/v1/auth/sessions')
      .set('Host', ROOT_HOST).set('Cookie', cookie1);
    const remaining = (finalList.body.sessions as Array<{ id: string; kind: string; current: boolean }>)
      .filter((session) => session.kind === 'better-auth');
    expect(remaining).toEqual([expect.objectContaining({ id: current!.id, current: true })]);
  });

  it('cookie và JWT học viên công cộng dùng ở công cộng, không dùng ở A; và ngược lại', async () => {
    const login = await http(app.getHttpServer()).post('/api/v1/auth/sign-in/username')
      .set('Host', ROOT_HOST).set('Origin', ROOT_ORIGIN)
      .send({ username: LEARNER_USERNAME, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    publicCookie = cookieOf(login);
    const me = await http(app.getHttpServer()).get('/api/v1/users/me')
      .set('Host', ROOT_HOST).set('Cookie', publicCookie);
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(me.body.id).toBe(publicUserId);

    const wrong = await http(app.getHttpServer()).get('/api/v1/users/me')
      .set('Host', CENTRE_HOST).set('Cookie', publicCookie);
    expect(wrong.status).toBe(401);

    // Cùng hợp đồng JWT của trung tâm: claim centre_id phải khớp
    // định danh đăng ký của kho công cộng. Đăng ký BA tự phục vụ
    // không ghi password_hash cũ; luồng web đăng nhập bằng cookie,
    // vì vậy ở đây ký token kiểm chứng biên JWT bằng JwtService thật.
    const jwt = app.get(JwtService);
    publicJwt = await jwt.signAsync({
      sub: publicUserId, username: LEARNER_USERNAME,
      tid: publicSpace.tenantId, centre_id: publicSpace.spaceId,
      sid: '88888888-8888-4888-8888-888888888881',
    }, { expiresIn: '5m' });
    const acceptedJwt = await http(app.getHttpServer()).get('/api/v1/users/me')
      .set('Host', ROOT_HOST).set('Authorization', 'Bearer ' + publicJwt);
    expect(acceptedJwt.status, JSON.stringify(acceptedJwt.body)).toBe(200);
    const wrongJwt = await http(app.getHttpServer()).get('/api/v1/users/me')
      .set('Host', CENTRE_HOST).set('Authorization', 'Bearer ' + publicJwt);
    expect(wrongJwt.status).toBe(401);

    const activated = await http(app.getHttpServer()).post('/api/v1/centres/activate-invite')
      .send({ slug: CENTRE_SLUG, token: centreSpace.inviteToken, password: PASSWORD });
    expect(activated.status, JSON.stringify(activated.body)).toBe(201);
    const centreLogin = await http(app.getHttpServer()).post('/api/v1/auth/sign-in/username')
      .set('Host', CENTRE_HOST).set('Origin', ROOT_ORIGIN)
      .send({ username: CENTRE_ADMIN_USERNAME, password: PASSWORD });
    expect(centreLogin.status, JSON.stringify(centreLogin.body)).toBe(200);
    centreCookie = cookieOf(centreLogin);

    const centreJwtLogin = await http(app.getHttpServer()).post('/api/v1/auth/token')
      .set('Host', CENTRE_HOST).send({ username: CENTRE_ADMIN_USERNAME, password: PASSWORD });
    expect(centreJwtLogin.status, JSON.stringify(centreJwtLogin.body)).toBe(201);
    centreJwt = centreJwtLogin.body.accessToken as string;

    const wrongCentreCookie = await http(app.getHttpServer()).get('/api/v1/users/me')
      .set('Host', ROOT_HOST).set('Cookie', centreCookie);
    expect(wrongCentreCookie.status).toBe(401);
    const wrongCentreJwt = await http(app.getHttpServer()).get('/api/v1/users/me')
      .set('Host', ROOT_HOST).set('Authorization', 'Bearer ' + centreJwt);
    expect(wrongCentreJwt.status).toBe(401);

    const centreUser = await withClient(storeUrl(centreSpace), async (db) =>
      db.query<{ id: string; email: string }>('SELECT id, email FROM users WHERE username = $1', [CENTRE_ADMIN_USERNAME]),
    );
    expect(centreUser.rows[0]?.email).toBe(ADMIN_EMAIL);
    expect(centreUser.rows[0]?.id).not.toBe(publicUserId);
  });

  it('HTTP tải file legacy sau nâng cấp tại đúng host trung tâm/công cộng, chữ ký không dùng chéo dù trùng file id', async () => {
    // Tái hiện metadata trước migration: cả hai kho đều có cùng id và
    // contentHash nhưng chủ sở hữu context khác nhau. Byte vật lý chưa
    // được di trú nên vẫn ở thư mục hash cũ.
    const fileId = uuidv7();
    const bytes = Buffer.from('legacy-hosts-8-' + SFX);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const signing = app.get(FileSigningService);
    const path = storage.keyFor(LEGACY_FILE_DOMAIN, hash);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    const spaces = [publicSpace, centreSpace];
    try {
      for (const space of spaces) {
        await withClient(storeUrl(space), async (db) => {
          await db.query("SELECT set_config('app.platform', 'on', false)");
          const parent = await db.query<{ id: string; path: string; depth: number }>(
            'SELECT id, path, depth FROM context WHERE context_level = 20 AND instance_id = $1', [space.tenantId],
          );
          expect(parent.rows).toHaveLength(1);
          // files:view có mức tối thiểu 50; dựng context khoá con của
          // đúng tenant để kiểm cả metadata đã qua cổng capability.
          const child = uuidv7();
          await db.query(
            'INSERT INTO context (id,context_level,instance_id,path,depth) VALUES ($1,50,$2,$3,$4)',
            [child, uuidv7(), parent.rows[0]!.path + '/' + child, parent.rows[0]!.depth + 1],
          );
          await db.query(
            'INSERT INTO files (id,content_hash,context_id,component,file_area,file_name,file_size,storage_domain) ' +
            'VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [fileId, hash, child, 'core_user', 'profile', 'legacy.txt', bytes.length, 'legacy'],
          );
          if (space.slug === CENTRE_SLUG) {
            // Cấp files:view đúng cách cho tài khoản kiểm thử tại
            // context con; không hạ yêu cầu capability của endpoint.
            const manager = await db.query<{ id: string }>(
              "SELECT id FROM role WHERE short_name = 'manager'",
            );
            const user = await db.query<{ id: string }>(
              'SELECT id FROM users WHERE username = $1', [CENTRE_ADMIN_USERNAME],
            );
            if (manager.rows.length !== 1 || user.rows.length !== 1) {
              throw new Error('Fixture trung tâm thiếu đúng một manager hoặc quản trị viên');
            }
            await db.query(
              'INSERT INTO role_assignments (role_id,user_id,context_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
              [manager.rows[0]!.id, user.rows[0]!.id, parent.rows[0]!.id],
            );
            await db.query(
              'INSERT INTO role_capabilities (context_id,role_id,capability,permission) ' +
              'VALUES ($1,$2,$3,1) ON CONFLICT (context_id,role_id,capability) ' +
              'DO UPDATE SET permission = 1',
              [child, manager.rows[0]!.id, 'files:view'],
            );
          }
        });
      }
      const publicSig = signing.sign(fileId, fileDomainForSpace(publicSpace.spaceId)).token;
      const centreSig = signing.sign(fileId, fileDomainForSpace(centreSpace.spaceId)).token;
      const download = (host: string, sig: string) =>
        http(app.getHttpServer()).get('/api/v1/files/' + fileId + '/download')
          .set('Host', host).query({ sig });
      const publicOk = await download(ROOT_HOST, publicSig);
      const centreOk = await download(CENTRE_HOST, centreSig);
      expect(publicOk.status, JSON.stringify(publicOk.body)).toBe(200);
      expect(centreOk.status, JSON.stringify(centreOk.body)).toBe(200);
      expect(Buffer.from(publicOk.body)).toEqual(bytes);
      expect(Buffer.from(centreOk.body)).toEqual(bytes);
      const wrongCentre = await download(CENTRE_HOST, publicSig);
      const wrongPublic = await download(ROOT_HOST, centreSig);
      expect(wrongCentre.status).toBe(401);
      expect(wrongPublic.status).toBe(401);
      // Quyền metadata vẫn do capability tại context quyết định.
      const centreMeta = await http(app.getHttpServer()).get('/api/v1/files/' + fileId)
        .set('Host', CENTRE_HOST).set('Authorization', 'Bearer ' + centreJwt);
      expect(centreMeta.status, JSON.stringify(centreMeta.body)).toBe(200);
    } finally {
      for (const space of spaces) {
        await withClient(storeUrl(space), (db) => db.query('DELETE FROM files WHERE id = $1', [fileId]));
      }
      await rm(path, { force: true });
    }
  });

  it('mật khẩu/đình chỉ ở A không ảnh hưởng học viên có cùng email ở công cộng', async () => {
    const change = await http(app.getHttpServer()).post('/api/v1/auth/change-password')
      .set('Host', CENTRE_HOST).set('Cookie', centreCookie)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(change.status, JSON.stringify(change.body)).toBe(201);
    const centreNew = await http(app.getHttpServer()).post('/api/v1/auth/sign-in/username')
      .set('Host', CENTRE_HOST).set('Origin', ROOT_ORIGIN)
      .send({ username: CENTRE_ADMIN_USERNAME, password: NEW_PASSWORD });
    expect(centreNew.status, JSON.stringify(centreNew.body)).toBe(200);
    const publicStill = await http(app.getHttpServer()).post('/api/v1/auth/sign-in/username')
      .set('Host', ROOT_HOST).set('Origin', ROOT_ORIGIN)
      .send({ username: LEARNER_USERNAME, password: PASSWORD });
    expect(publicStill.status, JSON.stringify(publicStill.body)).toBe(200);

    await withClient(storeUrl(centreSpace), async (db) =>
      db.query('UPDATE users SET suspended = true WHERE username = $1', [CENTRE_ADMIN_USERNAME]));
    const centreBlocked = await http(app.getHttpServer()).get('/api/v1/users/me')
      .set('Host', CENTRE_HOST).set('Cookie', cookieOf(centreNew));
    expect(centreBlocked.status).toBe(401);
    const publicNotBlocked = await http(app.getHttpServer()).get('/api/v1/users/me')
      .set('Host', ROOT_HOST).set('Cookie', publicCookie);
    expect(publicNotBlocked.status, JSON.stringify(publicNotBlocked.body)).toBe(200);
  });

  it('giáo viên công cộng mở lớp/khoá bằng API; dữ liệu không được ghi vào kho chung hay A', async () => {
    const teacherLogin = await http(app.getHttpServer()).post('/api/v1/auth/sign-in/username')
      .set('Host', ROOT_HOST).set('Origin', ROOT_ORIGIN)
      .send({ username: TEACHER_USERNAME, password: PASSWORD });
    expect(teacherLogin.status, JSON.stringify(teacherLogin.body)).toBe(200);
    const auth = { Cookie: cookieOf(teacherLogin) };
    const category = await withClient(storeUrl(publicSpace), async (db) => {
      await db.query("SELECT set_config('app.platform', 'on', false)");
      return db.query<{ id: string }>('SELECT id FROM course_categories ORDER BY id LIMIT 1');
    });
    expect(category.rows.length).toBeGreaterThan(0);
    const cls = await http(app.getHttpServer()).post('/api/v1/classes')
      .set('Host', ROOT_HOST).set(auth).send({ name: 'Lớp công cộng 8 ' + SFX });
    expect(cls.status, JSON.stringify(cls.body)).toBe(201);
    const course = await http(app.getHttpServer()).post('/api/v1/courses')
      .set('Host', ROOT_HOST).set(auth).send({
        fullName: 'Khoá công cộng 8 ' + SFX,
        shortName: 'C8' + SFX.toUpperCase(),
        category: category.rows[0]!.id,
        classId: cls.body.id,
      });
    expect(course.status, JSON.stringify(course.body)).toBe(201);
    courseId = course.body.id as string;
    classId = cls.body.id as string;

    for (const dbUrl of [process.env.DATABASE_URL!, storeUrl(centreSpace)]) {
      const classes = await withClient(dbUrl, (db) =>
        db.query<{ n: string }>('SELECT count(*)::text AS n FROM classes WHERE id = $1', [cls.body.id]));
      const courses = await withClient(dbUrl, (db) =>
        db.query<{ n: string }>('SELECT count(*)::text AS n FROM course WHERE id = $1', [course.body.id]));
      expect(classes.rows[0]?.n).toBe('0');
      expect(courses.rows[0]?.n).toBe('0');
    }
    const publicCourse = await withClient(storeUrl(publicSpace), async (db) => {
      await db.query("SELECT set_config('app.platform', 'on', false)");
      return db.query<{ n: string }>('SELECT count(*)::text AS n FROM course WHERE id = $1', [course.body.id]);
    });
    expect(publicCourse.rows[0]?.n).toBe('1');
  });

  it('học viên nộp bài và giáo viên công cộng chấm/trả; bài, nhận xét, điểm không vào kho A/chung', async () => {
    const web = app.getHttpServer();
    const teacher = await http(web).post('/api/v1/auth/sign-in/username')
      .set('Host', ROOT_HOST).set('Origin', ROOT_ORIGIN)
      .send({ username: TEACHER_USERNAME, password: PASSWORD });
    expect(teacher.status, JSON.stringify(teacher.body)).toBe(200);
    const teacherAuth = { Cookie: cookieOf(teacher) };
    const learnerAuth = { Cookie: publicCookie };

    // Lớp giáo viên tự tạo liên kết học viên bằng định danh có thật
    // trong KHO CÔNG CỘNG (email trùng ở trung tâm A nhưng là user khác).
    const roster = await http(web).post('/api/v1/classes/' + classId + '/roster/identity')
      .set('Host', ROOT_HOST).set(teacherAuth)
      .send({ fullName: 'Học viên công cộng', email: ADMIN_EMAIL });
    expect(roster.status, JSON.stringify(roster.body)).toBe(201);
    expect(roster.body.userId).toBe(publicUserId);

    const content = await http(web).get('/api/v1/courses/' + courseId + '/content')
      .set('Host', ROOT_HOST).set(teacherAuth);
    expect(content.status, JSON.stringify(content.body)).toBe(200);
    const sectionId = content.body.sections[0].id as string;
    const created = await http(web).post('/api/v1/courses/' + courseId + '/assignments')
      .set('Host', ROOT_HOST).set(teacherAuth)
      .send({ sectionId, name: 'Bài kiểm tra công cộng ' + SFX, grade: 10 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const assignmentId = created.body.id as string;

    const uploaded = await http(web).post('/api/v1/assignments/' + assignmentId + '/submission/files')
      .set('Host', ROOT_HOST).set(learnerAuth)
      .attach('file', Buffer.from('Bai lam cong cong ' + SFX), 'bai-lam.jpg');
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const submitted = await http(web).post('/api/v1/assignments/' + assignmentId + '/submission/submit')
      .set('Host', ROOT_HOST).set(learnerAuth).send({});
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);

    const graded = await http(web).post('/api/v1/assignments/' + assignmentId + '/submissions/' + publicUserId + '/grade')
      .set('Host', ROOT_HOST).set(teacherAuth).send({
        grade: 8.5, feedbackStrengths: 'Giải đúng trọng tâm',
        feedbackWeaknesses: 'Cần trình bày rõ', feedbackProgress: 'Có tiến bộ',
      });
    expect(graded.status, JSON.stringify(graded.body)).toBe(201);
    const released = await http(web).post('/api/v1/assignments/' + assignmentId + '/submissions/' + publicUserId + '/release')
      .set('Host', ROOT_HOST).set(teacherAuth).send({});
    expect(released.status, JSON.stringify(released.body)).toBe(201);
    const gradeView = await http(web).get('/api/v1/assignments/' + assignmentId)
      .set('Host', ROOT_HOST).set(learnerAuth);
    expect(gradeView.status, JSON.stringify(gradeView.body)).toBe(200);
    expect(gradeView.body.mySubmission.grade.grade).toBe(8.5);

    for (const dbUrl of [process.env.DATABASE_URL!, storeUrl(centreSpace)]) {
      const result = await withClient(dbUrl, (db) =>
        db.query<{ n: string }>('SELECT count(*)::text AS n FROM assign_submissions WHERE assignment_id = $1', [assignmentId]),
      );
      expect(result.rows[0]?.n).toBe('0');
    }
    const found = await withClient(storeUrl(publicSpace), async (db) => {
      await db.query("SELECT set_config('app.platform', 'on', false)");
      return db.query<{ n: string }>('SELECT count(*)::text AS n FROM assign_submissions WHERE assignment_id = $1', [assignmentId]);
    });
    expect(found.rows[0]?.n).toBe('1');
  });

  it('kho ngân hàng hệ thống cài thật chỉ có bảng tài nguyên; không có bảng hồ sơ, lớp, bài làm hay điểm', async () => {
    const result = await withClient(clusterUrl(BANK_DATABASE), async (db) => {
      const tables = await db.query<{ table_name: string }>(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name', ['public'],
      );
      return tables.rows.map((row) => row.table_name);
    });
    expect(result).toContain('system_questions');
    expect(result).toContain('system_question_versions');
    for (const businessTable of [
      'users', 'account', 'session', 'tenants', 'classes', 'course', 'course_categories',
      'exam_attempts', 'quiz_attempts', 'assignments', 'assign_submissions',
      'assign_grades', 'grade_items', 'grade_grades',
    ]) {
      expect(result, `Business table ${businessTable} must not exist in system bank`).not.toContain(businessTable);
    }
  });

  it('tài khoản vận hành chỉ có token audience riêng, không dùng làm nghiệp vụ học tập', async () => {
    const platformLogin = await http(app.getHttpServer()).post('/api/v1/auth/platform/login')
      .set('Host', ROOT_HOST).send({ username: 'admin', password: 'Admin123!' });
    expect(platformLogin.status, JSON.stringify(platformLogin.body)).toBe(201);
    const token = platformLogin.body.accessToken as string;
    expect(token).toBeTruthy();
    const allowed = await http(app.getHttpServer()).get('/api/v1/control-plane/spaces/by-slug/cong-cong')
      .set('Host', ROOT_HOST).set('Authorization', 'Bearer ' + token);
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    expect(allowed.body.slug).toBe('cong-cong');
    const blocked = await http(app.getHttpServer()).get('/api/v1/users/me')
      .set('Host', ROOT_HOST).set('Authorization', 'Bearer ' + token);
    expect(blocked.status).toBe(403);
    const studentNotOperator = await http(app.getHttpServer()).get('/api/v1/control-plane/spaces/by-slug/cong-cong')
      .set('Host', ROOT_HOST).set('Authorization', 'Bearer ' + publicJwt);
    expect(studentNotOperator.status).toBe(403);
    const wrongHost = await http(app.getHttpServer()).post('/api/v1/auth/platform/login')
      .set('Host', CENTRE_HOST).send({ username: 'admin', password: 'Admin123!' });
    expect(wrongHost.status).toBe(403);
  });

  it('P2: đăng ký quá hạn mức IP nhận 429 trước khi xử lý payload', async () => {
    // Các ca trước gửi 7 lần POST đăng ký cùng IP (limit test 7/phút).
    // Lần thứ tám phải bị throttler từ chối, kể cả body không hợp lệ.
    const excessive = await http(app.getHttpServer()).post('/api/v1/auth/public/register')
      .set('Host', ROOT_HOST).send({});
    expect(excessive.status, JSON.stringify(excessive.body)).toBe(429);
  });
  it('issue #12: phục hồi database vào staging và đăng nhập thật qua HTTP bằng role runtime', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { FleetRegistryWriter } = await import('../../../src/modules/fleet/fleet-registry-writer');
    const { dumpSpaceArchive } = await import('../../../src/modules/fleet/fleet-space-archive');
    const { runFleetRestore } = await import('../../../src/modules/fleet/fleet-restore');
    const work = await mkdtemp(join(tmpdir(), 'giaokhoa-restore-http-'));
    const stagingDb = 'giaokhoa_test_12_stage_' + SFX;
    const stagingCp = 'giaokhoa_test_12_cp_' + SFX;
    const runtimeRole = 'gk12runtime' + SFX;
    const migratorRole = 'gk12migrator' + SFX;
    const stagingFiles = join(work, 'files-restored');
    const stagingEnv = {
      ...process.env, CONTROL_PLANE_DATABASE_URL: clusterUrl(CP_DATABASE),
      DATABASE_ADMIN_URL: clusterUrl('postgres'),
      FLEET_BACKUP_DIR: join(work, 'backup'),
      FLEET_BACKUP_ENCRYPTION_KEY: 'e2e-issue12-isolated-secret',
      FILE_STORAGE_DRIVER: 'local',
      FLEET_RESTORE_RUNTIME_URL: clusterUrl(stagingDb, runtimeRole, 'E2eRestore12!'),
      FLEET_RESTORE_MIGRATION_URL: clusterUrl(stagingDb, migratorRole, 'E2eRestore12!'),
    };
    // Các ca trước đã đình chỉ admin A: mở lại tài khoản chỉ trong
    // database kiểm thử trước khi chụp, rồi nghiệm thu staging sau cùng.
    await withClient(storeUrl(centreSpace), (db) =>
      db.query('UPDATE users SET suspended = false WHERE username = $1', [CENTRE_ADMIN_USERNAME]));
    const previousCp = process.env.CONTROL_PLANE_DATABASE_URL;
    const previousRuntime = process.env.FLEET_RESTORE_RUNTIME_URL;
    const previousFileDir = process.env.FILE_STORAGE_DIR;
    let stagingApp: INestApplication | undefined;
    let sourceFilePath: string | undefined;
    try {
      const sourceLogin = await http(app.getHttpServer()).post('/api/v1/auth/sign-in/username')
        .set('Host', CENTRE_HOST).set('Origin', ROOT_ORIGIN)
        .send({ username: CENTRE_ADMIN_USERNAME, password: NEW_PASSWORD });
      expect(sourceLogin.status, JSON.stringify(sourceLogin.body)).toBe(200);
      const manager = { Cookie: cookieOf(sourceLogin) };
      const category = await withClient(storeUrl(centreSpace), async (db) => {
        await db.query("SELECT set_config('app.platform', 'on', false)");
        const existing = await db.query<{ id: string }>('SELECT id FROM course_categories LIMIT 1');
        if (existing.rows.length) return existing;
        return db.query<{ id: string }>(
          'INSERT INTO course_categories (tenant_id, name) VALUES ($1, $2) RETURNING id',
          [centreSpace.tenantId, 'Danh mục phục hồi'],
        );
      });
      // Danh mục fixture tạo trực tiếp cần context cấp 40 bên dưới
      // context tenant; API chặn tạo course nếu chỉ có dòng danh mục.
      await withClient(storeUrl(centreSpace), async (db) => {
        const parent = await db.query<{ id: string; path: string; depth: number }>(
          'SELECT id, path, depth FROM context WHERE context_level = 20 AND instance_id = $1',
          [centreSpace.tenantId]);
        const contextId = uuidv7();
        await db.query(
          'INSERT INTO context (id,context_level,instance_id,path,depth) VALUES ($1,40,$2,$3,$4)',
          [contextId, category.rows[0]!.id, parent.rows[0]!.path + '/' + contextId, parent.rows[0]!.depth + 1]);
      });
      const cls = await http(app.getHttpServer()).post('/api/v1/classes').set('Host', CENTRE_HOST)
        .set(manager).send({ name: 'Lớp A để nghiệm thu restore' });
      expect(cls.status, JSON.stringify(cls.body)).toBe(201);
      const course = await http(app.getHttpServer()).post('/api/v1/courses').set('Host', CENTRE_HOST)
        .set(manager).send({ fullName: 'Khoá học phục hồi A', shortName: 'REST12' + SFX.toUpperCase(),
          classId: cls.body.id, category: category.rows[0]!.id });
      expect(course.status, JSON.stringify(course.body)).toBe(201);
      const content = await http(app.getHttpServer())
        .get('/api/v1/courses/' + course.body.id + '/content').set('Host', CENTRE_HOST).set(manager);
      expect(content.status, JSON.stringify(content.body)).toBe(200);
      const assignment = await http(app.getHttpServer())
        .post('/api/v1/courses/' + course.body.id + '/assignments').set('Host', CENTRE_HOST)
        .set(manager).send({ name: 'Bài tập phục hồi A', sectionId: content.body.sections[0].id, grade: 10 });
      expect(assignment.status, JSON.stringify(assignment.body)).toBe(201);
      const studentName = 'studentrestore12' + SFX;
      const studentEmail = studentName + '@example.com';
      const roster = await http(app.getHttpServer())
        .post('/api/v1/classes/' + cls.body.id + '/roster/identity')
        .set('Host', CENTRE_HOST).set(manager).send({ fullName: 'Học viên A', email: studentEmail });
      expect(roster.status, JSON.stringify(roster.body)).toBe(201);
      expect(roster.body.outcome).toBe('created');
      // Luồng roster tạo user + mật khẩu tạm thật, không bỏ qua cổng user:create.
      const student = { body: { id: roster.body.userId } };
      const studentLogin = await http(app.getHttpServer()).post('/api/v1/auth/token')
        .set('Host', CENTRE_HOST)
        .send({ username: roster.body.username, password: roster.body.temporaryPassword });
      expect(studentLogin.status, JSON.stringify(studentLogin.body)).toBe(201);
      const learner = { Authorization: 'Bearer ' + studentLogin.body.accessToken };
      const fileBytes = Buffer.from('Bài nộp thuộc A ' + SFX);
      const upload = await http(app.getHttpServer())
        .post('/api/v1/assignments/' + assignment.body.id + '/submission/files')
        .set('Host', CENTRE_HOST).set(learner)
        .attach('file', fileBytes, { filename: 'restore12.txt', contentType: 'application/octet-stream' });
      expect(upload.status, JSON.stringify(upload.body)).toBe(201);
      const submitted = await http(app.getHttpServer())
        .post('/api/v1/assignments/' + assignment.body.id + '/submission/submit')
        .set('Host', CENTRE_HOST).set(learner).send({});
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
      const grade = await http(app.getHttpServer())
        .post('/api/v1/assignments/' + assignment.body.id + '/submissions/' + student.body.id + '/grade')
        .set('Host', CENTRE_HOST).set(manager)
        .send({ grade: 8.5, feedbackStrengths: 'Đúng', feedbackWeaknesses: 'Thiếu giải thích', feedbackProgress: 'Tiến bộ' });
      expect(grade.status, JSON.stringify(grade.body)).toBe(201);
      const released = await http(app.getHttpServer())
        .post('/api/v1/assignments/' + assignment.body.id + '/submissions/' + student.body.id + '/release')
        .set('Host', CENTRE_HOST).set(manager).send({});
      expect(released.status, JSON.stringify(released.body)).toBe(201);
      const savedFile = await withClient(storeUrl(centreSpace), (db) =>
        db.query<{ id: string; content_hash: string }>(
          'SELECT id, content_hash FROM files WHERE file_name = $1 LIMIT 1', ['restore12.txt']));
      expect(savedFile.rows).toHaveLength(1);
      sourceFilePath = app.get<ObjectStorage>(OBJECT_STORAGE).keyFor(
        fileDomainForSpace(centreSpace.spaceId), savedFile.rows[0]!.content_hash,
      );
      const writer = new FleetRegistryWriter(stagingEnv);
      const sourceSpace = (await writer.listFleetSpaces()).find((space) => space.slug === CENTRE_SLUG)!;
      await writer.close();
      await dumpSpaceArchive({
        space: sourceSpace, url: clusterUrl(centreSpace.databaseName),
        dir: join(work, 'backup', CENTRE_SLUG), kind: 'scheduled', runId: 'http-restore',
        at: new Date(), encryptionKey: stagingEnv.FLEET_BACKUP_ENCRYPTION_KEY, env: stagingEnv,
      });
      const restored = await runFleetRestore({
        slug: CENTRE_SLUG, expectedSpaceId: centreSpace.spaceId,
        targetDatabase: stagingDb, targetFilesDir: stagingFiles,
        env: stagingEnv, log: () => undefined,
      });
      expect(restored.database).toBe(stagingDb);
      await withClient(clusterUrl('postgres'), (admin) =>
        admin.query('CREATE DATABASE ' + quoted(stagingCp)));
      await migrateStore(stagingCp, CP_MIGRATIONS);
      await withClient(clusterUrl(stagingCp), async (db) => {
        await db.query(
          "INSERT INTO space_registry (id,slug,name,kind,status,database_name,storage_mode,connection_role_ref,secret_ref) " +
          "VALUES ($1,$2,$3,'center','active',$4,'dedicated',$5,$6)",
          [centreSpace.spaceId, CENTRE_SLUG, 'Trung tâm staging', stagingDb,
            runtimeRole, 'env:FLEET_RESTORE_RUNTIME_URL'],
        );
        await db.query('INSERT INTO space_schema_registry (space_id) VALUES ($1)', [centreSpace.spaceId]);
      });
      process.env.CONTROL_PLANE_DATABASE_URL = clusterUrl(stagingCp);
      process.env.FLEET_RESTORE_RUNTIME_URL = stagingEnv.FLEET_RESTORE_RUNTIME_URL!;
      process.env.FILE_STORAGE_DIR = stagingFiles;
      stagingApp = await createMountedTestApp();
      const login = await http(stagingApp.getHttpServer()).post('/api/v1/auth/sign-in/username')
        .set('Host', CENTRE_HOST).set('Origin', ROOT_ORIGIN)
        .send({ username: CENTRE_ADMIN_USERNAME, password: NEW_PASSWORD });
      expect(login.status, JSON.stringify(login.body)).toBe(200);
      const me = await http(stagingApp.getHttpServer()).get('/api/v1/users/me')
        .set('Host', CENTRE_HOST).set('Cookie', cookieOf(login));
      expect(me.status, JSON.stringify(me.body)).toBe(200);
      const stagingAdmin = { Cookie: cookieOf(login) };
      const stagingStudentLogin = await http(stagingApp.getHttpServer()).post('/api/v1/auth/token')
        .set('Host', CENTRE_HOST)
        .send({ username: roster.body.username, password: roster.body.temporaryPassword });
      expect(stagingStudentLogin.status, JSON.stringify(stagingStudentLogin.body)).toBe(201);
      const stagingStudent = { Authorization: 'Bearer ' + stagingStudentLogin.body.accessToken };
      const restoredMe = await http(stagingApp.getHttpServer()).get('/api/v1/users/me')
        .set('Host', CENTRE_HOST).set(stagingStudent);
      expect(restoredMe.status, JSON.stringify(restoredMe.body)).toBe(200);
      expect(restoredMe.body.id).toBe(student.body.id);
      const restoredContent = await http(stagingApp.getHttpServer())
        .get('/api/v1/courses/' + course.body.id + '/content')
        .set('Host', CENTRE_HOST).set(stagingAdmin);
      expect(restoredContent.status, JSON.stringify(restoredContent.body)).toBe(200);
      expect(restoredContent.body.sections).toHaveLength(content.body.sections.length);
      const restoredHomework = await http(stagingApp.getHttpServer())
        .get('/api/v1/assignments/' + assignment.body.id)
        .set('Host', CENTRE_HOST).set(stagingStudent);
      expect(restoredHomework.status, JSON.stringify(restoredHomework.body)).toBe(200);
      expect(restoredHomework.body.mySubmission.grade.grade).toBe(8.5);
      const restoredGrading = await http(stagingApp.getHttpServer())
        .get('/api/v1/assignments/' + assignment.body.id + '/submissions/' + student.body.id)
        .set('Host', CENTRE_HOST).set(stagingAdmin);
      expect(restoredGrading.status, JSON.stringify(restoredGrading.body)).toBe(200);
      const signed = stagingApp.get(FileSigningService)
        .sign(savedFile.rows[0]!.id, fileDomainForSpace(centreSpace.spaceId)).token;
      const downloaded = await http(stagingApp.getHttpServer())
        .get('/api/v1/files/' + savedFile.rows[0]!.id + '/download')
        .set('Host', CENTRE_HOST).query({ sig: signed });
      expect(downloaded.status, JSON.stringify(downloaded.body)).toBe(200);
      expect(Buffer.from(downloaded.body)).toEqual(fileBytes);
      const publicUnchanged = await withClient(storeUrl(publicSpace), (db) =>
        db.query<{ n: string }>('SELECT count(*)::text AS n FROM assign_submissions WHERE assignment_id = $1',
          [assignment.body.id]));
      expect(publicUnchanged.rows[0]!.n).toBe('0');
      const sourceUnchanged = await withClient(storeUrl(centreSpace), (db) =>
        db.query<{ n: string }>('SELECT count(*)::text AS n FROM assign_submissions WHERE assignment_id = $1',
          [assignment.body.id]));
      expect(sourceUnchanged.rows[0]!.n).toBe('1');
    } finally {
      await stagingApp?.close();
      if (previousCp === undefined) delete process.env.CONTROL_PLANE_DATABASE_URL;
      else process.env.CONTROL_PLANE_DATABASE_URL = previousCp;
      if (previousRuntime === undefined) delete process.env.FLEET_RESTORE_RUNTIME_URL;
      else process.env.FLEET_RESTORE_RUNTIME_URL = previousRuntime;
      if (previousFileDir === undefined) delete process.env.FILE_STORAGE_DIR;
      else process.env.FILE_STORAGE_DIR = previousFileDir;
      await withClient(clusterUrl('postgres'), async (admin) => {
        for (const name of [stagingDb, stagingCp]) {
          await admin.query('DROP DATABASE IF EXISTS ' + quoted(name) + ' WITH (FORCE)');
        }
        for (const role of [runtimeRole, migratorRole]) {
          await admin.query('DROP ROLE IF EXISTS ' + quoted(role));
        }
      }).catch(() => undefined);
      if (sourceFilePath) await rm(sourceFilePath, { force: true });
      await rm(work, { recursive: true, force: true });
    }
  }, 180_000);


});
