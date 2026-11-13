import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { sql, type RawBuilder } from '@giaokhoa/db';
import { redisConnectionFromUrl } from '../../../src/config/env';
import { NotificationEventsCatchupService } from '../../../src/notification-events-catchup.service';
import { NotificationEventsMarker } from '../../../src/notification-events-marker.service';
import { outboxRelayJobId } from '../../../src/outbox-relay.scheduler';
import {
  bootWorkerModuleAsOrdinaryRole,
  type OrdinaryWorkerModuleHarness,
} from '../../support/ordinary-worker-module';

describe('Worker notification events catch-up (phát bù tồn đọng theo watermark cũ ở #520)', () => {
  let context: INestApplicationContext;
  let harness: OrdinaryWorkerModuleHarness;
  let db: OrdinaryWorkerModuleHarness['adminDb'];
  let eventsQueue: Queue;
  let catchup: NotificationEventsCatchupService;
  let marker: NotificationEventsMarker;
  let redis: Redis;
  let legacyWatermarkKey = '';
  let fixtureTenantId = '';
  const suffix = Date.now();
  const DAY = 24 * 3600_000;

  const uid = (n: number) => `01900000-0000-7000-8000-${String(720000 + n * 37 + (suffix % 991)).padStart(12, '0')}`;

  async function execRows<T>(query: RawBuilder<T>): Promise<T[]> {
    const result = await query.execute(db);
    return result.rows;
  }

  async function makeUser(id: string) {
    await sql`insert into users (id, username, email, first_name, last_name, suspended, deleted) values (${id}, ${`nc520-${id.slice(-6)}-${suffix}`}, ${`nc520-${id.slice(-6)}-${suffix}@x.io`}, 'An', 'Nguyễn Văn', false, false) on conflict (id) do nothing`.execute(db);
    await db.insertInto('user_preferences').values({
      user_id: id, name: 'message_provider_enrol_expiry_warning_email_v2', value: 'immediate',
    }).onConflict((oc) => oc.doNothing()).execute();
  }

  async function fixtureClassId(): Promise<string> {
    const ownerId = '01980000-0000-7000-8000-00000000c1a5';
    await sql`insert into users (id, username, email, suspended, deleted) values (${ownerId}, 'wk-class-owner', 'wk-class-owner@x.io', false, false) on conflict (id) do nothing`.execute(db);
    const coh = await execRows<{ id: string }>(sql`insert into cohort (tenant_id, name, context_id, component, visible) values ((select id from tenants where slug = 'worker-fixture'), 'wk fixture cohort', '01990000-0000-7000-8000-0000000000a1', 'class', false) returning id`);
    const cls = await execRows<{ id: string }>(sql`insert into classes (tenant_id, name, owner_id, cohort_id) values ((select id from tenants where slug = 'worker-fixture'), 'wk fixture class', ${ownerId}, ${coh[0]!.id}) returning id`);
    return cls[0]!.id;
  }

  async function makeCourse(name: string): Promise<string> {
    const cat = await execRows<{ id: string }>(sql`insert into course_categories (name, path, tenant_id) values (${`nc520-cat-${suffix}-${Math.random()}`}, '', (select id from tenants where slug = 'worker-fixture')) returning id`);
    const short = `nc520${suffix}${Math.floor(Math.random() * 1e9)}`;
    const rows = await execRows<{ id: string }>(sql`insert into course (category, tenant_id, full_name, short_name, visible, class_id) values (${cat[0]!.id}, (select tenant_id from course_categories where id = ${cat[0]!.id}), ${name}, ${short}, true, ${await fixtureClassId()}) returning id`);
    return rows[0]!.id;
  }

  async function enrolStudent(courseId: string, userId: string): Promise<void> {
    const inst = await db.insertInto('enrol').values({ course_id: courseId, enrol: 'manual', status: 0 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('user_enrolments').values({
      enrol_id: inst.id, user_id: userId, status: 0, time_start: new Date(Date.now() - DAY),
    }).execute();
  }

  async function emitMarkedRow(userId: string, courseId: string): Promise<{ id: string; seq: number }> {
    const row = await db.insertInto('outbox_events').values({
      aggregate: 'enrol', type: 'enrol_expiry_warning', tenant_id: fixtureTenantId,
      published_at: new Date(),
      payload: {
        userId, enrolmentId: uid(950), enrolId: uid(951), courseId,
        timeEnd: new Date(Date.now() + 3 * DAY).toISOString(),
      },
    }).returning(['id', 'seq']).executeTakeFirstOrThrow();
    return { id: row.id, seq: Number(row.seq) };
  }

  async function waitJobCompleted(outboxId: string, timeoutMs = 90000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await eventsQueue.getJob(outboxRelayJobId(null, outboxId));
      if (job && (await job.getState()) === 'completed') return;
      if (Date.now() > deadline) throw new Error(`job sự kiện ${outboxId} chưa completed sau ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  async function notificationsOf(userId: string, eventType: string) {
    return db.selectFrom('notifications').selectAll()
      .where('user_id_to', '=', userId).where('event_type', '=', eventType)
      .execute();
  }

  beforeAll(async () => {
    harness = await bootWorkerModuleAsOrdinaryRole();
    context = harness.context;
    db = harness.adminDb;
    await sql`insert into tenants (slug, name, kind, status) values ('worker-fixture', 'Worker fixture tenant', 'school', 'active') on conflict (slug) do nothing`.execute(db);
    const tenantRows = await execRows<{ id: string }>(sql`select id from tenants where slug = 'worker-fixture'`);
    fixtureTenantId = tenantRows[0]!.id;
    eventsQueue = context.get<Queue>(getQueueToken('notification-events'));
    catchup = context.get(NotificationEventsCatchupService);
    marker = context.get(NotificationEventsMarker);
    redis = new Redis({
      ...redisConnectionFromUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    });
    const databaseName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, '') || 'default';
    legacyWatermarkKey = `giaokhoa:messaging:notifications:${databaseName}:seq`;
    await redis.del(legacyWatermarkKey);
  });
  afterAll(async () => {
    await redis.del(legacyWatermarkKey).catch(() => undefined);
    redis.disconnect();
    await harness.close();
  });

  async function makeStudentCourse(n: number): Promise<{ student: string; courseId: string }> {
    const student = uid(n);
    await makeUser(student);
    const courseId = await makeCourse(`NC520 Khoá chuyển đổi ${n}`);
    await enrolStudent(courseId, student);
    return { student, courseId };
  }

  it('phát bù đúng các dòng trên watermark cũ đã bị đóng dấu: dòng trên được xử lý đúng một lần, dòng dưới không xử lý lại, dòng đã có dấu không sinh thông báo trùng, khoá cũ bị xoá sau khi rút cạn', async () => {
    const belowFixture = await makeStudentCourse(1);
    const aboveFixture = await makeStudentCourse(2);
    const markedFixture = await makeStudentCourse(3);
    const belowStudent = belowFixture.student;
    const aboveStudent = aboveFixture.student;
    const markedStudent = markedFixture.student;

    const below = await emitMarkedRow(belowStudent, belowFixture.courseId);
    const above = await emitMarkedRow(aboveStudent, aboveFixture.courseId);
    const marked = await emitMarkedRow(markedStudent, markedFixture.courseId);
    expect(above.seq).toBeGreaterThan(below.seq);
    expect(marked.seq).toBeGreaterThan(above.seq);
    await marker.markProcessed(marked.id);
    await redis.set(legacyWatermarkKey, String(below.seq));

    const enqueued = await catchup.drainLegacyBacklog();
    expect(enqueued).toBe(2);

    await waitJobCompleted(above.id);
    await waitJobCompleted(marked.id);

    expect(await notificationsOf(aboveStudent, 'enrol_expiry_warning')).toHaveLength(1);
    expect(await notificationsOf(markedStudent, 'enrol_expiry_warning')).toHaveLength(0);
    expect(await notificationsOf(belowStudent, 'enrol_expiry_warning')).toHaveLength(0);
    expect(await eventsQueue.getJob(outboxRelayJobId(null, below.id))).toBeFalsy();

    expect(await redis.get(legacyWatermarkKey)).toBeNull();
    expect(await catchup.drainLegacyBacklog()).toBe(0);
  }, 180000);

  it('hệ mới tinh không có watermark cũ thì không phát bù gì: dòng đã đóng dấu không thành job và không sinh thông báo', async () => {
    const student = uid(4);
    await makeUser(student);
    const courseId = await makeCourse('NC520 Khoá hệ mới');
    await enrolStudent(courseId, student);
    const row = await emitMarkedRow(student, courseId);

    expect(await redis.get(legacyWatermarkKey)).toBeNull();
    expect(await catchup.drainLegacyBacklog()).toBe(0);
    expect(await eventsQueue.getJob(outboxRelayJobId(null, row.id))).toBeFalsy();
    expect(await notificationsOf(student, 'enrol_expiry_warning')).toHaveLength(0);
  }, 180000);

  it('khoá watermark có sẵn trước khi worker khởi động thì OnModuleInit tự phát bù không cần gọi tay: dòng trên watermark được xử lý đúng một lần và khoá cũ bị xoá trong lúc khởi tạo module', async () => {
    const belowFixture = await makeStudentCourse(11);
    const aboveFixture = await makeStudentCourse(12);
    const below = await emitMarkedRow(belowFixture.student, belowFixture.courseId);
    const above = await emitMarkedRow(aboveFixture.student, aboveFixture.courseId);
    expect(above.seq).toBeGreaterThan(below.seq);
    await redis.set(legacyWatermarkKey, String(below.seq));

    const bootHarness = await bootWorkerModuleAsOrdinaryRole();
    try {
      expect(await redis.get(legacyWatermarkKey)).toBeNull();
      await waitJobCompleted(above.id);
      expect(await notificationsOf(aboveFixture.student, 'enrol_expiry_warning')).toHaveLength(1);
      expect(await notificationsOf(belowFixture.student, 'enrol_expiry_warning')).toHaveLength(0);
      expect(await eventsQueue.getJob(outboxRelayJobId(null, below.id))).toBeFalsy();
    } finally {
      await bootHarness.close();
    }
  }, 180000);

  it('lỗi thoáng qua ở lần đẩy job đầu tiên thì lượt phát bù tự thử lại tới khi rút cạn trọn vẹn: tồn đọng được phát đúng một lần, khoá chỉ bị xoá sau khi thành công và lần thử thất bại có log error kèm số lần thử', async () => {
    const belowFixture = await makeStudentCourse(21);
    const aboveFixture = await makeStudentCourse(22);
    const markedFixture = await makeStudentCourse(23);
    const below = await emitMarkedRow(belowFixture.student, belowFixture.courseId);
    const above = await emitMarkedRow(aboveFixture.student, aboveFixture.courseId);
    const marked = await emitMarkedRow(markedFixture.student, markedFixture.courseId);
    expect(above.seq).toBeGreaterThan(below.seq);
    expect(marked.seq).toBeGreaterThan(above.seq);
    await marker.markProcessed(marked.id);
    await redis.set(legacyWatermarkKey, String(below.seq));

    const originalAdd = eventsQueue.add.bind(eventsQueue);
    let faultArmed = true;
    let keyValueAtFailure: string | null = null;
    eventsQueue.add = (async (...args: unknown[]) => {
      const data = args[1] as { outboxId?: string } | undefined;
      if (faultArmed && data?.outboxId === above.id) {
        faultArmed = false;
        keyValueAtFailure = await redis.get(legacyWatermarkKey);
        throw new Error('Lỗi thoáng qua mô phỏng tại queue.add trong ca tiêm lỗi');
      }
      return (originalAdd as unknown as (...a: unknown[]) => Promise<unknown>)(...args);
    }) as unknown as typeof eventsQueue.add;

    const loggerRef = (catchup as unknown as {
      logger: { error: (...args: unknown[]) => void };
    }).logger;
    const originalError = loggerRef.error.bind(loggerRef);
    const errorMessages: string[] = [];
    loggerRef.error = (...args: unknown[]) => {
      errorMessages.push(String(args[0]));
      originalError(...args);
    };

    let enqueued: number | undefined;
    try {
      enqueued = await catchup.drainLegacyBacklog();
    } finally {
      eventsQueue.add = originalAdd as typeof eventsQueue.add;
      loggerRef.error = originalError;
    }

    expect(faultArmed).toBe(false);
    expect(keyValueAtFailure).toBe(String(below.seq));
    expect(errorMessages.some((message) => message.includes('lần thử 1'))).toBe(true);
    expect(enqueued).toBe(2);

    await waitJobCompleted(above.id);
    await waitJobCompleted(marked.id);
    expect(await notificationsOf(aboveFixture.student, 'enrol_expiry_warning')).toHaveLength(1);
    expect(await notificationsOf(markedFixture.student, 'enrol_expiry_warning')).toHaveLength(0);
    expect(await notificationsOf(belowFixture.student, 'enrol_expiry_warning')).toHaveLength(0);
    expect(await eventsQueue.getJob(outboxRelayJobId(null, below.id))).toBeFalsy();
    expect(await redis.get(legacyWatermarkKey)).toBeNull();
  }, 180000);
});
