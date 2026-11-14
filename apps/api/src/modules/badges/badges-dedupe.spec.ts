import { describe, expect, it, vi } from 'vitest';
import { BadgesService } from './badges.service';

describe('BadgesService.enqueueEvaluation — enqueue đánh giá huy hiệu dùng jobId ổn định theo người dùng và trigger (N18)', () => {
  function buildService() {
    const awardQueue = { add: vi.fn(async (_name: string, _data: Record<string, unknown>, _options: Record<string, unknown>) => ({})) };
    const badges = new BadgesService(
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, awardQueue as never,
    );
    return { badges, awardQueue };
  }

  function enqueue(badges: BadgesService, userId: string, trigger: string): Promise<void> {
    return (badges as unknown as { enqueueEvaluation: (userId: string, trigger: string) => Promise<void> })
      .enqueueEvaluation(userId, trigger);
  }

  it('đánh giá 2 lần cho cùng người dùng và trigger: enqueue 2 lần với cùng một jobId ổn định, không chứa UUID, và job được xoá khi xong để lần sau enqueue được', async () => {
    const { badges, awardQueue } = buildService();
    await enqueue(badges, 'user-1', 'course-completion');
    await enqueue(badges, 'user-1', 'course-completion');
    expect(awardQueue.add).toHaveBeenCalledTimes(2);
    const firstOptions = awardQueue.add.mock.calls[0]![2] as Record<string, unknown>;
    const secondOptions = awardQueue.add.mock.calls[1]![2] as Record<string, unknown>;
    expect(firstOptions.jobId).toBe('shared-badge-award-user-1-course-completion');
    expect(secondOptions.jobId).toBe(firstOptions.jobId);
    expect(firstOptions.removeOnComplete).toBe(true);
    expect(firstOptions.removeOnFail).toBe(true);
  });

  it('trigger khác nhau: jobId khác nhau theo trigger', async () => {
    const { badges, awardQueue } = buildService();
    await enqueue(badges, 'user-1', 'course-completion');
    await enqueue(badges, 'user-1', 'competency');
    expect(awardQueue.add.mock.calls[0]![2]).toMatchObject({ jobId: 'shared-badge-award-user-1-course-completion' });
    expect(awardQueue.add.mock.calls[1]![2]).toMatchObject({ jobId: 'shared-badge-award-user-1-competency' });
  });
});
