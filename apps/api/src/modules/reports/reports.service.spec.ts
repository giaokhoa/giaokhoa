import { describe, expect, it, vi } from 'vitest';
import { ReportsService } from './reports.service';

describe('ReportsService.runSchedule — chạy lịch báo cáo gửi thông báo với eventId epoch', () => {
  function buildService() {
    const report = {
      id: 'report-1', name: 'Báo cáo ghi danh', dataSource: 'enrolments',
      columns: ['userId', 'username', 'courseId', 'status'], filters: {},
      createdBy: 'user-1', contextId: null, createdAt: new Date(),
    };
    const schedule = {
      id: 'sched-1', reportId: 'report-1', createdBy: 'user-1', cron: 'daily',
      enabled: true, lastRun: null, lastResult: null, createdAt: new Date(),
    };
    const dbHandle = {
      selectFrom: vi.fn(() => ({
        select: vi.fn(() => ({ execute: vi.fn(async () => []) })),
      })),
    };
    const repo = {
      dbHandle,
      getSchedule: vi.fn(async () => schedule),
      getReport: vi.fn(async () => report),
      updateSchedule: vi.fn(async (_id: string, _patch: Record<string, unknown>) => undefined),
    };
    const messaging = { notify: vi.fn(async (_userId: string, _provider: string, _input: Record<string, unknown>) => ({})) };
    const i18n = { t: vi.fn((key: string) => key) };
    const service = new ReportsService(
      repo as never, {} as never, {} as never, {} as never, messaging as never, i18n as never,
    );
    return { service, repo, messaging };
  }

  it('chạy lịch thành công: eventId của thông báo là report-scheduled-<scheduleId>-<epoch mili giây của lần chạy>, không chứa dấu hai chấm', async () => {
    const { service, repo, messaging } = buildService();
    const result = await service.runSchedule('sched-1');
    expect(result).toEqual({ scheduleId: 'sched-1', rows: 0 });
    expect(messaging.notify).toHaveBeenCalledTimes(1);
    const input = messaging.notify.mock.calls[0]![2] as Record<string, unknown>;
    const ranAt = repo.updateSchedule.mock.calls[0]![1].lastRun as Date;
    expect(input.eventId).toBe(`report-scheduled-sched-1-${ranAt.getTime()}`);
    expect(input.eventId as string).not.toContain(':');
  });
});
