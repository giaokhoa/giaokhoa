import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql, type RawBuilder } from '@giaokhoa/db';
import { OutboxRelayScheduler, outboxRelayJobId } from '../../../src/outbox-relay.scheduler';
import { NotificationEventsMarker } from '../../../src/notification-events-marker.service';
import { NotificationEventsProcessor } from '../../../src/processors/notification-events.processor';
import type { OutboxEventJobData } from '../../../src/outbox-event-routes';
import {
  bootWorkerModuleAsOrdinaryRole,
  type OrdinaryWorkerModuleHarness,
} from '../../support/ordinary-worker-module';

describe('Worker notification events queue mechanism (viết lại reanchor ở #520)', () => {
  let context: INestApplicationContext;
  let harness: OrdinaryWorkerModuleHarness;
  let db: OrdinaryWorkerModuleHarness['adminDb'];
  let eventsQueue: Queue;
  let processor: NotificationEventsProcessor;
  let marker: NotificationEventsMarker;
  let fixtureTenantId = '';
  const suffix = Date.now();
  const DAY = 24 * 3600_000;

  const uid = (n: number) => `01900000-0000-7000-8000-${String(620000 + n * 37 + (suffix % 991)).padStart(12, '0')}`;

  async function execRows<T>(query: RawBuilder<T>): Promise<T[]> {
    const result = await query.execute(db);
    return result.rows;
  }

  async function makeUser(id: string) {
    await sql`insert into users (id, username, email, first_name, last_name, suspended, deleted) values (${id}, ${`nq520-${id.slice(-6)}-${suffix}`}, ${`nq520-${id.slice(-6)}-${suffix}@x.io`}, 'An', 'Nguyễn Văn', false, false) on conflict (id) do nothing`.execute(db);
    for (const provider of ['grade_updated', 'enrol_expiry_warning']) {
      await db.insertInto('user_preferences').values({
        user_id: id, name: `message_provider_${provider}_email_v2`, value: 'immediate',
      }).onConflict((oc) => oc.doNothing()).execute();
    }
  }

  async function fixtureClassId(): Promise<string> {
    const ownerId = '01980000-0000-7000-8000-00000000c1a5';
    await sql`insert into users (id, username, email, suspended, deleted) values (${ownerId}, 'wk-class-owner', 'wk-class-owner@x.io', false, false) on conflict (id) do nothing`.execute(db);
    const coh = await execRows<{ id: string }>(sql`insert into cohort (tenant_id, name, context_id, component, visible) values ((select id from tenants where slug = 'worker-fixture'), 'wk fixture cohort', '01990000-0000-7000-8000-0000000000a1', 'class', false) returning id`);
    const cls = await execRows<{ id: string }>(sql`insert into classes (tenant_id, name, owner_id, cohort_id) values ((select id from tenants where slug = 'worker-fixture'), 'wk fixture class', ${ownerId}, ${coh[0]!.id}) returning id`);
    return cls[0]!.id;
  }

  async function makeCourse(name: string): Promise<string> {
    const cat = await execRows<{ id: string }>(sql`insert into course_categories (name, path, tenant_id) values (${`nq520-cat-${suffix}-${Math.random()}`}, '', (select id from tenants where slug = 'worker-fixture')) returning id`);
    const short = `nq520${suffix}${Math.floor(Math.random() * 1e9)}`;
    const rows = await execRows<{ id: string }>(sql`insert into course (category, tenant_id, full_name, short_name, visible, class_id) values (${cat[0]!.id}, (select tenant_id from course_categories where id = ${cat[0]!.id}), ${name}, ${short}, true, ${await fixtureClassId()}) returning id`);
    return rows[0]!.id;
  }

  async function enrolStudent(courseId: string, userId: string): Promise<void> {
    const inst = await db.insertInto('enrol').values({ course_id: courseId, enrol: 'manual', status: 0 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('user_enrolments').values({
      enrol_id: inst.id, user_id: userId, status: 0, time_start: new Date(Date.now() - DAY),
    }).execute();
  }

  async function emitExpiryWarning(userId: string, courseId: string): Promise<string> {
    const row = await db.insertInto('outbox_events').values({
      aggregate: 'enrol', type: 'enrol_expiry_warning', tenant_id: fixtureTenantId,
      payload: {
        userId, enrolmentId: uid(950), enrolId: uid(951), courseId,
        timeEnd: new Date(Date.now() + 3 * DAY).toISOString(),
      },
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async function waitJobCompleted(outboxId: string, timeoutMs = 90000): Promise<void> {
    await context.get(OutboxRelayScheduler).relayTick();
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
    processor = context.get(NotificationEventsProcessor);
    marker = context.get(NotificationEventsMarker);
  });
  afterAll(async () => { await harness.close(); });

  it('một sự kiện qua relay vào hàng đợi được xử lý đúng một lần, dòng được đóng dấu publishedAt sau khi phát và hàng đợi giữ đúng một job của dòng', async () => {
    const student = uid(1);
    await makeUser(student);
    const courseId = await makeCourse('NQ520 Khoá cơ chế');
    await enrolStudent(courseId, student);

    const outboxId = await emitExpiryWarning(student, courseId);
    await waitJobCompleted(outboxId);

    expect(await notificationsOf(student, 'enrol_expiry_warning')).toHaveLength(1);
    const row = await db.selectFrom('outbox_events').selectAll().where('id', '=', outboxId).executeTakeFirst();
    expect(row?.published_at).not.toBeNull();

    const jobs = await eventsQueue.getJobs(['waiting', 'active', 'completed', 'delayed']);
    expect(jobs.filter((j) => j.id === outboxRelayJobId(null, outboxId))).toHaveLength(1);
    expect(await notificationsOf(student, 'enrol_expiry_warning')).toHaveLength(1);
  }, 180000);

  it('sự kiện mang seq nhỏ hơn seq của sự kiện đã xử lý vẫn được xử lý — consumer hàng đợi không giữ watermark seq để bị kẹt sau reset DB', async () => {
    const student = uid(2);
    await makeUser(student);
    const courseId = await makeCourse('NQ520 Khoá seq thụt');
    await enrolStudent(courseId, student);

    const firstId = await emitExpiryWarning(student, courseId);
    await waitJobCompleted(firstId);
    expect(await notificationsOf(student, 'enrol_expiry_warning')).toHaveLength(1);
    const firstRow = await db.selectFrom('outbox_events').selectAll().where('id', '=', firstId).executeTakeFirst();
    const firstSeq = Number(firstRow!.seq);

    const secondPayload = {
      userId: student, enrolmentId: uid(952), enrolId: uid(953), courseId,
      timeEnd: new Date(Date.now() + 3 * DAY).toISOString(),
    };
    let secondId: string | undefined;
    for (let candidate = firstSeq - 1; candidate > firstSeq - 200 && !secondId; candidate--) {
      try {
        const secondRows = await execRows<{ id: string }>(sql`
          insert into outbox_events (aggregate, type, tenant_id, payload, seq)
          overriding system value
          values ('enrol', 'enrol_expiry_warning', ${fixtureTenantId}, ${JSON.stringify(secondPayload)}::jsonb, ${candidate})
          returning id`);
        secondId = secondRows[0]!.id;
      } catch {
      }
    }
    if (!secondId) throw new Error('không tìm được seq trống nhỏ hơn seq của sự kiện đã xử lý');
    await waitJobCompleted(secondId);
    expect(await notificationsOf(student, 'enrol_expiry_warning')).toHaveLength(2);
  }, 180000);

  it('phát lại thật: processor xử lý cùng một job hai lần thì lần hai kết luận trùng và không sinh thông báo thứ hai', async () => {
    const student = uid(3);
    await makeUser(student);
    const courseId = await makeCourse('NQ520 Khoá phát lại');
    await enrolStudent(courseId, student);
    const item = await execRows<{ id: string }>(sql`insert into grade_items (course_id, item_name, item_type, grade_max, posting_policy) values (${courseId}, 'Bài phát lại', 'manual', 100, 'auto') returning id`);
    await db.insertInto('grade_grades').values({
      item_id: item[0]!.id,
      user_id: student,
      raw_grade: 9,
      final_grade: 9,
    }).execute();

    const jobData: OutboxEventJobData = {
      outboxId: uid(960), seq: 0, aggregate: 'grades', type: 'grade_updated',
      tenantId: fixtureTenantId, spaceSlug: null, spaceId: null, occurredAt: new Date().toISOString(),
      payload: {
        courseId, itemId: item[0]!.id, userId: student,
        rawGrade: 9, finalGrade: 9, actorId: uid(961),
      },
    };
    const fakeJob = {
      data: jobData,
      moveToDelayed: async () => undefined,
    };
    const first = await processor.process(fakeJob as never, 'worker-token');
    expect(first).toEqual({ handled: true });
    expect(await notificationsOf(student, 'grade_updated')).toHaveLength(1);

    const second = await processor.process(fakeJob as never, 'worker-token');
    expect(second).toEqual({ handled: true, duplicate: true });
    expect(await notificationsOf(student, 'grade_updated')).toHaveLength(1);
  }, 180000);

  it('lease đang xử lý chỉ nhả được bởi đúng token của chủ — token lạ không mở được lease của lượt khác', async () => {
    const outboxId = uid(970);
    const token = await marker.claimProcessing(outboxId);
    expect(token).not.toBeNull();
    expect(await marker.claimProcessing(outboxId)).toBeNull();
    await marker.releaseProcessing(outboxId, 'token-khong-phai-cua-chu');
    expect(await marker.claimProcessing(outboxId)).toBeNull();
    await marker.releaseProcessing(outboxId, token!);
    const next = await marker.claimProcessing(outboxId);
    expect(next).not.toBeNull();
    await marker.releaseProcessing(outboxId, next!);
    expect(await marker.hasProcessed(outboxId)).toBe(false);
    await marker.markProcessed(outboxId);
    expect(await marker.hasProcessed(outboxId)).toBe(true);
  }, 180000);
});
