import { INestApplication, RequestMethod, VersioningType, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { TenantsService } from '../../src/modules/tenants/tenants.service';
import { RolesService } from '../../src/modules/access/roles.service';
import { ContextsService } from '../../src/modules/access/contexts.service';
import { tenantAls } from '../../src/modules/tenants/tenant-als';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { enableTrustedProxy } from '../../src/common/client-ip';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter';
import { REDIS_THROTTLER_KEY_PREFIX } from '../../src/common/redis-throttler.storage';
import { SpaceDatabaseService } from '../../src/db/routing/space-database.service';
import { BetterAuthService } from '../../src/modules/auth/better-auth/better-auth.service';
import { mountBetterAuth } from '../../src/modules/auth/better-auth/better-auth.mount';
import { McpDepsService } from '../../src/modules/mcp/mcp-deps.service';
import { mountMcp } from '../../src/modules/mcp/mcp.mount';
import { MessagingRedisIoAdapter } from '../../src/modules/messaging/messaging-redis-io.adapter';

process.env.FILE_STORAGE_DIR = process.env.FILE_STORAGE_DIR ?? '/tmp/giaokhoa-test-files';

export const ADMIN = { username: 'admin', password: 'Admin123!' };
export const STRONG_PASSWORD = 'Passw0rd!';

async function resetRedisThrottlerCounters(): Promise<void> {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `${REDIS_THROTTLER_KEY_PREFIX}*`, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) await client.del(...keys);
    } while (cursor !== '0');
  } finally {
    client.disconnect();
  }
}

export async function createTestApp(options?: { controllers?: Array<Type<unknown>> }): Promise<INestApplication> {
  await resetRedisThrottlerCounters().catch(() => undefined);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: options?.controllers ?? [] }).compile();
  const app = moduleRef.createNestApplication();
  app.useSecurityHeaders();
  const expressApp = app as NestExpressApplication;
  enableTrustedProxy(expressApp);
  const config = app.get(ConfigService);
  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.enableCsrfProtection({
    trustedOrigins: corsOrigins,
    exclude: [
      { path: 'payments/ipn/sepay', method: RequestMethod.POST, version: '1' },
      { path: 'payments/webhook', method: RequestMethod.POST, version: '1' },
      { path: 'webservice/call', method: RequestMethod.POST, version: '1' },
      { path: 'mcp', method: RequestMethod.POST },
    ],
  });
  const betterAuth = app.get(BetterAuthService);
  if (betterAuth.auth) {
    mountBetterAuth(expressApp, betterAuth.requireAuth(), app.get(SpaceDatabaseService, { strict: false }));
  }
  mountMcp(expressApp, app.get(McpDepsService).createMountDeps());
  app.setGlobalPrefix('api', { exclude: [{ path: 'mcp', method: RequestMethod.ALL }] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter());
  const socketAdapter = new MessagingRedisIoAdapter(app, config.getOrThrow<string>('REDIS_URL'), corsOrigins);
  await socketAdapter.connectToRedis();
  app.useWebSocketAdapter(socketAdapter);
  app.enableShutdownHooks();
  await app.init();
  return app;
}

export function http(app: INestApplication) { return request(app.getHttpServer()); }

export async function login(app: INestApplication, username: string, password: string): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const res = await http(app).post('/api/v1/auth/token').send({ username, password });
  if (res.status !== 200 && res.status !== 201) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken, userId: res.body.user.id };
}

export async function adminToken(app: INestApplication): Promise<string> {
  return (await login(app, ADMIN.username, ADMIN.password)).accessToken;
}

let counter = 0;
export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export async function createUserViaApi(app: INestApplication, token: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; username: string; email: string }> {
  const username = uniqueName('user');
  const res = await http(app).post('/api/v1/users').set('Authorization', `Bearer ${token}`)
    .send({ username, email: `${username}@example.com`, password: STRONG_PASSWORD, firstName: 'Test', lastName: 'User', ...overrides });
  if (res.status !== 200 && res.status !== 201) throw new Error(`create user failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createContextViaApi(app: INestApplication, token: string, contextLevel: number, instanceId: string, parentId?: string): Promise<{ id: string; path: string }> {
  const res = await http(app).post('/api/v1/access/contexts').set('Authorization', `Bearer ${token}`)
    .send({ contextLevel, instanceId, parentId });
  if (res.status !== 200 && res.status !== 201) throw new Error(`create context failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function systemContextId(app: INestApplication, token: string): Promise<string> {
  const res = await http(app).get('/api/v1/access/contexts').set('Authorization', `Bearer ${token}`);
  const system = (res.body as { id: string; contextLevel: number }[]).find((c) => c.contextLevel === 10);
  if (!system) throw new Error('system context missing');
  return system.id;
}

export async function roleIdByShortname(app: INestApplication, token: string, shortName: string): Promise<string> {
  const res = await http(app).get('/api/v1/access/roles').set('Authorization', `Bearer ${token}`);
  const roleRow = (res.body as { id: string; shortName: string }[]).find((r) => r.shortName === shortName);
  if (!roleRow) throw new Error(`role ${shortName} missing`);
  return roleRow.id;
}

export async function createRoleViaApi(app: INestApplication, token: string): Promise<string> {
  const shortName = uniqueName('role');
  const res = await http(app).post('/api/v1/access/roles').set('Authorization', `Bearer ${token}`)
    .send({ name: `Role ${shortName}`, shortName });
  if (res.status !== 200 && res.status !== 201) throw new Error(`create role failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

export async function assignRole(app: INestApplication, token: string, userId: string, roleId: string, contextId: string): Promise<void> {
  const res = await http(app).post('/api/v1/access/assignments').set('Authorization', `Bearer ${token}`).send({ userId, roleId, contextId });
  if (res.status !== 200 && res.status !== 201) throw new Error(`assign failed: ${res.status} ${JSON.stringify(res.body)}`);
}

export async function setOverride(app: INestApplication, token: string, roleId: string, capability: string, contextId: string, permission: number): Promise<void> {
  const res = await http(app).post('/api/v1/access/overrides').set('Authorization', `Bearer ${token}`).send({ roleId, capability, contextId, permission });
  if (res.status !== 200 && res.status !== 201) throw new Error(`override failed: ${res.status} ${JSON.stringify(res.body)}`);
}

export async function hasCapability(app: INestApplication, token: string, userId: string, capability: string, contextId: string): Promise<boolean> {
  const res = await http(app).get('/api/v1/access/has-capability').query({ userId, capability, contextId }).set('Authorization', `Bearer ${token}`);
  if (res.status !== 200) throw new Error(`has-capability failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.allowed as boolean;
}


export async function grantTenantManagerFixture(app: INestApplication, token: string, tenantId: string): Promise<void> {
  const actor = await app.get(JwtService, { strict: false }).verifyAsync<{ sub: string }>(token);
  const tenants = app.get(TenantsService, { strict: false });
  const roles = app.get(RolesService, { strict: false });
  const contexts = app.get(ContextsService, { strict: false });
  await tenantAls.run({ platform: true }, async () => {
    await tenants.ensureActiveMembership(tenantId, actor.sub);
    const manager = await roles.getRoleByShortname('manager');
    if (!manager) throw new Error('Thiếu vai manager mặc định trong fixture');
    const context = await contexts.ensureTenantContext(tenantId);
    await roles.assignRole(actor.sub, manager.id, context.id);
  });
}

export async function seedTenantMembershipFixture(app: INestApplication, tenantId: string, userId: string): Promise<void> {
  const tenants = app.get(TenantsService, { strict: false });
  await tenantAls.run({ platform: true }, () => tenants.ensureActiveMembership(tenantId, userId));
}
