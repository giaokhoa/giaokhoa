import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD, systemContextId } from '../../support/identity-access-helpers';

describe('Tuỳ chọn thông báo v2 (NB-2, issue #174)', () => {
  let app: INestApplication;
  let admin: string;
  let pg: Client;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
  });
  afterAll(async () => { await pg.end(); await app.close(); });

  interface PrefRow {
    provider: string; component: string; group: string;
    label: { vi: string; en: string }; description: { vi: string; en: string };
    teacherOnly: boolean; mandatoryInApp: boolean;
    popupEnabled: boolean; emailFrequency: string | null; emailAvailable: boolean;
    [key: string]: unknown;
  }

  async function freshUser(): Promise<{ id: string; token: string }> {
    const user = await createUserViaApi(app, admin);
    const token = (await login(app, user.username, STRONG_PASSWORD)).accessToken;
    await assignRole(app, admin, user.id, await roleIdByShortname(app, admin, 'teacher'), await systemContextId(app, admin));
    return { id: user.id, token };
  }

  async function freshDualUser(): Promise<{ id: string; token: string }> {
    const user = await createUserViaApi(app, admin);
    const sys = await systemContextId(app, admin);
    await assignRole(app, admin, user.id, await roleIdByShortname(app, admin, 'teacher'), sys);
    await assignRole(app, admin, user.id, await roleIdByShortname(app, admin, 'student'), sys);
    const token = (await login(app, user.username, STRONG_PASSWORD)).accessToken;
    return { id: user.id, token };
  }

  async function freshGuardianStaffUser(): Promise<{ id: string; token: string }> {
    const { id, token } = await freshUser();
    const child = await createUserViaApi(app, admin);
    const tenant = await pg.query(`select id from tenants order by created_at asc limit 1`);
    await pg.query(
      `insert into guardian_links (tenant_id, guardian_user_id, student_user_id, relationship, created_by) values ($1, $2, $3, 'Cha', $2)`,
      [tenant.rows[0].id, id, child.id],
    );
    return { id, token };
  }

  async function preferencesOf(token: string): Promise<PrefRow[]> {
    const res = await http(app).get('/api/v1/messages/preferences').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as PrefRow[];
  }

  async function send(userId: string, provider: string): Promise<{ popup?: string; email?: string }> {
    const res = await http(app).post('/api/v1/notifications/send').set('Authorization', `Bearer ${admin}`)
      .send({ userId, provider, subject: `Thông báo kiểm tra ${provider}`, body: 'Nội dung kiểm tra' });
    expect(res.status).toBeLessThan(300);
    return (res.body as { channels: { popup?: string; email?: string } }).channels;
  }

  it('GET trả một dòng v2 có nhãn cho mỗi provider trong audience giáo viên thuần — không khoá thô, không push, không trục trạng thái đăng nhập', async () => {
    const { token } = await freshUser();
    const rows = await preferencesOf(token);
    expect(rows.map((r) => r.provider).sort()).toEqual([
      'admin_announcement', 'assignment_submitted', 'badge_awarded', 'calendar_reminder',
      'competency_review_requested', 'contact_request', 'conversation_reported',
      'message_new', 'quiz_attempt_finished', 'report_scheduled',
    ]);
    for (const row of rows) {
      expect(row.label.vi.length).toBeGreaterThan(0);
      expect(row.label.en.length).toBeGreaterThan(0);
      expect(row.description.vi.length).toBeGreaterThan(0);
      expect(row.description.en.length).toBeGreaterThan(0);
      expect(row).not.toHaveProperty('state');
      expect(row).not.toHaveProperty('channel');
      expect(row).not.toHaveProperty('channels');
      expect(row.emailAvailable).toBe(true);
    }
    const byName = new Map(rows.map((r) => [r.provider, r]));
    expect(byName.get('message_new')).toMatchObject({ group: 'people', emailFrequency: 'immediate' });
    expect(byName.get('quiz_attempt_finished')?.teacherOnly).toBe(true);
    expect(byName.get('conversation_reported')?.teacherOnly).toBe(true);
    expect(byName.get('assignment_submitted')?.teacherOnly).toBe(false);
    expect(rows.filter((r) => r.mandatoryInApp).map((r) => r.provider)).toEqual(['admin_announcement']);
    expect(byName.get('admin_announcement')).toMatchObject({ group: 'system', popupEnabled: true, emailFrequency: 'immediate' });
  });

  it('nguyên mẫu audience (issue #288): vai kép thấy phía học viên, staff phụ huynh thấy loại phụ huynh, admin thấy cả 20', async () => {
    const dual = await freshDualUser();
    const dualRows = await preferencesOf(dual.token);
    const dualNames = dualRows.map((r) => r.provider);
    expect(dualNames).toHaveLength(18);
    expect(dualNames).toContain('grade_updated');
    expect(dualNames).toContain('enrol_expiry_warning');
    expect(dualNames).not.toContain('guardian_digest');
    expect(dualNames).not.toContain('guardian_overdue_alert');
    const dualByName = new Map(dualRows.map((r) => [r.provider, r]));
    expect(dualByName.get('grade_updated')).toMatchObject({ group: 'learning', teacherOnly: false, mandatoryInApp: false, popupEnabled: true, emailFrequency: 'daily' });
    expect(dualByName.get('course_completed')?.emailFrequency).toBeNull();

    const guardianStaff = await freshGuardianStaffUser();
    const guardianNames = (await preferencesOf(guardianStaff.token)).map((r) => r.provider);
    expect(guardianNames).toHaveLength(12);
    expect(guardianNames).toContain('guardian_digest');
    expect(guardianNames).toContain('guardian_overdue_alert');
    const guardianPut = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${guardianStaff.token}`)
      .send({ provider: 'guardian_digest', popupEnabled: false });
    expect(guardianPut.status).toBe(200);
    expect((guardianPut.body as PrefRow).popupEnabled).toBe(false);

    expect(await preferencesOf(admin)).toHaveLength(20);
  });

  it('cổng audience trên PUT (issue #288): giáo viên thuần bị từ chối 403 với loại chỉ-học-viên và loại phụ huynh', async () => {
    const { token } = await freshUser();
    for (const provider of ['grade_updated', 'guardian_digest']) {
      const refused = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${token}`)
        .send({ provider, popupEnabled: false });
      expect(refused.status).toBe(403);
      expect((refused.body as { code?: string }).code).toBe('messaging.preference_audience');
    }
  });

  it('thay đổi hiệu lực ngay ở lần phân phối tiếp theo; tắt email giữ popup độc lập', async () => {
    const { id, token } = await freshDualUser();
    expect(await send(id, 'grade_updated')).toMatchObject({ popup: 'delivered', email: 'queued' });

    const off = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${token}`)
      .send({ provider: 'grade_updated', emailFrequency: 'off' });
    expect(off.status).toBe(200);
    expect((off.body as PrefRow).emailFrequency).toBe('off');
    expect(await send(id, 'grade_updated')).toMatchObject({ popup: 'delivered', email: 'skipped-preference' });

    const popupOff = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${token}`)
      .send({ provider: 'grade_updated', popupEnabled: false });
    expect(popupOff.status).toBe(200);
    expect(await send(id, 'grade_updated')).toMatchObject({ popup: 'skipped-preference', email: 'skipped-preference' });

    await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${token}`)
      .send({ provider: 'grade_updated', popupEnabled: true });
    expect(await send(id, 'grade_updated')).toMatchObject({ popup: 'delivered', email: 'skipped-preference' });

    const list = await http(app).get('/api/v1/notifications/items').set('Authorization', `Bearer ${token}`);
    expect((list.body as { items: unknown[] }).items).toHaveLength(3);
  });

  it('provider bắt buộc từ chối tắt popup (400) nhưng cho tắt email, và popup vẫn phân phối', async () => {
    const { id, token } = await freshDualUser();
    for (const provider of ['enrol_expiry_warning', 'admin_announcement']) {
      const refused = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${token}`)
        .send({ provider, popupEnabled: false });
      expect(refused.status).toBe(400);
      expect((refused.body as { code?: string }).code).toBe('messaging.preference_mandatory');
      const emailOff = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${token}`)
        .send({ provider, emailFrequency: 'off' });
      expect(emailOff.status).toBe(200);
      expect(await send(id, provider)).toMatchObject({ popup: 'delivered', email: 'skipped-preference' });
      const row = (await preferencesOf(token)).find((r) => r.provider === provider);
      expect(row?.popupEnabled).toBe(true);
    }
  });

  it('dòng v1 cũ được tôn trọng qua suy dẫn, không bao giờ viết lại; ghi v2 thắng legacy', async () => {
    const { id, token } = await freshDualUser();
    await pg.query(
      `insert into user_preferences (user_id, name, value) values ($1, 'message_provider_grade_updated_popup_loggedin', '0'), ($1, 'message_provider_grade_updated_email_loggedin', '0')`,
      [id],
    );
    let row = (await preferencesOf(token)).find((r) => r.provider === 'grade_updated');
    expect(row?.popupEnabled).toBe(false);
    expect(row?.emailFrequency).toBe('off');
    expect(await send(id, 'grade_updated')).toMatchObject({ popup: 'skipped-preference', email: 'skipped-preference' });

    const put = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${token}`)
      .send({ provider: 'grade_updated', popupEnabled: true });
    expect(put.status).toBe(200);
    row = (await preferencesOf(token)).find((r) => r.provider === 'grade_updated');
    expect(row?.popupEnabled).toBe(true);
    expect(row?.emailFrequency).toBe('off');
    const stored = await pg.query(`select name, value from user_preferences where user_id = $1 order by name`, [id]);
    expect(stored.rows).toEqual([
      { name: 'message_provider_grade_updated_email_loggedin', value: '0' },
      { name: 'message_provider_grade_updated_popup_loggedin', value: '0' },
      { name: 'message_provider_grade_updated_popup_v2', value: '1' },
    ]);
  });

  it('kiểm chứng: provider lạ, patch rỗng, và tần suất email trên provider không có email đều 400', async () => {
    const { token } = await freshDualUser();
    const unknown = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${token}`)
      .send({ provider: 'khong_ton_tai', popupEnabled: true });
    expect(unknown.status).toBe(400);
    expect((unknown.body as { code?: string }).code).toBe('messaging.unknown_provider');

    const empty = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${token}`)
      .send({ provider: 'grade_updated' });
    expect(empty.status).toBe(400);
    expect((empty.body as { code?: string }).code).toBe('messaging.preference_empty');

    const noEmail = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${token}`)
      .send({ provider: 'course_completed', emailFrequency: 'off' });
    expect(noEmail.status).toBe(400);
    expect((noEmail.body as { code?: string }).code).toBe('messaging.unknown_channel');
  });
});
