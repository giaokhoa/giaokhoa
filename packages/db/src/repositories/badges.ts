import { sql, type Insertable, type InsertObject, type RawBuilder, type Updateable, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { JsonValue } from '../types/centre-db';
import { applyDefined } from './mapping';

type RepoDb = CentreDb | CentreTx;

export interface BadgeRow {
  id: string;
  name: string;
  description: string;
  type: number;
  courseId: string | null;
  issuerName: string;
  issuerUrl: string;
  issuerContact: string;
  expireDate: Date | null;
  expirePeriod: number | null;
  status: number;
  version: string;
  language: string;
  userCreated: string | null;
  userModified: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewBadge {
  id?: string;
  name: string;
  description?: string;
  type?: number;
  courseId?: string | null;
  issuerName?: string;
  issuerUrl?: string;
  issuerContact?: string;
  expireDate?: Date | null;
  expirePeriod?: number | null;
  status?: number;
  version?: string;
  language?: string;
  userCreated?: string | null;
  userModified?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CriteriaRow {
  id: string;
  badgeId: string;
  criteriaType: string;
  method: number;
  params: unknown;
  description: string;
}

export interface NewCriteria {
  id?: string;
  badgeId: string;
  criteriaType: string;
  method?: number;
  params?: unknown;
  description?: string;
}

export interface IssuedRow {
  id: string;
  badgeId: string;
  userId: string;
  uniqueHash: string;
  snapshot: unknown;
  evidence: unknown;
  dateIssued: Date;
  dateExpire: Date | null;
  visible: boolean;
  revoked: boolean;
  revokedAt: Date | null;
  issuerNotified: boolean;
}

export interface NewIssued {
  id?: string;
  badgeId: string;
  userId: string;
  uniqueHash: string;
  snapshot?: unknown;
  evidence?: unknown;
  dateIssued?: Date;
  dateExpire?: Date | null;
  visible?: boolean;
  revoked?: boolean;
  revokedAt?: Date | null;
  issuerNotified?: boolean;
}

export interface ManualAwardRow {
  id: string;
  badgeId: string;
  recipientId: string;
  issuerId: string;
  issuerRole: string | null;
  dateMet: Date;
}

export interface NewManualAward {
  id?: string;
  badgeId: string;
  recipientId: string;
  issuerId: string;
  issuerRole?: string | null;
  dateMet?: Date;
}

const BADGE_COLUMNS = [
  'id',
  'name',
  'description',
  'type',
  'course_id as courseId',
  'issuer_name as issuerName',
  'issuer_url as issuerUrl',
  'issuer_contact as issuerContact',
  'expire_date as expireDate',
  'expire_period as expirePeriod',
  'status',
  'version',
  'language',
  'user_created as userCreated',
  'user_modified as userModified',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const BADGE_CRITERIA_COLUMNS = [
  'id',
  'badge_id as badgeId',
  'criteria_type as criteriaType',
  'method',
  'params',
  'description',
] as const;

const BADGE_ISSUED_COLUMNS = [
  'id',
  'badge_id as badgeId',
  'user_id as userId',
  'unique_hash as uniqueHash',
  'snapshot',
  'evidence',
  'date_issued as dateIssued',
  'date_expire as dateExpire',
  'visible',
  'revoked',
  'revoked_at as revokedAt',
  'issuer_notified as issuerNotified',
] as const;

const BADGE_MANUAL_AWARD_COLUMNS = [
  'id',
  'badge_id as badgeId',
  'recipient_id as recipientId',
  'issuer_id as issuerId',
  'issuer_role as issuerRole',
  'date_met as dateMet',
] as const;

function jsonbValue(value: unknown): RawBuilder<JsonValue> {
  return sql<JsonValue>`${JSON.stringify(value)}::jsonb`;
}

function badgeInsertValues(values: NewBadge): Insertable<CentreDB['badge']> {
  const row: Insertable<CentreDB['badge']> = { name: values.name };
  applyDefined(row, values, [
    ['id', 'id'],
    ['description', 'description'],
    ['type', 'type'],
    ['courseId', 'course_id'],
    ['issuerName', 'issuer_name'],
    ['issuerUrl', 'issuer_url'],
    ['issuerContact', 'issuer_contact'],
    ['expireDate', 'expire_date'],
    ['expirePeriod', 'expire_period'],
    ['status', 'status'],
    ['version', 'version'],
    ['language', 'language'],
    ['userCreated', 'user_created'],
    ['userModified', 'user_modified'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function badgeUpdateSet(patch: Partial<BadgeRow>): Updateable<CentreDB['badge']> {
  const set: Updateable<CentreDB['badge']> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['name', 'name'],
    ['description', 'description'],
    ['type', 'type'],
    ['courseId', 'course_id'],
    ['issuerName', 'issuer_name'],
    ['issuerUrl', 'issuer_url'],
    ['issuerContact', 'issuer_contact'],
    ['expireDate', 'expire_date'],
    ['expirePeriod', 'expire_period'],
    ['status', 'status'],
    ['version', 'version'],
    ['language', 'language'],
    ['userCreated', 'user_created'],
    ['userModified', 'user_modified'],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

function criteriaInsertValues(values: NewCriteria): InsertObject<CentreDB, 'badge_criteria'> {
  const row: InsertObject<CentreDB, 'badge_criteria'> = {
    badge_id: values.badgeId,
    criteria_type: values.criteriaType,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['method', 'method'],
    ['params', 'params', (value) => jsonbValue(value)],
    ['description', 'description'],
  ]);
  return row;
}

function issuedInsertValues(values: NewIssued): InsertObject<CentreDB, 'badge_issued'> {
  const row: InsertObject<CentreDB, 'badge_issued'> = {
    badge_id: values.badgeId,
    user_id: values.userId,
    unique_hash: values.uniqueHash,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['snapshot', 'snapshot', (value) => jsonbValue(value)],
    ['evidence', 'evidence', (value) => jsonbValue(value)],
    ['dateIssued', 'date_issued'],
    ['dateExpire', 'date_expire'],
    ['visible', 'visible'],
    ['revoked', 'revoked'],
    ['revokedAt', 'revoked_at'],
    ['issuerNotified', 'issuer_notified'],
  ]);
  return row;
}

function issuedUpdateSet(patch: Partial<IssuedRow>): UpdateObject<CentreDB, 'badge_issued'> {
  const set: UpdateObject<CentreDB, 'badge_issued'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['badgeId', 'badge_id'],
    ['userId', 'user_id'],
    ['uniqueHash', 'unique_hash'],
    ['snapshot', 'snapshot', (value) => jsonbValue(value)],
    ['evidence', 'evidence', (value) => jsonbValue(value)],
    ['dateIssued', 'date_issued'],
    ['dateExpire', 'date_expire'],
    ['visible', 'visible'],
    ['revoked', 'revoked'],
    ['revokedAt', 'revoked_at'],
    ['issuerNotified', 'issuer_notified'],
  ]);
  return set;
}

function manualAwardInsertValues(values: NewManualAward): Insertable<CentreDB['badge_manual_award']> {
  const row: Insertable<CentreDB['badge_manual_award']> = {
    badge_id: values.badgeId,
    recipient_id: values.recipientId,
    issuer_id: values.issuerId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['issuerRole', 'issuer_role'],
    ['dateMet', 'date_met'],
  ]);
  return row;
}

export class BadgesRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CentreDb {
    return this.handle;
  }

  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async insertBadge(values: NewBadge, db: RepoDb = this.db()): Promise<BadgeRow> {
    const rows = await db.insertInto('badge').values(badgeInsertValues(values)).returning(BADGE_COLUMNS).execute();
    return rows[0]!;
  }

  async getBadge(id: string, db: RepoDb = this.db()): Promise<BadgeRow | undefined> {
    return db.selectFrom('badge').select(BADGE_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async listBadges(db: RepoDb = this.db()): Promise<BadgeRow[]> {
    return db.selectFrom('badge').select(BADGE_COLUMNS).orderBy('id', 'asc').execute();
  }

  async updateBadge(id: string, patch: Partial<BadgeRow>, db: RepoDb = this.db()): Promise<void> {
    await db
      .updateTable('badge')
      .set({ ...badgeUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async insertCriteria(values: NewCriteria, db: RepoDb = this.db()): Promise<CriteriaRow> {
    const rows = await db
      .insertInto('badge_criteria')
      .values(criteriaInsertValues(values))
      .returning(BADGE_CRITERIA_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listCriteria(badgeId: string, db: RepoDb = this.db()): Promise<CriteriaRow[]> {
    return db
      .selectFrom('badge_criteria')
      .select(BADGE_CRITERIA_COLUMNS)
      .where('badge_id', '=', badgeId)
      .orderBy('id', 'asc')
      .execute();
  }

  async deleteCriteria(badgeId: string, db: RepoDb = this.db()): Promise<void> {
    await db.deleteFrom('badge_criteria').where('badge_id', '=', badgeId).execute();
  }

  async insertIssued(values: NewIssued, db: RepoDb = this.db()): Promise<IssuedRow> {
    const rows = await db
      .insertInto('badge_issued')
      .values(issuedInsertValues(values))
      .onConflict((oc) => oc.columns(['badge_id', 'user_id']).doNothing())
      .returning(BADGE_ISSUED_COLUMNS)
      .execute();
    if (rows[0]) return rows[0];
    const existing = await this.db()
      .selectFrom('badge_issued')
      .select(BADGE_ISSUED_COLUMNS)
      .where('badge_id', '=', values.badgeId)
      .where('user_id', '=', values.userId)
      .limit(1)
      .executeTakeFirst();
    return existing!;
  }

  async getIssued(id: string, db: RepoDb = this.db()): Promise<IssuedRow | undefined> {
    return db.selectFrom('badge_issued').select(BADGE_ISSUED_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async findIssued(badgeId: string, userId: string, db: RepoDb = this.db()): Promise<IssuedRow | undefined> {
    return db
      .selectFrom('badge_issued')
      .select(BADGE_ISSUED_COLUMNS)
      .where('badge_id', '=', badgeId)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
  }

  async listIssuedForBadge(badgeId: string, db: RepoDb = this.db()): Promise<IssuedRow[]> {
    return db
      .selectFrom('badge_issued')
      .select(BADGE_ISSUED_COLUMNS)
      .where('badge_id', '=', badgeId)
      .orderBy('id', 'asc')
      .execute();
  }

  async listIssuedForUser(userId: string, db: RepoDb = this.db()): Promise<IssuedRow[]> {
    return db
      .selectFrom('badge_issued')
      .select(BADGE_ISSUED_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute();
  }

  async countIssued(badgeId: string, db: RepoDb = this.db()): Promise<number> {
    const rows = await db
      .selectFrom('badge_issued')
      .select(BADGE_ISSUED_COLUMNS)
      .where('badge_id', '=', badgeId)
      .execute();
    return rows.length;
  }

  async updateIssued(id: string, patch: Partial<IssuedRow>, db: RepoDb = this.db()): Promise<void> {
    await db.updateTable('badge_issued').set(issuedUpdateSet(patch)).where('id', '=', id).execute();
  }

  async insertManualAward(values: NewManualAward, db: RepoDb = this.db()): Promise<ManualAwardRow> {
    const rows = await db
      .insertInto('badge_manual_award')
      .values(manualAwardInsertValues(values))
      .onConflict((oc) => oc.columns(['badge_id', 'recipient_id', 'issuer_id']).doNothing())
      .returning(BADGE_MANUAL_AWARD_COLUMNS)
      .execute();
    if (rows[0]) return rows[0];
    const existing = await this.db()
      .selectFrom('badge_manual_award')
      .select(BADGE_MANUAL_AWARD_COLUMNS)
      .where('badge_id', '=', values.badgeId)
      .where('recipient_id', '=', values.recipientId)
      .limit(1)
      .executeTakeFirst();
    return existing!;
  }

  async findManualAward(badgeId: string, recipientId: string, db: RepoDb = this.db()): Promise<ManualAwardRow | undefined> {
    return db
      .selectFrom('badge_manual_award')
      .select(BADGE_MANUAL_AWARD_COLUMNS)
      .where('badge_id', '=', badgeId)
      .where('recipient_id', '=', recipientId)
      .limit(1)
      .executeTakeFirst();
  }
}
