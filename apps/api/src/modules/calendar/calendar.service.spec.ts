import { describe, expect, it, vi } from 'vitest';
import { CalendarService } from './calendar.service';

describe('CalendarService.requestImport — bấm nhập lại dùng jobId ổn định theo subscription (N18)', () => {
  function buildService() {
    const importQueue = { add: vi.fn(async (_name: string, _data: Record<string, unknown>, _options: Record<string, unknown>) => ({})) };
    const repo = { getSubscription: vi.fn(async () => ({ id: 'sub-1' })) };
    const evaluator = { requireCapability: vi.fn(async () => undefined) };
    const contexts = { ensureSystemContext: vi.fn(async () => ({ id: 'ctx-1' })) };
    const service = new CalendarService(
      repo as never, {} as never, {} as never, {} as never,
      evaluator as never, contexts as never, {} as never,
      { add: vi.fn(async () => ({})) } as never, importQueue as never,
    );
    return { service, importQueue };
  }

  it('bấm nhập lại 2 lần cho cùng subscription: enqueue 2 lần với cùng một jobId ổn định, không chứa UUID, và job được xoá khi xong để lần sau enqueue được', async () => {
    const { service, importQueue } = buildService();
    await service.requestImport('actor-1', 'sub-1');
    await service.requestImport('actor-1', 'sub-1');
    expect(importQueue.add).toHaveBeenCalledTimes(2);
    const firstOptions = importQueue.add.mock.calls[0]![2] as Record<string, unknown>;
    const secondOptions = importQueue.add.mock.calls[1]![2] as Record<string, unknown>;
    expect(firstOptions.jobId).toBe('shared-cal-import-sub-1');
    expect(secondOptions.jobId).toBe(firstOptions.jobId);
    expect(firstOptions.removeOnComplete).toBe(true);
  });

  it('hai subscription khác nhau: jobId khác nhau theo subscriptionId', async () => {
    const { service, importQueue } = buildService();
    await service.requestImport('actor-1', 'sub-1');
    await service.requestImport('actor-1', 'sub-2');
    expect(importQueue.add.mock.calls[0]![2]).toMatchObject({ jobId: 'shared-cal-import-sub-1' });
    expect(importQueue.add.mock.calls[1]![2]).toMatchObject({ jobId: 'shared-cal-import-sub-2' });
  });
});
