import { sql, type Insertable, type InsertObject, type RawBuilder, type Updateable } from 'kysely';
import type { ControlPlaneDb, ControlPlaneTx, ControlPlaneDB } from '../client';
import type { SchemaMigrationStep, SpaceRegistrySnapshot } from '../jsonb-types';
import { applyDefined } from './mapping';

export type CpTx = ControlPlaneTx;
export type CpDb = ControlPlaneDb | ControlPlaneTx;

export interface SpaceRegistryRow {
  id: string;
  slug: string;
  name: string;
  kind: string;
  status: string;
  databaseName: string;
  storageMode: string;
  connectionRoleRef: string;
  secretRef: string | null;
  schemaVersion: string | null;
  plan: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceRegistryHistoryRow {
  id: string;
  spaceId: string;
  actorId: string;
  action: string;
  before: SpaceRegistrySnapshot | null;
  after: SpaceRegistrySnapshot;
  createdAt: Date;
}

export interface SpaceSchemaRegistryRow {
  spaceId: string;
  currentVersion: string | null;
  lastBackupStatus: string | null;
  lastBackupAt: Date | null;
  lastRestoreStatus: string | null;
  lastRestoreAt: Date | null;
  updatedAt: Date;
}

export interface SpaceSchemaMigrationRunRow {
  id: string;
  spaceId: string;
  runId: string;
  fromVersion: string | null;
  toVersion: string | null;
  status: string;
  steps: SchemaMigrationStep[];
  startedAt: Date;
  finishedAt: Date | null;
}

export interface NewSpaceRegistration {
  id?: string;
  slug: string;
  name: string;
  kind: string;
  status?: string;
  databaseName: string;
  storageMode: string;
  connectionRoleRef: string;
  secretRef?: string | null;
  schemaVersion?: string | null;
  plan?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewSpaceSchemaRegistry {
  spaceId: string;
  currentVersion?: string | null;
  lastBackupStatus?: string | null;
  lastBackupAt?: Date | null;
  lastRestoreStatus?: string | null;
  lastRestoreAt?: Date | null;
  updatedAt?: Date;
}

export interface NewSchemaMigrationRun {
  id?: string;
  spaceId: string;
  runId: string;
  fromVersion?: string | null;
  toVersion?: string | null;
  status: string;
  steps?: SchemaMigrationStep[];
  startedAt?: Date;
  finishedAt?: Date | null;
}

export class ControlPlaneNotConfiguredError extends Error {
  readonly code = 'control_plane.not_configured';

  constructor() {
    super('Control plane database is not configured');
    this.name = 'ControlPlaneNotConfiguredError';
  }
}

export const DEDICATED_DATABASE_NAME_UNIQUE_INDEX = 'space_registry_database_name_dedicated_unique';

function jsonbValue<T>(value: T): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

export function isDedicatedDatabaseNameConflict(err: unknown): boolean {
  let e: unknown = err;
  while (e !== null && typeof e === 'object') {
    const candidate = e as { code?: unknown; constraint?: unknown; message?: unknown };
    if (candidate.code === '23505'
      && (candidate.constraint === DEDICATED_DATABASE_NAME_UNIQUE_INDEX
        || (typeof candidate.message === 'string' && candidate.message.includes(DEDICATED_DATABASE_NAME_UNIQUE_INDEX)))) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

const SPACE_REGISTRY_COLUMNS = [
  'id',
  'slug',
  'name',
  'kind',
  'status',
  'database_name as databaseName',
  'storage_mode as storageMode',
  'connection_role_ref as connectionRoleRef',
  'secret_ref as secretRef',
  'schema_version as schemaVersion',
  'plan',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const SPACE_REGISTRY_HISTORY_COLUMNS = [
  'id',
  'space_id as spaceId',
  'actor_id as actorId',
  'action',
  'before',
  'after',
  'created_at as createdAt',
] as const;

const SPACE_SCHEMA_REGISTRY_COLUMNS = [
  'space_id as spaceId',
  'current_version as currentVersion',
  'last_backup_status as lastBackupStatus',
  'last_backup_at as lastBackupAt',
  'last_restore_status as lastRestoreStatus',
  'last_restore_at as lastRestoreAt',
  'updated_at as updatedAt',
] as const;

const SPACE_SCHEMA_MIGRATION_RUN_COLUMNS = [
  'id',
  'space_id as spaceId',
  'run_id as runId',
  'from_version as fromVersion',
  'to_version as toVersion',
  'status',
  'steps',
  'started_at as startedAt',
  'finished_at as finishedAt',
] as const;

function spaceRegistryInsertValues(values: NewSpaceRegistration): Insertable<ControlPlaneDB['space_registry']> {
  const row: Insertable<ControlPlaneDB['space_registry']> = {
    slug: values.slug,
    name: values.name,
    kind: values.kind,
    database_name: values.databaseName,
    storage_mode: values.storageMode,
    connection_role_ref: values.connectionRoleRef,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['status', 'status'],
    ['secretRef', 'secret_ref'],
    ['schemaVersion', 'schema_version'],
    ['plan', 'plan'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function spaceRegistryUpdateSet(patch: Partial<NewSpaceRegistration>): Updateable<ControlPlaneDB['space_registry']> {
  const set: Updateable<ControlPlaneDB['space_registry']> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['slug', 'slug'],
    ['name', 'name'],
    ['kind', 'kind'],
    ['status', 'status'],
    ['databaseName', 'database_name'],
    ['storageMode', 'storage_mode'],
    ['connectionRoleRef', 'connection_role_ref'],
    ['secretRef', 'secret_ref'],
    ['schemaVersion', 'schema_version'],
    ['plan', 'plan'],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

export class ControlPlaneRepository {
  constructor(
    private readonly handle: ControlPlaneDb | null,
    private readonly notConfiguredError: () => Error = () => new ControlPlaneNotConfiguredError(),
  ) {}

  private db(): ControlPlaneDb {
    if (!this.handle) {
      throw this.notConfiguredError();
    }
    return this.handle;
  }

  async transaction<T>(fn: (tx: CpTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async insertSpaceIfAbsent(values: NewSpaceRegistration, db: CpDb = this.db()): Promise<SpaceRegistryRow | undefined> {
    const rows = await db
      .insertInto('space_registry')
      .values(spaceRegistryInsertValues(values))
      .onConflict((oc) => oc.column('slug').doNothing())
      .returning(SPACE_REGISTRY_COLUMNS)
      .execute();
    return rows[0];
  }

  async updateSpace(id: string, patch: Partial<NewSpaceRegistration>, db: CpDb = this.db()): Promise<SpaceRegistryRow> {
    const rows = await db
      .updateTable('space_registry')
      .set({ ...spaceRegistryUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .returning(SPACE_REGISTRY_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async findSpaceById(id: string, db: CpDb = this.db()): Promise<SpaceRegistryRow | undefined> {
    return db.selectFrom('space_registry').select(SPACE_REGISTRY_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async findSpaceByIdForUpdate(id: string, db: CpDb): Promise<SpaceRegistryRow | undefined> {
    return db
      .selectFrom('space_registry')
      .select(SPACE_REGISTRY_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .forUpdate()
      .executeTakeFirst();
  }

  async findSpaceBySlug(slug: string, db: CpDb = this.db()): Promise<SpaceRegistryRow | undefined> {
    return db.selectFrom('space_registry').select(SPACE_REGISTRY_COLUMNS).where('slug', '=', slug).limit(1).executeTakeFirst();
  }

  async findSpaceByDatabaseName(databaseName: string, db: CpDb = this.db()): Promise<SpaceRegistryRow | undefined> {
    return db
      .selectFrom('space_registry')
      .select(SPACE_REGISTRY_COLUMNS)
      .where('database_name', '=', databaseName)
      .limit(1)
      .executeTakeFirst();
  }

  async findOtherSpaceByDatabaseName(
    databaseName: string,
    excludeId: string,
    db: CpDb = this.db(),
  ): Promise<SpaceRegistryRow | undefined> {
    return db
      .selectFrom('space_registry')
      .select(SPACE_REGISTRY_COLUMNS)
      .where('database_name', '=', databaseName)
      .where('id', '<>', excludeId)
      .limit(1)
      .executeTakeFirst();
  }

  async listSpaces(db: CpDb = this.db()): Promise<SpaceRegistryRow[]> {
    return db.selectFrom('space_registry').select(SPACE_REGISTRY_COLUMNS).orderBy('slug', 'asc').execute();
  }

  async insertHistory(
    values: { spaceId: string; actorId: string; action: string; before: SpaceRegistrySnapshot | null; after: SpaceRegistrySnapshot },
    db: CpDb = this.db(),
  ): Promise<SpaceRegistryHistoryRow> {
    const rows = await db
      .insertInto('space_registry_history')
      .values({
        space_id: values.spaceId,
        actor_id: values.actorId,
        action: values.action,
        before: values.before === null ? null : jsonbValue(values.before),
        after: jsonbValue(values.after),
        created_at: sql<Date>`clock_timestamp()`,
      })
      .returning(SPACE_REGISTRY_HISTORY_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listHistory(spaceId: string, db: CpDb = this.db()): Promise<SpaceRegistryHistoryRow[]> {
    return db
      .selectFrom('space_registry_history')
      .select(SPACE_REGISTRY_HISTORY_COLUMNS)
      .where('space_id', '=', spaceId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
  }

  async findSchemaRegistry(spaceId: string, db: CpDb = this.db()): Promise<SpaceSchemaRegistryRow | undefined> {
    return db
      .selectFrom('space_schema_registry')
      .select(SPACE_SCHEMA_REGISTRY_COLUMNS)
      .where('space_id', '=', spaceId)
      .limit(1)
      .executeTakeFirst();
  }

  async upsertSchemaRegistry(
    values: NewSpaceSchemaRegistry,
    db: CpDb = this.db(),
  ): Promise<SpaceSchemaRegistryRow> {
    const insert: Insertable<ControlPlaneDB['space_schema_registry']> = { space_id: values.spaceId };
    applyDefined(insert, values, [
      ['currentVersion', 'current_version'],
      ['lastBackupStatus', 'last_backup_status'],
      ['lastBackupAt', 'last_backup_at'],
      ['lastRestoreStatus', 'last_restore_status'],
      ['lastRestoreAt', 'last_restore_at'],
      ['updatedAt', 'updated_at'],
    ]);
    const updateSet: Updateable<ControlPlaneDB['space_schema_registry']> = { updated_at: new Date() };
    applyDefined(updateSet, values, [
      ['currentVersion', 'current_version'],
      ['lastBackupStatus', 'last_backup_status'],
      ['lastBackupAt', 'last_backup_at'],
      ['lastRestoreStatus', 'last_restore_status'],
      ['lastRestoreAt', 'last_restore_at'],
    ]);
    const rows = await db
      .insertInto('space_schema_registry')
      .values(insert)
      .onConflict((oc) => oc.column('space_id').doUpdateSet(updateSet))
      .returning(SPACE_SCHEMA_REGISTRY_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async ensureSchemaRegistry(spaceId: string, currentVersion: string, db: CpDb = this.db()): Promise<void> {
    await db
      .insertInto('space_schema_registry')
      .values({ space_id: spaceId, current_version: currentVersion })
      .onConflict((oc) => oc.column('space_id').doNothing())
      .execute();
  }

  async insertMigrationRun(values: NewSchemaMigrationRun, db: CpDb = this.db()): Promise<SpaceSchemaMigrationRunRow> {
    const insert: InsertObject<ControlPlaneDB, 'space_schema_migration_runs'> = {
      space_id: values.spaceId,
      run_id: values.runId,
      status: values.status,
    };
    applyDefined(insert, values, [
      ['id', 'id'],
      ['fromVersion', 'from_version'],
      ['toVersion', 'to_version'],
      ['steps', 'steps', (value) => jsonbValue(value)],
      ['startedAt', 'started_at'],
      ['finishedAt', 'finished_at'],
    ]);
    const rows = await db
      .insertInto('space_schema_migration_runs')
      .values(insert)
      .returning(SPACE_SCHEMA_MIGRATION_RUN_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listMigrationRuns(spaceId: string, db: CpDb = this.db()): Promise<SpaceSchemaMigrationRunRow[]> {
    return db
      .selectFrom('space_schema_migration_runs')
      .select(SPACE_SCHEMA_MIGRATION_RUN_COLUMNS)
      .where('space_id', '=', spaceId)
      .orderBy('started_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  isConfigured(): boolean {
    return this.handle !== null;
  }
}
