import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { parseIcs } from '../domain/ics';
import { SpaceJobRunner } from '../db/routing/space-job-runner';
import { SpaceDatabaseService } from '../db/routing/space-database.service';
import type { BackgroundJobScope } from '../db/routing/background-job-scope';

export interface CalendarImportJobData extends BackgroundJobScope { subscriptionId: string }
export interface CalendarImportResult { eventsimported: number; eventsskipped: number; eventsupdated: 0; eventsdeleted: 0 }

@Processor('calendar-import', { concurrency: 5 })
export class CalendarImportProcessor extends WorkerHost {
  constructor(private readonly spaceDb: SpaceDatabaseService, private readonly jobRunner: SpaceJobRunner) { super(); }

  async process(job: Job<CalendarImportJobData>): Promise<CalendarImportResult> {
    return this.jobRunner.runForJob(job.data, () => this.processInContext(job));
  }

  private async processInContext(job: Job<CalendarImportJobData>): Promise<CalendarImportResult> {
    const { subscriptionId } = job.data;
    const sub = await this.spaceDb.routedKysely
      .selectFrom('calendar_subscriptions')
      .select([
        'id', 'ics_data as icsData', 'event_type as eventType', 'course_id as courseId',
        'category_id as categoryId', 'user_id as userId',
      ])
      .where('id', '=', subscriptionId)
      .executeTakeFirst();
    if (!sub || !sub.icsData) return { eventsimported: 0, eventsskipped: 0, eventsupdated: 0, eventsdeleted: 0 };
    const parsed = parseIcs(sub.icsData);
    let imported = 0;
    let skipped = 0;
    for (const event of parsed) {
      const existing = await this.spaceDb.routedKysely
        .selectFrom('calendar_events')
        .select('id')
        .where('subscription_id', '=', subscriptionId)
        .where('uuid', '=', event.uid)
        .executeTakeFirst();
      if (existing) { skipped += 1; continue; }
      await this.spaceDb.routedKysely
        .insertInto('calendar_events')
        .values({
          name: event.summary, description: event.description, event_type: sub.eventType,
          course_id: sub.courseId, category_id: sub.categoryId, user_id: sub.userId,
          subscription_id: subscriptionId, uuid: event.uid, time_start: event.start,
          time_duration: event.end ? Math.max(0, Math.round((event.end.getTime() - event.start.getTime()) / 1000)) : 0,
        })
        .execute();
      imported += 1;
    }
    await this.spaceDb.routedKysely
      .updateTable('calendar_subscriptions')
      .set({ last_updated: new Date() })
      .where('id', '=', subscriptionId)
      .execute();
    return { eventsimported: imported, eventsskipped: skipped, eventsupdated: 0, eventsdeleted: 0 };
  }
}
