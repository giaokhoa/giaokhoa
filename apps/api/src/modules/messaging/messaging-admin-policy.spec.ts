import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MessagingService } from './messaging.service';
import { notificationPolicySettingName } from './notification-providers';

describe('MessagingService — chính sách site của admin + tuỳ chọn tối thiểu của học viên (NB-7)', () => {
  function buildService(opts: {
    disabledProviders?: string[];
    staffAssignment?: boolean;
    siteAdmin?: boolean;
    studentContext?: boolean;
    guardianLink?: boolean;
  } = {}) {
    const disabled = new Set(opts.disabledProviders ?? []);
    const inserted: Record<string, unknown>[] = [];
    const logs: Record<string, unknown>[] = [];
    const jobs: Record<string, unknown>[] = [];
    const storedPrefs = new Map<string, string>();
    const repo = {
      getUserDefaultTenantId: vi.fn(async () => null),
      insertNotification: vi.fn(async (v: Record<string, unknown>) => { inserted.push(v); return { id: 'notif-1', ...v }; }),
      insertDispatchLog: vi.fn(async (v: Record<string, unknown>) => { logs.push(v); return {}; }),
      hasStaffRoleAssignment: vi.fn(async () => opts.staffAssignment ?? false),
      hasStudentContext: vi.fn(async () => opts.studentContext ?? false),
      hasActiveGuardianLink: vi.fn(async () => opts.guardianLink ?? false),
    };
    const users = {
      getByIdOrUndefined: vi.fn(async (id: string) => ({ id, suspended: false, deleted: false })),
      getPreference: vi.fn(async (_userId: string, name: string) => storedPrefs.get(name) ?? null),
      setPreference: vi.fn(async (_userId: string, name: string, value: string) => { storedPrefs.set(name, value); }),
    };
    const evaluator = { isSiteAdmin: vi.fn(async () => opts.siteAdmin ?? false) };
    const unreadStream = { signalUnreadCountChanged: vi.fn(async () => undefined) };
    const dispatchQueue = { add: vi.fn(async (_name: string, data: Record<string, unknown>) => { jobs.push(data); }) };
    const outbox = { enqueueStandalone: vi.fn(async () => undefined) };
    const siteConfig = {
      getValue: vi.fn(async (component: string, name: string) => {
        if (component !== 'notifications') return undefined;
        const provider = name.replace(/^provider_/, '').replace(/_enabled$/, '');
        return disabled.has(provider) ? false : undefined;
      }),
    };
    const sendThrottle = { consume: vi.fn(async () => undefined) };
    const service = new MessagingService(
      repo as never, users as never, evaluator as never, {} as never, outbox as never,
      {} as never, unreadStream as never, dispatchQueue as never, siteConfig as never,
      sendThrottle as never, {} as never,
    );
    return { service, inserted, logs, jobs, storedPrefs };
  }

  it('loại bị site tắt thì bỏ qua trên mọi kênh kèm log admin-disabled, ngay cả khi tuỳ chọn người dùng đang bật', async () => {
    const { service, inserted, logs, jobs, storedPrefs } = buildService({ disabledProviders: ['grade_updated'] });
    storedPrefs.set('message_provider_grade_updated_popup_v2', '1');
    const result = await service.notify('user-1', 'grade_updated', { subject: 'Điểm mới', body: 'Nội dung' });
    expect(result.skipped).toBe('admin-disabled');
    expect(result.notificationId).toBeNull();
    expect(result.channels).toEqual({});
    expect(inserted).toHaveLength(0);
    expect(jobs).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ provider: 'grade_updated', channel: 'popup', status: 'skipped-admin-disabled' });
  });

  it('loại admin chưa tắt vẫn chảy bình thường', async () => {
    const { service, inserted } = buildService({ disabledProviders: ['grade_updated'] });
    const result = await service.notify('user-1', 'enrol_welcome', { subject: 'Chào mừng', body: 'Nội dung' });
    expect(result.skipped).toBeUndefined();
    expect(inserted).toHaveLength(1);
  });

  it('loại bắt buộc P2 không bao giờ bị lớp chính sách site chặn', async () => {
    const { service, inserted } = buildService({ disabledProviders: ['enrol_expiry_warning', 'admin_announcement'] });
    for (const provider of ['enrol_expiry_warning', 'admin_announcement']) {
      const result = await service.notify('user-1', provider, {
        subject: 'Bắt buộc', body: 'Nội dung',
        externalSubject: 'Bắt buộc', externalBody: 'Nội dung',
      });
      expect(result.skipped).toBeUndefined();
    }
    expect(inserted).toHaveLength(2);
  });

  it('học viên thuần nhận 403 trên PUT theo loại và GET rỗng (tối thiểu)', async () => {
    const { service } = buildService({ staffAssignment: false, siteAdmin: false });
    await expect(service.getPreferences('student-1')).resolves.toEqual([]);
    const error = await service.setPreference('student-1', { provider: 'grade_updated', popupEnabled: false })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'messaging.preference_staff_only' });
    const error2 = await service.setPreference('student-1', { provider: 'khong_ton_tai', popupEnabled: false })
      .catch((e: unknown) => e);
    expect(error2).toBeInstanceOf(ForbiddenException);
  });

  it('nhân viên giảng dạy giữ bề mặt v2 cho phía của họ (dòng GET + PUT chạy trên loại staff)', async () => {
    const { service, storedPrefs } = buildService({ staffAssignment: true });
    const rows = await service.getPreferences('teacher-1');
    expect(rows.map((r) => r.provider).sort()).toEqual([
      'admin_announcement', 'assignment_submitted', 'badge_awarded', 'calendar_reminder',
      'competency_review_requested', 'contact_request', 'conversation_reported',
      'message_new', 'quiz_attempt_finished', 'report_scheduled',
    ]);
    const view = await service.setPreference('teacher-1', { provider: 'assignment_submitted', popupEnabled: false });
    expect(view.popupEnabled).toBe(false);
    expect(storedPrefs.get('message_provider_assignment_submitted_popup_v2')).toBe('0');
  });

  it('tách audience (issue #288): giáo viên thuần không thấy và không đặt được loại chỉ-dành-cho-học-viên hay loại phụ huynh', async () => {
    const { service } = buildService({ staffAssignment: true });
    const names = (await service.getPreferences('teacher-1')).map((r) => r.provider);
    for (const hidden of ['grade_updated', 'assignment_assigned', 'assignment_returned', 'quiz_available', 'enrol_welcome', 'guardian_digest', 'guardian_overdue_alert']) {
      expect(names).not.toContain(hidden);
    }
    for (const provider of ['grade_updated', 'guardian_digest']) {
      const error = await service.setPreference('teacher-1', { provider, popupEnabled: false })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'messaging.preference_audience' });
    }
  });

  it('tách audience (issue #288): người dùng hai vai (dạy + học) thấy cả hai phía, phụ huynh chỉ khi có liên kết phụ huynh', async () => {
    const dual = buildService({ staffAssignment: true, studentContext: true });
    const dualNames = (await dual.service.getPreferences('dual-1')).map((r) => r.provider);
    expect(dualNames).toContain('grade_updated');
    expect(dualNames).toHaveLength(18);
    expect(dualNames).not.toContain('guardian_digest');
    const put = await dual.service.setPreference('dual-1', { provider: 'grade_updated', popupEnabled: false });
    expect(put.popupEnabled).toBe(false);

    const guardian = buildService({ staffAssignment: true, guardianLink: true });
    const guardianNames = (await guardian.service.getPreferences('guardian-1')).map((r) => r.provider);
    expect(guardianNames).toContain('guardian_digest');
    expect(guardianNames).toContain('guardian_overdue_alert');
    expect(guardianNames).toHaveLength(12);
  });

  it('dòng tuỳ chọn lộ chính sách site dưới dạng siteEnabled để trang cài đặt khoá được loại admin đã tắt (#288)', async () => {
    const { service } = buildService({ staffAssignment: true, studentContext: true, disabledProviders: ['grade_updated', 'enrol_expiry_warning'] });
    const rows = await service.getPreferences('teacher-1');
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    expect(byProvider.get('grade_updated')?.siteEnabled).toBe(false);
    expect(byProvider.get('enrol_welcome')?.siteEnabled).toBe(true);
    expect(byProvider.get('enrol_expiry_warning')?.siteEnabled).toBe(true);
  });

  it('site admin không có vai trò khoá học vẫn có đầy đủ bề mặt', async () => {
    const { service } = buildService({ staffAssignment: false, siteAdmin: true });
    expect(await service.getPreferences('admin-1')).toHaveLength(20);
  });

  it('tên cài đặt chính sách theo đúng hình dạng đã đăng ký', () => {
    expect(notificationPolicySettingName('grade_updated')).toBe('provider_grade_updated_enabled');
  });
});
