import { sql, type Insertable, type InsertObject, type RawBuilder, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { JsonValue } from '../types/centre-db';
import { applyDefined } from './mapping';

export type IntegrationsDb = CentreDb | CentreTx;

export interface ServiceRow {
  id: string;
  name: string;
  shortName: string;
  enabled: boolean;
  functions: unknown;
  createdAt: Date;
}

export interface TokenRow {
  id: string;
  tokenHash: string;
  userId: string;
  serviceId: string;
  validUntil: Date | null;
  ipRestriction: string | null;
  revoked: boolean;
  lastAccess: Date | null;
  createdAt: Date;
}

export interface TokenOwnerState { suspended: boolean; deleted: boolean }

export interface NewService {
  id?: string;
  name: string;
  shortName: string;
  enabled?: boolean;
  functions?: unknown;
  createdAt?: Date;
}

export interface NewToken {
  id?: string;
  tokenHash: string;
  userId: string;
  serviceId: string;
  validUntil?: Date | null;
  ipRestriction?: string | null;
  revoked?: boolean;
  lastAccess?: Date | null;
  createdAt?: Date;
}

function jsonbValue(value: unknown): RawBuilder<JsonValue> {
  return sql<JsonValue>`${JSON.stringify(value)}::jsonb`;
}

const SERVICE_COLUMNS = [
  'id',
  'name',
  'short_name as shortName',
  'enabled',
  'functions',
  'created_at as createdAt',
] as const;

const TOKEN_COLUMNS = [
  'id',
  'token_hash as tokenHash',
  'user_id as userId',
  'service_id as serviceId',
  'valid_until as validUntil',
  'ip_restriction as ipRestriction',
  'revoked',
  'last_access as lastAccess',
  'created_at as createdAt',
] as const;

function serviceInsertValues(values: NewService): InsertObject<CentreDB, 'external_services'> {
  const row: InsertObject<CentreDB, 'external_services'> = {
    name: values.name,
    short_name: values.shortName,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['enabled', 'enabled'],
    ['functions', 'functions', (value) => jsonbValue(value)],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function serviceUpdateSet(patch: Partial<NewService>): UpdateObject<CentreDB, 'external_services'> {
  const set: UpdateObject<CentreDB, 'external_services'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['name', 'name'],
    ['shortName', 'short_name'],
    ['enabled', 'enabled'],
    ['functions', 'functions', (value) => jsonbValue(value)],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

function tokenInsertValues(values: NewToken): Insertable<CentreDB['external_tokens']> {
  const row: Insertable<CentreDB['external_tokens']> = {
    token_hash: values.tokenHash,
    user_id: values.userId,
    service_id: values.serviceId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['validUntil', 'valid_until'],
    ['ipRestriction', 'ip_restriction'],
    ['revoked', 'revoked'],
    ['lastAccess', 'last_access'],
    ['createdAt', 'created_at'],
  ]);
  return row;
}

function tokenUpdateSet(patch: Partial<NewToken>): UpdateObject<CentreDB, 'external_tokens'> {
  const set: UpdateObject<CentreDB, 'external_tokens'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['tokenHash', 'token_hash'],
    ['userId', 'user_id'],
    ['serviceId', 'service_id'],
    ['validUntil', 'valid_until'],
    ['ipRestriction', 'ip_restriction'],
    ['revoked', 'revoked'],
    ['lastAccess', 'last_access'],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

export class IntegrationsRepository {
  constructor(private readonly handle: CentreDb) {}

  get dbHandle(): CentreDb {
    return this.handle;
  }

  async insertService(v: NewService, db: IntegrationsDb = this.handle): Promise<ServiceRow> {
    const rows = await db
      .insertInto('external_services')
      .values(serviceInsertValues(v))
      .returning(SERVICE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getService(id: string, db: IntegrationsDb = this.handle): Promise<ServiceRow | undefined> {
    return db
      .selectFrom('external_services')
      .select(SERVICE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listServices(db: IntegrationsDb = this.handle): Promise<ServiceRow[]> {
    return db.selectFrom('external_services').select(SERVICE_COLUMNS).execute();
  }

  async updateService(id: string, v: Partial<NewService>, db: IntegrationsDb = this.handle): Promise<void> {
    await db
      .updateTable('external_services')
      .set(serviceUpdateSet(v))
      .where('id', '=', id)
      .execute();
  }

  async insertToken(v: NewToken, db: IntegrationsDb = this.handle): Promise<TokenRow> {
    const rows = await db
      .insertInto('external_tokens')
      .values(tokenInsertValues(v))
      .returning(TOKEN_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getTokenByHash(tokenHash: string, db: IntegrationsDb = this.handle): Promise<TokenRow | undefined> {
    return db
      .selectFrom('external_tokens')
      .select(TOKEN_COLUMNS)
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
  }

  async getToken(id: string, db: IntegrationsDb = this.handle): Promise<TokenRow | undefined> {
    return db
      .selectFrom('external_tokens')
      .select(TOKEN_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listTokens(db: IntegrationsDb = this.handle): Promise<TokenRow[]> {
    return db.selectFrom('external_tokens').select(TOKEN_COLUMNS).execute();
  }

  async updateToken(id: string, v: Partial<NewToken>, db: IntegrationsDb = this.handle): Promise<void> {
    await db
      .updateTable('external_tokens')
      .set(tokenUpdateSet(v))
      .where('id', '=', id)
      .execute();
  }

  async getTokenOwnerState(userId: string, db: IntegrationsDb = this.handle): Promise<TokenOwnerState | undefined> {
    return db
      .selectFrom('users')
      .select(['suspended', 'deleted'])
      .where('id', '=', userId)
      .executeTakeFirst();
  }
}
