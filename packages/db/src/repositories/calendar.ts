import type { Insertable, Updateable } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import { applyDefined } from './mapping';

type RepoDb = CentreDb | CentreTx;

export interface CalendarEventRow {
  id: string;
  name: string;
  description: string;
  eventType: string;
  courseId: string | null;
  groupId: string | null;
  categoryId: string | null;
  userId: string | null;
  contextId: string | null;
  subscriptionId: string | null;
  uuid: string | null;
  repeatId: string | null;
  rrule: string | null;
  isException: boolean;
  exceptionOf: string | null;
  timeStart: Date;
  timeDuration: number;
  visible: boolean;
  location: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCalendarEvent {
  id?: string;
  name: string;
  description?: string;
  eventType?: string;
  courseId?: string | null;
  groupId?: string | null;
  categoryId?: string | null;
  userId?: string | null;
  contextId?: string | null;
  subscriptionId?: string | null;
  uuid?: string | null;
  repeatId?: string | null;
  rrule?: string | null;
  isException?: boolean;
  exceptionOf?: string | null;
  timeStart: Date;
  timeDuration?: number;
  visible?: boolean;
  location?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CalendarSubscriptionRow {
  id: string;
  name: string;
  url: string | null;
  icsData: string | null;
  eventType: string;
  courseId: string | null;
  categoryId: string | null;
  userId: string | null;
  pollInterval: number;
  lastUpdated: Date | null;
  createdAt: Date;
}

export interface NewCalendarSubscription {
  id?: string;
  name: string;
  url?: string | null;
  icsData?: string | null;
  eventType?: string;
  courseId?: string | null;
  categoryId?: string | null;
  userId?: string | null;
  pollInterval?: number;
  lastUpdated?: Date | null;
  createdAt?: Date;
}

export interface CalendarExportTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  lastAccess: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CALENDAR_EVENT_COLUMNS = [
  'id',
  'name',
  'description',
  'event_type as eventType',
  'course_id as courseId',
  'group_id as groupId',
  'category_id as categoryId',
  'user_id as userId',
  'context_id as contextId',
  'subscription_id as subscriptionId',
  'uuid',
  'repeat_id as repeatId',
  'rrule',
  'is_exception as isException',
  'exception_of as exceptionOf',
  'time_start as timeStart',
  'time_duration as timeDuration',
  'visible',
  'location',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const CALENDAR_SUBSCRIPTION_COLUMNS = [
  'id',
  'name',
  'url',
  'ics_data as icsData',
  'event_type as eventType',
  'course_id as courseId',
  'category_id as categoryId',
  'user_id as userId',
  'poll_interval as pollInterval',
  'last_updated as lastUpdated',
  'created_at as createdAt',
] as const;

const CALENDAR_EXPORT_TOKEN_COLUMNS = [
  'id',
  'user_id as userId',
  'token_hash as tokenHash',
  'last_access as lastAccess',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

function calendarEventInsertValues(values: NewCalendarEvent): Insertable<CentreDB['calendar_events']> {
  const row: Insertable<CentreDB['calendar_events']> = {
    name: values.name,
    time_start: values.timeStart,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['description', 'description'],
    ['eventType', 'event_type'],
    ['courseId', 'course_id'],
    ['groupId', 'group_id'],
    ['categoryId', 'category_id'],
    ['userId', 'user_id'],
    ['contextId', 'context_id'],
    ['subscriptionId', 'subscription_id'],
    ['uuid', 'uuid'],
    ['repeatId', 'repeat_id'],
    ['rrule', 'rrule'],
    ['isException', 'is_exception'],
    ['exceptionOf', 'exception_of'],
    ['timeDuration', 'time_duration'],
    ['visible', 'visible'],
    ['location', 'location'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function calendarEventUpdateSet(patch: Partial<CalendarEventRow>): Updateable<CentreDB['calendar_events']> {
  const set: Updateable<CentreDB['calendar_events']> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['name', 'name'],
    ['description', 'description'],
    ['eventType', 'event_type'],
    ['courseId', 'course_id'],
    ['groupId', 'group_id'],
    ['categoryId', 'category_id'],
    ['userId', 'user_id'],
    ['contextId', 'context_id'],
    ['subscriptionId', 'subscription_id'],
    ['uuid', 'uuid'],
    ['repeatId', 'repeat_id'],
    ['rrule', 'rrule'],
    ['isException', 'is_exception'],
    ['exceptionOf', 'exception_of'],
    ['timeStart', 'time_start'],
    ['timeDuration', 'time_duration'],
    ['visible', 'visible'],
    ['location', 'location'],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

function calendarSubscriptionInsertValues(
  values: NewCalendarSubscription,
): Insertable<CentreDB['calendar_subscriptions']> {
  const row: Insertable<CentreDB['calendar_subscriptions']> = { name: values.name };
  applyDefined(row, values, [
    ['id', 'id'],
    ['url', 'url'],
    ['icsData', 'ics_data'],
    ['eventType', 'event_type'],
    ['courseId', 'course_id'],
    ['categoryId', 'category_id'],
    ['userId', 'user_id'],
    ['pollInterval', 'poll_interval'],
    ['lastUpdated', 'last_updated'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

export class CalendarRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CentreDb {
    return this.handle;
  }

  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async insertEvent(values: NewCalendarEvent, db: RepoDb = this.db()): Promise<CalendarEventRow> {
    const rows = await db
      .insertInto('calendar_events')
      .values(calendarEventInsertValues(values))
      .returning(CALENDAR_EVENT_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getEvent(id: string, db: RepoDb = this.db()): Promise<CalendarEventRow | undefined> {
    return db
      .selectFrom('calendar_events')
      .select(CALENDAR_EVENT_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
  }

  async updateEvent(id: string, patch: Partial<CalendarEventRow>, db: RepoDb = this.db()): Promise<void> {
    await db
      .updateTable('calendar_events')
      .set({ ...calendarEventUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteEvent(id: string, db: RepoDb = this.db()): Promise<void> {
    await db.deleteFrom('calendar_events').where('id', '=', id).execute();
  }

  async listAllEvents(db: RepoDb = this.db()): Promise<CalendarEventRow[]> {
    return db.selectFrom('calendar_events').select(CALENDAR_EVENT_COLUMNS).orderBy('time_start', 'asc').execute();
  }

  async listEventsInRange(from: Date, to: Date, db: RepoDb = this.db()): Promise<CalendarEventRow[]> {
    return db
      .selectFrom('calendar_events')
      .select(CALENDAR_EVENT_COLUMNS)
      .where('time_start', '>=', from)
      .where('time_start', '<=', to)
      .orderBy('time_start', 'asc')
      .execute();
  }

  async listSeries(repeatId: string, db: RepoDb = this.db()): Promise<CalendarEventRow[]> {
    return db
      .selectFrom('calendar_events')
      .select(CALENDAR_EVENT_COLUMNS)
      .where('repeat_id', '=', repeatId)
      .orderBy('time_start', 'asc')
      .execute();
  }

  async findBySubscriptionUuid(
    subscriptionId: string,
    uuid: string,
    db: RepoDb = this.db(),
  ): Promise<CalendarEventRow | undefined> {
    return db
      .selectFrom('calendar_events')
      .select(CALENDAR_EVENT_COLUMNS)
      .where('subscription_id', '=', subscriptionId)
      .where('uuid', '=', uuid)
      .limit(1)
      .executeTakeFirst();
  }

  async insertSubscription(
    values: NewCalendarSubscription,
    db: RepoDb = this.db(),
  ): Promise<CalendarSubscriptionRow> {
    const rows = await db
      .insertInto('calendar_subscriptions')
      .values(calendarSubscriptionInsertValues(values))
      .returning(CALENDAR_SUBSCRIPTION_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getSubscription(id: string, db: RepoDb = this.db()): Promise<CalendarSubscriptionRow | undefined> {
    return db
      .selectFrom('calendar_subscriptions')
      .select(CALENDAR_SUBSCRIPTION_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
  }

  async listSubscriptions(db: RepoDb = this.db()): Promise<CalendarSubscriptionRow[]> {
    return db
      .selectFrom('calendar_subscriptions')
      .select(CALENDAR_SUBSCRIPTION_COLUMNS)
      .orderBy('id', 'asc')
      .execute();
  }

  async listSubscriptionsForUser(userId: string, db: RepoDb = this.db()): Promise<CalendarSubscriptionRow[]> {
    return db
      .selectFrom('calendar_subscriptions')
      .select(CALENDAR_SUBSCRIPTION_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute();
  }

  async getExportTokenByUser(userId: string, db: RepoDb = this.db()): Promise<CalendarExportTokenRow | undefined> {
    return db
      .selectFrom('calendar_export_tokens')
      .select(CALENDAR_EXPORT_TOKEN_COLUMNS)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
  }

  async getExportTokenByHash(tokenHash: string, db: RepoDb = this.db()): Promise<CalendarExportTokenRow | undefined> {
    return db
      .selectFrom('calendar_export_tokens')
      .select(CALENDAR_EXPORT_TOKEN_COLUMNS)
      .where('token_hash', '=', tokenHash)
      .limit(1)
      .executeTakeFirst();
  }

  async upsertExportToken(userId: string, tokenHash: string, db: RepoDb = this.db()): Promise<CalendarExportTokenRow> {
    const rows = await db
      .insertInto('calendar_export_tokens')
      .values({ user_id: userId, token_hash: tokenHash })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet({ token_hash: tokenHash, updated_at: new Date(), last_access: null }),
      )
      .returning(CALENDAR_EXPORT_TOKEN_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async deleteExportToken(userId: string, db: RepoDb = this.db()): Promise<boolean> {
    const deleted = await db
      .deleteFrom('calendar_export_tokens')
      .where('user_id', '=', userId)
      .returning(CALENDAR_EXPORT_TOKEN_COLUMNS)
      .execute();
    return deleted.length > 0;
  }

  async touchExportToken(id: string, db: RepoDb = this.db()): Promise<void> {
    await db
      .updateTable('calendar_export_tokens')
      .set({ last_access: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async touchSubscription(id: string, db: RepoDb = this.db()): Promise<void> {
    await db
      .updateTable('calendar_subscriptions')
      .set({ last_updated: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
