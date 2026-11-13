import { sql, type InsertObject, type RawBuilder, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { JsonValue } from '../types/centre-db';

export type PrivacyDb = CentreDb | CentreTx;

export interface PrivacyRequestRow {
  id: string;
  userId: string;
  type: string;
  status: string;
  requestedBy: string;
  approvedBy: string | null;
  result: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportFileRow {
  id: string;
  requestId: string;
  fileId: string | null;
  subsystem: string;
  manifest: unknown | null;
  createdAt: Date;
}

export interface NewPrivacyRequest {
  id?: string;
  userId: string;
  type: string;
  status?: string;
  requestedBy: string;
  approvedBy?: string | null;
  result?: unknown | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewExportFile {
  id?: string;
  requestId: string;
  fileId?: string | null;
  subsystem?: string;
  manifest?: unknown | null;
  createdAt?: Date;
}

function jsonbValue(value: unknown): RawBuilder<JsonValue> {
  return sql<JsonValue>`${JSON.stringify(value)}::jsonb`;
}

const PRIVACY_REQUEST_COLUMNS = [
  'id',
  'user_id as userId',
  'type',
  'status',
  'requested_by as requestedBy',
  'approved_by as approvedBy',
  'result',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const PRIVACY_EXPORT_FILE_COLUMNS = [
  'id',
  'request_id as requestId',
  'file_id as fileId',
  'subsystem',
  'manifest',
  'created_at as createdAt',
] as const;

function privacyRequestInsertValues(values: NewPrivacyRequest): InsertObject<CentreDB, 'privacy_requests'> {
  const row: InsertObject<CentreDB, 'privacy_requests'> = {
    user_id: values.userId,
    type: values.type,
    requested_by: values.requestedBy,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.status !== undefined) row.status = values.status;
  if (values.approvedBy !== undefined) row.approved_by = values.approvedBy;
  if (values.result !== undefined) row.result = jsonbValue(values.result);
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function privacyRequestUpdateSet(patch: Partial<NewPrivacyRequest>): UpdateObject<CentreDB, 'privacy_requests'> {
  const set: UpdateObject<CentreDB, 'privacy_requests'> = {};
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.userId !== undefined) set.user_id = patch.userId;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.requestedBy !== undefined) set.requested_by = patch.requestedBy;
  if (patch.approvedBy !== undefined) set.approved_by = patch.approvedBy;
  if (patch.result !== undefined) set.result = jsonbValue(patch.result);
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt;
  return set;
}

function exportFileInsertValues(values: NewExportFile): InsertObject<CentreDB, 'privacy_export_files'> {
  const row: InsertObject<CentreDB, 'privacy_export_files'> = {
    request_id: values.requestId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.fileId !== undefined) row.file_id = values.fileId;
  if (values.subsystem !== undefined) row.subsystem = values.subsystem;
  if (values.manifest !== undefined) row.manifest = jsonbValue(values.manifest);
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  return row;
}

export class PrivacyRepository {
  constructor(private readonly handle: CentreDb) {}

  get dbHandle(): CentreDb {
    return this.handle;
  }

  async insertRequest(v: NewPrivacyRequest, db: PrivacyDb = this.handle): Promise<PrivacyRequestRow> {
    const rows = await db
      .insertInto('privacy_requests')
      .values(privacyRequestInsertValues(v))
      .returning(PRIVACY_REQUEST_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getRequest(id: string, db: PrivacyDb = this.handle): Promise<PrivacyRequestRow | undefined> {
    return db
      .selectFrom('privacy_requests')
      .select(PRIVACY_REQUEST_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listRequests(db: PrivacyDb = this.handle): Promise<PrivacyRequestRow[]> {
    return db.selectFrom('privacy_requests').select(PRIVACY_REQUEST_COLUMNS).execute();
  }

  async listRequestsForUser(userId: string, db: PrivacyDb = this.handle): Promise<PrivacyRequestRow[]> {
    return db
      .selectFrom('privacy_requests')
      .select(PRIVACY_REQUEST_COLUMNS)
      .where('user_id', '=', userId)
      .execute();
  }

  async updateRequest(id: string, v: Partial<NewPrivacyRequest>, db: PrivacyDb = this.handle): Promise<void> {
    await db
      .updateTable('privacy_requests')
      .set({ ...privacyRequestUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async insertExportFile(v: NewExportFile, db: PrivacyDb = this.handle): Promise<ExportFileRow> {
    const rows = await db
      .insertInto('privacy_export_files')
      .values(exportFileInsertValues(v))
      .returning(PRIVACY_EXPORT_FILE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listExportFiles(requestId: string, db: PrivacyDb = this.handle): Promise<ExportFileRow[]> {
    return db
      .selectFrom('privacy_export_files')
      .select(PRIVACY_EXPORT_FILE_COLUMNS)
      .where('request_id', '=', requestId)
      .execute();
  }
}
