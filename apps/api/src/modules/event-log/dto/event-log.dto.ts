import { z } from 'zod';
import { listEventLogsQuerySchema } from '@giaokhoa/contracts';

export { listEventLogsQuerySchema };

export const listEventLogsQueryServerSchema = listEventLogsQuerySchema.extend({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type ListEventLogsQueryDto = z.infer<typeof listEventLogsQueryServerSchema>;
