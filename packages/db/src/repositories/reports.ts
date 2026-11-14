import { sql, type Insertable, type InsertObject, type RawBuilder, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { JsonValue } from '../types/centre-db';
import { applyDefined } from './mapping';

export type ReportsDb = CentreDb | CentreTx;

export interface ReportRow {
  id: string;
  name: string;
  dataSource: string;
  columns: unknown;
  filters: unknown;
  createdBy: string;
  contextId: string | null;
  createdAt: Date;
}

export interface AudienceRow {
  id: string;
  reportId: string;
  userId: string | null;
  role: string | null;
}

export interface ScheduleRow {
  id: string;
  reportId: string;
  createdBy: string;
  cron: string;
  enabled: boolean;
  lastRun: Date | null;
  lastResult: unknown | null;
  createdAt: Date;
}

export interface NewReport {
  id?: string;
  name: string;
  dataSource: string;
  columns?: unknown;
  filters?: unknown;
  createdBy: string;
  contextId?: string | null;
  createdAt?: Date;
}

export interface NewAudience {
  id?: string;
  reportId: string;
  userId?: string | null;
  role?: string | null;
}

export interface NewSchedule {
  id?: string;
  reportId: string;
  createdBy: string;
  cron?: string;
  enabled?: boolean;
  lastRun?: Date | null;
  lastResult?: unknown | null;
  createdAt?: Date;
}

function jsonbValue(value: unknown): RawBuilder<JsonValue> {
  return sql<JsonValue>`${JSON.stringify(value)}::jsonb`;
}

const REPORT_COLUMNS = [
  'id',
  'name',
  'data_source as dataSource',
  'columns',
  'filters',
  'created_by as createdBy',
  'context_id as contextId',
  'created_at as createdAt',
] as const;

const AUDIENCE_COLUMNS = [
  'id',
  'report_id as reportId',
  'user_id as userId',
  'role',
] as const;

const SCHEDULE_COLUMNS = [
  'id',
  'report_id as reportId',
  'created_by as createdBy',
  'cron',
  'enabled',
  'last_run as lastRun',
  'last_result as lastResult',
  'created_at as createdAt',
] as const;

function reportInsertValues(values: NewReport): InsertObject<CentreDB, 'report_builder_report'> {
  const row: InsertObject<CentreDB, 'report_builder_report'> = {
    name: values.name,
    data_source: values.dataSource,
    created_by: values.createdBy,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['columns', 'columns', (value) => jsonbValue(value)],
    ['filters', 'filters', (value) => jsonbValue(value)],
    ['contextId', 'context_id'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function audienceInsertValues(values: NewAudience): Insertable<CentreDB['report_builder_audience']> {
  const row: Insertable<CentreDB['report_builder_audience']> = {
    report_id: values.reportId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['userId', 'user_id'],
    ['role', 'role'],
  ]);
  return row;
}

function scheduleInsertValues(values: NewSchedule): InsertObject<CentreDB, 'report_builder_schedule'> {
  const row: InsertObject<CentreDB, 'report_builder_schedule'> = {
    report_id: values.reportId,
    created_by: values.createdBy,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['cron', 'cron'],
    ['enabled', 'enabled'],
    ['lastRun', 'last_run'],
    ['lastResult', 'last_result', (value) => jsonbValue(value)],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function scheduleUpdateSet(patch: Partial<NewSchedule>): UpdateObject<CentreDB, 'report_builder_schedule'> {
  const set: UpdateObject<CentreDB, 'report_builder_schedule'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['reportId', 'report_id'],
    ['createdBy', 'created_by'],
    ['cron', 'cron'],
    ['enabled', 'enabled'],
    ['lastRun', 'last_run'],
    ['lastResult', 'last_result', (value) => jsonbValue(value)],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

export class ReportsRepository {
  constructor(private readonly handle: CentreDb) {}

  get dbHandle(): CentreDb {
    return this.handle;
  }

  async insertReport(v: NewReport, db: ReportsDb = this.handle): Promise<ReportRow> {
    const rows = await db
      .insertInto('report_builder_report')
      .values(reportInsertValues(v))
      .returning(REPORT_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getReport(id: string, db: ReportsDb = this.handle): Promise<ReportRow | undefined> {
    return db
      .selectFrom('report_builder_report')
      .select(REPORT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listReports(db: ReportsDb = this.handle): Promise<ReportRow[]> {
    return db.selectFrom('report_builder_report').select(REPORT_COLUMNS).execute();
  }

  async insertAudience(v: NewAudience, db: ReportsDb = this.handle): Promise<AudienceRow> {
    const rows = await db
      .insertInto('report_builder_audience')
      .values(audienceInsertValues(v))
      .returning(AUDIENCE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listAudience(reportId: string, db: ReportsDb = this.handle): Promise<AudienceRow[]> {
    return db
      .selectFrom('report_builder_audience')
      .select(AUDIENCE_COLUMNS)
      .where('report_id', '=', reportId)
      .execute();
  }

  async insertSchedule(v: NewSchedule, db: ReportsDb = this.handle): Promise<ScheduleRow> {
    const rows = await db
      .insertInto('report_builder_schedule')
      .values(scheduleInsertValues(v))
      .returning(SCHEDULE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getSchedule(id: string, db: ReportsDb = this.handle): Promise<ScheduleRow | undefined> {
    return db
      .selectFrom('report_builder_schedule')
      .select(SCHEDULE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listSchedules(db: ReportsDb = this.handle): Promise<ScheduleRow[]> {
    return db.selectFrom('report_builder_schedule').select(SCHEDULE_COLUMNS).execute();
  }

  async updateSchedule(id: string, v: Partial<NewSchedule>, db: ReportsDb = this.handle): Promise<void> {
    await db
      .updateTable('report_builder_schedule')
      .set(scheduleUpdateSet(v))
      .where('id', '=', id)
      .execute();
  }

  async userHasAnyRole(userId: string, roleNames: string[], db: ReportsDb = this.handle): Promise<boolean> {
    if (!roleNames.length) return false;
    const fragments = roleNames.map((name) => sql`${name}`);
    const result = await sql<{ ok: number }>`
      select 1 as ok from role_assignments ra join role r on r.id = ra.role_id
      where ra.user_id = ${userId} and r.short_name in (${sql.join(fragments, sql`, `)}) limit 1`
      .execute(db);
    return result.rows.length > 0;
  }
}
