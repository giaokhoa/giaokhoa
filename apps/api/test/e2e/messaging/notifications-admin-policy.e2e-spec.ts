import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD, systemContextId } from '../../support/identity-access-helpers';
import { createCategory, createCourse, createEnrolInstance, enrolUser } from '../../support/course-enrolment-helpers';
import { MANDATORY_NOTIFICATION_PROVIDERS, MESSAGE_PROVIDERS, notificationPolicySettingName } from '../../../src/modules/messaging/notification-providers';

describe('Chính sách thông báo admin NB-7 + tuỳ chọn tối thiểu của học viên', () => {
  let app: INestApplication;
  let admin: string;
  let pg: Client;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
  });

  afterAll(async () => {
    await pg.query(`delete from plugin_config where plugin = 'notifications' and name like 'provider_%_enabled' and tenant_id is null`);
    await pg.end();
    await app.close();
  });

  async function staffUser(): Promise<{ id: string; token: string }> {
    const user = await createUserViaApi(app, admin);
    await assignRole(app, admin, user.id, await roleIdByShortname(app, admin, 'teacher'), await systemContextId(app, admin));
    const token = (await login(app, user.username, STRONG_PASSWORD)).accessToken;
    return { id: user.id, token };
  }

  async function staffDualUser(): Promise<{ id: string; token: string }> {
    const user = await createUserViaApi(app, admin);
    const sys = await systemContextId(app, admin);
    await assignRole(app, admin, user.id, await roleIdByShortname(app, admin, 'teacher'), sys);
    await assignRole(app, admin, user.id, await roleIdByShortname(app, admin, 'student'), sys);
    const token = (await login(app, user.username, STRONG_PASSWORD)).accessToken;
    return { id: user.id, token };
  }

  async function studentInCourse(): Promise<{ courseId: string; id: string; token: string }> {
    const cat = await createCategory(app, admin);
    const course = await createCourse(app, admin, cat.id);
    const instance = await createEnrolInstance(app, admin, course.id);
    const user = await createUserViaApi(app, admin);
    await enrolUser(app, admin, course.id, instance.id, user.id);
    const token = (await login(app, user.username, STRONG_PASSWORD)).accessToken;
    return { courseId: course.id, id: user.id, token };
  }

  async function setSitePolicy(provider: string, value: boolean) {
    return http(app).put(`/api/v1/site-config/notifications/provider_${provider}_enabled`)
      .set('Authorization', `Bearer ${admin}`).send({ value });
  }

  async function sendTo(userId: string, provider: string, subject: string) {
    return http(app).post('/api/v1/notifications/send').set('Authorization', `Bearer ${admin}`)
      .send({ userId, provider, subject, body: 'Nội dung kiểm chứng NB-7' });
  }

  it('registry chính sách: site-config có đúng tập khoá suy ra từ registry thông báo, boolean, mặc định bật, gồm hai khoá bắt buộc P2', async () => {
    const res = await http(app).get('/api/v1/site-config').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    const rows = (res.body as { component: string; name: string; type: string; defaultValue: unknown; value: unknown }[])
      .filter((r) => r.component === 'notifications');
    const expectedNames = MESSAGE_PROVIDERS.map((p) => notificationPolicySettingName(p.name)).sort();
    expect(rows.map((r) => r.name).sort()).toEqual(expectedNames);
    for (const row of rows) {
      expect(row.name).toMatch(/^provider_.+_enabled$/);
      expect(row.type).toBe('boolean');
      expect(row.defaultValue).toBe(true);
    }
    const actualNames = rows.map((r) => r.name);
    for (const mandatory of MANDATORY_NOTIFICATION_PROVIDERS) {
      expect(actualNames).toContain(notificationPolicySettingName(mandatory));
    }
    expect(actualNames).toContain('provider_enrol_expiry_warning_enabled');
    expect(actualNames).toContain('provider_admin_announcement_enabled');
  });

  it('admin tắt chặn phân phối cho mọi người trước tuỳ chọn người dùng, ghi log skipped-admin-disabled; bật lại khôi phục', async () => {
    const staff = await staffDualUser();
    const student = await studentInCourse();

    const pref = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${staff.token}`)
      .send({ provider: 'grade_updated', popupEnabled: true });
    expect(pref.status).toBe(200);

    const off = await setSitePolicy('grade_updated', false);
    expect(off.status).toBe(200);
    expect(off.body.value).toBe(false);

    const blocked = await sendTo(staff.id, 'grade_updated', 'Điểm mới NB-7');
    expect(blocked.status).toBe(201);
    expect(blocked.body.skipped).toBe('admin-disabled');
    expect(blocked.body.notificationId).toBeNull();
    expect(blocked.body.channels).toEqual({});
    const blockedStudent = await sendTo(student.id, 'grade_updated', 'Điểm mới NB-7 HS');
    expect(blockedStudent.body.skipped).toBe('admin-disabled');

    const staffItems = await http(app).get('/api/v1/notifications/items').set('Authorization', `Bearer ${staff.token}`);
    expect((staffItems.body.items as { subject: string }[]).some((n) => n.subject === 'Điểm mới NB-7')).toBe(false);
    const log = await pg.query(
      `select count(*)::int as n from notification_dispatch_log where user_id = $1 and provider = 'grade_updated' and status = 'skipped-admin-disabled'`,
      [staff.id],
    );
    expect(log.rows[0].n).toBeGreaterThan(0);

    const other = await sendTo(staff.id, 'badge_awarded', 'Huy hiệu NB-7');
    expect(other.body.channels.popup).toBe('delivered');

    const on = await setSitePolicy('grade_updated', true);
    expect(on.status).toBe(200);
    const restored = await sendTo(staff.id, 'grade_updated', 'Điểm mới NB-7 lần 2');
    expect(restored.body.skipped).toBeUndefined();
    expect(restored.body.channels.popup).toBe('delivered');
  });

  it('loại bắt buộc P2 không thể bị admin tắt và vẫn phân phối', async () => {
    for (const provider of ['enrol_expiry_warning', 'admin_announcement']) {
      const res = await setSitePolicy(provider, false);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('site_config.notification_mandatory');
    }
    const staff = await staffUser();
    const sent = await sendTo(staff.id, 'enrol_expiry_warning', 'Sắp hết hạn NB-7');
    expect(sent.body.skipped).toBeUndefined();
    expect(sent.body.channels.popup).toBe('delivered');
  });

  it('học viên: PUT theo loại 403, GET rỗng, override tắt tiếng khoá vẫn chạy; staff giữ phía bề mặt của họ', async () => {
    const student = await studentInCourse();

    const put = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${student.token}`)
      .send({ provider: 'grade_updated', popupEnabled: false });
    expect(put.status).toBe(403);
    expect(JSON.stringify(put.body)).toContain('messaging.preference_staff_only');

    const get = await http(app).get('/api/v1/messages/preferences').set('Authorization', `Bearer ${student.token}`);
    expect(get.status).toBe(200);
    expect(get.body).toEqual([]);

    const courses = await http(app).get('/api/v1/messages/preferences/courses').set('Authorization', `Bearer ${student.token}`);
    expect(courses.status).toBe(200);
    expect((courses.body.courses as { courseId: string }[]).map((c) => c.courseId)).toContain(student.courseId);
    const mute = await http(app).put('/api/v1/messages/preferences/courses').set('Authorization', `Bearer ${student.token}`)
      .send({ courseId: student.courseId, mode: 'mute' });
    expect(mute.status).toBe(200);
    expect(mute.body.mode).toBe('mute');
    const prefRow = await pg.query(
      `select value from user_preferences where user_id = $1 and name = $2`,
      [student.id, `notif.course.${student.courseId}`],
    );
    expect(prefRow.rows[0]?.value).toBe('mute');

    const staff = await staffUser();
    const staffGet = await http(app).get('/api/v1/messages/preferences').set('Authorization', `Bearer ${staff.token}`);
    expect(staffGet.status).toBe(200);
    expect(staffGet.body).toHaveLength(10);
    const staffPut = await http(app).put('/api/v1/messages/preferences').set('Authorization', `Bearer ${staff.token}`)
      .send({ provider: 'assignment_submitted', popupEnabled: false });
    expect(staffPut.status).toBe(200);
    expect(staffPut.body.popupEnabled).toBe(false);
  });
});
