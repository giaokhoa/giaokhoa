/**
 * Biên runtime của job: BullMQ đọc dữ liệu JSON từ Redis, type assertion TS
 * không chứng minh payload thật hợp lệ. Các schema là object lỏng để giữ
 * trường tương thích của job lịch sử, nhưng bắt buộc kiểm các ID/kiểu
 * cần có trước khi mở phiên database hoặc gọi dịch vụ bên ngoài.
 */
import { z } from 'zod';

const spaceScope = {
  spaceSlug: z.string().min(1).nullable().optional(),
  spaceId: z.string().min(1).nullable().optional(),
  tenantId: z.string().min(1).nullable().optional(),
};

export const workerPayloadSchemas = {
  // Phong bì chung của transactional outbox, kiểm trước khi định
  // tuyến kho để lỗi shape không thể bị hiểu là sự kiện hợp lệ.
  // Không kiểm schema `payload` nghiệp vụ ở đây: mỗi consumer
  // dùng contract chuyên biệt và có luật tương thích dữ liệu cũ.
  'outbox-event': z.looseObject({
    outboxId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    aggregate: z.string().min(1),
    type: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).nullable(),
    occurredAt: z.string().min(1),
    ...spaceScope,
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

/** Không in body, token hay dữ liệu mail vào log/throw khi payload bị lỗi. */
export function validateWorkerJobPayload<T extends z.ZodType>(
  schema: T,
  data: unknown,
  queueName: string,
): z.output<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.') || '<root>');
    throw new Error(`Payload job không hợp lệ (${queueName}); trường: ${[...new Set(fields)].join(', ')}`);
  }
  return parsed.data;
}
