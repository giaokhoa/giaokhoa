import { grantSystemRole, revokeSystemRole } from '../../helpers/roles.js';
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import { authzContexts, fileBlobs, files, fileSources, users } from '@giaokhoa/database/schema';
import type { Database } from '@giaokhoa/database/types';
import { createAuth } from '../../../src/auth/auth.js';

type AppAuth = ReturnType<typeof createAuth>;

const testDatabaseName = `giaokhoa_curriculum_auth_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;
const missingId = '0199f6e8-865f-7a63-b4ad-a6d488412248';

function databaseUrl(databaseName: string) {
  if (!originalDatabaseUrl)
    throw new Error('DATABASE_URL is required for curriculum auth e2e tests');
  const url = new URL(originalDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function withAdminConnection<T>(run: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: databaseUrl('postgres') });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function cookieHeader(headers: Headers) {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe('Phân quyền truy cập chương trình học qua HTTP', () => {
  let app: INestApplication<App>;
  let pool: Pool;
  let db: Database;
  let auth: AuthService<AppAuth>;

  beforeAll(async () => {
    await withAdminConnection((client) => client.query(`CREATE DATABASE "${testDatabaseName}"`));
    process.env.DATABASE_URL = databaseUrl(testDatabaseName);
    process.env.RESEND_API_KEY = '';
    process.env.RESEND_FROM_EMAIL = '';

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const migrationDb = drizzle(pool);
    await migrate(migrationDb, { migrationsFolder });

    const { AppModule } = await import('../../../src/app.module.js');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = module.createNestApplication();
    await app.init();

    db = app.get<Database>(getDrizzleToken());
    auth = app.get<AuthService<AppAuth>>(AuthService);
  }, 20_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();

    restoreEnv('DATABASE_URL', originalDatabaseUrl);
    restoreEnv('RESEND_API_KEY', originalResendApiKey);
    restoreEnv('RESEND_FROM_EMAIL', originalResendFromEmail);

    await withAdminConnection((client) =>
      client.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`),
    );
  }, 20_000);

  async function createSession(email: string) {
    const { headers, response } = await auth.api.signUpEmail({
      returnHeaders: true,
      body: {
        email,
        name: 'Test User',
        password: 'password1234',
      },
    });

    return {
      cookie: cookieHeader(headers),
      userId: response.user.id,
    };
  }

  it('kiểm tra quyền hệ thống theo context và thu hồi ngay mà không dùng admin plugin', async () => {
    await request(app.getHttpServer()).get('/subjects').expect(401);

    const regular = await createSession(`user-${randomUUID()}@example.com`);
    const admin = await createSession(`admin-${randomUUID()}@example.com`);
    await grantSystemRole(db, admin.userId, 'admin');

    const protectedPaths = [
      '/subjects',
      `/curricula/${missingId}`,
      `/curriculum-nodes/${missingId}`,
      `/learning-outcomes/${missingId}`,
    ];

    for (const path of protectedPaths) {
      await request(app.getHttpServer()).get(path).set('cookie', regular.cookie).expect(403);
    }

    await request(app.getHttpServer()).get('/subjects').set('cookie', admin.cookie).expect(200);
    await request(app.getHttpServer())
      .post(`/authorization/system-roles/${regular.userId}`)
      .set('cookie', regular.cookie)
      .send({ role: 'teacher' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/authorization/system-roles/${regular.userId}`)
      .set('cookie', admin.cookie)
      .send({ role: 'teacher' })
      .expect(201, { changed: true });
    await request(app.getHttpServer())
      .post(`/authorization/system-roles/${regular.userId}`)
      .set('cookie', admin.cookie)
      .send({ role: 'teacher' })
      .expect(201, { changed: false });
    await request(app.getHttpServer())
      .delete(`/authorization/system-roles/${regular.userId}`)
      .set('cookie', admin.cookie)
      .send({ role: 'teacher' })
      .expect(200, { changed: true });
    await request(app.getHttpServer())
      .get('/api/auth/admin/list-users')
      .set('cookie', admin.cookie)
      .expect(404);
    for (const path of protectedPaths.slice(1)) {
      await request(app.getHttpServer()).get(path).set('cookie', admin.cookie).expect(404);
    }
    await revokeSystemRole(db, admin.userId, 'admin');
    await request(app.getHttpServer()).get('/subjects').set('cookie', admin.cookie).expect(403);
  });

  it('quản trị định nghĩa role và ma trận qua HTTP, từ chối tài khoản không đủ quyền', async () => {
    const regular = await createSession(`role-user-${randomUUID()}@example.com`);
    const admin = await createSession(`role-admin-${randomUUID()}@example.com`);
    await grantSystemRole(db, admin.userId, 'admin');
    const roleKey = `custom_${randomUUID()}`;
    const create = { key: roleKey, contextKind: 'class', contexts: ['class'] };
    await request(app.getHttpServer())
      .post('/authorization/roles')
      .set('cookie', regular.cookie)
      .send(create)
      .expect(403);
    await request(app.getHttpServer())
      .post('/authorization/roles')
      .set('cookie', admin.cookie)
      .send(create)
      .expect(201, { changed: true });
    await request(app.getHttpServer())
      .put(`/authorization/roles/${roleKey}/permissions`)
      .set('cookie', admin.cookie)
      .send({ capability: 'class:update', effect: 'ALLOW' })
      .expect(200, { changed: true });
    await request(app.getHttpServer())
      .put(`/authorization/roles/${roleKey}/contexts`)
      .set('cookie', admin.cookie)
      .send({ contexts: ['class', 'assignment'] })
      .expect(200, { changed: true });
    await request(app.getHttpServer())
      .put('/authorization/roles/system:admin/matrix')
      .set('cookie', regular.cookie)
      .send({ targetRoleKey: roleKey, action: 'assign', allowed: true })
      .expect(403);
    await request(app.getHttpServer())
      .put('/authorization/roles/system:admin/matrix')
      .set('cookie', admin.cookie)
      .send({ targetRoleKey: roleKey, action: 'assign', allowed: true })
      .expect(200, { changed: true });
    const [system] = await db
      .select({ id: authzContexts.id })
      .from(authzContexts)
      .where(eq(authzContexts.kind, 'system'))
      .limit(1);
    await request(app.getHttpServer())
      .post(`/authorization/contexts/${system.id}/roles/${regular.userId}`)
      .set('cookie', admin.cookie)
      .send({ roleKey: 'system:teacher' })
      .expect(201, { changed: true });
    await request(app.getHttpServer())
      .delete(`/authorization/contexts/${system.id}/roles/${regular.userId}`)
      .set('cookie', regular.cookie)
      .send({ roleKey: 'system:teacher' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/authorization/contexts/${system.id}/roles/${regular.userId}`)
      .set('cookie', admin.cookie)
      .send({ roleKey: 'system:teacher' })
      .expect(200, { changed: true });
  });

  it('khóa tài khoản thu hồi quyền truy cập nguồn TikZ đang tồn tại qua phiên cũ', async () => {
    const user = await createSession(`ban-existing-${randomUUID()}@example.com`);
    const hash = createHash('sha256').update(randomUUID()).digest('hex');
    await db
      .insert(fileBlobs)
      .values({ contentHash: hash, storageKey: `files/${hash}`, byteSize: 10 });
    const [image] = await db
      .insert(files)
      .values({
        createdByUserId: user.userId,
        contentHash: hash,
        mimeType: 'image/svg+xml',
        width: 16,
        height: 16,
        originalFilename: 'tikz.svg',
      })
      .returning();
    await db
      .insert(fileSources)
      .values({ fileId: image.id, kind: 'tikz', source: 'du lieu rieng' });

    await request(app.getHttpServer())
      .get(`/files/${image.id}/source`)
      .set('cookie', user.cookie)
      .expect(200, { kind: 'tikz', source: 'du lieu rieng' });
    await db.update(users).set({ banned: true }).where(eq(users.id, user.userId));
    await request(app.getHttpServer())
      .get(`/files/${image.id}/source`)
      .set('cookie', user.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/files/${image.id}`)
      .set('cookie', user.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post('/files/discard')
      .set('cookie', user.cookie)
      .send({ files: [] })
      .expect(403);
    await request(app.getHttpServer()).get('/subjects').set('cookie', user.cookie).expect(403);
  });

  it('chặn tạo phiên khi tài khoản bị khóa, không phụ thuộc vào plugin quản trị', async () => {
    const email = `suspended-${randomUUID()}@example.com`;
    const created = await createSession(email);
    await db.update(users).set({ banned: true }).where(eq(users.id, created.userId));
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email, password: 'password1234' })
      .expect(403);
    await db.update(users).set({ banned: false }).where(eq(users.id, created.userId));
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email, password: 'password1234' })
      .expect(200);
  });
});
