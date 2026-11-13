import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';

export type EventLogDb = CentreDb | CentreTx;

export interface EventLogRow {
  id: string;
  seq: string;
  eventType: string;
  contextId: string | null;
  userId: string | null;
  tenantId: string | null;
  payload: unknown | null;
  createdAt: Date;
}

export interface EventLogFilters {
  userId?: string;
  relatedUserId?: string;
  courseId?: string;
  contextId?: string;
  component?: string;
  eventType?: string;
  from?: Date;
  to?: Date;
}

const EVENT_LOG_COLUMNS = [
  'id',
  'seq',
  'event_type as eventType',
  'context_id as contextId',
  'user_id as userId',
  'tenant_id as tenantId',
  'payload',
  'created_at as createdAt',
] as const;

function eventLogConditions(
  eb: ExpressionBuilder<CentreDB, 'event_log'>,
  filters: EventLogFilters,
): Expression<SqlBool>[] {
  const conds: Expression<SqlBool>[] = [];
  if (filters.userId) conds.push(eb('user_id', '=', filters.userId));
  if (filters.contextId) conds.push(eb('context_id', '=', filters.contextId));
  if (filters.eventType) conds.push(eb('event_type', '=', filters.eventType));
  if (filters.relatedUserId) conds.push(sql<SqlBool>`payload ->> 'relatedUserId' = ${filters.relatedUserId}`);
  if (filters.courseId) conds.push(sql<SqlBool>`payload ->> 'courseId' = ${filters.courseId}`);
  if (filters.component) conds.push(sql<SqlBool>`payload ->> 'component' = ${filters.component}`);
  if (filters.from) conds.push(eb('created_at', '>=', filters.from));
  if (filters.to) conds.push(eb('created_at', '<=', filters.to));
  return conds;
}

export class EventLogRepository {
  constructor(private readonly handle: CentreDb) {}

  async search(filters: EventLogFilters, page: number, pageSize: number, db: EventLogDb = this.handle): Promise<{ rows: EventLogRow[]; total: number }> {
    const rows = await db
      .selectFrom('event_log')
      .select(EVENT_LOG_COLUMNS)
      .where((eb) => eb.and(eventLogConditions(eb, filters)))
      .orderBy('seq', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();
    const totalRow = await db
      .selectFrom('event_log')
      .select(sql<number>`count(*)::int`.as('total'))
      .where((eb) => eb.and(eventLogConditions(eb, filters)))
      .executeTakeFirst();
    return { rows, total: totalRow?.total ?? 0 };
  }
}
