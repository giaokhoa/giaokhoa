import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { createHash, randomBytes } from 'node:crypto';
import { OutboxService } from '../../infra/events/outbox.service';
import { backgroundJobContext, backgroundJobId } from '../../db/routing/background-job-context';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { CoursesService } from '../courses/courses.service';
import { EnrolService } from '../enrol/enrol.service';
import { GroupsService } from '../groups/groups.service';
import { CalendarRepository, type CalendarEventRow, type CalendarExportTokenRow, type CalendarSubscriptionRow } from '@giaokhoa/db/repositories/calendar';
import { serializeCalendar } from './domain/ics';
import { formatRrule, occurrenceStarts, parseRrule } from './domain/rrule';

function hashExportToken(raw: string): string { return createHash('sha256').update(raw).digest('hex'); }

export const CALENDAR_REMINDER_QUEUE = 'calendar-reminders';
export const CALENDAR_IMPORT_QUEUE = 'calendar-import';
export const EVENT_TYPES = ['site', 'category', 'course', 'group', 'user'] as const;
export type CalendarEventType = (typeof EVENT_TYPES)[number];

export interface CreateEventInput {
  name: string;
  description?: string;
  eventType: CalendarEventType;
  courseId?: string;
  groupId?: string;
  categoryId?: string;
  timeStart: string;
  timeDuration?: number;
  location?: string;
  repeat?: { freq: string; count?: number; until?: string };
}

@Injectable()
export class CalendarService {
  constructor(
    private readonly repo: CalendarRepository,
    private readonly courses: CoursesService,
    private readonly enrol: EnrolService,
    private readonly groups: GroupsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
    private readonly outbox: OutboxService,
    @InjectQueue(CALENDAR_REMINDER_QUEUE) private readonly reminderQueue: Queue,
    @InjectQueue(CALENDAR_IMPORT_QUEUE) private readonly importQueue: Queue,
  ) {}

  private async systemCtx(): Promise<string> {
    return (await this.contexts.ensureSystemContext()).id;
  }

  private async manageContextId(input: { eventType: string; courseId?: string; categoryId?: string; userId?: string }): Promise<string> {
    switch (input.eventType) {
      case 'course':
      case 'group':
        return this.courses.courseContextId(input.courseId!);
      case 'category':
        return this.courses.categoryContextId(input.categoryId!);
      case 'user':
        return (await this.contexts.getByLevelInstance(30, input.userId!))?.id ?? this.systemCtx();
      default:
        return this.systemCtx();
    }
  }

  private async requireManage(actorId: string, input: { eventType: string; courseId?: string; categoryId?: string; userId?: string }): Promise<void> {
    if (input.eventType === 'user') {
      if (input.userId !== undefined && input.userId !== actorId) {
        await this.evaluator.requireCapability(actorId, 'calendar:manageentries', await this.systemCtx());
        return;
      }
      const ctx = await this.manageContextId({ ...input, userId: actorId });
      await this.evaluator.requireCapability(actorId, 'calendar:manageownentries', ctx);
      return;
    }
    const capability = input.eventType === 'group' ? 'calendar:managegroupentries' : 'calendar:manageentries';
    await this.evaluator.requireCapability(actorId, capability, await this.manageContextId(input));
  }

  async createEvent(actorId: string, input: CreateEventInput): Promise<{ event: CalendarEventRow; occurrences: CalendarEventRow[] }> {
    if (!EVENT_TYPES.includes(input.eventType)) {
      throw new BadRequestException({ message: `Unknown event type ${input.eventType}`, code: 'calendar.bad_type' });
    }
    if (input.eventType === 'course' && !input.courseId) throw new BadRequestException({ message: 'Course events require courseId', code: 'calendar.course_required' });
    if (input.eventType === 'group' && (!input.courseId || !input.groupId)) throw new BadRequestException({ message: 'Group events require courseId and groupId', code: 'calendar.group_required' });
    if (input.eventType === 'category' && !input.categoryId) throw new BadRequestException({ message: 'Category events require categoryId', code: 'calendar.category_required' });
    if (input.eventType === 'group') {
      const group = await this.groups.getGroup(input.groupId!);
      if (group.courseId !== input.courseId) throw new BadRequestException({ message: 'Group belongs to another course', code: 'calendar.group_course_mismatch' });
    }
    const owner = input.eventType === 'user' ? actorId : undefined;
    await this.requireManage(actorId, { eventType: input.eventType, courseId: input.courseId, categoryId: input.categoryId, userId: owner });
    const contextId = await this.manageContextId({ eventType: input.eventType, courseId: input.courseId, categoryId: input.categoryId, userId: owner });
    const start = new Date(input.timeStart);
    if (Number.isNaN(start.getTime())) throw new BadRequestException({ message: 'Invalid timeStart', code: 'calendar.bad_time' });

    const base = {
      name: input.name, description: input.description ?? '', eventType: input.eventType,
      courseId: input.courseId ?? null, groupId: input.groupId ?? null, categoryId: input.categoryId ?? null,
      userId: owner, contextId: contextId, timeDuration: input.timeDuration ?? 0,
      location: input.location ?? '', visible: true,
    };
    if (!input.repeat) {
      const event = await this.repo.insertEvent({ ...base, timeStart: start });
      await this.outbox.enqueueStandalone({ aggregate: 'calendar', type: 'calendar_event_created', payload: { eventId: event.id, eventType: event.eventType } });
      return { event, occurrences: [event] };
    }
    const spec = parseRrule(input.repeat);
    const starts = occurrenceStarts(start, spec);
    const occurrences: CalendarEventRow[] = [];
    let root: CalendarEventRow | undefined;
    await this.repo.transaction(async (tx) => {
      root = await this.repo.insertEvent({ ...base, timeStart: starts[0]!, rrule: formatRrule(spec), repeatId: null }, tx);
      await this.repo.updateEvent(root.id, { repeatId: root.id }, tx);
      root = { ...root, repeatId: root.id };
      occurrences.push(root);
      for (const s of starts.slice(1)) {
        occurrences.push(await this.repo.insertEvent({ ...base, timeStart: s, repeatId: root.id }, tx));
      }
      await this.outbox.enqueueKysely(tx, { aggregate: 'calendar', type: 'calendar_event_created', payload: { eventId: root.id, eventType: input.eventType, series: true, count: starts.length } });
    });
    return { event: root!, occurrences };
  }

  async getEvent(id: string): Promise<CalendarEventRow> {
    const row = await this.repo.getEvent(id);
    if (!row) throw new NotFoundException({ message: `Calendar event ${id} not found`, code: 'calendar.event_not_found' });
    return row;
  }

  async createException(actorId: string, occurrenceId: string, input: { name?: string; timeStart: string; description?: string }): Promise<CalendarEventRow> {
    const occurrence = await this.getEvent(occurrenceId);
    if (!occurrence.repeatId) throw new BadRequestException({ message: 'Only a series occurrence can have an exception', code: 'calendar.not_series' });
    await this.requireManage(actorId, { eventType: occurrence.eventType, courseId: occurrence.courseId || undefined, categoryId: occurrence.categoryId || undefined, userId: occurrence.userId || undefined });
    const exception = await this.repo.insertEvent({
      name: input.name ?? occurrence.name, description: input.description ?? occurrence.description,
      eventType: occurrence.eventType, courseId: occurrence.courseId, groupId: occurrence.groupId,
      categoryId: occurrence.categoryId, userId: occurrence.userId, contextId: occurrence.contextId,
      timeStart: new Date(input.timeStart), timeDuration: occurrence.timeDuration,
      repeatId: occurrence.repeatId, isException: true, exceptionOf: occurrence.id, location: occurrence.location,
    });
    return exception;
  }

  async deleteEvent(actorId: string, id: string): Promise<{ deleted: boolean; seriesDeleted: number }> {
    const event = await this.getEvent(id);
    await this.requireManage(actorId, { eventType: event.eventType, courseId: event.courseId || undefined, categoryId: event.categoryId || undefined, userId: event.userId || undefined });
    let count = 1;
    if (event.repeatId && event.id === event.repeatId) {
      const series = await this.repo.listSeries(event.repeatId);
      for (const row of series) { await this.repo.deleteEvent(row.id); count = series.length; }
    } else {
      await this.repo.deleteEvent(id);
    }
    return { deleted: true, seriesDeleted: count };
  }


  private async canViewCoursePart(viewerId: string, courseId: string | undefined): Promise<boolean> {
    if (!courseId) return false;
    if (await this.evaluator.isSiteAdmin(viewerId)) return true;
    if (await this.enrol.isEnrolled(courseId, viewerId, { onlyActive: true })) return true;
    const ctx = await this.courses.courseContextId(courseId);
    return this.evaluator.hasCapabilityFromRealAssignment(viewerId, 'course:view', ctx, { excludeArchetypes: ['student'] });
  }

  async isVisibleTo(event: CalendarEventRow, viewerId: string): Promise<boolean> {
    if (!event.visible) {
      return this.requireManage(viewerId, { eventType: event.eventType, courseId: event.courseId || undefined, categoryId: event.categoryId || undefined, userId: event.userId || undefined }).then(() => true).catch(() => false);
    }
    switch (event.eventType) {
      case 'site':
        return true;
      case 'user':
        return event.userId === viewerId;
      case 'category': {
        if (await this.evaluator.isSiteAdmin(viewerId)) return true;
        const courses = await this.courses.listCourses(event.categoryId ?? undefined);
        for (const c of courses) {
          if (await this.canViewCoursePart(viewerId, c.id)) return true;
        }
        const ctx = await this.courses.categoryContextId(event.categoryId!);
        return this.evaluator.hasCapability(viewerId, 'calendar:manageentries', ctx);
      }
      case 'course':
        return this.canViewCoursePart(viewerId, event.courseId ?? undefined);
      case 'group': {
        if (!(await this.canViewCoursePart(viewerId, event.courseId ?? undefined))) return false;
        if (await this.groups.isMember(event.groupId!, viewerId)) return true;
        const ctx = await this.courses.courseContextId(event.courseId!);
        return this.evaluator.hasCapability(viewerId, 'group:accessallgroups', ctx);
      }
      default:
        return false;
    }
  }

  async listEventsForUser(viewerId: string, filter: { from?: string; to?: string; eventType?: string }): Promise<CalendarEventRow[]> {
    const from = filter.from ? new Date(filter.from) : new Date(Date.now() - 31 * 86400_000);
    const to = filter.to ? new Date(filter.to) : new Date(Date.now() + 62 * 86400_000);
    const rows = await this.repo.listEventsInRange(from, to);
    const exceptedIds = new Set(rows.filter((r) => r.isException).map((r) => r.exceptionOf));
    const visible: CalendarEventRow[] = [];
    for (const row of rows) {
      if (row.isException === false && row.exceptionOf === null && exceptedIds.has(row.id)) continue;
      if (filter.eventType && row.eventType !== filter.eventType) continue;
      if (await this.isVisibleTo(row, viewerId)) visible.push(row);
    }
    return visible;
  }


  async exportIcsForUser(userId: string, filter: { from?: string; to?: string; eventType?: string }): Promise<string> {
    const events = await this.listEventsForUser(userId, filter);
    return serializeCalendar(events);
  }

  async createOrRotateExportToken(userId: string): Promise<{ token: string; exportUrl: string; createdAt: Date; updatedAt: Date }> {
    const raw = randomBytes(32).toString('hex');
    const row = await this.repo.upsertExportToken(userId, hashExportToken(raw));
    return { token: raw, exportUrl: `/api/v1/calendar/export/${raw}.ics`, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  async getExportTokenStatus(userId: string): Promise<{ hasToken: boolean; createdAt: Date | null; updatedAt: Date | null; lastAccess: Date | null }> {
    const row = await this.repo.getExportTokenByUser(userId);
    if (!row) return { hasToken: false, createdAt: null, updatedAt: null, lastAccess: null };
    return { hasToken: true, createdAt: row.createdAt, updatedAt: row.updatedAt, lastAccess: row.lastAccess };
  }

  async revokeExportToken(userId: string): Promise<{ revoked: boolean }> {
    return { revoked: await this.repo.deleteExportToken(userId) };
  }

  async exportIcsByToken(rawToken: string, filter: { from?: string; to?: string; eventType?: string }): Promise<string> {
    const row: CalendarExportTokenRow | undefined = await this.repo.getExportTokenByHash(hashExportToken(rawToken));
    if (!row) {
      throw new UnauthorizedException({ message: 'Calendar export token is invalid or has been revoked', code: 'calendar.export_token_invalid' });
    }
    await this.repo.touchExportToken(row.id);
    return this.exportIcsForUser(row.userId, filter);
  }


  async scheduleReminder(actorId: string, eventId: string, minutesBefore: number): Promise<{ eventId: string; userId: string; remindAt: string; delayMs: number }> {
    const event = await this.getEvent(eventId);
    if (!(await this.isVisibleTo(event, actorId))) {
      throw new ForbiddenException({ message: 'You cannot set a reminder for an event you cannot see', code: 'calendar.reminder_forbidden' });
    }
    const remindAt = new Date(event.timeStart.getTime() - minutesBefore * 60_000);
    const delayMs = Math.max(0, remindAt.getTime() - Date.now());
    await this.reminderQueue.add('remind', { eventId, userId: actorId, minutesBefore, ...backgroundJobContext() }, {
      jobId: backgroundJobId(`cal-reminder-${eventId}-${actorId}-${minutesBefore}`),
      delay: delayMs, attempts: 3, removeOnComplete: true,
    });
    return { eventId, userId: actorId, remindAt: remindAt.toISOString(), delayMs };
  }


  async createSubscription(actorId: string, input: { name: string; url?: string; icsData?: string; eventType?: string; courseId?: string; categoryId?: string; pollInterval?: number }): Promise<CalendarSubscriptionRow> {
    const eventType = input.eventType ?? 'site';
    if (eventType === 'site') {
      await this.evaluator.requireCapability(actorId, 'calendar:managesubscriptions', await this.systemCtx());
    } else if (eventType === 'course' && input.courseId) {
      await this.evaluator.requireCapability(actorId, 'calendar:manageentries', await this.courses.courseContextId(input.courseId));
    }
    const subscription = await this.repo.insertSubscription({
      name: input.name, url: input.url ?? null, icsData: input.icsData ?? null,
      eventType, courseId: input.courseId ?? null, categoryId: input.categoryId ?? null,
      userId: actorId, pollInterval: input.pollInterval ?? 604800,
    });
    if (subscription.icsData) {
      await this.importQueue.add('import', { subscriptionId: subscription.id, ...backgroundJobContext() }, { jobId: backgroundJobId(`cal-import-${subscription.id}`), attempts: 3 });
    }
    return subscription;
  }

  async listSubscriptions(actorId: string): Promise<CalendarSubscriptionRow[]> {
    return this.repo.listSubscriptionsForUser(actorId);
  }

  async requestImport(actorId: string, subscriptionId: string): Promise<{ queued: boolean; subscriptionId: string }> {
    const sub = await this.repo.getSubscription(subscriptionId);
    if (!sub) throw new NotFoundException({ message: `Subscription ${subscriptionId} not found`, code: 'calendar.subscription_not_found' });
    await this.evaluator.requireCapability(actorId, 'calendar:managesubscriptions', await this.systemCtx());
    await this.importQueue.add('import', { subscriptionId, ...backgroundJobContext() }, { jobId: backgroundJobId(`cal-import-${subscriptionId}-${Date.now()}`), attempts: 3 });
    return { queued: true, subscriptionId };
  }
}
