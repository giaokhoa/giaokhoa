import { z } from 'zod';

export const completeOnboardingBodySchema = z.strictObject({
  lastName: z.string().trim().min(1, 'Vui lòng nhập họ.').max(100),
  firstName: z.string().trim().min(1, 'Vui lòng nhập tên.').max(100),
  password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự.').max(128),
});
export const completeOnboardingResponseSchema = z.strictObject({ status: z.literal(true) });

export const authContract = {
  completeOnboarding: {
    method: 'POST',
    path: '/auth/onboarding',
    body: completeOnboardingBodySchema,
    responses: { 201: completeOnboardingResponseSchema },
  },
} as const;

export type CompleteOnboardingBody = z.infer<typeof completeOnboardingBodySchema>;
export type CompleteOnboardingResponse = z.infer<typeof completeOnboardingResponseSchema>;
