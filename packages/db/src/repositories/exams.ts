import { sql, type Insertable, type InsertObject, type RawBuilder, type Updateable, type UpdateObject } from 'kysely';
import type { ExamQuestionSnapshot } from '../jsonb-types';
import { extractRichTextPlainText, type RichTextDocument } from '@giaokhoa/contracts';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import { applyDefined } from './mapping';

export type ExamsTx = CentreTx;
export type ExamsDb = CentreDb | CentreTx;

function jsonbValue<T>(value: T): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

export interface ExamRow {
  pinRequestId: string | null;
  pinRequestCourseId: string | null;
  sharedExamVersionId: string | null;
  systemExamForkVersionId: string | null;
  sharedSourceExamId: string | null;
  sharedSourceVersionNumber: number | null;
  sharedRequestedSectionId: string | null;
  sharedRequestChecksum: string | null;
  bankId: string;
  copyCount: number;
  createdAt: Date;
  createdBy: string;
  derivedFromBankId: string | null;
  derivedFromExamId: string | null;
  derivedFromMatrixId: string | null;
  derivedFromVersionNumber: number | null;
  id: string;
  kind: string;
  latestVersion: number;
  originalAuthorId: string | null;
  status: string;
  tenantId: string | null;
  updatedAt: Date;
  withdrawnAt: Date | null;
  withdrawnBy: string | null;
  withdrawnReason: string | null;
}

export interface NewExam {
  pinRequestId?: string | null;
  pinRequestCourseId?: string | null;
  sharedExamVersionId?: string | null;
  systemExamForkVersionId?: string | null;
  sharedSourceExamId?: string | null;
  sharedSourceVersionNumber?: number | null;
  sharedRequestedSectionId?: string | null;
  sharedRequestChecksum?: string | null;
  bankId: string;
  copyCount?: number;
  createdAt?: Date;
  createdBy: string;
  derivedFromBankId?: string | null;
  derivedFromExamId?: string | null;
  derivedFromMatrixId?: string | null;
  derivedFromVersionNumber?: number | null;
  id?: string;
  kind?: string;
  latestVersion?: number;
  originalAuthorId?: string | null;
  status?: string;
  tenantId?: string | null;
  updatedAt?: Date;
  withdrawnAt?: Date | null;
  withdrawnBy?: string | null;
  withdrawnReason?: string | null;
}

export const EXAM_COLUMNS = [
  'pin_request_id as pinRequestId',
  'pin_request_course_id as pinRequestCourseId',
  'shared_exam_version_id as sharedExamVersionId',
  'system_exam_fork_version_id as systemExamForkVersionId',
  'shared_source_exam_id as sharedSourceExamId',
  'shared_source_version_number as sharedSourceVersionNumber',
  'shared_requested_section_id as sharedRequestedSectionId',
  'shared_request_checksum as sharedRequestChecksum',
  'bank_id as bankId',
  'copy_count as copyCount',
  'created_at as createdAt',
  'created_by as createdBy',
  'derived_from_bank_id as derivedFromBankId',
  'derived_from_exam_id as derivedFromExamId',
  'derived_from_matrix_id as derivedFromMatrixId',
  'derived_from_version_number as derivedFromVersionNumber',
  'id',
  'kind',
  'latest_version as latestVersion',
  'original_author_id as originalAuthorId',
  'status',
  'tenant_id as tenantId',
  'updated_at as updatedAt',
  'withdrawn_at as withdrawnAt',
  'withdrawn_by as withdrawnBy',
  'withdrawn_reason as withdrawnReason',
] as const;

function examInsertValues(values: NewExam): Insertable<CentreDB['exams']> {
  const row: Insertable<CentreDB['exams']> = {
    bank_id: values.bankId,
    created_by: values.createdBy,
  };
  applyDefined(row, values, [
    ['pinRequestId', 'pin_request_id'],
    ['pinRequestCourseId', 'pin_request_course_id'],
    ['sharedExamVersionId', 'shared_exam_version_id'],
    ['systemExamForkVersionId', 'system_exam_fork_version_id'],
    ['sharedSourceExamId', 'shared_source_exam_id'],
    ['sharedSourceVersionNumber', 'shared_source_version_number'],
    ['sharedRequestedSectionId', 'shared_requested_section_id'],
    ['sharedRequestChecksum', 'shared_request_checksum'],
    ['copyCount', 'copy_count'],
    ['createdAt', 'created_at'],
    ['derivedFromBankId', 'derived_from_bank_id'],
    ['derivedFromExamId', 'derived_from_exam_id'],
    ['derivedFromMatrixId', 'derived_from_matrix_id'],
    ['derivedFromVersionNumber', 'derived_from_version_number'],
    ['id', 'id'],
    ['kind', 'kind'],
    ['latestVersion', 'latest_version'],
    ['originalAuthorId', 'original_author_id'],
    ['status', 'status'],
    ['tenantId', 'tenant_id'],
    ['updatedAt', 'updated_at'],
    ['withdrawnAt', 'withdrawn_at'],
    ['withdrawnBy', 'withdrawn_by'],
    ['withdrawnReason', 'withdrawn_reason'],
  ]);
  return row;
}

function examUpdateSet(patch: Partial<ExamRow>): Updateable<CentreDB['exams']> {
  const set: Updateable<CentreDB['exams']> = {};
  applyDefined(set, patch, [
    ['pinRequestId', 'pin_request_id'],
    ['pinRequestCourseId', 'pin_request_course_id'],
    ['sharedExamVersionId', 'shared_exam_version_id'],
    ['sharedSourceExamId', 'shared_source_exam_id'],
    ['sharedSourceVersionNumber', 'shared_source_version_number'],
    ['sharedRequestedSectionId', 'shared_requested_section_id'],
    ['sharedRequestChecksum', 'shared_request_checksum'],
    ['bankId', 'bank_id'],
    ['copyCount', 'copy_count'],
    ['createdAt', 'created_at'],
    ['createdBy', 'created_by'],
    ['derivedFromBankId', 'derived_from_bank_id'],
    ['derivedFromExamId', 'derived_from_exam_id'],
    ['derivedFromMatrixId', 'derived_from_matrix_id'],
    ['derivedFromVersionNumber', 'derived_from_version_number'],
    ['id', 'id'],
    ['kind', 'kind'],
    ['latestVersion', 'latest_version'],
    ['originalAuthorId', 'original_author_id'],
    ['status', 'status'],
    ['tenantId', 'tenant_id'],
    ['updatedAt', 'updated_at'],
    ['withdrawnAt', 'withdrawn_at'],
    ['withdrawnBy', 'withdrawn_by'],
    ['withdrawnReason', 'withdrawn_reason'],
  ]);
  return set;
}

export interface ExamVersionRow {
  createdAt: Date;
  createdBy: string;
  durationMinutes: number | null;
  examId: string;
  examKind: string | null;
  grade: number | null;
  id: string;
  matrixId: string | null;
  matrixVersion: number | null;
  matrixVersionId: string | null;
  name: string;
  subjectId: string | null;
  tfScale: number[] | null;
  totalScore: number;
  version: number;
}

export interface NewExamVersion {
  createdAt?: Date;
  createdBy: string;
  durationMinutes?: number | null;
  examId: string;
  examKind?: string | null;
  grade?: number | null;
  id?: string;
  matrixId?: string | null;
  matrixVersion?: number | null;
  matrixVersionId?: string | null;
  name: string;
  subjectId?: string | null;
  tfScale?: number[] | null;
  totalScore?: number;
  version: number;
}

export const EXAM_VERSION_COLUMNS = [
  'created_at as createdAt',
  'created_by as createdBy',
  'duration_minutes as durationMinutes',
  'exam_id as examId',
  'exam_kind as examKind',
  'grade',
  'id',
  'matrix_id as matrixId',
  'matrix_version as matrixVersion',
  'matrix_version_id as matrixVersionId',
  'name',
  'subject_id as subjectId',
  'tf_scale as tfScale',
  'total_score as totalScore',
  'version',
] as const;

function examVersionInsertValues(values: NewExamVersion): InsertObject<CentreDB, 'exam_versions'> {
  const row: InsertObject<CentreDB, 'exam_versions'> = {
    created_by: values.createdBy,
    exam_id: values.examId,
    name: values.name,
    version: values.version,
  };
  applyDefined(row, values, [
    ['createdAt', 'created_at'],
    ['durationMinutes', 'duration_minutes'],
    ['examKind', 'exam_kind'],
    ['grade', 'grade'],
    ['id', 'id'],
    ['matrixId', 'matrix_id'],
    ['matrixVersion', 'matrix_version'],
    ['matrixVersionId', 'matrix_version_id'],
    ['subjectId', 'subject_id'],
    ['tfScale', 'tf_scale', (value) => (value === null ? null : jsonbValue(value))],
    ['totalScore', 'total_score'],
  ]);
  return row;
}

export interface ExamSlotRow {
  sourceDomain: string;
  sourceSnapshot: ExamQuestionSnapshot | null;
  clusterId: string | null;
  createdAt: Date;
  examVersionId: string;
  id: string;
  matrixCellId: string | null;
  maxMark: number;
  pinnedVersionId: string | null;
  pinnedVersionNumber: number | null;
  position: number;
  questionId: string;
  section: string;
}

export interface NewExamSlot {
  sourceDomain?: string;
  sourceSnapshot?: ExamQuestionSnapshot | null;
  clusterId?: string | null;
  createdAt?: Date;
  examVersionId: string;
  id?: string;
  matrixCellId?: string | null;
  maxMark?: number;
  pinnedVersionId?: string | null;
  pinnedVersionNumber?: number | null;
  position: number;
  questionId: string;
  section?: string;
}

export const EXAM_SLOT_COLUMNS = [
  'source_domain as sourceDomain',
  'source_snapshot as sourceSnapshot',
  'cluster_id as clusterId',
  'created_at as createdAt',
  'exam_version_id as examVersionId',
  'id',
  'matrix_cell_id as matrixCellId',
  'max_mark as maxMark',
  'pinned_version_id as pinnedVersionId',
  'pinned_version_number as pinnedVersionNumber',
  'position',
  'question_id as questionId',
  'section',
] as const;

function examSlotInsertValues(values: NewExamSlot): InsertObject<CentreDB, 'exam_slots'> {
  const row: InsertObject<CentreDB, 'exam_slots'> = {
    exam_version_id: values.examVersionId,
    position: values.position,
    question_id: values.questionId,
  };
  applyDefined(row, values, [
    ['sourceDomain', 'source_domain'],
    ['sourceSnapshot', 'source_snapshot', (value) => (value === null ? null : jsonbValue(value))],
    ['clusterId', 'cluster_id'],
    ['createdAt', 'created_at'],
    ['id', 'id'],
    ['matrixCellId', 'matrix_cell_id'],
    ['maxMark', 'max_mark'],
    ['pinnedVersionId', 'pinned_version_id'],
    ['pinnedVersionNumber', 'pinned_version_number'],
    ['section', 'section'],
  ]);
  return row;
}

export interface ExamContributionRow {
  contentHash: string;
  createdAt: Date;
  dossierExamVersionId: string | null;
  dossierExamVersionNumber: number | null;
  dossierMatrixId: string | null;
  dossierMatrixVersion: number | null;
  dossierMatrixVersionId: string | null;
  dossierSpecSnapshot: Record<string, unknown> | null;
  examId: string;
  id: string;
  mode: string;
  nearDuplicateOf: string | null;
  note: string;
  proposerId: string;
  rejectReason: string | null;
  resultExamId: string | null;
  reviewerId: string | null;
  sourceDossierId: string | null;
  status: string;
  targetBankId: string;
  targetExamId: string | null;
  updatedAt: Date;
}

export interface NewExamContribution {
  contentHash?: string;
  createdAt?: Date;
  dossierExamVersionId?: string | null;
  dossierExamVersionNumber?: number | null;
  dossierMatrixId?: string | null;
  dossierMatrixVersion?: number | null;
  dossierMatrixVersionId?: string | null;
  dossierSpecSnapshot?: Record<string, unknown> | null;
  examId: string;
  id?: string;
  mode?: string;
  nearDuplicateOf?: string | null;
  note?: string;
  proposerId: string;
  rejectReason?: string | null;
  resultExamId?: string | null;
  reviewerId?: string | null;
  sourceDossierId?: string | null;
  status?: string;
  targetBankId: string;
  targetExamId?: string | null;
  updatedAt?: Date;
}

const EXAM_CONTRIBUTION_COLUMNS = [
  'content_hash as contentHash',
  'created_at as createdAt',
  'dossier_exam_version_id as dossierExamVersionId',
  'dossier_exam_version_number as dossierExamVersionNumber',
  'dossier_matrix_id as dossierMatrixId',
  'dossier_matrix_version as dossierMatrixVersion',
  'dossier_matrix_version_id as dossierMatrixVersionId',
  'dossier_spec_snapshot as dossierSpecSnapshot',
  'exam_id as examId',
  'id',
  'mode',
  'near_duplicate_of as nearDuplicateOf',
  'note',
  'proposer_id as proposerId',
  'reject_reason as rejectReason',
  'result_exam_id as resultExamId',
  'reviewer_id as reviewerId',
  'source_dossier_id as sourceDossierId',
  'status',
  'target_bank_id as targetBankId',
  'target_exam_id as targetExamId',
  'updated_at as updatedAt',
] as const;

function examContributionInsertValues(values: NewExamContribution): InsertObject<CentreDB, 'exam_contributions'> {
  const row: InsertObject<CentreDB, 'exam_contributions'> = {
    exam_id: values.examId,
    proposer_id: values.proposerId,
    target_bank_id: values.targetBankId,
  };
  applyDefined(row, values, [
    ['contentHash', 'content_hash'],
    ['createdAt', 'created_at'],
    ['dossierExamVersionId', 'dossier_exam_version_id'],
    ['dossierExamVersionNumber', 'dossier_exam_version_number'],
    ['dossierMatrixId', 'dossier_matrix_id'],
    ['dossierMatrixVersion', 'dossier_matrix_version'],
    ['dossierMatrixVersionId', 'dossier_matrix_version_id'],
    ['dossierSpecSnapshot', 'dossier_spec_snapshot', (value) => (value === null ? null : jsonbValue(value))],
    ['id', 'id'],
    ['mode', 'mode'],
    ['nearDuplicateOf', 'near_duplicate_of'],
    ['note', 'note'],
    ['rejectReason', 'reject_reason'],
    ['resultExamId', 'result_exam_id'],
    ['reviewerId', 'reviewer_id'],
    ['sourceDossierId', 'source_dossier_id'],
    ['status', 'status'],
    ['targetExamId', 'target_exam_id'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function examContributionUpdateSet(patch: Partial<ExamContributionRow>): UpdateObject<CentreDB, 'exam_contributions'> {
  const set: UpdateObject<CentreDB, 'exam_contributions'> = {};
  applyDefined(set, patch, [
    ['contentHash', 'content_hash'],
    ['createdAt', 'created_at'],
    ['dossierExamVersionId', 'dossier_exam_version_id'],
    ['dossierExamVersionNumber', 'dossier_exam_version_number'],
    ['dossierMatrixId', 'dossier_matrix_id'],
    ['dossierMatrixVersion', 'dossier_matrix_version'],
    ['dossierMatrixVersionId', 'dossier_matrix_version_id'],
    ['dossierSpecSnapshot', 'dossier_spec_snapshot', (value) => (value === null ? null : jsonbValue(value))],
    ['examId', 'exam_id'],
    ['id', 'id'],
    ['mode', 'mode'],
    ['nearDuplicateOf', 'near_duplicate_of'],
    ['note', 'note'],
    ['proposerId', 'proposer_id'],
    ['rejectReason', 'reject_reason'],
    ['resultExamId', 'result_exam_id'],
    ['reviewerId', 'reviewer_id'],
    ['sourceDossierId', 'source_dossier_id'],
    ['status', 'status'],
    ['targetBankId', 'target_bank_id'],
    ['targetExamId', 'target_exam_id'],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

export interface ExamContributionReviewRow {
  contributionId: string;
  createdAt: Date;
  decision: string;
  id: string;
  level: number;
  reason: string | null;
  reviewerId: string;
}

export interface NewExamContributionReview {
  contributionId: string;
  createdAt?: Date;
  decision: string;
  id?: string;
  level: number;
  reason?: string | null;
  reviewerId: string;
}

const EXAM_CONTRIBUTION_REVIEW_COLUMNS = [
  'contribution_id as contributionId',
  'created_at as createdAt',
  'decision',
  'id',
  'level',
  'reason',
  'reviewer_id as reviewerId',
] as const;

function examContributionReviewInsertValues(values: NewExamContributionReview): Insertable<CentreDB['exam_contribution_reviews']> {
  const row: Insertable<CentreDB['exam_contribution_reviews']> = {
    contribution_id: values.contributionId,
    decision: values.decision,
    level: values.level,
    reviewer_id: values.reviewerId,
  };
  applyDefined(row, values, [
    ['createdAt', 'created_at'],
    ['id', 'id'],
    ['reason', 'reason'],
  ]);
  return row;
}

export interface ExamDossierRow {
  createdAt: Date;
  examId: string;
  examVersionId: string | null;
  examVersionNumber: number | null;
  id: string;
  matrixId: string | null;
  matrixVersion: number | null;
  matrixVersionId: string | null;
  note: string;
  proposerId: string;
  resultExamId: string | null;
  specSnapshot: Record<string, unknown> | null;
  status: string;
  targetBankId: string;
  updatedAt: Date;
}

export interface NewExamDossier {
  createdAt?: Date;
  examId: string;
  examVersionId?: string | null;
  examVersionNumber?: number | null;
  id?: string;
  matrixId?: string | null;
  matrixVersion?: number | null;
  matrixVersionId?: string | null;
  note?: string;
  proposerId: string;
  resultExamId?: string | null;
  specSnapshot?: Record<string, unknown> | null;
  status?: string;
  targetBankId: string;
  updatedAt?: Date;
}

const EXAM_DOSSIER_COLUMNS = [
  'created_at as createdAt',
  'exam_id as examId',
  'exam_version_id as examVersionId',
  'exam_version_number as examVersionNumber',
  'id',
  'matrix_id as matrixId',
  'matrix_version as matrixVersion',
  'matrix_version_id as matrixVersionId',
  'note',
  'proposer_id as proposerId',
  'result_exam_id as resultExamId',
  'spec_snapshot as specSnapshot',
  'status',
  'target_bank_id as targetBankId',
  'updated_at as updatedAt',
] as const;

function examDossierInsertValues(values: NewExamDossier): InsertObject<CentreDB, 'exam_dossiers'> {
  const row: InsertObject<CentreDB, 'exam_dossiers'> = {
    exam_id: values.examId,
    proposer_id: values.proposerId,
    target_bank_id: values.targetBankId,
  };
  applyDefined(row, values, [
    ['createdAt', 'created_at'],
    ['examVersionId', 'exam_version_id'],
    ['examVersionNumber', 'exam_version_number'],
    ['id', 'id'],
    ['matrixId', 'matrix_id'],
    ['matrixVersion', 'matrix_version'],
    ['matrixVersionId', 'matrix_version_id'],
    ['note', 'note'],
    ['resultExamId', 'result_exam_id'],
    ['specSnapshot', 'spec_snapshot', (value) => (value === null ? null : jsonbValue(value))],
    ['status', 'status'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function examDossierUpdateSet(patch: Partial<ExamDossierRow>): UpdateObject<CentreDB, 'exam_dossiers'> {
  const set: UpdateObject<CentreDB, 'exam_dossiers'> = {};
  applyDefined(set, patch, [
    ['createdAt', 'created_at'],
    ['examId', 'exam_id'],
    ['examVersionId', 'exam_version_id'],
    ['examVersionNumber', 'exam_version_number'],
    ['id', 'id'],
    ['matrixId', 'matrix_id'],
    ['matrixVersion', 'matrix_version'],
    ['matrixVersionId', 'matrix_version_id'],
    ['note', 'note'],
    ['proposerId', 'proposer_id'],
    ['resultExamId', 'result_exam_id'],
    ['specSnapshot', 'spec_snapshot', (value) => (value === null ? null : jsonbValue(value))],
    ['status', 'status'],
    ['targetBankId', 'target_bank_id'],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

export interface ExamDossierReviewRow {
  createdAt: Date;
  decision: string;
  dossierId: string;
  id: string;
  level: number;
  reason: string | null;
  reviewerId: string;
}

export interface NewExamDossierReview {
  createdAt?: Date;
  decision: string;
  dossierId: string;
  id?: string;
  level: number;
  reason?: string | null;
  reviewerId: string;
}

const EXAM_DOSSIER_REVIEW_COLUMNS = [
  'created_at as createdAt',
  'decision',
  'dossier_id as dossierId',
  'id',
  'level',
  'reason',
  'reviewer_id as reviewerId',
] as const;

function examDossierReviewInsertValues(values: NewExamDossierReview): Insertable<CentreDB['exam_dossier_reviews']> {
  const row: Insertable<CentreDB['exam_dossier_reviews']> = {
    decision: values.decision,
    dossier_id: values.dossierId,
    level: values.level,
    reviewer_id: values.reviewerId,
  };
  applyDefined(row, values, [
    ['createdAt', 'created_at'],
    ['id', 'id'],
    ['reason', 'reason'],
  ]);
  return row;
}
export class ExamsRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CentreDb {
    return this.handle;
  }

  async transaction<T>(fn: (tx: ExamsTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async insertPaper(v: NewExam, db: ExamsDb = this.db()): Promise<ExamRow> {
    const rows = await db.insertInto('exams').values(examInsertValues(v)).returning(EXAM_COLUMNS).execute();
    return rows[0]!;
  }

  async findPaperByPinRequest(actorId: string, courseId: string, requestId: string): Promise<ExamRow | undefined> {
    return this.db().selectFrom('exams').select(EXAM_COLUMNS)
      .where('created_by', '=', actorId).where('pin_request_course_id', '=', courseId)
      .where('pin_request_id', '=', requestId).executeTakeFirst();
  }

  async listPinsOfExam(examId: string, db: ExamsDb = this.db()): Promise<{ id: string; courseId: string; courseName: string; examVersionId: string; versionNumber: number; name: string | null; variantCount: number; variants: { code: string }[]; targetGroupId: string | null; createdAt: Date }[]> {
    return db
      .selectFrom('exam_pins')
      .innerJoin('course', 'course.id', 'exam_pins.course_id')
      .innerJoin('exam_versions', 'exam_versions.id', 'exam_pins.exam_version_id')
      .select([
        'exam_pins.id as id',
        'exam_pins.course_id as courseId',
        'course.full_name as courseName',
        'exam_pins.exam_version_id as examVersionId',
        'exam_versions.version as versionNumber',
        'exam_pins.name as name',
        'exam_pins.variant_count as variantCount',
        'exam_pins.variants as variants',
        'exam_pins.target_group_id as targetGroupId',
        'exam_pins.created_at as createdAt',
      ])
      .where('exam_pins.exam_id', '=', examId)
      .orderBy('exam_pins.created_at', 'desc')
      .execute();
  }

  async getPaper(id: string, db: ExamsDb = this.db()): Promise<ExamRow | undefined> {
    return db.selectFrom('exams').select(EXAM_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  async listPapersInBank(bankId: string, db: ExamsDb = this.db()): Promise<ExamRow[]> {
    return db
      .selectFrom('exams')
      .select(EXAM_COLUMNS)
      .where('bank_id', '=', bankId)
      .where('kind', '=', 'snapshot')
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'asc')
      .execute();
  }

  async updatePaper(id: string, patch: Partial<ExamRow>, db: ExamsDb = this.db()): Promise<void> {
    await db
      .updateTable('exams')
      .set({ ...examUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deletePaper(id: string, db: ExamsDb = this.db()): Promise<void> {
    await db.deleteFrom('exams').where('id', '=', id).execute();
  }

  async insertVersion(v: NewExamVersion, db: ExamsDb = this.db()): Promise<ExamVersionRow> {
    const rows = await db.insertInto('exam_versions').values(examVersionInsertValues(v)).returning(EXAM_VERSION_COLUMNS).execute();
    return rows[0]!;
  }

  async getVersion(id: string, db: ExamsDb = this.db()): Promise<ExamVersionRow | undefined> {
    return db.selectFrom('exam_versions').select(EXAM_VERSION_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  async getVersionByNumber(paperId: string, version: number, db: ExamsDb = this.db()): Promise<ExamVersionRow | undefined> {
    return db
      .selectFrom('exam_versions')
      .select(EXAM_VERSION_COLUMNS)
      .where('exam_id', '=', paperId)
      .where('version', '=', version)
      .executeTakeFirst();
  }

  async listVersions(paperId: string, db: ExamsDb = this.db()): Promise<ExamVersionRow[]> {
    return db
      .selectFrom('exam_versions')
      .select(EXAM_VERSION_COLUMNS)
      .where('exam_id', '=', paperId)
      .orderBy('version', 'desc')
      .execute();
  }

  async insertSlots(rows: NewExamSlot[], db: ExamsDb = this.db()): Promise<void> {
    if (rows.length === 0) return;
    await db.insertInto('exam_slots').values(rows.map((r) => examSlotInsertValues(r))).execute();
  }

  async listSlots(examVersionId: string, db: ExamsDb = this.db()): Promise<ExamSlotRow[]> {
    return db
      .selectFrom('exam_slots')
      .select(EXAM_SLOT_COLUMNS)
      .where('exam_version_id', '=', examVersionId)
      .orderBy('position', 'asc')
      .execute();
  }

  async listSlotQuestionInfo(questionIds: string[], db: ExamsDb = this.db()): Promise<{ questionId: string; name: string; qtype: string }[]> {
    if (questionIds.length === 0) return [];
    const rows = await db
      .selectFrom('question')
      .innerJoin('question_bank_entries', 'question_bank_entries.question_id', 'question.id')
      .innerJoin('question_versions', (join) =>
        join
          .onRef('question_versions.question_bank_entry_id', '=', 'question_bank_entries.id')
          .onRef('question_versions.version', '=', 'question_bank_entries.latest_version'),
      )
      .select([
        'question.id as questionId',
        'question.qtype as qtype',
        'question_versions.question_text as questionText',
      ])
      .where('question.id', 'in', questionIds)
      .execute();
    return rows.map((r) => {
      const text = extractRichTextPlainText(r.questionText as RichTextDocument).trim();
      return { questionId: r.questionId, name: text.length > 120 ? `${text.slice(0, 120)}…` : text, qtype: r.qtype };
    });
  }

  async resolveReadyVersion(questionId: string, db: ExamsDb = this.db()): Promise<{ versionId: string; versionNumber: number; defaultMark: number } | undefined> {
    const entries = await db
      .selectFrom('question_bank_entries')
      .select(['question_bank_entries.latest_version as latestVersion', 'question_bank_entries.status as status'])
      .where('question_bank_entries.question_id', '=', questionId)
      .execute();
    const entry = entries.find((e) => e.status === 'ready');
    if (!entry) return undefined;
    const ver = await db
      .selectFrom('question_versions')
      .select(['question_versions.id as id', 'question_versions.version as version', 'question_versions.default_mark as defaultMark'])
      .where('question_versions.question_id', '=', questionId)
      .where('question_versions.version', '=', entry.latestVersion)
      .executeTakeFirst();
    if (!ver) return undefined;
    return { versionId: ver.id, versionNumber: ver.version, defaultMark: ver.defaultMark };
  }

  async listQuestionEntryStatuses(questionIds: string[], db: ExamsDb = this.db()): Promise<{ questionId: string; status: string }[]> {
    if (questionIds.length === 0) return [];
    return db
      .selectFrom('question_bank_entries')
      .select(['question_bank_entries.question_id as questionId', 'question_bank_entries.status as status'])
      .where('question_bank_entries.question_id', 'in', questionIds)
      .execute();
  }

  async questionExists(questionId: string, db: ExamsDb = this.db()): Promise<boolean> {
    const row = await db
      .selectFrom('question')
      .select(['question.id as id'])
      .where('question.id', '=', questionId)
      .executeTakeFirst();
    return !!row;
  }

  async insertContribution(v: NewExamContribution, db: ExamsDb = this.db()): Promise<ExamContributionRow> {
    const rows = await db.insertInto('exam_contributions').values(examContributionInsertValues(v)).returning(EXAM_CONTRIBUTION_COLUMNS).execute();
    return rows[0]!;
  }

  async getContribution(id: string, db: ExamsDb = this.db()): Promise<ExamContributionRow | undefined> {
    return db.selectFrom('exam_contributions').select(EXAM_CONTRIBUTION_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  async listContributionsForBank(targetBankId: string, db: ExamsDb = this.db()): Promise<ExamContributionRow[]> {
    return db
      .selectFrom('exam_contributions')
      .select(EXAM_CONTRIBUTION_COLUMNS)
      .where('target_bank_id', '=', targetBankId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async findPendingContribution(paperId: string, targetBankId: string, mode: 'new' | 'update' = 'new', targetExamId?: string, db: ExamsDb = this.db()): Promise<ExamContributionRow | undefined> {
    let query = db
      .selectFrom('exam_contributions')
      .select(EXAM_CONTRIBUTION_COLUMNS)
      .where('exam_id', '=', paperId)
      .where('target_bank_id', '=', targetBankId)
      .where('mode', '=', mode)
      .where('status', 'in', ['pending', 'pending_board']);
    if (mode === 'update' && targetExamId) {
      query = query.where('target_exam_id', '=', targetExamId);
    }
    return query.executeTakeFirst();
  }

  async findContributionBySourceDossier(dossierId: string, db: ExamsDb = this.db()): Promise<ExamContributionRow | undefined> {
    return db
      .selectFrom('exam_contributions')
      .select(EXAM_CONTRIBUTION_COLUMNS)
      .where('source_dossier_id', '=', dossierId)
      .executeTakeFirst();
  }

  async updateContribution(id: string, patch: Partial<ExamContributionRow>, db: ExamsDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_contributions')
      .set({ ...examContributionUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async insertContributionReview(v: NewExamContributionReview, db: ExamsDb = this.db()): Promise<ExamContributionReviewRow> {
    const rows = await db.insertInto('exam_contribution_reviews').values(examContributionReviewInsertValues(v)).returning(EXAM_CONTRIBUTION_REVIEW_COLUMNS).execute();
    return rows[0]!;
  }

  async listContributionReviews(contributionId: string, db: ExamsDb = this.db()): Promise<ExamContributionReviewRow[]> {
    return db
      .selectFrom('exam_contribution_reviews')
      .select(EXAM_CONTRIBUTION_REVIEW_COLUMNS)
      .where('contribution_id', '=', contributionId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  async bumpCopyCount(paperId: string, db: ExamsDb = this.db()): Promise<void> {
    await db
      .updateTable('exams')
      .set({ copy_count: sql<number>`"exams"."copy_count" + 1` })
      .where('id', '=', paperId)
      .execute();
  }


  async getMatrixInfo(matrixId: string, db: ExamsDb = this.db()): Promise<{ name: string; version: number } | undefined> {
    return db
      .selectFrom('exam_matrices')
      .select(['exam_matrices.name as name', 'exam_matrices.version as version'])
      .where('exam_matrices.id', '=', matrixId)
      .executeTakeFirst();
  }

  async getMatrixVersionRowId(matrixId: string, version: number, db: ExamsDb = this.db()): Promise<string | null> {
    const row = await db
      .selectFrom('exam_matrix_versions')
      .select(['exam_matrix_versions.id as id'])
      .where('exam_matrix_versions.matrix_id', '=', matrixId)
      .where('exam_matrix_versions.version', '=', version)
      .executeTakeFirst();
    return row?.id ?? null;
  }

  async insertDossier(v: NewExamDossier, db: ExamsDb = this.db()): Promise<ExamDossierRow> {
    const rows = await db.insertInto('exam_dossiers').values(examDossierInsertValues(v)).returning(EXAM_DOSSIER_COLUMNS).execute();
    return rows[0]!;
  }

  async getDossier(id: string, db: ExamsDb = this.db()): Promise<ExamDossierRow | undefined> {
    return db.selectFrom('exam_dossiers').select(EXAM_DOSSIER_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  async updateDossier(id: string, patch: Partial<ExamDossierRow>, db: ExamsDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_dossiers')
      .set({ ...examDossierUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteDossier(id: string, db: ExamsDb = this.db()): Promise<void> {
    await db.deleteFrom('exam_dossiers').where('id', '=', id).execute();
  }

  async listDossiersForBank(targetBankId: string, db: ExamsDb = this.db()): Promise<ExamDossierRow[]> {
    return db
      .selectFrom('exam_dossiers')
      .select(EXAM_DOSSIER_COLUMNS)
      .where('target_bank_id', '=', targetBankId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async listAllDossiers(db: ExamsDb = this.db()): Promise<ExamDossierRow[]> {
    return db.selectFrom('exam_dossiers').select(EXAM_DOSSIER_COLUMNS).orderBy('created_at', 'asc').execute();
  }

  async listDossiersByProposer(proposerId: string, db: ExamsDb = this.db()): Promise<ExamDossierRow[]> {
    return db
      .selectFrom('exam_dossiers')
      .select(EXAM_DOSSIER_COLUMNS)
      .where('proposer_id', '=', proposerId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async findActiveDossier(paperId: string, targetBankId: string, excludeId?: string, db: ExamsDb = this.db()): Promise<ExamDossierRow | undefined> {
    let query = db
      .selectFrom('exam_dossiers')
      .select(EXAM_DOSSIER_COLUMNS)
      .where('exam_id', '=', paperId)
      .where('target_bank_id', '=', targetBankId)
      .where('status', 'in', ['pending', 'pending_board']);
    if (excludeId) {
      query = query.where('id', '!=', excludeId);
    }
    return query.executeTakeFirst();
  }

  async insertDossierReview(v: NewExamDossierReview, db: ExamsDb = this.db()): Promise<ExamDossierReviewRow> {
    const rows = await db.insertInto('exam_dossier_reviews').values(examDossierReviewInsertValues(v)).returning(EXAM_DOSSIER_REVIEW_COLUMNS).execute();
    return rows[0]!;
  }

  async listDossierReviews(dossierId: string, db: ExamsDb = this.db()): Promise<ExamDossierReviewRow[]> {
    return db
      .selectFrom('exam_dossier_reviews')
      .select(EXAM_DOSSIER_REVIEW_COLUMNS)
      .where('dossier_id', '=', dossierId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async userTeachesGrade(userId: string, grade: number, db: ExamsDb = this.db()): Promise<boolean> {
    const rows = await db
      .selectFrom('role_assignments')
      .innerJoin('role', 'role_assignments.role_id', 'role.id')
      .innerJoin('context', 'role_assignments.context_id', 'context.id')
      .innerJoin('course', 'context.instance_id', 'course.id')
      .select(['role_assignments.id as id'])
      .where('role_assignments.user_id', '=', userId)
      .where('context.context_level', '=', 50)
      .where('course.grade', '=', grade)
      .where('role.archetype', 'in', ['teacher', 'editingteacher'])
      .limit(1)
      .execute();
    return rows.length > 0;
  }
}
