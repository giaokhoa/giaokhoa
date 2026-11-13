import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type CentreDb } from '@giaokhoa/db';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bootWorkerModuleAsOrdinaryRole,
  type OrdinaryWorkerModuleHarness,
} from '../../support/ordinary-worker-module';
import { NotificationDispatchProcessor } from '../../../src/processors/notification-dispatch.processor';
import { SpaceJobRunner } from '../../../src/db/routing/space-job-runner';
import { NotificationDigestProcessor } from '../../../src/processors/notification-digest.processor';
import type { WorkerMailMessage, WorkerMailSendResult } from '../../../src/resend-mail.service';


class FakeMail {
  readonly sent: WorkerMailMessage[] = [];
  mode: 'sent' | 'skipped' | 'throw' = 'sent';
  async send(message: WorkerMailMessage): Promise<WorkerMailSendResult> {
    if (this.mode === 'skipped') return { status: 'skipped', reason: 'resend_not_configured' };
    if (this.mode === 'throw') throw new Error('Resend API trả 500 (giả lập)');
    this.sent.push(message);
    return { status: 'sent', providerId: 'fake-resend-id' };
  }
}

function buildFakeI18n() {
  const catalog = JSON.parse(
    readFileSync(join(__dirname, '../../../src/i18n/vi/platform.json'), 'utf-8'),
  ) as Record<string, string>;
  return {
    t: (key: string, opts?: { args?: Record<string, unknown> }) => {
      const template = catalog[key.replace('platform.', '')];
      if (template === undefined) throw new Error(`Missing i18n key in vi catalog: ${key}`);
      return template.replace('{count}', String(opts?.args?.count ?? ''));
    },
  };
}

describe('Kênh email thông báo của worker + digest hàng ngày (NB-5, issue #174)', () => {
  let harness: OrdinaryWorkerModuleHarness;
  let db: CentreDb;
  const suffix = Date.now() % 100000;
  const userActive = `01920000-0000-7000-8000-${String(120000 + suffix).padStart(12, '0')}`;
  const userPrefOff = `01920000-0000-7000-8000-${String(220000 + suffix).padStart(12, '0')}`;
  const userSuspended = `01920000-0000-7000-8000-${String(320000 + suffix).padStart(12, '0')}`;
  const userDigest = `01920000-0000-7000-8000-${String(420000 + suffix).padStart(12, '0')}`;
  const userDeferred = `01920000-0000-7000-8000-${String(520000 + suffix).padStart(12, '0')}`;
  const userDigestOff = `01920000-0000-7000-8000-${String(620000 + suffix).padStart(12, '0')}`;
  const userPolicy = `01920000-0000-7000-8000-${String(720000 + suffix).padStart(12, '0')}`;
  const userMandatory = `01920000-0000-7000-8000-${String(820000 + suffix).padStart(12, '0')}`;
  const userThrow = `01920000-0000-7000-8000-${String(920000 + suffix).padStart(12, '0')}`;

  const mail = new FakeMail();
  let dispatch: NotificationDispatchProcessor;
  let digest: NotificationDigestProcessor;

  beforeAll(async () => {
    harness = await bootWorkerModuleAsOrdinaryRole();
    db = harness.adminDb;
    await db.deleteFrom('notification_dispatch_log').where('dedupe_key', 'like', 'nb5-%').execute();
    const rows: Array<[string, string, boolean]> = [
      [userActive, `nb5-a-${suffix}`, false],
      [userPrefOff, `nb5-p-${suffix}`, false],
      [userSuspended, `nb5-s-${suffix}`, true],
      [userDigest, `nb5-d-${suffix}`, false],
      [userDeferred, `nb5-x-${suffix}`, false],
      [userDigestOff, `nb5-o-${suffix}`, false],
      [userPolicy, `nb5-y-${suffix}`, false],
      [userMandatory, `nb5-m-${suffix}`, false],
      [userThrow, `nb5-t-${suffix}`, false],
    ];
    for (const [id, username, suspended] of rows) {
      await sql`insert into users (id, username, email, suspended, deleted) values (${id}, ${username}, ${`${username}@x.io`}, ${suspended}, false) on conflict (id) do nothing`.execute(db);
    }
    await db.insertInto('user_preferences').values({
      user_id: userPrefOff, name: 'message_provider_calendar_reminder_email_v2', value: 'off',
    }).onConflict((oc) => oc.doNothing()).execute();
    await db.insertInto('user_preferences').values({
      user_id: userDigestOff, name: 'message_provider_grade_updated_email_v2', value: 'off',
    }).onConflict((oc) => oc.doNothing()).execute();
    dispatch = new NotificationDispatchProcessor(harness.spaceDb, mail as never, new SpaceJobRunner(harness.spaceDb));
    digest = new NotificationDigestProcessor(harness.spaceDb, mail as never, buildFakeI18n() as never);
  });
  afterAll(async () => { await harness.close(); });

  const emailJob = (userId: string, dedupeKey: string, extra: Record<string, unknown> = {}) => ({
    data: {
      spaceSlug: null, spaceId: null,
      userId, provider: 'calendar_reminder', channel: 'email',
      subject: 'Nhắc lịch: Buổi học thêm', body: 'Bản tóm tắt cho kênh ngoài.',
      dedupeKey, ...extra,
    },
  }) as never;

  async function logRow(dedupeKey: string) {
    const rows = await db.selectFrom('notification_dispatch_log').selectAll()
      .where('dedupe_key', '=', dedupeKey)
      .execute();
    return rows[0];
  }

  it('tần suất immediate gửi một email thật với nội dung tối thiểu và ghi log sent', async () => {
    const before = mail.sent.length;
    const result = await dispatch.process(emailJob(userActive, `nb5-imm-${suffix}`, { emailFrequency: 'immediate' }));
    expect(result.status).toBe('sent');
    expect(mail.sent.length).toBe(before + 1);
    const message = mail.sent[mail.sent.length - 1]!;
    expect(message.to).toBe(`nb5-a-${suffix}@x.io`);
    expect(message.subject).toBe('Nhắc lịch: Buổi học thêm');
    expect(message.text).toBe('Bản tóm tắt cho kênh ngoài.');
    expect((await logRow(`nb5-imm-${suffix}`)).status).toBe('sent');
  });

  it('tần suất daily không gửi — lượt gửi xếp hàng chờ digest hàng ngày', async () => {
    const before = mail.sent.length;
    const result = await dispatch.process(emailJob(userActive, `nb5-daily-${suffix}`, { emailFrequency: 'daily' }));
    expect(result.status).toBe('digest-queued');
    expect(mail.sent.length).toBe(before);
    expect((await logRow(`nb5-daily-${suffix}`)).status).toBe('digest-queued');
  });

  it('opt-out email v2 đặt sau khi xếp hàng vẫn chặn lượt gửi (P2)', async () => {
    const before = mail.sent.length;
    const result = await dispatch.process(emailJob(userPrefOff, `nb5-off-${suffix}`, { emailFrequency: 'immediate' }));
    expect(result.status).toBe('skipped-preference');
    expect(mail.sent.length).toBe(before);
    expect((await logRow(`nb5-off-${suffix}`)).status).toBe('skipped-preference');
  });

  async function seedQueued(userId: string, key: string, subject: string, provider = 'grade_updated') {
    await db.insertInto('notification_dispatch_log').values({
      user_id: userId, provider, channel: 'email', status: 'digest-queued',
      subject, dedupe_key: key,
    }).onConflict((oc) => oc.doNothing()).execute();
  }

  it('lượt quét digest gửi ĐÚNG MỘT email tổng hợp cho mỗi người dùng, đóng các mục thành digest-sent, và không bao giờ gửi lại', async () => {
    await seedQueued(userDigest, `nb5-dg1-${suffix}`, 'Có điểm mới: Toán 6');
    await seedQueued(userDigest, `nb5-dg2-${suffix}`, 'Có điểm mới: Văn 6');
    await seedQueued(userDigest, `nb5-dg3-${suffix}`, 'Bài tập mới: Hình học');
    await seedQueued(userSuspended, `nb5-dg4-${suffix}`, 'Có điểm mới: Toán 6');

    const before = mail.sent.length;
    const sweep = await digest.process({} as never);
    expect(sweep.usersSent).toBe(2);
    expect(sweep.itemsSent).toBe(4);
    expect(sweep.usersSkipped).toBe(1);
    expect((await logRow(`nb5-daily-${suffix}`)).status).toBe('digest-sent');

    const digestMails = mail.sent.slice(before).filter((m) => m.to === `nb5-d-${suffix}@x.io`);
    expect(digestMails).toHaveLength(1);
    expect(digestMails[0]!.to).toBe(`nb5-d-${suffix}@x.io`);
    expect(digestMails[0]!.subject).toContain('3');
    expect(digestMails[0]!.text).toContain('Có điểm mới: Toán 6');
    expect(digestMails[0]!.text).toContain('Có điểm mới: Văn 6');
    expect(digestMails[0]!.text).toContain('Bài tập mới: Hình học');

    for (const key of [`nb5-dg1-${suffix}`, `nb5-dg2-${suffix}`, `nb5-dg3-${suffix}`]) {
      expect((await logRow(key)).status).toBe('digest-sent');
    }
    expect((await logRow(`nb5-dg4-${suffix}`)).status).toBe('skipped-suspended');
    expect(mail.sent.some((m) => m.to === `nb5-s-${suffix}@x.io`)).toBe(false);

    const second = await digest.process({} as never);
    expect(mail.sent.filter((m) => m.to === `nb5-d-${suffix}@x.io`)).toHaveLength(1);
    expect(second.itemsSent).toBe(0);
    expect((await logRow(`nb5-dg1-${suffix}`)).status).toBe('digest-sent');
  });

  it('transport chưa cấu hình để các mục đã xếp hàng chờ lượt quét sau', async () => {
    await seedQueued(userDeferred, `nb5-dg5-${suffix}`, 'Có điểm mới: Anh 6');
    mail.mode = 'skipped';
    try {
      const sweep = await digest.process({} as never);
      expect(sweep.usersDeferred).toBeGreaterThanOrEqual(1);
      expect(sweep.itemsSent).toBe(0);
      expect((await logRow(`nb5-dg5-${suffix}`)).status).toBe('digest-queued');
    } finally {
      mail.mode = 'sent';
    }
  });

  it('digest tôn trọng opt-out email theo provider đặt sau khi xếp hàng (luật lúc gửi)', async () => {
    await seedQueued(userDigestOff, `nb5-dg6-${suffix}`, 'Có điểm mới: Sinh 6');
    await seedQueued(userDigestOff, `nb5-dg7-${suffix}`, 'Có điểm mới: Sử 6');
    const sweep = await digest.process({} as never);
    expect(sweep.itemsSuppressedPreference).toBeGreaterThanOrEqual(2);
    expect((await logRow(`nb5-dg6-${suffix}`)).status).toBe('skipped-preference');
    expect((await logRow(`nb5-dg7-${suffix}`)).status).toBe('skipped-preference');
    expect(mail.sent.some((m) => m.to === `nb5-o-${suffix}@x.io`)).toBe(false);
  });

  it('digest tôn trọng chính sách site (NB-7) lúc gửi, kèm ngoại lệ bắt buộc P2', async () => {
    await db.insertInto('plugin_config').values({ plugin: 'notifications', name: 'provider_grade_updated_enabled', value: 'false' }).onConflict((oc) => oc.doNothing()).execute();
    await db.insertInto('plugin_config').values({ plugin: 'notifications', name: 'provider_admin_announcement_enabled', value: 'false' }).onConflict((oc) => oc.doNothing()).execute();
    try {
      await seedQueued(userPolicy, `nb5-dg8-${suffix}`, 'Có điểm mới: Toán 7');
      await seedQueued(userMandatory, `nb5-dg9-${suffix}`, 'Thông báo quản trị & an toàn', 'admin_announcement');
      const sweep = await digest.process({} as never);
      expect(sweep.itemsSuppressedAdmin).toBeGreaterThanOrEqual(1);
      expect((await logRow(`nb5-dg8-${suffix}`)).status).toBe('skipped-admin-disabled');
      expect(mail.sent.some((m) => m.to === `nb5-y-${suffix}@x.io`)).toBe(false);
      expect((await logRow(`nb5-dg9-${suffix}`)).status).toBe('digest-sent');
      const mandatoryMail = mail.sent.filter((m) => m.to === `nb5-m-${suffix}@x.io`);
      expect(mandatoryMail).toHaveLength(1);
      expect(mandatoryMail[0]!.text).toContain('Thông báo quản trị & an toàn');
    } finally {
      await db.deleteFrom('plugin_config')
        .where('plugin', '=', 'notifications')
        .where('name', 'in', ['provider_grade_updated_enabled', 'provider_admin_announcement_enabled'])
        .execute();
    }
  });

  it('lỗi transport để các mục xếp hàng chờ lượt quét sau và không làm hỏng lượt quét', async () => {
    await seedQueued(userThrow, `nb5-dg10-${suffix}`, 'Nhắc lịch: Lớp học bù', 'calendar_reminder');
    mail.mode = 'throw';
    try {
      const sweep = await digest.process({} as never);
      expect(sweep.usersFailed).toBeGreaterThanOrEqual(1);
      expect((await logRow(`nb5-dg10-${suffix}`)).status).toBe('digest-queued');
      expect(mail.sent.some((m) => m.to === `nb5-t-${suffix}@x.io`)).toBe(false);
    } finally {
      mail.mode = 'sent';
    }
  });
});
