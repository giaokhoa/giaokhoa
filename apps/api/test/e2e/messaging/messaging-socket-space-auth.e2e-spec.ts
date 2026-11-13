import { JwtService } from '@nestjs/jwt';
import { INestApplication, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createControlPlaneKysely } from '@giaokhoa/db/control-plane';

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

function signedBetterAuthCookie(token: string): string {
  const signature = createHmac('sha256', BETTER_AUTH_SECRET).update(token).digest('base64');
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

const CP_DATABASE = 'giaokhoa_test_cp_sock587';
const CP_ROLE = 'giaokhoa_cp_sock587';
const CP_PASSWORD = 'cp-test-sock587';
const CENTRE_DATABASE = 'giaokhoa_test_centre_sock587';
const CENTRE_ROLE = 'giaokhoa_centre_sock587_app';
const CENTRE_PASSWORD = 'centre-sock-test-587';
const RUN_SUFFIX = Math.random().toString(36).slice(2, 8);
const CENTRE_SLUG = `trung-tam-sock-587-${RUN_SUFFIX}`;
const HOST = `${CENTRE_SLUG}.test.local`;
const MESSAGE_TEXT = 'Tin chi o kho rieng 587';

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

async function copyRows(
  sourceUrl: string,
  targetUrl: string,
  table: string,
  whereColumn: string,
  whereValue: string,
): Promise<void> {
  const rows = await withClient(sourceUrl, async (client) => {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    const result = await client.query(`SELECT * FROM ${quoted(table)} WHERE ${quoted(whereColumn)} = $1`, [
      whereValue,
    ]);
    return result.rows as Record<string, unknown>[];
  });
  if (!rows.length) throw new Error(`Không tìm thấy dòng nguồn ${table}.${whereColumn}=${whereValue}`);
  await withClient(targetUrl, async (client) => {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    for (const row of rows) {
      const columns = Object.keys(row);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      await client.query(
        `INSERT INTO ${quoted(table)} (${columns.map(quoted).join(', ')}) VALUES (${placeholders})`,
        columns.map((column) => row[column]),
      );
    }
  });
}

async function copyRowById(sourceUrl: string, targetUrl: string, table: string, id: string): Promise<void> {
  await copyRows(sourceUrl, targetUrl, table, 'id', id);
}

async function copyMemberToCentre(userId: string, tenantId: string): Promise<void> {
  const centreUrl = clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD);
  await copyRowById(process.env.DATABASE_URL!, centreUrl, 'users', userId);
  const membershipRow = await withClient(process.env.DATABASE_URL!, async (client) => {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    const result = await client.query<{ id: string }>(
      'SELECT id FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, userId],
    );
    return result.rows[0];
  });
  if (!membershipRow) throw new Error('membership của tài khoản ở tenant kiểm chứng không tồn tại');
  await copyRowById(process.env.DATABASE_URL!, centreUrl, 'tenant_memberships', membershipRow.id);
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

async function seedSession(connectionString: string, token: string, userId: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    await client.query(
      `INSERT INTO "session" (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [token, userId],
    );
  });
}

interface WireMessage {
  id: string;
  conversationId: string;
  userIdFrom: string;
  fullMessage: string;
  seq: number;
}

describe('Socket realtime tại địa chỉ trung tâm ở kho riêng (đầu-cuối, issue #587)', () => {
  let app: INestApplication;
  let base: string;
  let tenantId = '';
  let memberAId = '';
  let memberBId = '';
  let sharedOnlyId = '';
  let convId = '';
  let tokenWithClaim = '';
  let tokenWithoutClaim = '';
  let sessionTokenA = '';
  let sessionTokenB = '';
  let sessionTokenSharedOnly = '';

  const sockets: Socket[] = [];

  function socketAtHost(host: string, opts: { cookieToken?: string; token?: string }): Socket {
    const socket = io(`${base}/messaging`, {
      auth: opts.token ? { token: opts.token } : undefined,
      extraHeaders: {
        Host: host,
        ...(opts.cookieToken ? { Cookie: signedBetterAuthCookie(opts.cookieToken) } : {}),
      },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    sockets.push(socket);
    return socket;
  }

  function centreSocket(opts: { cookieToken?: string; token?: string }): Socket {
    return socketAtHost(HOST, opts);
  }

  async function awaitConnected(socket: Socket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  async function waitForSocketEvent<T>(
    socket: Socket,
    event: string,
    predicate: (payload: T) => boolean,
    timeoutMs = 9000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, handler);
        reject(new Error(`không nhận được sự kiện ${event} khớp điều kiện trong ${timeoutMs}ms`));
      }, timeoutMs);
      const handler = (payload: T) => {
        if (!predicate(payload)) return;
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      };
      socket.on(event, handler);
    });
  }

  async function awaitRejected(socket: Socket): Promise<void> {
    const outcome = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 8000);
      socket.on('disconnect', () => { clearTimeout(timer); resolve('disconnected'); });
      socket.on('connect_error', () => { clearTimeout(timer); resolve('connect_error'); });
    });
    expect(['disconnected', 'connect_error']).toContain(outcome);
    expect(socket.connected).toBe(false);
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const must = async (res: { status: number; body: unknown }, what: string) => {
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body as never;
  };

  beforeAll(async () => {
    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
      await admin.query(`CREATE ROLE ${CP_ROLE} LOGIN PASSWORD '${CP_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${CENTRE_ROLE} LOGIN PASSWORD '${CENTRE_PASSWORD}'`);
      await admin.query(`CREATE DATABASE ${CP_DATABASE} OWNER ${CP_ROLE}`);
      await admin.query(`CREATE DATABASE ${CENTRE_DATABASE} OWNER ${CENTRE_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CP_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CP_DATABASE} TO ${CP_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CENTRE_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CENTRE_DATABASE} TO ${CENTRE_ROLE}`);
    });
    await applyControlPlaneMigrations(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD));
    await applyBusinessBaseline(clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD));

    process.env.CONTROL_PLANE_DATABASE_URL = clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD);
    process.env.SPACE_TEST_SOCK587_URL = clusterUrl('postgres', CENTRE_ROLE, CENTRE_PASSWORD);

    const cpPool = new Pool({ connectionString: clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD) });
    const cpDb = createControlPlaneKysely(cpPool);
    try {
      await cpDb.insertInto('space_registry').values([
        {
          slug: CENTRE_SLUG,
          name: 'Trung tâm socket 587',
          kind: 'center',
          status: 'active',
          database_name: CENTRE_DATABASE,
          storage_mode: 'dedicated',
          connection_role_ref: CENTRE_ROLE,
          secret_ref: 'env:SPACE_TEST_SOCK587_URL',
          schema_version: 'v1',
        },
      ]).execute();
    } finally {
      await cpDb.destroy();
    }

    helpers = await import('../../support/identity-access-helpers');
    app = await createMountedTestApp();
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const adminToken = (await helpers.login(app, 'admin', 'Admin123!')).accessToken;

    const created = (await must(
      await helpers.http(app).post('/api/v1/tenants').set(auth(adminToken)).send({
        name: 'Trung tâm socket (spec 587)',
        slug: CENTRE_SLUG,
        kind: 'school',
      }),
      'create tenant',
    )) as { id: string };
    tenantId = created.id;
    const centreUrl = clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD);
    await copyRowById(process.env.DATABASE_URL!, centreUrl, 'tenants', tenantId);

    const memberA = await helpers.createUserViaApi(app, adminToken);
    const memberB = await helpers.createUserViaApi(app, adminToken);
    memberAId = memberA.id;
    memberBId = memberB.id;
    for (const member of [memberA, memberB]) {
      await helpers.seedTenantMembershipFixture(app, tenantId, member.id);
      await copyMemberToCentre(member.id, tenantId);
    }

    const centreLoginA = (await must(
      await helpers.http(app).post('/api/v1/auth/token').set('Host', HOST)
        .send({ username: memberA.username, password: helpers.STRONG_PASSWORD }),
      'login member A at centre',
    )) as { accessToken: string };
    tokenWithClaim = centreLoginA.accessToken;
    const jwtService = app.get(JwtService);
    tokenWithoutClaim = await jwtService.signAsync({
      sub: memberAId,
      username: memberA.username,
      sid: randomUUID(),
      tid: tenantId,
    });

    const conv = await helpers.http(app).post('/api/v1/messages/conversations')
      .set(auth(adminToken))
      .send({ type: 2, memberIds: [memberAId, memberBId], name: 'Nhóm kho riêng 587' });
    expect(conv.status).toBe(201);
    convId = (conv.body as { id: string }).id;
    const sent = await helpers.http(app).post(`/api/v1/messages/conversations/${convId}/messages`)
      .set(auth(tokenWithoutClaim))
      .send({ text: MESSAGE_TEXT });
    expect(sent.status).toBe(201);
    const convTenantId = await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const result = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM message_conversations WHERE id = $1',
        [convId],
      );
      return result.rows[0]!.tenant_id;
    });
    if (convTenantId !== tenantId) {
      await copyRowById(process.env.DATABASE_URL!, centreUrl, 'tenants', convTenantId);
    }
    await copyRowById(process.env.DATABASE_URL!, centreUrl, 'message_conversations', convId);
    await copyRows(process.env.DATABASE_URL!, centreUrl, 'message_conversation_members', 'conversation_id', convId);
    await copyRows(process.env.DATABASE_URL!, centreUrl, 'message', 'conversation_id', convId);

    await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      await client.query('DELETE FROM message WHERE conversation_id = $1', [convId]);
      await client.query('DELETE FROM message_conversation_members WHERE conversation_id = $1', [convId]);
      await client.query('DELETE FROM message_conversations WHERE id = $1', [convId]);
      await client.query('DELETE FROM tenant_memberships WHERE tenant_id = $1 AND user_id = ANY($2)', [
        tenantId,
        [memberAId, memberBId],
      ]);
      await client.query('DELETE FROM users WHERE id = ANY($1)', [[memberAId, memberBId]]);
    });

    sessionTokenA = `sock587-a-${RUN_SUFFIX}-${randomUUID()}`;
    sessionTokenB = `sock587-b-${RUN_SUFFIX}-${randomUUID()}`;
    await seedSession(centreUrl, sessionTokenA, memberAId);
    await seedSession(centreUrl, sessionTokenB, memberBId);

    const sharedOnly = await helpers.createUserViaApi(app, adminToken);
    sharedOnlyId = sharedOnly.id;
    sessionTokenSharedOnly = `sock587-c-${RUN_SUFFIX}-${randomUUID()}`;
    await seedSession(process.env.DATABASE_URL!, sessionTokenSharedOnly, sharedOnlyId);
  }, 300_000);

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await app?.close().catch(() => undefined);
    delete process.env.SPACE_TEST_SOCK587_URL;
    delete process.env.CONTROL_PLANE_DATABASE_URL;
    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
    }).catch(() => undefined);
  });

  it('thành viên chỉ ở kho riêng nối socket bằng cookie tại địa chỉ trung tâm và nhận ảnh chụp presence', async () => {
    expect(await countRows(process.env.DATABASE_URL!, 'users', 'id', memberBId)).toBe(0);
    expect(await countRows(process.env.DATABASE_URL!, 'tenant_memberships', 'user_id', memberBId)).toBe(0);
    expect(await countRows(process.env.DATABASE_URL!, 'session', 'user_id', memberBId)).toBe(0);
    const centreUrl = clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD);
    expect(await countRows(centreUrl, 'users', 'id', memberBId)).toBe(1);
    expect(await countRows(centreUrl, 'session', 'user_id', memberBId)).toBe(1);

    const socket = centreSocket({ cookieToken: sessionTokenB });
    const snapshot = waitForSocketEvent<{ onlineUserIds: string[] }>(
      socket, 'presence.snapshot', () => true,
    );
    await awaitConnected(socket);
    const payload = await snapshot;
    expect(Array.isArray(payload.onlineUserIds)).toBe(true);
    socket.disconnect();
  });

  it('hai thành viên của trung tâm kho riêng trao đổi qua socket: sync trả tin chỉ có ở kho riêng, typing tới được phía bên kia', async () => {
    const socketA = centreSocket({ cookieToken: sessionTokenA });
    const socketB = centreSocket({ cookieToken: sessionTokenB });
    await awaitConnected(socketA);
    await awaitConnected(socketB);

    const syncResult = await socketB.emitWithAck('sync', { [convId]: 0 }) as Record<string, WireMessage[]>;
    expect(syncResult[convId]?.map((m) => m.fullMessage)).toEqual([MESSAGE_TEXT]);
    expect(syncResult[convId]?.[0]?.userIdFrom).toBe(memberAId);

    const joinAck = await socketB.emitWithAck('conversation.join', { conversationId: convId }) as { joined: boolean };
    expect(joinAck.joined).toBe(true);

    const typingSeen = waitForSocketEvent<{ conversationId: string; userId: string }>(
      socketA, 'typing', (p) => p.conversationId === convId && p.userId === memberBId,
    );
    const typingAck = await socketB.emitWithAck('typing', { conversationId: convId }) as { ok: boolean };
    expect(typingAck.ok).toBe(true);
    await typingSeen;

    socketA.disconnect();
    socketB.disconnect();
  });

  it('phiên chỉ tồn tại ở kho chung mang tới địa chỉ trung tâm kho riêng bị ngắt kết nối', async () => {
    const socket = centreSocket({ cookieToken: sessionTokenSharedOnly });
    await awaitRejected(socket);
    socket.disconnect();
  });

  it('token mang claim của trung tâm kho riêng nối socket được tại địa chỉ trung tâm', async () => {
    const socket = centreSocket({ token: tokenWithClaim });
    const snapshot = waitForSocketEvent<{ onlineUserIds: string[] }>(
      socket, 'presence.snapshot', () => true,
    );
    await awaitConnected(socket);
    await snapshot;
    socket.disconnect();
  });

  it('token cũ không mang claim của tài khoản chỉ ở kho riêng bị ngắt tại địa chỉ trung tâm (cổng 1a)', async () => {
    const socket = centreSocket({ token: tokenWithoutClaim });
    await awaitRejected(socket);
    socket.disconnect();
  });

  it('JWT trung tâm A tại hostname gốc bị ngắt dù user vẫn có bản sao legacy trong database chung (P1 PR #21)', async () => {
    const centreUrl = clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD);
    expect(await countRows(process.env.DATABASE_URL!, 'users', 'id', memberAId)).toBe(0);
    await copyRowById(centreUrl, process.env.DATABASE_URL!, 'users', memberAId);
    try {
      expect(await countRows(process.env.DATABASE_URL!, 'users', 'id', memberAId)).toBe(1);
      const socket = socketAtHost('giaokhoa.example', { token: tokenWithClaim });
      await awaitRejected(socket);
      socket.disconnect();
    } finally {
      await withClient(process.env.DATABASE_URL!, async (client) => {
        await client.query("SELECT set_config('app.platform', 'on', false)");
        await client.query('DELETE FROM users WHERE id = $1', [memberAId]);
      });
    }
  });
});
