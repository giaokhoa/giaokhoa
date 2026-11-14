import { describe, expect, it, vi } from 'vitest';
import { CompletionService } from './completion.service';

describe('CompletionService.setCriteria — enqueue tính lại dùng jobId ổn định theo khoá học (N18)', () => {
  function buildService() {
    const recalcQueue = { add: vi.fn(async (_name: string, _data: Record<string, unknown>, _options: Record<string, unknown>) => ({})) };
    const repo = {
      listCriteria: vi.fn(async () => []),
      listCourseCompletions: vi.fn(async () => [{ id: 'cc-1', reAggregate: new Date() }]),
      deleteCriteria: vi.fn(async () => undefined),
      insertCriteria: vi.fn(async () => undefined),
      setSettings: vi.fn(async () => undefined),
      upsertCourseCompletion: vi.fn(async () => undefined),
    };
    const courses = {
      getCourse: vi.fn(async () => ({})),
      courseContextId: vi.fn(async () => 'ctx-1'),
    };
    const evaluator = { requireCapability: vi.fn(async () => undefined) };
    const outbox = { enqueueStandalone: vi.fn(async () => undefined) };
    const service = new CompletionService(
      repo as never, courses as never, {} as never, {} as never, {} as never,
      evaluator as never, {} as never, outbox as never, {} as never, recalcQueue as never,
    );
    return { service, recalcQueue };
  }

  const input = { criteria: [{ criteriaType: 'date', date: '2026-01-01T00:00:00.000Z' }] };

  it('đặt tiêu chí 2 lần cho cùng khoá học: enqueue 2 lần với cùng một jobId ổn định, không chứa UUID, và job được xoá khi xong hoặc khi fail hết lượt thử để lần sau enqueue được', async () => {
    const { service, recalcQueue } = buildService();
    await service.setCriteria('actor-1', 'course-1', input);
    await service.setCriteria('actor-1', 'course-1', input);
    expect(recalcQueue.add).toHaveBeenCalledTimes(2);
    const firstOptions = recalcQueue.add.mock.calls[0]![2] as Record<string, unknown>;
    const secondOptions = recalcQueue.add.mock.calls[1]![2] as Record<string, unknown>;
    expect(firstOptions.jobId).toBe('shared-completion-recalc-course-1');
    expect(secondOptions.jobId).toBe(firstOptions.jobId);
    expect(firstOptions.removeOnComplete).toBe(true);
    expect(firstOptions.removeOnFail).toBe(true);
  });

  it('hai khoá học khác nhau: jobId khác nhau theo courseId', async () => {
    const { service, recalcQueue } = buildService();
    await service.setCriteria('actor-1', 'course-1', input);
    await service.setCriteria('actor-1', 'course-2', input);
    expect(recalcQueue.add.mock.calls[0]![2]).toMatchObject({ jobId: 'shared-completion-recalc-course-1' });
    expect(recalcQueue.add.mock.calls[1]![2]).toMatchObject({ jobId: 'shared-completion-recalc-course-2' });
  });
});
