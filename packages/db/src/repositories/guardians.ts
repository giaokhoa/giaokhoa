import type { Expression, Insertable, SqlBool, Updateable } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';

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
  if (values.id !== undefined) row.id = values.id;
  if (values.status !== undefined) row.status = values.status;
  if (values.revokedBy !== undefined) row.revoked_by = values.revokedBy;
  if (values.revokedAt !== undefined) row.revoked_at = values.revokedAt;
  if (values.note !== undefined) row.note = values.note;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function guardianLinkUpdateSet(patch: Partial<GuardianLinkRow>): Updateable<CentreDB['guardian_links']> {
  const set: Updateable<CentreDB['guardian_links']> = {};
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.tenantId !== undefined) set.tenant_id = patch.tenantId;
  if (patch.guardianUserId !== undefined) set.guardian_user_id = patch.guardianUserId;
  if (patch.studentUserId !== undefined) set.student_user_id = patch.studentUserId;
  if (patch.relationship !== undefined) set.relationship = patch.relationship;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.createdBy !== undefined) set.created_by = patch.createdBy;
  if (patch.revokedBy !== undefined) set.revoked_by = patch.revokedBy;
  if (patch.revokedAt !== undefined) set.revoked_at = patch.revokedAt;
  if (patch.note !== undefined) set.note = patch.note;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
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
