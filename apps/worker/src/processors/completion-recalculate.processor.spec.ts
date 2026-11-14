import { describe, expect, it, vi } from 'vitest';
import { CompletionRecalculateProcessor } from './completion-recalculate.processor';

describe('CompletionRecalculateProcessor — enqueue lại khoá phụ thuộc dùng jobId ổn định và không bị job đã xong chặn (N34)', () => {
  function buildProcessor(recalcAdd: (...args: unknown[]) => Promise<unknown>) {
    const past = new Date('2026-01-01T00:00:00.000Z');
    const criteriaRow = {
      id: 'crit-1', criteriaType: 'date', moduleInstance: null, courseInstance: null,
      date: past, enrolPeriodDays: null, course: 'course-1',
    };
    const selectBuilder = (table: string) => {
      const wheres: unknown[][] = [];
      const builder = {
        select: () => builder,
        where: (...args: unknown[]) => { wheres.push(args); return builder; },
        executeTakeFirst: async () => (table === 'course_completion_settings' ? { method: 1 } : undefined),
        execute: async () => {
          if (table === 'course_completion_criteria') {
            return wheres.some((w) => w[0] === 'criteria_type') ? [{ course: 'dep-course' }] : [criteriaRow];
          }
          if (table === 'enrol') return [{ id: 'enrol-1', status: 0 }];
          if (table === 'user_enrolments') return [{ enrolId: 'enrol-1', userId: 'user-1', status: 0, timeStart: past }];
          if (table === 'course_completions') {
            return [{ userId: 'user-1', course: 'course-1', status: 'in_progress', timeEnrolled: past, timeStarted: past, timeCompleted: null }];
          }
          if (table === 'course_modules') return [];
          return [];
        },
      };
      return builder;
    };
    const insertBuilder = () => {
      const builder = {
        values: () => builder,
        onConflict: () => builder,
        doUpdateSet: () => builder,
        execute: async () => [],
      };
      return builder;
    };
    const spaceDb = {
      routedKysely: { selectFrom: selectBuilder, insertInto: () => insertBuilder() },
    };
    const jobRunner = { runForJob: vi.fn(async (_data: unknown, fn: () => Promise<unknown>) => fn()) };
    const recalcQueue = { add: vi.fn(recalcAdd) };
    const processor = new CompletionRecalculateProcessor(spaceDb as never, jobRunner as never, recalcQueue as never);
    return { processor, recalcQueue };
  }

  function recalcJob() {
    return { data: { courseId: 'course-1', spaceSlug: null, spaceId: 'space-1', tenantId: null } } as never;
  }

  it('chạy 2 lần cho cùng khoá phụ thuộc: enqueue lại với cùng một jobId ổn định, không chứa UUID, và job được xoá khi xong để lần sau enqueue được', async () => {
    const { processor, recalcQueue } = buildProcessor(async () => ({}));
    await processor.process(recalcJob());
    await processor.process(recalcJob());
    expect(recalcQueue.add).toHaveBeenCalledTimes(2);
    const firstOptions = recalcQueue.add.mock.calls[0]![2] as Record<string, unknown>;
    const secondOptions = recalcQueue.add.mock.calls[1]![2] as Record<string, unknown>;
    expect(firstOptions.jobId).toBe('space-1-completion-recalc-dep-course');
    expect(secondOptions.jobId).toBe(firstOptions.jobId);
    expect(firstOptions.jobId).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(firstOptions.removeOnComplete).toBe(true);
    const firstData = recalcQueue.add.mock.calls[0]![1] as Record<string, unknown>;
    expect(firstData.courseId).toBe('dep-course');
  });

  it('enqueue lại thất bại (lỗi Redis): processor vẫn trả kết quả thay vì ném lỗi lên caller', async () => {
    const { processor } = buildProcessor(async () => { throw new Error('Redis lỗi'); });
    const result = await processor.process(recalcJob());
    expect(result).toEqual({ courseId: 'course-1', users: 1, completedUsers: ['user-1'] });
  });
});
