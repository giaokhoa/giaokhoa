import { sql, type RawBuilder } from 'kysely';
import type { PaperQuality, PaperReading, PaperRosterEntry, PaperSlotLayout } from '@giaokhoa/contracts';
import type { CentreDb } from '../client';
import { pickDefined } from './mapping';


export interface PaperBatchRow {
  id: string;
  examPinId: string;
  variantCode: string;
  examCode: string | null;
  codeDigits: number;
  layout: PaperSlotLayout[];
  roster: PaperRosterEntry[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaperScanRow {
  id: string;
  examPinId: string;
  batchId: string | null;
  sessionId: string | null;
  fileId: string;
  warpedFileId: string | null;
  uploadedBy: string;
  status: string;
  identityCode: string | null;
  identitySource: string | null;
  studentId: string | null;
  attemptId: string | null;
  variantCodeRead: string | null;
  quality: PaperQuality | null;
  readings: PaperReading[];
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}


export interface NewPaperBatch {
  id?: string;
  examPinId: string;
  variantCode: string;
  examCode?: string | null;
  codeDigits?: number;
  layout: PaperSlotLayout[];
  roster: PaperRosterEntry[];
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewPaperScan {
  id?: string;
  examPinId: string;
  batchId?: string | null;
  sessionId?: string | null;
  fileId: string;
  warpedFileId?: string | null;
  uploadedBy: string;
  status?: string;
  identityCode?: string | null;
  identitySource?: string | null;
  studentId?: string | null;
  attemptId?: string | null;
  variantCodeRead?: string | null;
  quality?: PaperQuality | null;
  readings?: PaperReading[];
  expiresAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}


const BATCH_COLUMNS = [
  'id', 'exam_pin_id as examPinId', 'variant_code as variantCode',
  'exam_code as examCode', 'code_digits as codeDigits', 'layout', 'roster',
  'created_by as createdBy', 'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

const SCAN_COLUMNS = [
  'id', 'exam_pin_id as examPinId', 'batch_id as batchId',
  'session_id as sessionId', 'file_id as fileId',
  'warped_file_id as warpedFileId', 'uploaded_by as uploadedBy', 'status',
  'identity_code as identityCode', 'identity_source as identitySource',
  'student_id as studentId', 'attempt_id as attemptId',
  'variant_code_read as variantCodeRead', 'quality', 'readings',
  'expires_at as expiresAt', 'created_at as createdAt',
  'updated_at as updatedAt',
] as const;


function jsonbValue<T>(value: T): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

function batchInsertValues(v: NewPaperBatch) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    exam_pin_id: v.examPinId,
    variant_code: v.variantCode,
    ...pickDefined(v, [
      ['examCode', 'exam_code'],
      ['codeDigits', 'code_digits'],
    ]),
    layout: jsonbValue(v.layout),
    roster: jsonbValue(v.roster),
    created_by: v.createdBy,
    ...pickDefined(v, [
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ]),
  };
}

function scanInsertValues(v: NewPaperScan) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    exam_pin_id: v.examPinId,
    ...pickDefined(v, [
      ['batchId', 'batch_id'],
      ['sessionId', 'session_id'],
    ]),
    file_id: v.fileId,
    ...pickDefined(v, [['warpedFileId', 'warped_file_id']]),
    uploaded_by: v.uploadedBy,
    ...pickDefined(v, [
      ['status', 'status'],
      ['identityCode', 'identity_code'],
      ['identitySource', 'identity_source'],
      ['studentId', 'student_id'],
      ['attemptId', 'attempt_id'],
      ['variantCodeRead', 'variant_code_read'],
      ['quality', 'quality', (value) => (value === null ? null : jsonbValue(value))],
      ['readings', 'readings', (value) => jsonbValue(value)],
      ['expiresAt', 'expires_at'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ]),
  };
}

function scanUpdateSet(patch: Partial<NewPaperScan>) {
  return {
    ...pickDefined(patch, [
      ['id', 'id'],
      ['examPinId', 'exam_pin_id'],
      ['batchId', 'batch_id'],
      ['sessionId', 'session_id'],
      ['fileId', 'file_id'],
      ['warpedFileId', 'warped_file_id'],
      ['uploadedBy', 'uploaded_by'],
      ['status', 'status'],
      ['identityCode', 'identity_code'],
      ['identitySource', 'identity_source'],
      ['studentId', 'student_id'],
      ['attemptId', 'attempt_id'],
      ['variantCodeRead', 'variant_code_read'],
      ['quality', 'quality', (value) => (value === null ? null : jsonbValue(value))],
      ['readings', 'readings', (value) => jsonbValue(value)],
      ['expiresAt', 'expires_at'],
      ['createdAt', 'created_at'],
    ]),
    updated_at: new Date(),
  };
}

export class PaperGradingRepository {
  constructor(private readonly handle: CentreDb) {}

  async insertBatch(v: NewPaperBatch): Promise<PaperBatchRow> {
    return this.handle
      .insertInto('exam_batches')
      .values(batchInsertValues(v))
      .returning(BATCH_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getBatch(id: string): Promise<PaperBatchRow | undefined> {
    return this.handle
      .selectFrom('exam_batches')
      .select(BATCH_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listBatchesForPin(pinId: string): Promise<PaperBatchRow[]> {
    return this.handle
      .selectFrom('exam_batches')
      .select(BATCH_COLUMNS)
      .where('exam_pin_id', '=', pinId)
      .orderBy('created_at')
      .execute();
  }

  async insertScan(v: NewPaperScan): Promise<PaperScanRow> {
    return this.handle
      .insertInto('exam_scans')
      .values(scanInsertValues(v))
      .returning(SCAN_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getScan(id: string): Promise<PaperScanRow | undefined> {
    return this.handle
      .selectFrom('exam_scans')
      .select(SCAN_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listScansForPin(pinId: string, status?: string): Promise<PaperScanRow[]> {
    let query = this.handle
      .selectFrom('exam_scans')
      .select(SCAN_COLUMNS)
      .where('exam_pin_id', '=', pinId);
    if (status !== undefined) query = query.where('status', '=', status);
    return query
      .orderBy('created_at')
      .execute();
  }

  async updateScan(id: string, patch: Partial<NewPaperScan>): Promise<PaperScanRow> {
    return this.handle
      .updateTable('exam_scans')
      .set(scanUpdateSet(patch))
      .where('id', '=', id)
      .returning(SCAN_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async deleteScan(id: string): Promise<void> {
    await this.handle
      .deleteFrom('exam_scans')
      .where('id', '=', id)
      .execute();
  }

  async latestScanForQuiz(pinId: string): Promise<PaperScanRow | undefined> {
    return this.handle
      .selectFrom('exam_scans')
      .select(SCAN_COLUMNS)
      .where('exam_pin_id', '=', pinId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }
}
