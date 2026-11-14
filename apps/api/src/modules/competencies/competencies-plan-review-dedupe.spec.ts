import { describe, expect, it, vi } from 'vitest';
import { CompetenciesService, PLAN_STATUS } from './competencies.service';

describe('CompetenciesService.requestPlanReview — gửi lại yêu cầu duyệt sau khi huỷ không bị dedupe nuốt mất thông báo lần hai', () => {
  function buildService() {
    let status: number = PLAN_STATUS.ACTIVE;
    const plan = { id: 'plan-1', userId: 'owner-1', reviewerId: 'reviewer-1', name: 'Kế hoạch học tập' };
    const reviews: Record<string, unknown>[] = [];
    const repo = {
      getPlan: vi.fn(async () => ({ ...plan, status })),
      updatePlan: vi.fn(async (_id: string, patch: { status: number }) => { status = patch.status; }),
      insertPlanReview: vi.fn(async (v: Record<string, unknown>) => { reviews.push(v); }),
    };
    const evaluator = { requireCapability: vi.fn(async () => undefined) };
    const messaging = { notify: vi.fn(async (_userId: string, _provider: string, _input: Record<string, unknown>) => ({})) };
    const outbox = { enqueueStandalone: vi.fn(async () => undefined) };
    const i18n = { t: vi.fn((key: string) => key) };
    const service = new CompetenciesService(
      repo as never, {} as never, evaluator as never, {} as never, {} as never,
      {} as never, messaging as never, {} as never, outbox as never, {} as never, i18n as never,
    );
    return { service, reviews, messaging };
  }

  it('yêu cầu duyệt, huỷ, rồi yêu cầu duyệt lại: hai lần gửi có eventId khác nhau, mỗi eventId gắn đúng id của bản ghi review vừa tạo', async () => {
    const { service, reviews, messaging } = buildService();
    await service.requestPlanReview('owner-1', 'plan-1');
    await service.cancelPlanReview('owner-1', 'plan-1');
    await service.requestPlanReview('owner-1', 'plan-1');
    const requestReviews = reviews.filter((r) => r.action === 'request-review');
    expect(requestReviews).toHaveLength(2);
    expect(requestReviews[0]!.id).not.toBe(requestReviews[1]!.id);
    expect(messaging.notify).toHaveBeenCalledTimes(2);
    const firstEventId = messaging.notify.mock.calls[0]![2].eventId as string;
    const secondEventId = messaging.notify.mock.calls[1]![2].eventId as string;
    expect(firstEventId).toBe(`competency-plan-review-${requestReviews[0]!.id}`);
    expect(secondEventId).toBe(`competency-plan-review-${requestReviews[1]!.id}`);
    expect(firstEventId).not.toBe(secondEventId);
    expect(firstEventId).not.toContain(':');
    expect(secondEventId).not.toContain(':');
  });
});
