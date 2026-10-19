import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { migrationsFolder } from '@giaokhoa/database/migrations';
import { users } from '@giaokhoa/database/schema';
import type { Database } from '@giaokhoa/database/types';
import { createAuth } from '../src/auth/auth.js';

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

describe('Curriculum authorization (e2e)', () => {
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

    const { AppModule } = await import('../src/app.module.js');
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

  it('requires the system admin role for all curriculum resource controllers', async () => {
    await request(app.getHttpServer()).get('/subjects').expect(401);

    const regular = await createSession(`user-${randomUUID()}@example.com`);
    const [regularUser] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, regular.userId))
      .limit(1);
    expect(regularUser?.role).toBe('user');

    const admin = await createSession(`admin-${randomUUID()}@example.com`);
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.userId));

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
    for (const path of protectedPaths.slice(1)) {
      await request(app.getHttpServer()).get(path).set('cookie', admin.cookie).expect(404);
    }
  });
});
