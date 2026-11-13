import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingService } from './messaging.service';
import { MESSAGE_PROVIDERS } from './notification-providers';

describe('MessagingService.notify — tối thiểu hoá kênh ngoài (C-5)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = ORIGINAL_NODE_ENV; });

  function buildService() {
    const inserted: Record<string, unknown>[] = [];
    const jobs: Record<string, unknown>[] = [];
    const repo = {
      insertNotification: vi.fn(async (v: Record<string, unknown>) => { inserted.push(v); return { id: 'notif-1', ...v }; }),
      insertDispatchLog: vi.fn(async () => ({})),
      getUserDefaultTenantId: vi.fn(async () => null),
    };
    const users = {
      getByIdOrUndefined: vi.fn(async (id: string) => ({ id, suspended: false, deleted: false })),
      getPreference: vi.fn(async () => null),
    };
    const evaluator = { isSiteAdmin: vi.fn(async () => true) };
    const unreadStream = { signalUnreadCountChanged: vi.fn(async () => undefined) };
    const dispatchQueue = { add: vi.fn(async (_name: string, data: Record<string, unknown>) => { jobs.push(data); }) };
    const outbox = { enqueueStandalone: vi.fn(async () => undefined) };
    const siteConfig = { getValue: vi.fn(async () => undefined) };
    const sendThrottle = { consume: vi.fn(async () => undefined) };
    const i18n = {
      t: vi.fn((key: string, opts?: { args?: Record<string, unknown> }) => {
        if (key === 'platform.externalGenericSubject') return 'Bạn có thông báo mới';
        if (key === 'platform.externalGenericBody') return `Có thông báo mới thuộc loại "${String(opts?.args?.event ?? '')}" dành cho bạn. Đăng nhập Giáo khoa để xem chi tiết.`;
        return key;
      }),
    };
    const service = new MessagingService(
      repo as never, users as never, evaluator as never, {} as never, outbox as never,
      {} as never, unreadStream as never, dispatchQueue as never, siteConfig as never,
      sendThrottle as never, i18n as never,
    );
    return { service, inserted, jobs };
  }

  it('job gửi ngoài chỉ mang subject/body đã tối thiểu; dòng in-app giữ đầy đủ nội dung', async () => {
    const { service, inserted, jobs } = buildService();
    const result = await service.notify('user-1', 'grade_updated', {
      subject: 'Full in-app subject', body: 'Full in-app body with detail',
      externalSubject: 'You have a new grade', externalBody: 'Open the app to see it.',
    });
    expect(result.notificationId).toBe('notif-1');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.subject).toBe('Full in-app subject');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.channel).toBe('email');
    expect(jobs[0]!.subject).toBe('You have a new grade');
    expect(jobs[0]!.body).toBe('Open the app to see it.');
  });

  it('C-5 cấm: provider đã tối thiểu nhưng thiếu biến thể tối thiểu thì ném lỗi trong môi trường test thay vì rò rỉ nội dung gốc', async () => {
    process.env.NODE_ENV = 'test';
    const { service, jobs } = buildService();
    await expect(service.notify('user-1', 'guardian_digest', {
      subject: 'Full in-app subject', body: 'Full in-app body with child data',
    })).rejects.toThrow('messaging.external_minimization_required');
    expect(jobs).toHaveLength(0);
  });

  it('C-5 fallback: ngoài môi trường test, provider đã tối thiểu nhưng thiếu biến thể nhận bản tóm tắt i18n chung, không bao giờ nhận nội dung gốc', async () => {
    process.env.NODE_ENV = 'production';
    const { service, inserted, jobs } = buildService();
    await service.notify('user-1', 'guardian_digest', {
      subject: 'Full in-app subject', body: 'Full in-app body with child data',
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.subject).toBe('Full in-app subject');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.subject).toBe('Bạn có thông báo mới');
    expect(jobs[0]!.body).toBe('Có thông báo mới thuộc loại "Tổng hợp cho phụ huynh" dành cho bạn. Đăng nhập Giáo khoa để xem chi tiết.');
    expect(jobs[0]!.subject).not.toBe('Full in-app subject');
    expect(jobs[0]!.body).not.toContain('child data');
  });

  it("C-5 ngoại lệ: provider khai original-ok trong registry vẫn gửi subject/body gốc ra kênh ngoài", async () => {
    const { service, jobs } = buildService();
    await service.notify('user-1', 'enrol_welcome', {
      subject: 'Welcome', body: 'Welcome body',
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.subject).toBe('Welcome');
    expect(jobs[0]!.body).toBe('Welcome body');
  });

  it('C-5 đường ép: sendSystemNotification ép bản tóm tắt chung lên kênh ngoài ngay cả với provider original-ok', async () => {
    const { service, inserted, jobs } = buildService();
    const result = await service.sendSystemNotification('admin-1', {
      userId: 'user-1', provider: 'grade_updated',
      subject: 'Free admin subject', body: 'Free admin body',
    });
    expect(result.notificationId).toBe('notif-1');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.subject).toBe('Free admin subject');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.subject).toBe('Bạn có thông báo mới');
    expect(jobs[0]!.body).toBe('Có thông báo mới thuộc loại "Điểm số thay đổi" dành cho bạn. Đăng nhập Giáo khoa để xem chi tiết.');
    expect(jobs[0]!.body).not.toContain('Free admin body');
  });

  it('C-5 rào registry: mọi provider đều khai chính sách ngoài, và mọi khai original-ok đều kèm lý do', () => {
    expect(MESSAGE_PROVIDERS.length).toBeGreaterThan(0);
    for (const provider of MESSAGE_PROVIDERS) {
      expect(['minimized', 'original-ok'], `provider ${provider.name} must declare externalPolicy`).toContain(provider.externalPolicy);
      if (provider.externalPolicy === 'original-ok') {
        expect(provider.externalPolicyReason?.trim(), `provider ${provider.name} declared 'original-ok' without a reason`).toBeTruthy();
      }
    }
  });

  it('job email mang tần suất email đã phân giải cho quyết định gửi/digest của worker (NB-5)', async () => {
    const { service, jobs } = buildService();
    await service.notify('user-1', 'grade_updated', { subject: 'S', body: 'B' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.channel).toBe('email');
    expect(jobs[0]!.emailFrequency).toBe('daily');
    const second = buildService();
    await second.service.notify('user-1', 'calendar_reminder', { subject: 'S', body: 'B' });
    expect(second.jobs).toHaveLength(1);
    expect(second.jobs[0]!.emailFrequency).toBe('immediate');
  });
});
