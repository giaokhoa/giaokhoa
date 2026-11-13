import type { Insertable, Updateable } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';

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
  if (values.id !== undefined) row.id = values.id;
  if (values.description !== undefined) row.description = values.description;
  if (values.eventType !== undefined) row.event_type = values.eventType;
  if (values.courseId !== undefined) row.course_id = values.courseId;
  if (values.groupId !== undefined) row.group_id = values.groupId;
  if (values.categoryId !== undefined) row.category_id = values.categoryId;
  if (values.userId !== undefined) row.user_id = values.userId;
  if (values.contextId !== undefined) row.context_id = values.contextId;
  if (values.subscriptionId !== undefined) row.subscription_id = values.subscriptionId;
  if (values.uuid !== undefined) row.uuid = values.uuid;
  if (values.repeatId !== undefined) row.repeat_id = values.repeatId;
  if (values.rrule !== undefined) row.rrule = values.rrule;
  if (values.isException !== undefined) row.is_exception = values.isException;
  if (values.exceptionOf !== undefined) row.exception_of = values.exceptionOf;
  if (values.timeDuration !== undefined) row.time_duration = values.timeDuration;
  if (values.visible !== undefined) row.visible = values.visible;
  if (values.location !== undefined) row.location = values.location;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function calendarEventUpdateSet(patch: Partial<CalendarEventRow>): Updateable<CentreDB['calendar_events']> {
  const set: Updateable<CentreDB['calendar_events']> = {};
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.eventType !== undefined) set.event_type = patch.eventType;
  if (patch.courseId !== undefined) set.course_id = patch.courseId;
  if (patch.groupId !== undefined) set.group_id = patch.groupId;
  if (patch.categoryId !== undefined) set.category_id = patch.categoryId;
  if (patch.userId !== undefined) set.user_id = patch.userId;
  if (patch.contextId !== undefined) set.context_id = patch.contextId;
  if (patch.subscriptionId !== undefined) set.subscription_id = patch.subscriptionId;
  if (patch.uuid !== undefined) set.uuid = patch.uuid;
  if (patch.repeatId !== undefined) set.repeat_id = patch.repeatId;
  if (patch.rrule !== undefined) set.rrule = patch.rrule;
  if (patch.isException !== undefined) set.is_exception = patch.isException;
  if (patch.exceptionOf !== undefined) set.exception_of = patch.exceptionOf;
  if (patch.timeStart !== undefined) set.time_start = patch.timeStart;
  if (patch.timeDuration !== undefined) set.time_duration = patch.timeDuration;
  if (patch.visible !== undefined) set.visible = patch.visible;
  if (patch.location !== undefined) set.location = patch.location;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  return set;
}

function calendarSubscriptionInsertValues(
  values: NewCalendarSubscription,
): Insertable<CentreDB['calendar_subscriptions']> {
  const row: Insertable<CentreDB['calendar_subscriptions']> = { name: values.name };
  if (values.id !== undefined) row.id = values.id;
  if (values.url !== undefined) row.url = values.url;
  if (values.icsData !== undefined) row.ics_data = values.icsData;
  if (values.eventType !== undefined) row.event_type = values.eventType;
  if (values.courseId !== undefined) row.course_id = values.courseId;
  if (values.categoryId !== undefined) row.category_id = values.categoryId;
  if (values.userId !== undefined) row.user_id = values.userId;
  if (values.pollInterval !== undefined) row.poll_interval = values.pollInterval;
  if (values.lastUpdated !== undefined) row.last_updated = values.lastUpdated;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
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
