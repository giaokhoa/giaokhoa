import { Injectable, Logger } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { sql, type CentreDB } from '@giaokhoa/db';
import { SpaceDatabaseService } from './db/routing/space-database.service';

export interface OutboxRowLike {
  id: string;
  seq: number;
  aggregate: string;
  type: string;
  occurredAt: Date;
  tenantId: string | null;
  payload: Record<string, unknown> | null;
}

const COURSE_CONTEXT_LEVEL = 50;

const OBJECT_ID_KEYS: Record<string, string[]> = {
  course: ['courseId'],
  course_category: ['categoryId'],
  course_module: ['cmId'],
  enrol: ['enrolmentId', 'instanceId'],
  grades: ['itemId', 'gradeId'],
  question: ['questionId', 'usageId'],
  stimulus: ['stimulusId'],
  user: ['userId'],
  auth: ['userId'],
  access: ['assignmentId'],
  badges: ['badgeId', 'issuedId'],
  group: ['groupId'],
  grouping: ['groupingId'],
  cohort: ['cohortId'],
  calendar: ['eventId'],
  completion: ['cmId', 'courseId'],
  competency: ['competencyId'],
  messaging: ['conversationId', 'messageId'],
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

@Injectable()
export class EventLogWriter {
  private readonly logger = new Logger(EventLogWriter.name);

  constructor(private readonly spaceDb: SpaceDatabaseService) {}

  async record(row: OutboxRowLike): Promise<void> {
    try {
      const source = (row.payload ?? {}) as Record<string, unknown>;
      const actorId = str(source.actorId);
      const payloadUserId = str(source.userId);
      const relatedUserId = str(source.relatedUserId)
        ?? (payloadUserId && payloadUserId !== actorId ? payloadUserId : null);
      const courseId = str(source.courseId);
      let contextId = str(source.contextId);
      if (!contextId && courseId) contextId = await this.courseContextId(courseId);
      const objectId = this.objectIdOf(row.aggregate, source);
      const sourceComponent = str(source.component);
      const payload: Record<string, unknown> = {
        ...source,
        ...(sourceComponent ? { sourceComponent } : {}),
        component: row.aggregate,
        action: row.type,
        actorId,
        relatedUserId,
        courseId,
        objectId,
        ip: str(source.ip),
        outboxId: row.id,
        outboxSeq: row.seq,
      };
      await this.spaceDb.routedKysely
        .insertInto('event_log')
        .values({
          event_type: row.type,
          context_id: contextId,
          user_id: actorId,
          tenant_id: row.tenantId ?? str(source.tenantId),
          payload: sql<CentreDB['event_log']['payload']>`${JSON.stringify(payload)}::jsonb`,
          created_at: row.occurredAt,
        })
        .execute();
    } catch (err) {
      this.logger.error(`Failed to mirror outbox event ${row.type} (${row.id}) into event_log: ${String(err)}`);
    }
  }

  private objectIdOf(aggregate: string, payload: Record<string, unknown>): string | null {
    const keys = OBJECT_ID_KEYS[aggregate] ?? ['objectId'];
    for (const key of keys) {
      const value = str(payload[key]);
      if (value) return value;
    }
    return str(payload.objectId);
  }

  private async courseContextId(courseId: string): Promise<string | null> {
    if (!uuidIdSchema.safeParse(courseId).success) return null;
    const row = await this.spaceDb.routedKysely
      .selectFrom('context')
      .select('id')
      .where('context_level', '=', COURSE_CONTEXT_LEVEL)
      .where('instance_id', '=', courseId)
      .limit(1)
      .executeTakeFirst();
    return row?.id ?? null;
  }
}
