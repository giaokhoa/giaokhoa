import { describe, expect, it } from 'vitest';
import { validateWorkerJobPayload, workerPayloadSchemas } from './job-payload-validation';

describe('Biên kiểm chứng job từ Redis trước khi đọc kho dữ liệu', () => {
  const good = { spaceSlug: 'centre-a', spaceId: 'space-id-1' };

  it('từ chối payload thiếu định danh của các tác vụ nền', () => {
    expect(() => validateWorkerJobPayload(workerPayloadSchemas['calendar-import'], {
      ...good,
    }, 'calendar-import')).toThrow('subscriptionId');
    expect(() => validateWorkerJobPayload(workerPayloadSchemas['completion-recalculate'], {
      ...good, courseId: 123,
    }, 'completion-recalculate')).toThrow('courseId');
    expect(() => validateWorkerJobPayload(workerPayloadSchemas['badge-award'], {
      ...good, userId: null,
    }, 'badge-award')).toThrow('userId');
  });

  it('kiểm kiểu số phút nhắc và body mail bên ngoài', () => {
    expect(() => validateWorkerJobPayload(workerPayloadSchemas['calendar-reminders'], {
      ...good, eventId: 'event-id', userId: 'user-id', minutesBefore: -1,
    }, 'calendar-reminders')).toThrow('minutesBefore');
    expect(() => validateWorkerJobPayload(workerPayloadSchemas['notification-dispatch'], {
      ...good, userId: 'u', provider: 'email', channel: 'email', subject: 'Test', dedupeKey: 'x',
    }, 'notification-dispatch')).toThrow('body');
  });

  it('chấp nhận trường bổ sung của phiên bản job lịch sử nhưng không mất scope', () => {
    const data = { ...good, subscriptionId: 'subscription-1', legacyField: true };
    expect(validateWorkerJobPayload(workerPayloadSchemas['calendar-import'], data, 'calendar-import'))
      .toMatchObject(data);
  });

  it('không đưa dữ liệu nhạy cảm ngoài schema vào thông điệp lỗi', () => {
    const message = (() => {
      try {
        validateWorkerJobPayload(workerPayloadSchemas['notification-dispatch'], {
          provider: 'email', subject: 'secret-123', body: 'secret-body', dedupeKey: 'dedupe',
          userId: 17,
        }, 'notification-dispatch');
      } catch (error) {
        return String(error);
      }
      return '';
    })();
    expect(message).toContain('userId');
    expect(message).not.toContain('secret-123');
    expect(message).not.toContain('secret-body');
  });
});

describe('Phong bì job outbox: không tin dữ liệu JSON từ Redis', () => {
  const valid = {
    outboxId: '0191e8f2-7c3a-7b21-9f00-000000000517',
    seq: 517,
    aggregate: 'auth',
    type: 'auth_mail_requested',
    payload: { resetUrl: 'https://example.org/reset/very-secret' },
    tenantId: null,
    spaceSlug: null,
    occurredAt: '2026-11-13T12:00:00.000Z',
  };

  it('chấp nhận phong bì outbox lịch sử với payload nghiệp vụ tuỳ biến', () => {
    expect(validateWorkerJobPayload(workerPayloadSchemas['outbox-event'], valid, 'auth-mail'))
      .toMatchObject(valid);
  });

  it('từ chối định danh và số thứ tự outbox không hợp lệ trước khi chạy consumer', () => {
    expect(() => validateWorkerJobPayload(workerPayloadSchemas['outbox-event'], {
      ...valid, outboxId: '', seq: '517',
    }, 'auth-mail')).toThrow(/outboxId, seq/);
    expect(() => validateWorkerJobPayload(workerPayloadSchemas['outbox-event'], {
      ...valid, spaceSlug: 42,
    }, 'auth-mail')).toThrow('spaceSlug');
  });

  it('không đưa reset URL hoặc dữ liệu khách hàng vào thông báo lỗi', () => {
    let message = '';
    try {
      validateWorkerJobPayload(workerPayloadSchemas['outbox-event'], {
        ...valid, type: null,
      }, 'auth-mail');
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('type');
    expect(message).not.toContain('very-secret');
  });
});
