import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job, Queue } from 'bullmq';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NotificationDigestProcessor } from '../../../src/processors/notification-digest.processor';
import { EnrolExpiryProcessor } from '../../../src/processors/enrol-expiry.processor';
import { TaskLogService } from '../../../src/task-log.service';
import { createCentreKysely, sql } from '@giaokhoa/db';
import { createControlPlaneKysely } from '@giaokhoa/db/control-plane';
import { tenantAls } from '../../../src/db/tenant-als';
import { SpaceDatabaseService } from '../../../src/db/routing/space-database.service';
import { SpaceJobRunner } from '../../../src/db/routing/space-job-runner';
import { TenantAwarePool } from '../../../src/db/tenant-pool';
import { NotificationDeliveryService } from '../../../src/notification-delivery.service';
import { NotificationEventsHandlerService } from '../../../src/notification-events-handler.service';
import { NotificationEventsMarker } from '../../../src/notification-events-marker.service';
import { OUTBOX_EVENT_QUEUE_ROUTES, allQueueNamesOfRoutes, type OutboxEventJobData } from '../../../src/outbox-event-routes';
import { OutboxRelayScheduler } from '../../../src/outbox-relay.scheduler';
import { NotificationEventsProcessor } from '../../../src/processors/notification-events.processor';

const CP_DATABASE = 'giaokhoa_test_cp_582w';
const CP_ROLE = 'giaokhoa_cp_test_582w';
const CP_PASSWORD = 'cp-test-582w';
const CENTRE_DATABASE = 'giaokhoa_test_centre_a_582w';
const CENTRE_ROLE = 'giaokhoa_centre_a_582w_app';
const CENTRE_PASSWORD = 'centre-a-582w';
const CENTRE_SLUG = 'trung-tam-a-582w';
const PUBLIC_DATABASE = 'giaokhoa_test_public_582w';
const PUBLIC_ROLE = 'giaokhoa_public_582w_app';
const PUBLIC_PASSWORD = 'public-582w';
const PUBLIC_SLUG = 'cong-cong';
const PUBLIC_TENANT_ID = '01958200-0000-7000-8000-0000000000a7';
const PUBLIC_OUTBOX_ID = '01958200-0000-7000-8000-0000000000f7';
const B_DATABASE = 'giaokhoa_test_centre_b_582w';
const B_ROLE = 'giaokhoa_centre_b_582w_app';
const B_PASSWORD = 'centre-b-582w';
const B_SLUG = 'trung-tam-b-582w';
const PERIODIC_ENROL_ID = '01958200-0000-7000-8000-0000000000c2';
const PERIODIC_UE_ID = '01958200-0000-7000-8000-0000000000c3';
const PERIODIC_LOG_ID = '01958200-0000-7000-8000-0000000000c4';
const CENTRE_TENANT_ID = '01958200-0000-7000-8000-0000000000a1';
const SHARED_TENANT_ID = '01958200-0000-7000-8000-0000000000b1';
const SHARED_TENANT_SLUG = 'tt-chung-582w';
const STUDENT_ID = '01958200-0000-7000-8000-0000000000c1';
const COURSE_ID = '01958200-0000-7000-8000-0000000000d1';
const CATEGORY_ID = '01958200-0000-7000-8000-0000000000d2';
const GRADE_ITEM_ID = '01958200-0000-7000-8000-0000000000e1';
const CENTRE_OUTBOX_ID = '01958200-0000-7000-8000-0000000000f1';
const SHARED_OUTBOX_ID = '01958200-0000-7000-8000-0000000000f2';

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
  const baseline = join(
    __dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', 'centre', '20261025163710_baseline', 'migration.sql',
  );
  await applySqlFile(connectionString, baseline, true);
}

function fakeConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Missing config ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

class CaptureQueue {
  readonly jobs: Array<{ name: string; data: OutboxEventJobData }> = [];

  async add(name: string, data: OutboxEventJobData): Promise<void> {
    this.jobs.push({ name, data });
  }
}

async function readNotificationIdsDirectly(
  connectionString: string,
  userId: string,
): Promise<string[]> {
  return withClient(connectionString, async (client) => {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    const result = await client.query<{ id: string }>(
      'SELECT id FROM notifications WHERE user_id_to = $1 ORDER BY id',
      [userId],
    );
    return result.rows.map((row) => row.id);
  });
}

describe('Định tuyến job theo trung tâm phía worker (integration)', () => {
  let spaceDb: SpaceDatabaseService;
  let sharedPool: TenantAwarePool;
  let marker: NotificationEventsMarker;

  beforeAll(async () => {
    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_DATABASE, B_DATABASE, PUBLIC_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_ROLE, B_ROLE, PUBLIC_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
      await admin.query(`CREATE ROLE ${CP_ROLE} LOGIN PASSWORD '${CP_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${CENTRE_ROLE} LOGIN PASSWORD '${CENTRE_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${B_ROLE} LOGIN PASSWORD '${B_PASSWORD}'`);
      await admin.query(`CREATE ROLE ${PUBLIC_ROLE} LOGIN PASSWORD '${PUBLIC_PASSWORD}'`);
      await admin.query(`CREATE DATABASE ${CP_DATABASE} OWNER ${CP_ROLE}`);
      await admin.query(`CREATE DATABASE ${CENTRE_DATABASE} OWNER ${CENTRE_ROLE}`);
      await admin.query(`CREATE DATABASE ${B_DATABASE} OWNER ${B_ROLE}`);
      await admin.query(`CREATE DATABASE ${PUBLIC_DATABASE} OWNER ${PUBLIC_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CP_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CP_DATABASE} TO ${CP_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${CENTRE_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${CENTRE_DATABASE} TO ${CENTRE_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${B_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${B_DATABASE} TO ${B_ROLE}`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${PUBLIC_DATABASE} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${PUBLIC_DATABASE} TO ${PUBLIC_ROLE}`);
    });

    await applyControlPlaneMigrations(clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD));
    await applyBusinessBaseline(clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD));
    await applyBusinessBaseline(clusterUrl(B_DATABASE, B_ROLE, B_PASSWORD));
    await applyBusinessBaseline(clusterUrl(PUBLIC_DATABASE, PUBLIC_ROLE, PUBLIC_PASSWORD));

    process.env.SPACE_TEST_A_582W_URL = clusterUrl('postgres', CENTRE_ROLE, CENTRE_PASSWORD);
    process.env.SPACE_TEST_B_582W_URL = clusterUrl('postgres', B_ROLE, B_PASSWORD);
    process.env.SPACE_TEST_PUBLIC_582W_URL = clusterUrl('postgres', PUBLIC_ROLE, PUBLIC_PASSWORD);

    const config = fakeConfig({
      CONTROL_PLANE_DATABASE_URL: clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD),
      DATABASE_SSL: false,
      SPACE_ROUTING_CACHE_TTL_MS: 60_000,
      SPACE_DB_POOL_MAX: 5,
      SPACE_DB_POOL_IDLE_TIMEOUT_MS: 60_000,
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    });
    spaceDb = new SpaceDatabaseService(config);
    sharedPool = new TenantAwarePool({ connectionString: process.env.DATABASE_URL! });
    spaceDb.bindSharedKysely(createCentreKysely(sharedPool));

    const cpSeedPool = new Pool({ connectionString: clusterUrl(CP_DATABASE, CP_ROLE, CP_PASSWORD) });
    try {
      const cpDb = createControlPlaneKysely(cpSeedPool);
      await cpDb.insertInto('space_registry').values({
        slug: CENTRE_SLUG,
        name: 'Trung tâm A 582w',
        kind: 'center',
        status: 'active',
        database_name: CENTRE_DATABASE,
        storage_mode: 'dedicated',
        connection_role_ref: CENTRE_ROLE,
        secret_ref: 'env:SPACE_TEST_A_582W_URL',
        schema_version: 'v1',
      }).execute();
      await cpDb.insertInto('space_registry').values({
        slug: B_SLUG, name: 'Trung tâm B 582w', kind: 'center', status: 'active',
        database_name: B_DATABASE, storage_mode: 'dedicated',
        connection_role_ref: B_ROLE, secret_ref: 'env:SPACE_TEST_B_582W_URL', schema_version: 'v1',
      }).execute();
      await cpDb.insertInto('space_registry').values({
        slug: PUBLIC_SLUG, name: 'Khu công cộng 582w', kind: 'platform', status: 'active',
        database_name: PUBLIC_DATABASE, storage_mode: 'dedicated',
        connection_role_ref: PUBLIC_ROLE, secret_ref: 'env:SPACE_TEST_PUBLIC_582W_URL', schema_version: 'v1',
      }).execute();
    } finally {
      await cpSeedPool.end();
    }

    const seedPool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 });
    try {
      const seedDb = createCentreKysely(seedPool);
      await sql`SELECT set_config('app.platform', 'on', false)`.execute(seedDb);
      await seedDb.deleteFrom('outbox_events').where('id', '=', SHARED_OUTBOX_ID).execute();
      await seedDb.deleteFrom('tenants').where('id', '=', SHARED_TENANT_ID).execute();
      await seedDb.insertInto('tenants').values({
        id: SHARED_TENANT_ID,
        slug: SHARED_TENANT_SLUG,
        name: 'Tenant kho chung 582w',
        kind: 'center',
      }).execute();
      await seedDb.insertInto('outbox_events').values({
        id: SHARED_OUTBOX_ID,
        aggregate: 'grades',
        type: 'grade_updated',
        tenant_id: SHARED_TENANT_ID,
        payload: { userId: STUDENT_ID, itemId: GRADE_ITEM_ID, finalGrade: 9 },
      }).execute();
    } finally {
      await seedPool.end();
    }

    await spaceDb.withSpaceKysely(
      CENTRE_SLUG,
      async () => {
        const db = spaceDb.routedKysely;
        await db.insertInto('tenants').values({
          id: CENTRE_TENANT_ID,
          slug: CENTRE_SLUG,
          name: 'Trung tâm A 582w',
          kind: 'center',
        }).execute();
        await db.insertInto('users').values({
          id: STUDENT_ID,
          username: 'hoc-vien-582w',
          email: 'hoc-vien-582w@example.com',
          first_name: 'Học viên',
          last_name: '582w',
        }).execute();
        await db.insertInto('course_categories').values({ id: CATEGORY_ID, name: 'Danh mục 582w', tenant_id: CENTRE_TENANT_ID }).execute();
        await db.insertInto('course').values({
          id: COURSE_ID,
          tenant_id: CENTRE_TENANT_ID,
          category: CATEGORY_ID,
          full_name: 'Khoá học 582w',
          short_name: 'KH582W',
          is_template: true,
        }).execute();
        await db.insertInto('grade_items').values({ id: GRADE_ITEM_ID, course_id: COURSE_ID, item_name: 'Bài kiểm tra 582w' }).execute();
        await db.insertInto('outbox_events').values({
          id: CENTRE_OUTBOX_ID,
          aggregate: 'grades',
          type: 'grade_updated',
          tenant_id: CENTRE_TENANT_ID,
          payload: { userId: STUDENT_ID, itemId: GRADE_ITEM_ID, finalGrade: 9 },
        }).execute();
      },
      { tenantId: CENTRE_TENANT_ID },
    );

    marker = new NotificationEventsMarker(
      fakeConfig({ REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379' }),
    );
  }, 180_000);

  afterAll(async () => {
    await marker?.onModuleDestroy().catch(() => undefined);
    await spaceDb?.onModuleDestroy().catch(() => undefined);
    await sharedPool?.end().catch(() => undefined);
    delete process.env.SPACE_TEST_A_582W_URL;
    delete process.env.SPACE_TEST_B_582W_URL;
    delete process.env.SPACE_TEST_PUBLIC_582W_URL;
    await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      await client.query('DELETE FROM outbox_events WHERE id = $1', [SHARED_OUTBOX_ID]);
      await client.query('DELETE FROM tenants WHERE id = $1', [SHARED_TENANT_ID]);
    }).catch(() => undefined);
    await withClient(clusterUrl('postgres'), async (admin) => {
      for (const database of [CP_DATABASE, CENTRE_DATABASE, B_DATABASE, PUBLIC_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
      }
      for (const role of [CP_ROLE, CENTRE_ROLE, B_ROLE, PUBLIC_ROLE]) {
        await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
      }
    });
  });

  function makeRelay(): { relay: OutboxRelayScheduler; queue: CaptureQueue } {
    const queue = new CaptureQueue();
    const queues = new Map<string, Queue>(allQueueNamesOfRoutes(OUTBOX_EVENT_QUEUE_ROUTES).map(
      (name) => [name, (name === 'notification-events' ? queue : new CaptureQueue()) as unknown as Queue],
    ));
    const relay = new OutboxRelayScheduler(
      { record: async () => undefined } as never,
      { recordRun: async () => undefined } as never,
      OUTBOX_EVENT_QUEUE_ROUTES,
      queues,
      spaceDb,
      fakeConfig({}),
    );
    return { relay, queue };
  }

  it('relay phát sự kiện ở kho chung: job đóng dấu shared tường minh và dòng được đóng dấu ở kho chung', async () => {
    const { relay, queue } = makeRelay();

    await tenantAls.run({ platform: true }, () => relay.publishPending());

    const sharedJob = queue.jobs.find((job) => job.data.outboxId === SHARED_OUTBOX_ID);
    expect(sharedJob).toBeDefined();
    expect(sharedJob!.data).toMatchObject({
      tenantId: SHARED_TENANT_ID,
      spaceSlug: null,
      spaceId: null,
    });
    const stamped = await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const result = await client.query<{ published_at: Date | null }>(
        'SELECT published_at FROM outbox_events WHERE id = $1',
        [SHARED_OUTBOX_ID],
      );
      return result.rows[0]?.published_at;
    });
    expect(stamped).not.toBeNull();
  });

  it('relay quét outbox trong kho riêng của trung tâm: job mang slug của trung tâm và dòng được đóng dấu ở chính kho riêng', async () => {
    const { relay, queue } = makeRelay();

    const result = await tenantAls.run({ platform: true }, () => relay.publishPendingForCentres());

    expect(result).toEqual({ published: 1, failedSlugs: [] });
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]!.data).toMatchObject({
      outboxId: CENTRE_OUTBOX_ID,
      tenantId: CENTRE_TENANT_ID,
      spaceSlug: CENTRE_SLUG,
      spaceId: expect.any(String),
    });
    const stamped = await withClient(clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD), async (client) => {
      const result = await client.query<{ published_at: Date | null }>(
        'SELECT published_at FROM outbox_events WHERE id = $1',
        [CENTRE_OUTBOX_ID],
      );
      return result.rows[0]?.published_at;
    });
    expect(stamped).not.toBeNull();
    const inShared = await withClient(process.env.DATABASE_URL!, async (client) => {
      await client.query("SELECT set_config('app.platform', 'on', false)");
      const result = await client.query<{ count: string }>(
        'SELECT count(*) FROM outbox_events WHERE id = $1',
        [CENTRE_OUTBOX_ID],
      );
      return Number(result.rows[0]!.count);
    });
    expect(inShared).toBe(0);
  });

  it('relay PostgreSQL thật đọc outbox công cộng kind platform, gắn đúng spaceId, không ghi sang platform/A/B', async () => {
    await tenantAls.run({ platform: true }, () => spaceDb.withSpaceKysely(PUBLIC_SLUG, async () => {
      const db = spaceDb.routedKysely;
      await db.insertInto('tenants').values({
        id: PUBLIC_TENANT_ID, slug: PUBLIC_SLUG, name: 'Khu học tập công cộng', kind: 'platform',
      }).execute();
      await db.insertInto('users').values({
        id: STUDENT_ID, username: 'hoc-vien-cong-cong-582w', email: 'hoc-vien-cong-cong-582w@example.com',
      }).execute();
      await db.insertInto('outbox_events').values({
        id: PUBLIC_OUTBOX_ID, aggregate: 'grades', type: 'grade_updated',
        tenant_id: PUBLIC_TENANT_ID, payload: { userId: STUDENT_ID, itemId: GRADE_ITEM_ID, finalGrade: 8 },
      }).execute();
    }));

    const { relay, queue } = makeRelay();
    const result = await tenantAls.run({ platform: true }, () => relay.publishPendingForCentres());
    expect(result).toEqual({ published: 1, failedSlugs: [] });
    const publicJob = queue.jobs.find((job) => job.data.outboxId === PUBLIC_OUTBOX_ID);
    expect(publicJob?.data).toMatchObject({
      tenantId: PUBLIC_TENANT_ID, spaceSlug: PUBLIC_SLUG, spaceId: expect.any(String),
    });
    const marked = await withClient(clusterUrl(PUBLIC_DATABASE, PUBLIC_ROLE, PUBLIC_PASSWORD), async (client) => {
      const result = await client.query<{ published_at: Date | null }>(
        'SELECT published_at FROM outbox_events WHERE id = $1', [PUBLIC_OUTBOX_ID],
      );
      return result.rows[0]?.published_at;
    });
    expect(marked).not.toBeNull();
    for (const url of [process.env.DATABASE_URL!, clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD), clusterUrl(B_DATABASE, B_ROLE, B_PASSWORD)]) {
      const count = await withClient(url, async (client) => {
        await client.query("SELECT set_config('app.platform', 'on', false)");
        const result = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM outbox_events WHERE id = $1', [PUBLIC_OUTBOX_ID],
        );
        return Number(result.rows[0]!.count);
      });
      expect(count).toBe(0);
    }
    const second = await tenantAls.run({ platform: true }, () => relay.publishPendingForCentres());
    expect(second).toEqual({ published: 0, failedSlugs: [] });
    expect(queue.jobs.filter((job) => job.data.outboxId === PUBLIC_OUTBOX_ID)).toHaveLength(1);
  });

  it('consumer thật xử lý job của trung tâm thì thông báo được ghi vào kho riêng của trung tâm, không vào kho chung', async () => {
    const { relay, queue } = makeRelay();
    const freshOutboxId = randomUUID();
    await spaceDb.withSpaceKysely(
      CENTRE_SLUG,
      async () => {
        await spaceDb.routedKysely.insertInto('outbox_events').values({
          id: freshOutboxId,
          aggregate: 'grades',
          type: 'grade_updated',
          tenant_id: CENTRE_TENANT_ID,
          payload: { userId: STUDENT_ID, itemId: GRADE_ITEM_ID, finalGrade: 10 },
        }).execute();
      },
      { tenantId: CENTRE_TENANT_ID },
    );
    await tenantAls.run({ platform: true }, () => relay.publishPendingForCentres());
    const jobData = queue.jobs.find((job) => job.data.outboxId === freshOutboxId)?.data;
    expect(jobData).toBeDefined();
    expect(jobData!.spaceSlug).toBe(CENTRE_SLUG);

    const config = fakeConfig({
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      DATABASE_URL: process.env.DATABASE_URL!,
    });
    const fakeI18n = { t: (key: string) => key } as never;
    const dispatchQueue = { add: async () => ({}) };
    const delivery = new NotificationDeliveryService(
      spaceDb,
      config,
      dispatchQueue as never,
      fakeI18n,
    );
    const handler = new NotificationEventsHandlerService(spaceDb, delivery, fakeI18n);
    const processor = new NotificationEventsProcessor(handler, marker, new SpaceJobRunner(spaceDb));

    const outcome = await processor.process({ data: jobData } as Job<OutboxEventJobData>);

    expect(outcome).toEqual({ handled: true });
    expect(
      await readNotificationIdsDirectly(clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD), STUDENT_ID),
    ).toHaveLength(1);
    expect(await readNotificationIdsDirectly(process.env.DATABASE_URL!, STUDENT_ID)).toHaveLength(0);
    const centreNotifications = await spaceDb.withSpaceKysely(
      CENTRE_SLUG,
      async () => spaceDb.routedKysely.selectFrom('notifications').selectAll().where('user_id_to', '=', STUDENT_ID).execute(),
      { tenantId: CENTRE_TENANT_ID },
    );
    expect(centreNotifications).toHaveLength(1);
  });

  it('quét digest và hạn ghi danh ở hai kho riêng trùng UUID; lỗi A không chặn B và retry không nhân đôi', async () => {
    const aUrl = clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD);
    const bUrl = clusterUrl(B_DATABASE, B_ROLE, B_PASSWORD);
    for (const [slug, isB] of [[CENTRE_SLUG, false], [B_SLUG, true]] as const) {
      await tenantAls.run({ platform: true }, () => spaceDb.withSpaceKysely(slug, async () => {
        const db = spaceDb.routedKysely;
        if (isB) {
          await db.insertInto('tenants').values({
            id: CENTRE_TENANT_ID, slug: B_SLUG, name: 'Tenant B 582w', kind: 'center',
          }).execute();
          await db.insertInto('users').values({
            id: STUDENT_ID, username: 'hoc-vien-b-582w', email: 'hoc-vien-b-582w@example.com',
          }).execute();
          await db.insertInto('course_categories').values({
            id: CATEGORY_ID, name: 'Danh mục B', tenant_id: CENTRE_TENANT_ID,
          }).execute();
          await db.insertInto('course').values({
            id: COURSE_ID, tenant_id: CENTRE_TENANT_ID, category: CATEGORY_ID,
            full_name: 'Khoá học B', short_name: 'KH582B', is_template: true,
          }).execute();
        }
        await db.insertInto('enrol').values({
          id: PERIODIC_ENROL_ID, course_id: COURSE_ID, enrol: 'manual', status: 0,
        }).execute();
        await db.insertInto('user_enrolments').values({
          id: PERIODIC_UE_ID, enrol_id: PERIODIC_ENROL_ID, user_id: STUDENT_ID,
          status: 0, time_start: new Date(Date.now() - 86400000),
          time_end: new Date(Date.now() + 3 * 86400000),
        }).execute();
        await db.insertInto('notification_dispatch_log').values({
          id: PERIODIC_LOG_ID, user_id: STUDENT_ID, provider: 'grade_updated',
          channel: 'email', status: 'digest-queued',
          subject: isB ? 'B: kiểm chứng kho riêng' : 'A: kiểm chứng kho riêng',
          dedupe_key: 'periodic-retry-same-internal-id',
        }).execute();
      }));
    }

    const sent: Array<{ to: string; text: string }> = [];
    const digest = new NotificationDigestProcessor(spaceDb, {
      send: async (mail: { to: string; text: string }) => {
        sent.push({ to: mail.to, text: mail.text });
        return { status: 'sent', providerId: 'fake-periodic-582' };
      },
    } as never, { t: (key: string) => key } as never);
    const expiry = new EnrolExpiryProcessor(spaceDb, new TaskLogService(spaceDb));

    const readStatus = (url: string) => withClient(url, async (db) => {
      await db.query("SELECT set_config('app.platform', 'on', false)");
      const rows = await db.query<{ status: string }>(
        'SELECT status FROM notification_dispatch_log WHERE id = $1', [PERIODIC_LOG_ID],
      );
      return rows.rows[0]!.status;
    });
    const countWarnings = (url: string) => withClient(url, async (db) => {
      await db.query("SELECT set_config('app.platform', 'on', false)");
      const rows = await db.query<{ count: string }>(
        "SELECT count(*) FROM outbox_events WHERE type = 'enrol_expiry_warning' AND payload ->> 'enrolmentId' = $1",
        [PERIODIC_UE_ID],
      );
      return Number(rows.rows[0]!.count);
    });

    const original = spaceDb.withSpaceKysely.bind(spaceDb);
    const failA = () => vi.spyOn(spaceDb, 'withSpaceKysely').mockImplementation((slug, fn, context) => {
      if (slug === CENTRE_SLUG) throw new Error('Kho A tạm không kết nối');
      return original(slug, fn, context);
    });

    let stub = failA();
    try {
      await expect(digest.process({ data: {} } as never)).rejects.toThrow('Kho A tạm không kết nối');
      expect(await readStatus(aUrl)).toBe('digest-queued');
      expect(await readStatus(bUrl)).toBe('digest-sent');
      expect(sent.filter((x) => x.to === 'hoc-vien-b-582w@example.com')).toHaveLength(1);
      expect(sent.filter((x) => x.to === 'hoc-vien-582w@example.com')).toHaveLength(0);
    } finally {
      stub.mockRestore();
    }

    await digest.process({ data: {} } as never);
    await digest.process({ data: {} } as never);
    expect(await readStatus(aUrl)).toBe('digest-sent');
    expect(await readStatus(bUrl)).toBe('digest-sent');
    expect(sent.filter((x) => x.to === 'hoc-vien-b-582w@example.com')).toHaveLength(1);
    expect(sent.filter((x) => x.to === 'hoc-vien-582w@example.com')).toHaveLength(1);
    expect(sent.find((x) => x.to === 'hoc-vien-b-582w@example.com')!.text).toContain('B: kiểm chứng kho riêng');
    expect(sent.find((x) => x.to === 'hoc-vien-582w@example.com')!.text).toContain('A: kiểm chứng kho riêng');

    stub = failA();
    try {
      await expect(expiry.process({ data: {} } as never)).rejects.toThrow('Kho A tạm không kết nối');
      expect(await countWarnings(aUrl)).toBe(0);
      expect(await countWarnings(bUrl)).toBe(1);
    } finally {
      stub.mockRestore();
    }
    await expiry.process({ data: {} } as never);
    await expiry.process({ data: {} } as never);
    expect(await countWarnings(aUrl)).toBe(1);
    expect(await countWarnings(bUrl)).toBe(1);
    for (const dbUrl of [aUrl, bUrl]) {
      const logs = await withClient(dbUrl, async (client) => {
        await client.query("SELECT set_config('app.platform', 'on', false)");
        return client.query<{ count: string }>(
          "SELECT count(*) FROM task_log WHERE task_name = 'enrol-expiry' AND status = 'success'",
        );
      });
      expect(Number(logs.rows[0]!.count)).toBeGreaterThanOrEqual(1);
    }
  }, 180_000);
  it('nhịp worker đọc và xử lý ghi danh ở công cộng nhưng không nhân đôi hoặc chạm kho khác', async () => {
    await tenantAls.run({ platform: true }, () => spaceDb.withSpaceKysely(PUBLIC_SLUG, async () => {
      const db = spaceDb.routedKysely;
      await db.insertInto('course_categories').values({ id: CATEGORY_ID, name: 'Danh mục công cộng', tenant_id: PUBLIC_TENANT_ID }).execute();
      await db.insertInto('course').values({ id: COURSE_ID, tenant_id: PUBLIC_TENANT_ID, category: CATEGORY_ID, full_name: 'Khoá công cộng', short_name: 'PUBLIC582W', is_template: true }).execute();
      await db.insertInto('enrol').values({ id: PERIODIC_ENROL_ID, course_id: COURSE_ID, enrol: 'manual', status: 0 }).execute();
      await db.insertInto('user_enrolments').values({ id: PERIODIC_UE_ID, enrol_id: PERIODIC_ENROL_ID, user_id: STUDENT_ID, status: 0, time_start: new Date(Date.now() - 86400000), time_end: new Date(Date.now() + 3 * 86400000) }).execute();
    }));
    const expiry = new EnrolExpiryProcessor(spaceDb, new TaskLogService(spaceDb));
    const first = await expiry.process({ data: {} } as never);
    expect(first.warnedIds).toContain(PERIODIC_UE_ID);
    await expiry.process({ data: {} } as never);
    for (const [url, expected] of [
      [clusterUrl(PUBLIC_DATABASE, PUBLIC_ROLE, PUBLIC_PASSWORD), 1],
      [process.env.DATABASE_URL!, 0],
      [clusterUrl(CENTRE_DATABASE, CENTRE_ROLE, CENTRE_PASSWORD), 1],
      [clusterUrl(B_DATABASE, B_ROLE, B_PASSWORD), 1],
    ] as const) {
      const count = await withClient(url, async (client) => {
        await client.query("SELECT set_config('app.platform', 'on', false)");
        const rows = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM outbox_events WHERE type = 'enrol_expiry_warning' AND payload ->> 'enrolmentId' = $1", [PERIODIC_UE_ID]);
        return Number(rows.rows[0]!.count);
      });
      expect(count).toBe(expected);
    }
  }, 180_000);

});
