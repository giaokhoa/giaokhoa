import { z } from 'zod';
import {
  createPrivacyRequestSchema,
  decidePrivacyRequestSchema,
  type DecidePrivacyRequest,
  uuidIdSchema,
} from '@giaokhoa/contracts';

export { decidePrivacyRequestSchema };
export type DecidePrivacyRequestDto = DecidePrivacyRequest;

export const createPrivacyRequestServerSchema = createPrivacyRequestSchema.extend({
  userId: uuidIdSchema.optional(),
});
export type CreatePrivacyRequestDto = z.infer<typeof createPrivacyRequestServerSchema>;
