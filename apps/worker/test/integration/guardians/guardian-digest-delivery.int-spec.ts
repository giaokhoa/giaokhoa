import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { OutboxRelayScheduler, outboxRelayJobId } from '../../../src/outbox-relay.scheduler';
import { GuardianDigestEventsProcessor } from '../../../src/processors/guardian-digest-events.processor';
import type { OutboxEventJobData } from '../../../src/outbox-event-routes';
import { sql, type RawBuilder } from '@giaokhoa/db';
import {
  bootWorkerModuleAsOrdinaryRole,
  type OrdinaryWorkerModuleHarness,
} from '../../support/ordinary-worker-module';

describe('Worker guardian digest delivery (PH-2, issue #159; chuyển worker ở #518)', () => {
  let context: INestApplicationContext;
  let harness: OrdinaryWorkerModuleHarness;
  let db: OrdinaryWorkerModuleHarness['adminDb'];
  let eventsQueue: Queue;
  let dispatchQueue: Queue;
  let eventsProcessor: GuardianDigestEventsProcessor;
  let fixtureTenantId = '';
  const suffix = Date.now();
  const DAY = 24 * 3600_000;

  const runId = randomUUID().replaceAll('-', '').slice(0, 6);
  const uid = (n: number) => `01900000-0000-7000-8000-${runId}${n.toString(16).padStart(6, '0')}`;

  async function execRows<T>(query: RawBuilder<unknown>): Promise<T[]> {
    const result = await query.execute(db);
    return result.rows as T[];
  }

  async function makeUser(id: string) {
    await sql`insert into users (id, username, email, first_name, last_name, suspended, deleted) values (${id}, ${`ph2d-${id.slice(-6)}-${suffix}`}, ${`ph2d-${id.slice(-6)}-${suffix}@x.io`}, 'An', 'Nguyễn Văn', false, false) on conflict (id) do nothing`.execute(db);
  }

  async function setEmailImmediate(guardianId: string) {
    for (const provider of ['guardian_digest', 'guardian_overdue_alert']) {
      await db.insertInto('user_preferences').values({
        user_id: guardianId, name: `message_provider_${provider}_email_v2`, value: 'immediate',
      }).onConflict((oc) => oc.doNothing()).execute();
    }
  }

  async function makeLink(guardianId: string, studentId: string, status = 'active') {
    await setEmailImmediate(guardianId);
    const rows = await execRows<{ id: string }>(sql`insert into guardian_links (guardian_user_id, student_user_id, relationship, status, created_by, created_at, updated_at, tenant_id) values (${guardianId}, ${studentId}, 'Cha', ${status}, ${guardianId}, ${new Date(Date.now() - 10 * DAY)}, now(), (select id from tenants where slug = 'worker-fixture')) returning id`);
    return rows[0]!.id;
  }

  async function fixtureClassId(): Promise<string> {
    const ownerId = '01980000-0000-7000-8000-00000000c1a5';
    await sql`insert into users (id, username, email, suspended, deleted) values (${ownerId}, 'wk-class-owner', 'wk-class-owner@x.io', false, false) on conflict (id) do nothing`.execute(db);
    const coh = await execRows<{ id: string }>(sql`insert into cohort (tenant_id, name, context_id, component, visible) values ((select id from tenants where slug = 'worker-fixture'), 'wk fixture cohort', '01990000-0000-7000-8000-0000000000a1', 'class', false) returning id`);
    const cohId = coh[0]!.id;
    const cls = await execRows<{ id: string }>(sql`insert into classes (tenant_id, name, owner_id, cohort_id) values ((select id from tenants where slug = 'worker-fixture'), 'wk fixture class', ${ownerId}, ${cohId}) returning id`);
    return cls[0]!.id;
  }

  async function makeEnrolledCourse(studentId: string): Promise<string> {
    const catRows = await execRows<{ id: string }>(sql`insert into course_categories (name, path, tenant_id) values (${`ph2d-cat-${suffix}-${Math.random()}`}, '', (select id from tenants where slug = 'worker-fixture')) returning id`);
    const catId = catRows[0]!.id;
    const short = `ph2d${suffix}${Math.floor(Math.random() * 1e9)}`;
    const courseRows = await execRows<{ id: string }>(sql`insert into course (category, tenant_id, full_name, short_name, visible, class_id) values (${catId}, (select tenant_id from course_categories where id = ${catId}), 'PH2D course', ${short}, true, ${await fixtureClassId()}) returning id`);
    const courseId = courseRows[0]!.id;
    const instRows = await execRows<{ id: string }>(sql`insert into enrol (course_id, enrol, status) values (${courseId}, 'manual', 0) returning id`);
    const instId = instRows[0]!.id;
    await sql`insert into user_enrolments (enrol_id, user_id, status, time_start) values (${instId}, ${studentId}, 0, ${new Date(Date.now() - 30 * DAY)})`.execute(db);
    return courseId;
  }

  async function makeGrade(courseId: string, studentId: string, input: { itemName: string; postingPolicy: 'auto' | 'manual'; finalGrade: number }) {
    const itemRows = await execRows<{ id: string }>(sql`insert into grade_items (course_id, item_name, item_type, grade_max, posting_policy) values (${courseId}, ${input.itemName}, 'manual', 10, ${input.postingPolicy}) returning id`);
    const itemId = itemRows[0]!.id;
    await sql`insert into grade_grades (item_id, user_id, final_grade, updated_at) values (${itemId}, ${studentId}, ${input.finalGrade}, now())`.execute(db);
    return itemId;
  }

  async function queueDigestEvent(input: {
    guardianId: string; studentId: string; kind: 'weekly' | 'daily';
    windowStart: Date; windowEnd: Date;
  }): Promise<{ digestId: string; outboxId: string }> {
    const dedupeKey = `digest:${fixtureTenantId}:${input.guardianId}:${input.studentId}:${input.kind}:${input.windowStart.toISOString()}:int-${suffix}-${Math.random()}`;
    const row = await db.insertInto('guardian_digests').values({
      guardian_user_id: input.guardianId, student_user_id: input.studentId, kind: input.kind,
      window_start: input.windowStart, window_end: input.windowEnd, activity_cm_id: null,
      dedupe_key: dedupeKey, status: 'queued', tenant_id: fixtureTenantId,
    }).returning('id').executeTakeFirstOrThrow();
    const digestId = row.id;
    const event = await db.insertInto('outbox_events').values({
      aggregate: 'guardian', type: 'guardian_digest_due', tenant_id: fixtureTenantId,
      payload: {
        guardianUserId: input.guardianId, studentUserId: input.studentId, digestId, tenantId: fixtureTenantId,
        kind: input.kind, windowStart: input.windowStart.toISOString(), windowEnd: input.windowEnd.toISOString(),
      },
    }).returning('id').executeTakeFirstOrThrow();
    return { digestId, outboxId: event.id };
  }

  async function queueOverdueEvent(input: {
    guardianId: string; studentId: string; cmId: string; courseId: string; activityName: string; dueAt: Date;
  }): Promise<{ digestId: string; outboxId: string }> {
    const dedupeKey = `overdue:${fixtureTenantId}:${input.guardianId}:${input.studentId}:${input.cmId}:int-${suffix}-${Math.random()}`;
    const row = await db.insertInto('guardian_digests').values({
      guardian_user_id: input.guardianId, student_user_id: input.studentId, kind: 'overdue_alert',
      window_start: null, window_end: null, activity_cm_id: input.cmId,
      dedupe_key: dedupeKey, status: 'queued', tenant_id: fixtureTenantId,
    }).returning('id').executeTakeFirstOrThrow();
    const digestId = row.id;
    const payload = {
      guardianUserId: input.guardianId, studentUserId: input.studentId, digestId, tenantId: fixtureTenantId,
      cmId: input.cmId, activityKind: 'quiz' as const, courseId: input.courseId,
      activityName: input.activityName, dueAt: input.dueAt.toISOString(),
    };
    const event = await db.insertInto('outbox_events').values({
      aggregate: 'guardian', type: 'guardian_overdue_alert', tenant_id: fixtureTenantId, payload,
    }).returning('id').executeTakeFirstOrThrow();
    return { digestId, outboxId: event.id };
  }

  async function digestRow(id: string) {
    const row = await db.selectFrom('guardian_digests').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    return { status: row.status, newResultsCount: row.new_results_count, notificationId: row.notification_id };
  }

  async function waitDigestStatus(id: string, timeoutMs = 90000) {
    await context.get(OutboxRelayScheduler).relayTick();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await digestRow(id);
      if (row.status !== 'queued') return row;
      if (Date.now() > deadline) throw new Error(`digest ${id} vẫn queued sau ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  async function notificationsOf(guardianId: string, eventType: string) {
    const rows = await db.selectFrom('notifications').selectAll()
      .where('user_id_to', '=', guardianId)
      .where('event_type', '=', eventType)
      .execute();
    return rows.map((r) => ({ id: r.id, subject: r.subject, fullMessage: r.full_message, contextUrl: r.context_url, tenantId: r.tenant_id }));
  }

  async function waitEventJobCompleted(outboxId: string, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await eventsQueue.getJob(outboxRelayJobId(null, outboxId));
      if (job && (await job.getState()) === 'completed') return;
      if (Date.now() > deadline) throw new Error(`job sự kiện ${outboxId} chưa completed sau ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  async function waitEmailEvidence(jobId: string, timeoutMs = 60000): Promise<{ subject: string; raw: string }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await dispatchQueue.getJob(jobId);
      if (job) {
        const data = job.data as { subject: string };
        return { subject: data.subject, raw: JSON.stringify(job.data) };
      }
      const log = await db.selectFrom('notification_dispatch_log').selectAll()
        .where('dedupe_key', '=', jobId).executeTakeFirst();
      if (log) return { subject: log.subject, raw: JSON.stringify(log) };
      if (Date.now() > deadline) throw new Error(`không thấy job/log email ${jobId} sau ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  beforeAll(async () => {
    harness = await bootWorkerModuleAsOrdinaryRole();
    context = harness.context;
    db = harness.adminDb;
    await sql`insert into tenants (slug, name, kind, status) values ('worker-fixture', 'Worker fixture tenant', 'school', 'active') on conflict (slug) do nothing`.execute(db);
    const tenantRows = await execRows<{ id: string }>(sql`select id from tenants where slug = 'worker-fixture'`);
    fixtureTenantId = tenantRows[0]!.id;
    eventsQueue = context.get<Queue>(getQueueToken('guardian-digest-events'));
    dispatchQueue = context.get<Queue>(getQueueToken('notification-dispatch'));
    eventsProcessor = context.get(GuardianDigestEventsProcessor);
  });
  afterAll(async () => { await harness.close(); });

  it('kết quả mới ĐÃ CÔNG BỐ: gửi đúng 1 thông báo đếm số mục + link sâu, không điểm số ở mọi kênh, audit có vết, phát lại không trùng', async () => {
    const guardian = uid(1); const student = uid(2);
    await makeUser(guardian); await makeUser(student);
    await makeLink(guardian, student);
    const courseId = await makeEnrolledCourse(student);
    await makeGrade(courseId, student, { itemName: 'Điểm miệng PH2 bí mật', postingPolicy: 'auto', finalGrade: 7.25 });

    const now = Date.now();
    const windowStart = new Date(now - 7 * DAY);
    const windowEnd = new Date(now + DAY);
    const { digestId } = await queueDigestEvent({ guardianId: guardian, studentId: student, kind: 'weekly', windowStart, windowEnd });

    const row = await waitDigestStatus(digestId);
    expect(row.status).toBe('sent');
    expect(row.newResultsCount).toBe(1);

    const notifs = await notificationsOf(guardian, 'guardian_digest');
    expect(notifs).toHaveLength(1);
    const notif = notifs[0]!;
    expect(notif.subject).toContain('Tổng hợp tuần');
    expect(notif.fullMessage).toContain('Kết quả mới đã công bố: 1');
    expect(notif.contextUrl).toBe(`/guardian/students/${student}`);
    expect(notif.tenantId).toBe(fixtureTenantId);
    expect(notif.fullMessage).not.toContain('7.25');
    expect(notif.fullMessage).not.toContain('Điểm miệng PH2 bí mật');
    expect(notif.subject).not.toContain('7.25');
    expect(row.notificationId).toBe(notif.id);

    const auditRows = await db.selectFrom('outbox_events').selectAll().where('type', '=', 'guardian_digest_sent').execute();
    const audit = (auditRows as unknown as { payload: { digestId?: string } }[])
      .find((e) => e.payload.digestId === digestId);
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit!.payload)).not.toContain('7.25');

    const jobId = `${fixtureTenantId}-dispatch-guardian_digest-${guardian}-email-${notif.id}`;
    const email = await waitEmailEvidence(jobId);
    expect(email.subject).toBe('Thông tin mới về việc học của con');
    expect(email.raw).not.toContain('7.25');
    expect(email.raw).not.toContain('Điểm miệng PH2 bí mật');

    const replay = await db.insertInto('outbox_events').values({
      aggregate: 'guardian', type: 'guardian_digest_due', tenant_id: fixtureTenantId,
      payload: {
        guardianUserId: guardian, studentUserId: student, digestId, tenantId: fixtureTenantId,
        kind: 'weekly', windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(),
      },
    }).returning('id').executeTakeFirstOrThrow();
    await waitEventJobCompleted(replay.id);
    expect(await notificationsOf(guardian, 'guardian_digest')).toHaveLength(1);

    const other = uid(3);
    await makeUser(other);
    expect(await notificationsOf(other, 'guardian_digest')).toHaveLength(0);
  }, 180000);

  it('item CHƯA công bố (chính sách manual, chưa publish): số kết quả mới bằng 0, lượt khép skipped_empty, không rò tên item hay điểm', async () => {
    const guardian = uid(4); const student = uid(5);
    await makeUser(guardian); await makeUser(student);
    await makeLink(guardian, student);
    const courseId = await makeEnrolledCourse(student);
    await makeGrade(courseId, student, { itemName: 'Điểm chưa công bố PH2', postingPolicy: 'manual', finalGrade: 3.75 });

    const now = Date.now();
    const { digestId } = await queueDigestEvent({
      guardianId: guardian, studentId: student, kind: 'weekly',
      windowStart: new Date(now - 7 * DAY), windowEnd: new Date(now + DAY),
    });
    const row = await waitDigestStatus(digestId);
    expect(row.newResultsCount).toBe(0);
    expect(row.status).toBe('skipped_empty');
    const notifs = await notificationsOf(guardian, 'guardian_digest');
    expect(notifs).toHaveLength(0);
    expect(JSON.stringify(notifs)).not.toContain('Điểm chưa công bố PH2');
    expect(JSON.stringify(notifs)).not.toContain('3.75');
  }, 180000);

  it('cửa sổ không có gì mới: lượt khép skipped_empty, không sinh thông báo', async () => {
    const guardian = uid(6); const student = uid(7);
    await makeUser(guardian); await makeUser(student);
    await makeLink(guardian, student);

    const now = Date.now();
    const { digestId } = await queueDigestEvent({
      guardianId: guardian, studentId: student, kind: 'weekly',
      windowStart: new Date(now - 14 * DAY), windowEnd: new Date(now - 7 * DAY),
    });
    const row = await waitDigestStatus(digestId);
    expect(row.status).toBe('skipped_empty');
    expect(await notificationsOf(guardian, 'guardian_digest')).toHaveLength(0);
  }, 180000);

  it('liên kết đã thu hồi tại thời điểm gửi: lượt khép skipped_revoked, không gửi gì', async () => {
    const guardian = uid(8); const student = uid(9);
    await makeUser(guardian); await makeUser(student);
    await makeLink(guardian, student, 'revoked');

    const now = Date.now();
    const { digestId } = await queueDigestEvent({
      guardianId: guardian, studentId: student, kind: 'weekly',
      windowStart: new Date(now - 7 * DAY), windowEnd: new Date(now + DAY),
    });
    const row = await waitDigestStatus(digestId);
    expect(row.status).toBe('skipped_revoked');
    expect(await notificationsOf(guardian, 'guardian_digest')).toHaveLength(0);
  }, 180000);

  it('đẩy riêng quá hạn ≥7 ngày: thông báo guardian_overdue_alert đúng một lần, tên hoạt động không ra kênh email, phát lại không trùng', async () => {
    const guardian = uid(10); const student = uid(11);
    await makeUser(guardian); await makeUser(student);
    await makeLink(guardian, student);
    const courseId = await makeEnrolledCourse(student);
    const cmId = '01900000-0000-7000-8000-0000000000aa';

    const { digestId } = await queueOverdueEvent({
      guardianId: guardian, studentId: student, cmId, courseId,
      activityName: 'Kiểm tra chương 1', dueAt: new Date(Date.now() - 8 * DAY),
    });
    const row = await waitDigestStatus(digestId);
    expect(row.status).toBe('sent');

    const notifs = await notificationsOf(guardian, 'guardian_overdue_alert');
    expect(notifs).toHaveLength(1);
    const notif = notifs[0]!;
    expect(notif.subject).toContain('Kiểm tra chương 1');
    expect(notif.contextUrl).toBe(`/guardian/students/${student}`);
    expect(row.notificationId).toBe(notif.id);

    const jobId = `${fixtureTenantId}-dispatch-guardian_overdue_alert-${guardian}-email-${notif.id}`;
    const email = await waitEmailEvidence(jobId);
    expect(email.subject).toBe('Có việc quá hạn 7 ngày chưa nộp');
    expect(email.raw).not.toContain('Kiểm tra chương 1');

    const replay = await db.insertInto('outbox_events').values({
      aggregate: 'guardian', type: 'guardian_overdue_alert', tenant_id: fixtureTenantId,
      payload: {
        guardianUserId: guardian, studentUserId: student, digestId, tenantId: fixtureTenantId,
        cmId, activityKind: 'quiz', courseId,
        activityName: 'Kiểm tra chương 1', dueAt: new Date(Date.now() - 8 * DAY).toISOString(),
      },
    }).returning('id').executeTakeFirstOrThrow();
    await waitEventJobCompleted(replay.id);
    expect(await notificationsOf(guardian, 'guardian_overdue_alert')).toHaveLength(1);
  }, 180000);

  it('cùng một job sự kiện xử lý hai lần: lần hai là no-op nhờ vết lượt đã rời queued — không sinh thông báo thứ hai', async () => {
    const guardian = uid(12); const student = uid(13);
    await makeUser(guardian); await makeUser(student);
    await makeLink(guardian, student);
    const courseId = await makeEnrolledCourse(student);
    await makeGrade(courseId, student, { itemName: 'Điểm miệng PH2 lần hai', postingPolicy: 'auto', finalGrade: 8.5 });

    const now = Date.now();
    const windowStart = new Date(now - 7 * DAY);
    const windowEnd = new Date(now + DAY);
    const dedupeKey = `digest:${fixtureTenantId}:${guardian}:${student}:weekly:${windowStart.toISOString()}:int-direct-${suffix}-${Math.random()}`;
    const row = await db.insertInto('guardian_digests').values({
      guardian_user_id: guardian, student_user_id: student, kind: 'weekly',
      window_start: windowStart, window_end: windowEnd, activity_cm_id: null,
      dedupe_key: dedupeKey, status: 'queued', tenant_id: fixtureTenantId,
    }).returning('id').executeTakeFirstOrThrow();
    const digestId = row.id;
    const jobData: OutboxEventJobData = {
      outboxId: '01900000-0000-7000-8000-0000000000d1', seq: 0, aggregate: 'guardian',
      type: 'guardian_digest_due', tenantId: fixtureTenantId, spaceSlug: null, spaceId: null, occurredAt: new Date().toISOString(),
      payload: {
        guardianUserId: guardian, studentUserId: student, digestId, tenantId: fixtureTenantId,
        kind: 'weekly', windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(),
      },
    };
    const first = await eventsProcessor.process({ data: jobData } as never);
    expect(first).toEqual({ handled: true });
    expect((await digestRow(digestId)).status).toBe('sent');
    expect(await notificationsOf(guardian, 'guardian_digest')).toHaveLength(1);

    const second = await eventsProcessor.process({ data: jobData } as never);
    expect(second).toEqual({ handled: true });
    expect(await notificationsOf(guardian, 'guardian_digest')).toHaveLength(1);
  }, 180000);
});
