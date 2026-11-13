import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AvailabilityService } from './availability.service';

/**
 * Lá date của AvailabilityService ở biên thời gian (A2, báo cáo code style 2026-11-13):
 * hướng '<' và '<=' phải khác nhau đúng tại thời điểm `when` — '<' không khả dụng
 * tại `when`, '<=' khả dụng tại `when`. Test viết TRƯỚC khi sửa evalDate để xác
 * minh '<=' có sai thật không; epoch giây (< 1e12) và mili-giây (>= 1e12) đều
 * phải hiểu đúng tại biên.
 */
describe('AvailabilityService — lá date ở biên thời gian', () => {
  function buildService() {
    const users = { getProfileView: async () => { throw new Error('không dùng trong test lá date'); } };
    const i18n = { t: (key: string) => key };
    return new AvailabilityService(users as never, i18n as never);
  }

  const WHEN = new Date('2026-11-13T00:00:00.000Z');
  const WHEN_SECONDS = Math.floor(WHEN.getTime() / 1000);
  const ONE_SECOND_BEFORE = new Date(WHEN.getTime() - 1000);

  function dateTree(direction: string, time: number) {
    return { op: '&', c: [{ type: 'date', d: direction, t: time }] };
  }

  it('hướng "<": đúng thời điểm when thì không khả dụng', async () => {
    const service = buildService();
    const result = await service.evaluate(dateTree('<', WHEN_SECONDS), { userId: 'user-1', now: WHEN });
    expect(result.available).toBe(false);
  });

  it('hướng "<": trước thời điểm when thì khả dụng', async () => {
    const service = buildService();
    const result = await service.evaluate(dateTree('<', WHEN_SECONDS), { userId: 'user-1', now: ONE_SECOND_BEFORE });
    expect(result.available).toBe(true);
  });

  it('hướng "<=": đúng thời điểm when thì khả dụng', async () => {
    const service = buildService();
    const result = await service.evaluate(dateTree('<=', WHEN_SECONDS), { userId: 'user-1', now: WHEN });
    expect(result.available).toBe(true);
  });

  it('hướng "<=": trước thời điểm when thì khả dụng', async () => {
    const service = buildService();
    const result = await service.evaluate(dateTree('<=', WHEN_SECONDS), { userId: 'user-1', now: ONE_SECOND_BEFORE });
    expect(result.available).toBe(true);
  });

  it('hướng ">=": đúng thời điểm when thì khả dụng', async () => {
    const service = buildService();
    const result = await service.evaluate(dateTree('>=', WHEN_SECONDS), { userId: 'user-1', now: WHEN });
    expect(result.available).toBe(true);
  });

  it('epoch mili-giây: hướng "<=" đúng thời điểm when thì khả dụng', async () => {
    const service = buildService();
    const result = await service.evaluate(dateTree('<=', WHEN.getTime()), { userId: 'user-1', now: WHEN });
    expect(result.available).toBe(true);
  });

  it('epoch mili-giây: hướng "<" đúng thời điểm when thì không khả dụng', async () => {
    const service = buildService();
    const result = await service.evaluate(dateTree('<', WHEN.getTime()), { userId: 'user-1', now: WHEN });
    expect(result.available).toBe(false);
  });
});

/**
 * Ca 400 thuộc về tầng service: parseAvailabilityTree (domain thuần) chỉ ném
 * Error thường, AvailabilityService.parse mới đổi thành BadRequest 400.
 */
describe('AvailabilityService.parse — cây sai định dạng', () => {
  it('parse cây sai định dạng thì ném lỗi validation mức 400', () => {
    const users = { getProfileView: async () => { throw new Error('không dùng trong test parse'); } };
    const i18n = { t: (key: string) => key };
    const service = new AvailabilityService(users as never, i18n as never);
    try {
      service.parse({ op: 'xor', c: [] });
      expect.unreachable('parse phải ném lỗi với cây sai định dạng');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'availability.invalid_tree' });
    }
  });
});
