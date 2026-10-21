import { describe, expect, it } from 'vitest';
import { completeOnboardingBodySchema } from '@giaokhoa/shared/http/auth';

describe('Lược đồ hoàn tất tạo hồ sơ (completeOnboardingBodySchema)', () => {
  it('yêu cầu tên và mật khẩu hợp lệ', () => {
    expect(
      completeOnboardingBodySchema.safeParse({
        lastName: 'Nguyễn',
        firstName: 'An',
        password: 'abcdefgh',
      }).success,
    ).toBe(true);

    expect(
      completeOnboardingBodySchema.safeParse({
        lastName: '',
        firstName: 'An',
        password: 'abcdefgh',
      }).success,
    ).toBe(false);

    expect(
      completeOnboardingBodySchema.safeParse({
        lastName: 'Nguyễn',
        firstName: 'An',
        password: 'short',
      }).success,
    ).toBe(false);
  });
});
