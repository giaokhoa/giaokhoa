import { expect, test, vi } from 'vitest';
import { OnboardingService } from './onboarding.service.js';

const body = { lastName: 'Nguyễn', firstName: 'An', password: 'password123' };

test('completes onboarding with password and full name', async () => {
  const setPassword = vi.fn().mockResolvedValue(undefined);
  const updateUser = vi.fn().mockResolvedValue(undefined);
  const service = new OnboardingService({ api: { setPassword, updateUser } } as never);

  await service.complete(body, { user: { name: '  ' } } as never, { cookie: 'session=abc' });

  expect(setPassword).toHaveBeenCalledWith({
    body: { newPassword: body.password },
    headers: expect.any(Headers),
  });
  expect(updateUser).toHaveBeenCalledWith({
    body: { name: 'Nguyễn An' },
    headers: expect.any(Headers),
  });
});

test('does not repeat onboarding for users with a name', async () => {
  const setPassword = vi.fn();
  const updateUser = vi.fn();
  const service = new OnboardingService({ api: { setPassword, updateUser } } as never);

  await service.complete(body, { user: { name: 'Existing user' } } as never, {});

  expect(setPassword).not.toHaveBeenCalled();
  expect(updateUser).not.toHaveBeenCalled();
});
