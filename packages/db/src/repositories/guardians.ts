import type { Expression, Insertable, SqlBool, Updateable } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import { applyDefined } from './mapping';

export type GuardianDb = CentreDb | CentreTx;

export interface GuardianLinkRow {
  id: string;
  tenantId: string;
  guardianUserId: string;
  studentUserId: string;
  relationship: string;
  status: string;
  createdBy: string;
  revokedBy: string | null;
  revokedAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewGuardianLink {
  id?: string;
  tenantId: string;
  guardianUserId: string;
  studentUserId: string;
  relationship: string;
  status?: string;
  createdBy: string;
  revokedBy?: string | null;
  revokedAt?: Date | null;
  note?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const GUARDIAN_LINK_COLUMNS = [
  'id',
  'tenant_id as tenantId',
  'guardian_user_id as guardianUserId',
  'student_user_id as studentUserId',
  'relationship',
  'status',
  'created_by as createdBy',
  'revoked_by as revokedBy',
  'revoked_at as revokedAt',
  'note',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

function guardianLinkInsertValues(values: NewGuardianLink): Insertable<CentreDB['guardian_links']> {
  const row: Insertable<CentreDB['guardian_links']> = {
    tenant_id: values.tenantId,
    guardian_user_id: values.guardianUserId,
    student_user_id: values.studentUserId,
    relationship: values.relationship,
    created_by: values.createdBy,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['status', 'status'],
    ['revokedBy', 'revoked_by'],
    ['revokedAt', 'revoked_at'],
    ['note', 'note'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function guardianLinkUpdateSet(patch: Partial<GuardianLinkRow>): Updateable<CentreDB['guardian_links']> {
  const set: Updateable<CentreDB['guardian_links']> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['tenantId', 'tenant_id'],
    ['guardianUserId', 'guardian_user_id'],
    ['studentUserId', 'student_user_id'],
    ['relationship', 'relationship'],
    ['status', 'status'],
    ['createdBy', 'created_by'],
    ['revokedBy', 'revoked_by'],
    ['revokedAt', 'revoked_at'],
    ['note', 'note'],
    ['createdAt', 'created_at'],
  ]);
  return set;
}

export class GuardiansRepository {
  constructor(private readonly handle: GuardianDb) {}

  private db(): GuardianDb {
    return this.handle;
  }

  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async insertLink(v: NewGuardianLink, db: GuardianDb = this.db()): Promise<GuardianLinkRow> {
    const rows = await db
      .insertInto('guardian_links')
      .values(guardianLinkInsertValues(v))
      .returning(GUARDIAN_LINK_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getLink(id: string, db: GuardianDb = this.db()): Promise<GuardianLinkRow | undefined> {
    return db
      .selectFrom('guardian_links')
      .select(GUARDIAN_LINK_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
  }

  async findActiveLink(
    guardianUserId: string,
    studentUserId: string,
    db: GuardianDb = this.db(),
  ): Promise<GuardianLinkRow | undefined> {
    return db
      .selectFrom('guardian_links')
      .select(GUARDIAN_LINK_COLUMNS)
      .where('guardian_user_id', '=', guardianUserId)
      .where('student_user_id', '=', studentUserId)
      .where('status', '=', 'active')
      .limit(1)
      .executeTakeFirst();
  }

  async listLinks(
    filters: { guardianUserId?: string; studentUserId?: string; status?: string },
    db: GuardianDb = this.db(),
  ): Promise<GuardianLinkRow[]> {
    const { guardianUserId, studentUserId, status } = filters;
    let query = db.selectFrom('guardian_links').select(GUARDIAN_LINK_COLUMNS);
    if (guardianUserId !== undefined || studentUserId !== undefined || status !== undefined) {
      query = query.where((eb) => {
        const conds: Expression<SqlBool>[] = [];
        if (guardianUserId !== undefined) conds.push(eb('guardian_user_id', '=', guardianUserId));
        if (studentUserId !== undefined) conds.push(eb('student_user_id', '=', studentUserId));
        if (status !== undefined) conds.push(eb('status', '=', status));
        return eb.and(conds);
      });
    }
    return query.orderBy('created_at', 'asc').orderBy('id', 'asc').execute();
  }

  async updateLink(id: string, patch: Partial<GuardianLinkRow>, db: GuardianDb = this.db()): Promise<void> {
    await db
      .updateTable('guardian_links')
      .set({ ...guardianLinkUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
