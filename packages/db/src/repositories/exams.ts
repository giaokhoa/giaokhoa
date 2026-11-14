import { sql, type Insertable, type InsertObject, type RawBuilder, type Updateable, type UpdateObject } from 'kysely';
import type { ExamQuestionSnapshot } from '../jsonb-types';
import { extractRichTextPlainText, type RichTextDocument } from '@giaokhoa/contracts';
import type { CentreDb, CentreTx, CentreDB } from '../client';

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
  if (values.pinRequestId !== undefined) row.pin_request_id = values.pinRequestId;
  if (values.pinRequestCourseId !== undefined) row.pin_request_course_id = values.pinRequestCourseId;
  if (values.sharedExamVersionId !== undefined) row.shared_exam_version_id = values.sharedExamVersionId;
  if (values.systemExamForkVersionId !== undefined) row.system_exam_fork_version_id = values.systemExamForkVersionId;
  if (values.sharedSourceExamId !== undefined) row.shared_source_exam_id = values.sharedSourceExamId;
  if (values.sharedSourceVersionNumber !== undefined) row.shared_source_version_number = values.sharedSourceVersionNumber;
  if (values.sharedRequestedSectionId !== undefined) row.shared_requested_section_id = values.sharedRequestedSectionId;
  if (values.sharedRequestChecksum !== undefined) row.shared_request_checksum = values.sharedRequestChecksum;
  if (values.copyCount !== undefined) row.copy_count = values.copyCount;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.derivedFromBankId !== undefined) row.derived_from_bank_id = values.derivedFromBankId;
  if (values.derivedFromExamId !== undefined) row.derived_from_exam_id = values.derivedFromExamId;
  if (values.derivedFromMatrixId !== undefined) row.derived_from_matrix_id = values.derivedFromMatrixId;
  if (values.derivedFromVersionNumber !== undefined) row.derived_from_version_number = values.derivedFromVersionNumber;
  if (values.id !== undefined) row.id = values.id;
  if (values.kind !== undefined) row.kind = values.kind;
  if (values.latestVersion !== undefined) row.latest_version = values.latestVersion;
  if (values.originalAuthorId !== undefined) row.original_author_id = values.originalAuthorId;
  if (values.status !== undefined) row.status = values.status;
  if (values.tenantId !== undefined) row.tenant_id = values.tenantId;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  if (values.withdrawnAt !== undefined) row.withdrawn_at = values.withdrawnAt;
  if (values.withdrawnBy !== undefined) row.withdrawn_by = values.withdrawnBy;
  if (values.withdrawnReason !== undefined) row.withdrawn_reason = values.withdrawnReason;
  return row;
}

function examUpdateSet(patch: Partial<ExamRow>): Updateable<CentreDB['exams']> {
  const set: Updateable<CentreDB['exams']> = {};
  if (patch.pinRequestId !== undefined) set.pin_request_id = patch.pinRequestId;
  if (patch.pinRequestCourseId !== undefined) set.pin_request_course_id = patch.pinRequestCourseId;
  if (patch.sharedExamVersionId !== undefined) set.shared_exam_version_id = patch.sharedExamVersionId;
  if (patch.sharedSourceExamId !== undefined) set.shared_source_exam_id = patch.sharedSourceExamId;
  if (patch.sharedSourceVersionNumber !== undefined) set.shared_source_version_number = patch.sharedSourceVersionNumber;
  if (patch.sharedRequestedSectionId !== undefined) set.shared_requested_section_id = patch.sharedRequestedSectionId;
  if (patch.sharedRequestChecksum !== undefined) set.shared_request_checksum = patch.sharedRequestChecksum;
  if (patch.bankId !== undefined) set.bank_id = patch.bankId;
  if (patch.copyCount !== undefined) set.copy_count = patch.copyCount;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  if (patch.createdBy !== undefined) set.created_by = patch.createdBy;
  if (patch.derivedFromBankId !== undefined) set.derived_from_bank_id = patch.derivedFromBankId;
  if (patch.derivedFromExamId !== undefined) set.derived_from_exam_id = patch.derivedFromExamId;
  if (patch.derivedFromMatrixId !== undefined) set.derived_from_matrix_id = patch.derivedFromMatrixId;
  if (patch.derivedFromVersionNumber !== undefined) set.derived_from_version_number = patch.derivedFromVersionNumber;
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.latestVersion !== undefined) set.latest_version = patch.latestVersion;
  if (patch.originalAuthorId !== undefined) set.original_author_id = patch.originalAuthorId;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.tenantId !== undefined) set.tenant_id = patch.tenantId;
  if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt;
  if (patch.withdrawnAt !== undefined) set.withdrawn_at = patch.withdrawnAt;
  if (patch.withdrawnBy !== undefined) set.withdrawn_by = patch.withdrawnBy;
  if (patch.withdrawnReason !== undefined) set.withdrawn_reason = patch.withdrawnReason;
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
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.durationMinutes !== undefined) row.duration_minutes = values.durationMinutes;
  if (values.examKind !== undefined) row.exam_kind = values.examKind;
  if (values.grade !== undefined) row.grade = values.grade;
  if (values.id !== undefined) row.id = values.id;
  if (values.matrixId !== undefined) row.matrix_id = values.matrixId;
  if (values.matrixVersion !== undefined) row.matrix_version = values.matrixVersion;
  if (values.matrixVersionId !== undefined) row.matrix_version_id = values.matrixVersionId;
  if (values.subjectId !== undefined) row.subject_id = values.subjectId;
  if (values.tfScale !== undefined) row.tf_scale = values.tfScale === null ? null : jsonbValue(values.tfScale);
  if (values.totalScore !== undefined) row.total_score = values.totalScore;
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
  if (values.sourceDomain !== undefined) row.source_domain = values.sourceDomain;
  if (values.sourceSnapshot !== undefined) row.source_snapshot = values.sourceSnapshot === null ? null : jsonbValue(values.sourceSnapshot);
  if (values.clusterId !== undefined) row.cluster_id = values.clusterId;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.id !== undefined) row.id = values.id;
  if (values.matrixCellId !== undefined) row.matrix_cell_id = values.matrixCellId;
  if (values.maxMark !== undefined) row.max_mark = values.maxMark;
  if (values.pinnedVersionId !== undefined) row.pinned_version_id = values.pinnedVersionId;
  if (values.pinnedVersionNumber !== undefined) row.pinned_version_number = values.pinnedVersionNumber;
  if (values.section !== undefined) row.section = values.section;
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
  if (values.contentHash !== undefined) row.content_hash = values.contentHash;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.dossierExamVersionId !== undefined) row.dossier_exam_version_id = values.dossierExamVersionId;
  if (values.dossierExamVersionNumber !== undefined) row.dossier_exam_version_number = values.dossierExamVersionNumber;
  if (values.dossierMatrixId !== undefined) row.dossier_matrix_id = values.dossierMatrixId;
  if (values.dossierMatrixVersion !== undefined) row.dossier_matrix_version = values.dossierMatrixVersion;
  if (values.dossierMatrixVersionId !== undefined) row.dossier_matrix_version_id = values.dossierMatrixVersionId;
  if (values.dossierSpecSnapshot !== undefined) row.dossier_spec_snapshot = values.dossierSpecSnapshot === null ? null : jsonbValue(values.dossierSpecSnapshot);
  if (values.id !== undefined) row.id = values.id;
  if (values.mode !== undefined) row.mode = values.mode;
  if (values.nearDuplicateOf !== undefined) row.near_duplicate_of = values.nearDuplicateOf;
  if (values.note !== undefined) row.note = values.note;
  if (values.rejectReason !== undefined) row.reject_reason = values.rejectReason;
  if (values.resultExamId !== undefined) row.result_exam_id = values.resultExamId;
  if (values.reviewerId !== undefined) row.reviewer_id = values.reviewerId;
  if (values.sourceDossierId !== undefined) row.source_dossier_id = values.sourceDossierId;
  if (values.status !== undefined) row.status = values.status;
  if (values.targetExamId !== undefined) row.target_exam_id = values.targetExamId;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function examContributionUpdateSet(patch: Partial<ExamContributionRow>): UpdateObject<CentreDB, 'exam_contributions'> {
  const set: UpdateObject<CentreDB, 'exam_contributions'> = {};
  if (patch.contentHash !== undefined) set.content_hash = patch.contentHash;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  if (patch.dossierExamVersionId !== undefined) set.dossier_exam_version_id = patch.dossierExamVersionId;
  if (patch.dossierExamVersionNumber !== undefined) set.dossier_exam_version_number = patch.dossierExamVersionNumber;
  if (patch.dossierMatrixId !== undefined) set.dossier_matrix_id = patch.dossierMatrixId;
  if (patch.dossierMatrixVersion !== undefined) set.dossier_matrix_version = patch.dossierMatrixVersion;
  if (patch.dossierMatrixVersionId !== undefined) set.dossier_matrix_version_id = patch.dossierMatrixVersionId;
  if (patch.dossierSpecSnapshot !== undefined) set.dossier_spec_snapshot = patch.dossierSpecSnapshot === null ? null : jsonbValue(patch.dossierSpecSnapshot);
  if (patch.examId !== undefined) set.exam_id = patch.examId;
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.mode !== undefined) set.mode = patch.mode;
  if (patch.nearDuplicateOf !== undefined) set.near_duplicate_of = patch.nearDuplicateOf;
  if (patch.note !== undefined) set.note = patch.note;
  if (patch.proposerId !== undefined) set.proposer_id = patch.proposerId;
  if (patch.rejectReason !== undefined) set.reject_reason = patch.rejectReason;
  if (patch.resultExamId !== undefined) set.result_exam_id = patch.resultExamId;
  if (patch.reviewerId !== undefined) set.reviewer_id = patch.reviewerId;
  if (patch.sourceDossierId !== undefined) set.source_dossier_id = patch.sourceDossierId;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.targetBankId !== undefined) set.target_bank_id = patch.targetBankId;
  if (patch.targetExamId !== undefined) set.target_exam_id = patch.targetExamId;
  if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt;
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
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.id !== undefined) row.id = values.id;
  if (values.reason !== undefined) row.reason = values.reason;
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
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.examVersionId !== undefined) row.exam_version_id = values.examVersionId;
  if (values.examVersionNumber !== undefined) row.exam_version_number = values.examVersionNumber;
  if (values.id !== undefined) row.id = values.id;
  if (values.matrixId !== undefined) row.matrix_id = values.matrixId;
  if (values.matrixVersion !== undefined) row.matrix_version = values.matrixVersion;
  if (values.matrixVersionId !== undefined) row.matrix_version_id = values.matrixVersionId;
  if (values.note !== undefined) row.note = values.note;
  if (values.resultExamId !== undefined) row.result_exam_id = values.resultExamId;
  if (values.specSnapshot !== undefined) row.spec_snapshot = values.specSnapshot === null ? null : jsonbValue(values.specSnapshot);
  if (values.status !== undefined) row.status = values.status;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function examDossierUpdateSet(patch: Partial<ExamDossierRow>): UpdateObject<CentreDB, 'exam_dossiers'> {
  const set: UpdateObject<CentreDB, 'exam_dossiers'> = {};
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  if (patch.examId !== undefined) set.exam_id = patch.examId;
  if (patch.examVersionId !== undefined) set.exam_version_id = patch.examVersionId;
  if (patch.examVersionNumber !== undefined) set.exam_version_number = patch.examVersionNumber;
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.matrixId !== undefined) set.matrix_id = patch.matrixId;
  if (patch.matrixVersion !== undefined) set.matrix_version = patch.matrixVersion;
  if (patch.matrixVersionId !== undefined) set.matrix_version_id = patch.matrixVersionId;
  if (patch.note !== undefined) set.note = patch.note;
  if (patch.proposerId !== undefined) set.proposer_id = patch.proposerId;
  if (patch.resultExamId !== undefined) set.result_exam_id = patch.resultExamId;
  if (patch.specSnapshot !== undefined) set.spec_snapshot = patch.specSnapshot === null ? null : jsonbValue(patch.specSnapshot);
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.targetBankId !== undefined) set.target_bank_id = patch.targetBankId;
  if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt;
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
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.id !== undefined) row.id = values.id;
  if (values.reason !== undefined) row.reason = values.reason;
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
