import type { Queue } from 'bullmq';

export const OUTBOX_EVENT_QUEUE_ROUTES: OutboxEventQueueRoutes = {
  auth_mail_requested: 'auth-mail',
  guardian_digest_due: 'guardian-digest-events',
  guardian_overdue_alert: 'guardian-digest-events',
  grade_updated: 'notification-events',
  course_completed: 'notification-events',
  enrol_expiry_warning: 'notification-events',
  activity_due_reminder: 'notification-events',
  assignment_created: 'notification-events',
  assignment_submitted: 'notification-events',
  assignment_returned: 'notification-events',
  exam_pinned: 'notification-events',
  quiz_attempt_finished: 'notification-events',
  cohort_member_added: 'cohort-sync-events',
  cohort_member_removed: 'cohort-sync-events',
  message_sent: ['messaging-realtime', 'notification-events'],
  message_conversation_read: 'messaging-realtime',
  message_deleted: 'messaging-realtime',
  message_recalled: 'messaging-realtime',
  message_removed: 'messaging-realtime',
  message_deleted_for_me: 'messaging-realtime',
};

export type OutboxEventQueueRoutes = Readonly<Record<string, string | readonly string[]>>;

export function queueNamesOfRoute(route: string | readonly string[]): readonly string[] {
  return typeof route === 'string' ? [route] : route;
}

export function allQueueNamesOfRoutes(routes: OutboxEventQueueRoutes): string[] {
  const names: string[] = [];
  for (const route of Object.values(routes)) {
    for (const name of queueNamesOfRoute(route)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

export const OUTBOX_EVENT_ROUTES = 'OUTBOX_EVENT_ROUTES';

export const OUTBOX_EVENT_QUEUES = 'OUTBOX_EVENT_QUEUES';

export type OutboxEventQueues = ReadonlyMap<string, Queue>;

export interface OutboxEventJobData {
  outboxId: string;
  seq: number;
  aggregate: string;
  type: string;
  payload: Record<string, unknown> | null;
  tenantId: string | null;
  spaceSlug: string | null;
  spaceId?: string | null;
  occurredAt: string;
}
