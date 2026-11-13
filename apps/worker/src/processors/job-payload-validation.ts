





import { z } from 'zod';
import { UnrecoverableError } from 'bullmq';

const spaceScope = {
  spaceSlug: z.string().min(1).nullable().optional(),
  spaceId: z.string().min(1).nullable().optional(),
  tenantId: z.string().min(1).nullable().optional(),
};

export const workerPayloadSchemas = {




  'outbox-event': z.looseObject({
    outboxId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    aggregate: z.string().min(1),
    type: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).nullable(),
    occurredAt: z.string().min(1),
    ...spaceScope,
  }),




  'backup': z.looseObject({ jobId: z.string().min(1) }),
  'restore': z.looseObject({ jobId: z.string().min(1) }),
  'analytics-run': z.looseObject({ courseId: z.string().min(1) }),
  'report-schedule': z.looseObject({ scheduleId: z.string().min(1) }),
  'privacy': z.looseObject({ requestId: z.string().min(1) }),



  'payment-reconciliation': z.looseObject({
    paymentId: z.string().min(1).optional(),
    externalTransactionId: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
  }),
  'calendar-import': z.looseObject({ subscriptionId: z.string().min(1), ...spaceScope }),
  'calendar-reminders': z.looseObject({
    eventId: z.string().min(1),
    userId: z.string().min(1),
    minutesBefore: z.number().int().nonnegative(),
    ...spaceScope,
  }),
  'completion-recalculate': z.looseObject({ courseId: z.string().min(1), ...spaceScope }),
  'badge-award': z.looseObject({
    userId: z.string().min(1),
    trigger: z.string().optional(),
    ...spaceScope,
  }),
  'notification-dispatch': z.looseObject({
    userId: z.string().min(1),
    provider: z.string().min(1),
    channel: z.string().min(1),
    subject: z.string(),
    body: z.string(),
    dedupeKey: z.string().min(1),
    ...spaceScope,
  }),
} as const;


export function validateWorkerJobPayload<T extends z.ZodType>(
  schema: T,
  data: unknown,
  queueName: string,
): z.output<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.') || '<root>');



    throw new UnrecoverableError(`Payload job không hợp lệ (${queueName}); trường: ${[...new Set(fields)].join(', ')}`);
  }
  return parsed.data;
}
