import { sql, type InsertObject, type RawBuilder, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { JsonValue } from '../types/centre-db';
import { applyDefined } from './mapping';

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
  applyDefined(row, values, [
    ['id', 'id'],
    ['status', 'status'],
    ['approvedBy', 'approved_by'],
    ['result', 'result', (value) => jsonbValue(value)],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function privacyRequestUpdateSet(patch: Partial<NewPrivacyRequest>): UpdateObject<CentreDB, 'privacy_requests'> {
  const set: UpdateObject<CentreDB, 'privacy_requests'> = {};
  applyDefined(set, patch, [
    ['id', 'id'],
    ['userId', 'user_id'],
    ['type', 'type'],
    ['status', 'status'],
    ['requestedBy', 'requested_by'],
    ['approvedBy', 'approved_by'],
    ['result', 'result', (value) => jsonbValue(value)],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

function exportFileInsertValues(values: NewExportFile): InsertObject<CentreDB, 'privacy_export_files'> {
  const row: InsertObject<CentreDB, 'privacy_export_files'> = {
    request_id: values.requestId,
  };
  applyDefined(row, values, [
    ['id', 'id'],
    ['fileId', 'file_id'],
    ['subsystem', 'subsystem'],
    ['manifest', 'manifest', (value) => jsonbValue(value)],
    ['createdAt', 'created_at'],
  ]);
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
