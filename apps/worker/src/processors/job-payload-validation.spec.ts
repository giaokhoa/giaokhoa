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
