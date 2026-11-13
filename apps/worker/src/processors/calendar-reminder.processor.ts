import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import { validateWorkerJobPayload, workerPayloadSchemas } from './job-payload-validation';
import { I18nService } from '@nestjs/i18n';
import type { Job } from 'bullmq';
import { NotificationDeliveryService } from '../notification-delivery.service';
import { SpaceJobRunner } from '../db/routing/space-job-runner';
import { resolveDefaultTenantId } from '../db/default-tenant';
import { SpaceDatabaseService } from '../db/routing/space-database.service';
import type { BackgroundJobScope } from '../db/routing/background-job-scope';

export interface CalendarReminderJobData extends BackgroundJobScope { eventId: string; userId: string; minutesBefore: number }
export interface CalendarReminderResult { status: 'notified' | 'duplicate' | 'skipped-suspended' | 'skipped-preference' | 'skipped-admin-disabled' | 'event-missing'; notificationId?: string }

@Processor('calendar-reminders')



export class CalendarReminderProcessor extends ObservedWorkerHost {
  constructor(
    private readonly i18n: I18nService,
    private readonly delivery: NotificationDeliveryService,
    private readonly spaceDb: SpaceDatabaseService,
    private readonly jobRunner: SpaceJobRunner,
  ) { super(); }

  async process(job: Job<CalendarReminderJobData>): Promise<CalendarReminderResult> {

    validateWorkerJobPayload(workerPayloadSchemas['calendar-reminders'], job.data, 'calendar-reminders');
    return this.jobRunner.runForJob(job.data, () => this.processInContext(job));
  }

  private async processInContext(job: Job<CalendarReminderJobData>): Promise<CalendarReminderResult> {
    const { eventId, userId } = job.data;
    const event = await this.spaceDb.routedKysely
      .selectFrom('calendar_events')
      .select(['name', 'course_id as courseId', 'time_start as timeStart'])
      .where('id', '=', eventId)
      .executeTakeFirst();
    if (!event) return { status: 'event-missing' };
    const contextUrl = `/calendar/events/${eventId}`;
    const existing = await this.spaceDb.routedKysely
      .selectFrom('notifications')
      .select('id')
      .where('user_id_to', '=', userId)
      .where('event_type', '=', 'calendar_reminder')
      .where('context_url', '=', contextUrl)
      .executeTakeFirst();
    if (existing) return { status: 'duplicate', notificationId: existing.id };
    const recipientLocale = 'vi';
    const subject = this.i18n.t('platform.calendarReminderSubject', { locale: recipientLocale, args: { name: event.name } });
    let tenantId: string | null = null;
    if (event.courseId) {
      const courseRow = await this.spaceDb.routedKysely
        .selectFrom('course')
        .select('tenant_id as tenantId')
        .where('id', '=', event.courseId)
        .executeTakeFirst();
      tenantId = courseRow?.tenantId ?? null;
    }
    if (!tenantId) tenantId = await resolveDefaultTenantId(this.spaceDb.routedKysely, userId);
    const delivered = await this.delivery.deliverInApp(userId, 'calendar_reminder', {
      subject,
      body: this.i18n.t('platform.calendarReminderBody', { locale: recipientLocale, args: { name: event.name, time: event.timeStart.toISOString() } }),
      smallMessage: subject,
      contextUrl,
      tenantId,
    });
    if (delivered.status === 'delivered') return { status: 'notified', notificationId: delivered.notificationId };
    if (delivered.status === 'skipped-suspended') return { status: 'skipped-suspended' };
    if (delivered.status === 'skipped-admin-disabled') return { status: 'skipped-admin-disabled' };
    return { status: 'skipped-preference' };
  }
}
