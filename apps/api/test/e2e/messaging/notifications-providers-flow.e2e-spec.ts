import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, createTestApp, http } from '../../support/identity-access-helpers';

describe('Provider thông báo đã nối dây (N1, issue #49)', () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
  });
  afterAll(async () => { await app.close(); });

  it('tuỳ chọn: mọi provider liệt kê đều đã nối dây và mang phân loại 3 nhóm — không còn toggle giả', async () => {
    const res = await http(app).get('/api/v1/messages/preferences').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    const rows = res.body as { provider: string; group: string; label: { vi: string; en: string }; description: { vi: string; en: string } }[];
    for (const row of rows) {
      expect(row.label.vi.length).toBeGreaterThan(0);
      expect(row.label.en.length).toBeGreaterThan(0);
      expect(row.description.vi.length).toBeGreaterThan(0);
      expect(row).not.toHaveProperty('state');
      expect(row).not.toHaveProperty('channel');
    }
    const groups = new Map<string, string>();
    for (const row of rows) groups.set(row.provider, row.group);
    expect([...groups.keys()].sort()).toEqual([
      'activity_due_soon', 'admin_announcement', 'assignment_assigned', 'assignment_returned', 'assignment_submitted', 'badge_awarded',
      'calendar_reminder', 'competency_review_requested', 'contact_request',
      'conversation_reported', 'course_completed', 'enrol_expiry_warning', 'enrol_welcome',
      'grade_updated', 'guardian_digest', 'guardian_overdue_alert', 'message_new', 'quiz_attempt_finished',
      'quiz_available', 'report_scheduled',
    ]);
    expect(groups.get('admin_announcement')).toBe('system');
    expect(groups.get('grade_updated')).toBe('learning');
    expect(groups.get('course_completed')).toBe('learning');
    expect(groups.get('enrol_expiry_warning')).toBe('learning');
    expect(groups.get('enrol_welcome')).toBe('learning');
    expect(groups.get('activity_due_soon')).toBe('learning');
    expect(groups.get('assignment_assigned')).toBe('learning');
    expect(groups.get('assignment_submitted')).toBe('learning');
    expect(groups.get('assignment_returned')).toBe('learning');
    expect(groups.get('quiz_available')).toBe('learning');
    expect(groups.get('quiz_attempt_finished')).toBe('learning');
    expect(groups.get('guardian_digest')).toBe('learning');
    expect(groups.get('guardian_overdue_alert')).toBe('learning');
    expect(groups.get('message_new')).toBe('people');
    expect(groups.get('contact_request')).toBe('people');
    expect(groups.get('calendar_reminder')).toBe('system');
    expect(groups.get('report_scheduled')).toBe('system');
  });
});
