import { describe, expect, it, vi } from 'vitest';
import { CalendarService } from './calendar.service';

describe('CalendarService.requestImport — bấm nhập lại dùng jobId ổn định theo subscription (N18)', () => {
  function buildService() {
    const importQueue = { add: vi.fn(async (_name: string, _data: Record<string, unknown>, _options: Record<string, unknown>) => ({})) };
    const reminderQueue = { add: vi.fn(async (_name: string, _data: Record<string, unknown>, _options: Record<string, unknown>) => ({})) };
    const repo = {
      getSubscription: vi.fn(async () => ({ id: 'sub-1' })),
      insertSubscription: vi.fn(async () => ({ id: 'sub-1', icsData: 'BEGIN:VCALENDAR' })),
      getEvent: vi.fn(async () => ({ id: 'event-1', eventType: 'site', visible: true, timeStart: new Date(Date.now() + 3_600_000) })),
    };
    const evaluator = { requireCapability: vi.fn(async () => undefined) };
    const contexts = { ensureSystemContext: vi.fn(async () => ({ id: 'ctx-1' })) };
    const service = new CalendarService(
      repo as never, {} as never, {} as never, {} as never,
      evaluator as never, contexts as never, {} as never,
      reminderQueue as never, importQueue as never,
    );
    return { service, importQueue, reminderQueue };
  }

  it('bấm nhập lại 2 lần cho cùng subscription: enqueue 2 lần với cùng một jobId ổn định, không chứa UUID, và job được xoá khi xong hoặc khi fail hết lượt thử để lần sau enqueue được', async () => {
    const { service, importQueue } = buildService();
    await service.requestImport('actor-1', 'sub-1');
    await service.requestImport('actor-1', 'sub-1');
    expect(importQueue.add).toHaveBeenCalledTimes(2);
    const firstOptions = importQueue.add.mock.calls[0]![2] as Record<string, unknown>;
    const secondOptions = importQueue.add.mock.calls[1]![2] as Record<string, unknown>;
    expect(firstOptions.jobId).toBe('shared-cal-import-sub-1');
    expect(secondOptions.jobId).toBe(firstOptions.jobId);
    expect(firstOptions.removeOnComplete).toBe(true);
    expect(firstOptions.removeOnFail).toBe(true);
  });

  it('tạo subscription có icsData rồi bấm nhập lại: cả hai lần enqueue dùng cùng một jobId ổn định và job được xoá khi xong hoặc khi fail hết lượt thử', async () => {
    const { service, importQueue } = buildService();
    await service.createSubscription('actor-1', { name: 'sub', icsData: 'BEGIN:VCALENDAR' });
    await service.requestImport('actor-1', 'sub-1');
    expect(importQueue.add).toHaveBeenCalledTimes(2);
    const firstOptions = importQueue.add.mock.calls[0]![2] as Record<string, unknown>;
    const secondOptions = importQueue.add.mock.calls[1]![2] as Record<string, unknown>;
    expect(firstOptions.jobId).toBe('shared-cal-import-sub-1');
    expect(secondOptions.jobId).toBe(firstOptions.jobId);
    expect(firstOptions.removeOnComplete).toBe(true);
    expect(firstOptions.removeOnFail).toBe(true);
    expect(secondOptions.removeOnComplete).toBe(true);
    expect(secondOptions.removeOnFail).toBe(true);
  });

  it('đặt nhắc hẹn: job nhắc được xoá khi xong hoặc khi fail hết lượt thử để lần sau đặt lại được', async () => {
    const { service, reminderQueue } = buildService();
    await service.scheduleReminder('actor-1', 'event-1', 15);
    expect(reminderQueue.add).toHaveBeenCalledTimes(1);
    const options = reminderQueue.add.mock.calls[0]![2] as Record<string, unknown>;
    expect(options.jobId).toBe('shared-cal-reminder-event-1-actor-1-15');
    expect(options.removeOnComplete).toBe(true);
    expect(options.removeOnFail).toBe(true);
  });

  it('hai subscription khác nhau: jobId khác nhau theo subscriptionId', async () => {
    const { service, importQueue } = buildService();
    await service.requestImport('actor-1', 'sub-1');
    await service.requestImport('actor-1', 'sub-2');
    expect(importQueue.add.mock.calls[0]![2]).toMatchObject({ jobId: 'shared-cal-import-sub-1' });
    expect(importQueue.add.mock.calls[1]![2]).toMatchObject({ jobId: 'shared-cal-import-sub-2' });
  });
});
