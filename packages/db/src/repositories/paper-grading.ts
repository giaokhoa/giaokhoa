import { sql, type RawBuilder } from 'kysely';
import type { PaperQuality, PaperReading, PaperRosterEntry, PaperSlotLayout } from '@giaokhoa/contracts';
import type { CentreDb } from '../client';


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
    ...(v.id !== undefined ? { id: v.id } : {}),
    exam_pin_id: v.examPinId,
    variant_code: v.variantCode,
    ...(v.examCode !== undefined ? { exam_code: v.examCode } : {}),
    ...(v.codeDigits !== undefined ? { code_digits: v.codeDigits } : {}),
    layout: jsonbValue(v.layout),
    roster: jsonbValue(v.roster),
    created_by: v.createdBy,
    ...(v.createdAt !== undefined ? { created_at: v.createdAt } : {}),
    ...(v.updatedAt !== undefined ? { updated_at: v.updatedAt } : {}),
  };
}

function scanInsertValues(v: NewPaperScan) {
  return {
    ...(v.id !== undefined ? { id: v.id } : {}),
    exam_pin_id: v.examPinId,
    ...(v.batchId !== undefined ? { batch_id: v.batchId } : {}),
    ...(v.sessionId !== undefined ? { session_id: v.sessionId } : {}),
    file_id: v.fileId,
    ...(v.warpedFileId !== undefined ? { warped_file_id: v.warpedFileId } : {}),
    uploaded_by: v.uploadedBy,
    ...(v.status !== undefined ? { status: v.status } : {}),
    ...(v.identityCode !== undefined ? { identity_code: v.identityCode } : {}),
    ...(v.identitySource !== undefined ? { identity_source: v.identitySource } : {}),
    ...(v.studentId !== undefined ? { student_id: v.studentId } : {}),
    ...(v.attemptId !== undefined ? { attempt_id: v.attemptId } : {}),
    ...(v.variantCodeRead !== undefined ? { variant_code_read: v.variantCodeRead } : {}),
    ...(v.quality !== undefined ? { quality: v.quality === null ? null : jsonbValue(v.quality) } : {}),
    ...(v.readings !== undefined ? { readings: jsonbValue(v.readings) } : {}),
    ...(v.expiresAt !== undefined ? { expires_at: v.expiresAt } : {}),
    ...(v.createdAt !== undefined ? { created_at: v.createdAt } : {}),
    ...(v.updatedAt !== undefined ? { updated_at: v.updatedAt } : {}),
  };
}

function scanUpdateSet(patch: Partial<NewPaperScan>) {
  return {
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.examPinId !== undefined ? { exam_pin_id: patch.examPinId } : {}),
    ...(patch.batchId !== undefined ? { batch_id: patch.batchId } : {}),
    ...(patch.sessionId !== undefined ? { session_id: patch.sessionId } : {}),
    ...(patch.fileId !== undefined ? { file_id: patch.fileId } : {}),
    ...(patch.warpedFileId !== undefined ? { warped_file_id: patch.warpedFileId } : {}),
    ...(patch.uploadedBy !== undefined ? { uploaded_by: patch.uploadedBy } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.identityCode !== undefined ? { identity_code: patch.identityCode } : {}),
    ...(patch.identitySource !== undefined ? { identity_source: patch.identitySource } : {}),
    ...(patch.studentId !== undefined ? { student_id: patch.studentId } : {}),
    ...(patch.attemptId !== undefined ? { attempt_id: patch.attemptId } : {}),
    ...(patch.variantCodeRead !== undefined ? { variant_code_read: patch.variantCodeRead } : {}),
    ...(patch.quality !== undefined ? { quality: patch.quality === null ? null : jsonbValue(patch.quality) } : {}),
    ...(patch.readings !== undefined ? { readings: jsonbValue(patch.readings) } : {}),
    ...(patch.expiresAt !== undefined ? { expires_at: patch.expiresAt } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
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
