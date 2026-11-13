import { sql, type Insertable, type InsertObject, type RawBuilder, type Updateable, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { JsonValue } from '../types/centre-db';

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
  if (values.id !== undefined) row.id = values.id;
  if (values.description !== undefined) row.description = values.description;
  if (values.type !== undefined) row.type = values.type;
  if (values.courseId !== undefined) row.course_id = values.courseId;
  if (values.issuerName !== undefined) row.issuer_name = values.issuerName;
  if (values.issuerUrl !== undefined) row.issuer_url = values.issuerUrl;
  if (values.issuerContact !== undefined) row.issuer_contact = values.issuerContact;
  if (values.expireDate !== undefined) row.expire_date = values.expireDate;
  if (values.expirePeriod !== undefined) row.expire_period = values.expirePeriod;
  if (values.status !== undefined) row.status = values.status;
  if (values.version !== undefined) row.version = values.version;
  if (values.language !== undefined) row.language = values.language;
  if (values.userCreated !== undefined) row.user_created = values.userCreated;
  if (values.userModified !== undefined) row.user_modified = values.userModified;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function badgeUpdateSet(patch: Partial<BadgeRow>): Updateable<CentreDB['badge']> {
  const set: Updateable<CentreDB['badge']> = {};
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.courseId !== undefined) set.course_id = patch.courseId;
  if (patch.issuerName !== undefined) set.issuer_name = patch.issuerName;
  if (patch.issuerUrl !== undefined) set.issuer_url = patch.issuerUrl;
  if (patch.issuerContact !== undefined) set.issuer_contact = patch.issuerContact;
  if (patch.expireDate !== undefined) set.expire_date = patch.expireDate;
  if (patch.expirePeriod !== undefined) set.expire_period = patch.expirePeriod;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.version !== undefined) set.version = patch.version;
  if (patch.language !== undefined) set.language = patch.language;
  if (patch.userCreated !== undefined) set.user_created = patch.userCreated;
  if (patch.userModified !== undefined) set.user_modified = patch.userModified;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  return set;
}

function criteriaInsertValues(values: NewCriteria): InsertObject<CentreDB, 'badge_criteria'> {
  const row: InsertObject<CentreDB, 'badge_criteria'> = {
    badge_id: values.badgeId,
    criteria_type: values.criteriaType,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.method !== undefined) row.method = values.method;
  if (values.params !== undefined) row.params = jsonbValue(values.params);
  if (values.description !== undefined) row.description = values.description;
  return row;
}

function issuedInsertValues(values: NewIssued): InsertObject<CentreDB, 'badge_issued'> {
  const row: InsertObject<CentreDB, 'badge_issued'> = {
    badge_id: values.badgeId,
    user_id: values.userId,
    unique_hash: values.uniqueHash,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.snapshot !== undefined) row.snapshot = jsonbValue(values.snapshot);
  if (values.evidence !== undefined) row.evidence = jsonbValue(values.evidence);
  if (values.dateIssued !== undefined) row.date_issued = values.dateIssued;
  if (values.dateExpire !== undefined) row.date_expire = values.dateExpire;
  if (values.visible !== undefined) row.visible = values.visible;
  if (values.revoked !== undefined) row.revoked = values.revoked;
  if (values.revokedAt !== undefined) row.revoked_at = values.revokedAt;
  if (values.issuerNotified !== undefined) row.issuer_notified = values.issuerNotified;
  return row;
}

function issuedUpdateSet(patch: Partial<IssuedRow>): UpdateObject<CentreDB, 'badge_issued'> {
  const set: UpdateObject<CentreDB, 'badge_issued'> = {};
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.badgeId !== undefined) set.badge_id = patch.badgeId;
  if (patch.userId !== undefined) set.user_id = patch.userId;
  if (patch.uniqueHash !== undefined) set.unique_hash = patch.uniqueHash;
  if (patch.snapshot !== undefined) set.snapshot = jsonbValue(patch.snapshot);
  if (patch.evidence !== undefined) set.evidence = jsonbValue(patch.evidence);
  if (patch.dateIssued !== undefined) set.date_issued = patch.dateIssued;
  if (patch.dateExpire !== undefined) set.date_expire = patch.dateExpire;
  if (patch.visible !== undefined) set.visible = patch.visible;
  if (patch.revoked !== undefined) set.revoked = patch.revoked;
  if (patch.revokedAt !== undefined) set.revoked_at = patch.revokedAt;
  if (patch.issuerNotified !== undefined) set.issuer_notified = patch.issuerNotified;
  return set;
}

function manualAwardInsertValues(values: NewManualAward): Insertable<CentreDB['badge_manual_award']> {
  const row: Insertable<CentreDB['badge_manual_award']> = {
    badge_id: values.badgeId,
    recipient_id: values.recipientId,
    issuer_id: values.issuerId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.issuerRole !== undefined) row.issuer_role = values.issuerRole;
  if (values.dateMet !== undefined) row.date_met = values.dateMet;
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
