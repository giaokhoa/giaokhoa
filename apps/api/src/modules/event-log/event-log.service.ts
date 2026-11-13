import { Injectable, NotFoundException } from '@nestjs/common';
import { ContextsService } from '../access/contexts.service';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { EventLogRepository, type EventLogRow } from '@giaokhoa/db/repositories/event-log';
import type { ListEventLogsQueryDto } from './dto/event-log.dto';

export const EVENT_LOG_VIEW_CAPABILITY = 'log:view';

export interface EventLogView {
  id: string;
  seq: number;
  eventType: string;
  component: string | null;
  action: string;
  userId: string | null;
  relatedUserId: string | null;
  contextId: string | null;
  courseId: string | null;
  objectId: string | null;
  ip: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

function payloadString(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

@Injectable()
export class EventLogService {
  constructor(
    private readonly repo: EventLogRepository,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
  ) {}

  async listLogs(actorId: string, query: ListEventLogsQueryDto): Promise<{ items: EventLogView[]; total: number; page: number; pageSize: number }> {
    if (query.courseId) {
      const courseContext = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSE, query.courseId);
      if (!courseContext) throw new NotFoundException({ message: `No context for course ${query.courseId}`, code: 'event_log.course_context_missing' });
      await this.evaluator.requireCapability(actorId, EVENT_LOG_VIEW_CAPABILITY, courseContext.id);
    } else {
      const system = await this.contexts.ensureSystemContext();
      await this.evaluator.requireCapability(actorId, EVENT_LOG_VIEW_CAPABILITY, system.id);
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const { rows, total } = await this.repo.search(
      {
        userId: query.userId, relatedUserId: query.relatedUserId, courseId: query.courseId,
        contextId: query.contextId, component: query.component, eventType: query.eventType,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
      page,
      pageSize,
    );
    return { items: rows.map((row) => this.toView(row)), total, page, pageSize };
  }

  private toView(row: EventLogRow): EventLogView {
    const payload = (row.payload ?? null) as Record<string, unknown> | null;
    return {
      id: row.id,
      seq: Number(row.seq),
      eventType: row.eventType,
      component: payloadString(payload, 'component'),
      action: row.eventType,
      userId: row.userId,
      relatedUserId: payloadString(payload, 'relatedUserId'),
      contextId: row.contextId,
      courseId: payloadString(payload, 'courseId'),
      objectId: payloadString(payload, 'objectId'),
      ip: payloadString(payload, 'ip'),
      payload,
      createdAt: row.createdAt,
    };
  }
}
