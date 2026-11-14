import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MessagingService } from './messaging.service';
import { MessagingNotificationsService } from './messaging-notifications.service';

describe('MessagingNotificationsService.notify — dedupeKey khi popup tắt chứa định danh lần phát, không dùng UUID ngẫu nhiên (N35)', () => {
  function buildService(popupOn = false) {
    const jobs: Record<string, unknown>[] = [];
    const options: Record<string, unknown>[] = [];
    const notificationId = popupOn ? 'notif-9' : 'notif-1';
    const repo = {
      insertNotification: vi.fn(async (v: Record<string, unknown>) => ({ id: notificationId, ...v })),
      insertDispatchLog: vi.fn(async () => ({})),
      getUserDefaultTenantId: vi.fn(async () => null),
    };
    const users = {
      getByIdOrUndefined: vi.fn(async (id: string) => ({ id, suspended: false, deleted: false })),
      getPreference: vi.fn(async (_userId: string, name: string) =>
        (!popupOn && name === 'message_provider_grade_updated_popup_v2' ? '0' : null)),
    };
    const evaluator = { isSiteAdmin: vi.fn(async () => true) };
    const outbox = { enqueueStandalone: vi.fn(async () => undefined) };
    const unreadStream = { signalUnreadCountChanged: vi.fn(async () => undefined) };
    const dispatchQueue = { add: vi.fn(async (_name: string, data: Record<string, unknown>, opts?: Record<string, unknown>) => { jobs.push(data); options.push(opts ?? {}); }) };
    const siteConfig = { getValue: vi.fn(async () => undefined) };
    const i18n = { t: vi.fn((key: string) => key) };
    const service = new MessagingNotificationsService(
      repo as never, users as never, evaluator as never, outbox as never,
      unreadStream as never, dispatchQueue as never, siteConfig as never,
      {} as never, i18n as never,
    );
    return { service, jobs, options };
  }

  const input = {
    subject: 'Điểm mới trong khoá học "Toán"',
    body: 'Bạn có điểm mới cho mục "Bài 1" trong khoá học "Toán".',
    contextUrl: '/courses/course-1/grades',
  };

  it('popup tắt, không có eventId: dedupeKey ổn định từ hash nội dung trong app nên lần phát lại không gửi trùng', async () => {
    const { service, jobs } = buildService();
    const result = await service.notify('user-1', 'grade_updated', input);
    expect(result.notificationId).toBeNull();
    expect(result.channels).toEqual({ popup: 'skipped-preference', email: 'queued' });
    const contentHash = createHash('sha256').update(JSON.stringify([input.subject, input.body, null, input.contextUrl, null])).digest('hex');
    expect(jobs[0]!.dedupeKey).toBe(`platform-dispatch-grade_updated-user-1-email-content-${contentHash}`);
  });

  it('popup tắt, hai lần phát khác nhau (nội dung trong app khác): dedupeKey khác nhau nên lần phát sau không bị nuốt', async () => {
    const { service, jobs } = buildService();
    await service.notify('user-1', 'grade_updated', input);
    await service.notify('user-1', 'grade_updated', {
      ...input,
      body: 'Bạn có điểm mới cho mục "Bài 2" trong khoá học "Toán".',
    });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.dedupeKey).not.toBe(jobs[1]!.dedupeKey);
  });

  it('popup tắt, cùng eventId: dedupeKey mang định danh lần phát và ổn định khi gọi lại', async () => {
    const { service, jobs } = buildService();
    await service.notify('user-1', 'grade_updated', { ...input, eventId: 'grade-item-1-8.5' });
    await service.notify('user-1', 'grade_updated', { ...input, eventId: 'grade-item-1-8.5' });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.dedupeKey).toBe('platform-dispatch-grade_updated-user-1-email-event-grade-item-1-8.5');
    expect(jobs[1]!.dedupeKey).toBe(jobs[0]!.dedupeKey);
  });

  it('popup tắt, cùng nội dung nhưng khác người gửi: dedupeKey khác nhau nên tin của người khác không bị nuốt', async () => {
    const { service, jobs } = buildService();
    await service.notify('user-1', 'grade_updated', { ...input, fromUserId: 'user-2' });
    await service.notify('user-1', 'grade_updated', { ...input, fromUserId: 'user-3' });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.dedupeKey).not.toBe(jobs[1]!.dedupeKey);
  });

  it('popup tắt, cùng nội dung và người gửi nhưng khác contextUrl: dedupeKey khác nhau nên thông báo ở nơi khác không bị nuốt', async () => {
    const { service, jobs } = buildService();
    await service.notify('user-1', 'grade_updated', input);
    await service.notify('user-1', 'grade_updated', { ...input, contextUrl: '/courses/course-2/grades' });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.dedupeKey).not.toBe(jobs[1]!.dedupeKey);
  });

  it('popup tắt, cùng nội dung nhưng khác khoá học: dedupeKey khác nhau nên thông báo của khoá khác không bị nuốt', async () => {
    const { service, jobs } = buildService();
    await service.notify('user-1', 'grade_updated', { ...input, courseId: 'course-1' });
    await service.notify('user-1', 'grade_updated', { ...input, courseId: 'course-2' });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.dedupeKey).not.toBe(jobs[1]!.dedupeKey);
  });

  it('popup bật: dedupeKey chứa đúng notificationId vừa tạo', async () => {
    const { service, jobs } = buildService(true);
    const result = await service.notify('user-1', 'grade_updated', input);
    expect(result.notificationId).toBe('notif-9');
    expect(result.channels).toEqual({ popup: 'delivered', email: 'queued' });
    expect(jobs[0]!.dedupeKey).toBe('platform-dispatch-grade_updated-user-1-email-notif-9');
  });

  it('job dispatch được xoá khi fail hết lượt để lần phát lại không kẹt vào job fail cũ, và job xong vẫn giữ lại làm cửa sổ dedupe chống gửi trùng', async () => {
    const { service, options } = buildService();
    await service.notify('user-1', 'grade_updated', input);
    expect(options).toHaveLength(1);
    expect(options[0]!.removeOnFail).toBe(true);
    expect(options[0]!.removeOnComplete).toBeUndefined();
  });
});

describe('MessagingService.notify — eventId đi qua passthrough xuống dedupeKey khi popup tắt (N35)', () => {
  function buildPassthroughService() {
    const jobs: Record<string, unknown>[] = [];
    const repo = {
      insertNotification: vi.fn(async (v: Record<string, unknown>) => ({ id: 'notif-1', ...v })),
      insertDispatchLog: vi.fn(async () => ({})),
      getUserDefaultTenantId: vi.fn(async () => null),
    };
    const users = {
      getByIdOrUndefined: vi.fn(async (id: string) => ({ id, suspended: false, deleted: false })),
      getPreference: vi.fn(async (_userId: string, name: string) =>
        (name === 'message_provider_grade_updated_popup_v2' ? '0' : null)),
    };
    const evaluator = { isSiteAdmin: vi.fn(async () => true) };
    const outbox = { enqueueStandalone: vi.fn(async () => undefined) };
    const unreadStream = { signalUnreadCountChanged: vi.fn(async () => undefined) };
    const dispatchQueue = { add: vi.fn(async (_name: string, data: Record<string, unknown>) => { jobs.push(data); }) };
    const siteConfig = { getValue: vi.fn(async () => undefined) };
    const sendThrottle = { consume: vi.fn(async () => undefined) };
    const i18n = { t: vi.fn((key: string) => key) };
    const service = new MessagingService(
      repo as never, users as never, evaluator as never, {} as never, outbox as never,
      {} as never, unreadStream as never, dispatchQueue as never, siteConfig as never,
      sendThrottle as never, i18n as never,
    );
    return { service, jobs };
  }

  it('popup tắt, caller truyền eventId qua MessagingService.notify: dedupeKey mang đúng eventId đó', async () => {
    const { service, jobs } = buildPassthroughService();
    const result = await service.notify('user-1', 'grade_updated', {
      subject: 'Điểm mới trong khoá học "Toán"',
      body: 'Bạn có điểm mới cho mục "Bài 1" trong khoá học "Toán".',
      contextUrl: '/courses/course-1/grades',
      eventId: 'grade-item-1-8.5-123',
    });
    expect(result.notificationId).toBeNull();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.dedupeKey).toBe('platform-dispatch-grade_updated-user-1-email-event-grade-item-1-8.5-123');
  });
});
