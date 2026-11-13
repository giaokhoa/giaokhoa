/**
 * Repository của cụm NGÂN HÀNG ĐỀ trên Kysely.
 *
 * Vai trò: mọi truy cập tới danh tính đề (exams), version nội dung bất biến (exam_versions), slots ghim version câu (exam_slots), đề xuất đóng góp (exam_contributions + exam_contribution_reviews) và bộ hồ sơ duyệt đề (exam_dossiers + exam_dossier_reviews) tập trung ở đây, cộng các đường đọc tham chiếu phục vụ các truy vấn trên: lần ghim của đề (exam_pins — bề mặt sở hữu ở repository quiz cùng package), thông tin câu của slots (question, question_bank_entries, question_versions), tên/số version ma trận
 * (exam_matrices, exam_matrix_versions — bề mặt sở hữu ở repository
 * quiz) và kiểm tra giáo viên dạy khối (role_assignments, role, context, course). Repository không chứa luật nghiệp vụ — cổng quyền và vòng đời nằm ở tầng service phía ứng dụng; repository chỉ nhận handle (instance gốc hoặc transaction đang mở) để phía gọi ghép nhiều thao tác vào một transaction khi cần.
 *
 * Ràng buộc về truy vấn và hình dạng dữ liệu tại biên repository:
 * - Bên trong repository, truy vấn viết trên interface schema sinh
 *   bằng codegen: tên bảng/cột giữ nguyên snake_case của database, kiểu dòng nội bộ qua `Selectable`/`Insertable`/`Updateable`.
 * - Bên ngoài, repository trả NHẬN các hình dạng dòng camelCase như
 *   phía tiêu thụ đang dùng: cột được chọn bằng danh sách tường minh có bí danh (`bank_id as bankId`), giá trị ghi được ánh xạ từng trường từ camelCase sang snake_case ở các hàm `*InsertValues`/`*UpdateSet` trong file này. Phía tiêu thụ vì vậy chỉ đổi điểm import khi kho này chuyển đổi.
 * - Giá trị `undefined` bị LOẠI khỏi values/set trước khi gọi
 *   builder (thử nghiệm T-4 của pilot): trường vắng mặt phải để default của database quyết định; ngược lại `undefined` lọt vào mệnh đề WHERE sẽ bị driver gắn NULL và lặng lẽ không khớp dòng nào — vì vậy mọi giá trị where trong repository đều là tham số bắt buộc, không bao giờ `undefined`.
 * - Mọi giá trị jsonb khi ghi đều qua `jsonbValue` (serialize tường
 *   minh + `::jsonb`): driver `pg` hiểu nhầm một MẢNG ở cấp cao nhất là mảng PostgreSQL thay vì JSON (đo tại pilot).
 * - Repository không import từ `apps/*`, không đọc ALS/ngữ cảnh
 *   ứng dụng, không tự mở pool, không đọc biến môi trường: handle do tầng ứng dụng dựng bằng factory của package rồi truyền vào.
 */
import {sql, type InsertObject, type UpdateObject} from 'kysely';
import { extractRichTextPlainText, type RichTextDocument } from '@giaokhoa/contracts';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import { jsonbValue, jsonbField } from '../jsonb';
import { CONTEXT_LEVEL_COURSE } from './dashboard';

/** Handle giao dịch của kho trung tâm — kiểu `Transaction<CentreDB>` của package. */
export type ExamsTx = CentreTx;
/** Handle đọc/ghi mà repository nhận: transaction đang mở hoặc chính instance gốc. */
export type ExamsDb = CentreDb | CentreTx;

/**
 * Các archetype vai trò được coi là "đang dạy" cho cổng bảo mật đề định kỳ (`userTeachesGrade`): chỉ giáo viên (có/không quyền sửa). Đây là khái niệm KHÁC với `STAFF_ARCHETYPES` của messaging (`manager`, `coursecreator` cùng nằm trong staff nhưng không "dạy" khối) nên giữ hằng riêng, không dùng chung.
 */
export const TEACHER_ARCHETYPES = ['teacher', 'editingteacher'] as const;

/** Một dòng của bảng `exams` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamRow {
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

/** Dữ kiện ghi một dòng `exams` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExam {
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

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exams` (dùng cho cả select lẫn returning). */
export const EXAM_COLUMNS = [
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

/**
 * Ánh xạ dữ kiện ghi dòng `exams` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examInsertValues(values: NewExam): InsertObject<CentreDB, 'exams'> {
  return {
    bank_id: values.bankId,
    created_by: values.createdBy,
    ...(values.copyCount !== undefined ? { copy_count: values.copyCount } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.derivedFromBankId !== undefined ? { derived_from_bank_id: values.derivedFromBankId } : {}),
    ...(values.derivedFromExamId !== undefined ? { derived_from_exam_id: values.derivedFromExamId } : {}),
    ...(values.derivedFromMatrixId !== undefined ? { derived_from_matrix_id: values.derivedFromMatrixId } : {}),
    ...(values.derivedFromVersionNumber !== undefined ? { derived_from_version_number: values.derivedFromVersionNumber } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.kind !== undefined ? { kind: values.kind } : {}),
    ...(values.latestVersion !== undefined ? { latest_version: values.latestVersion } : {}),
    ...(values.originalAuthorId !== undefined ? { original_author_id: values.originalAuthorId } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.tenantId !== undefined ? { tenant_id: values.tenantId } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
    ...(values.withdrawnAt !== undefined ? { withdrawn_at: values.withdrawnAt } : {}),
    ...(values.withdrawnBy !== undefined ? { withdrawn_by: values.withdrawnBy } : {}),
    ...(values.withdrawnReason !== undefined ? { withdrawn_reason: values.withdrawnReason } : {}),
  };
}

/**
 * Ánh xạ một patch cập nhật dòng `exams` (camelCase) sang set
 * update (snake_case), LOẠI mọi trường `undefined` — patch chỉ
 * chứa trường nào thì chỉ trường đó đổi (quy tắc T-4); giá trị
 * jsonb đi qua `jsonbValue`. Mốc `updated_at` do repository
 * gắn sau cùng.
 */
function examUpdateSet(patch: Partial<ExamRow>): UpdateObject<CentreDB, 'exams'> {
  return {
    ...(patch.bankId !== undefined ? { bank_id: patch.bankId } : {}),
    ...(patch.copyCount !== undefined ? { copy_count: patch.copyCount } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
    ...(patch.createdBy !== undefined ? { created_by: patch.createdBy } : {}),
    ...(patch.derivedFromBankId !== undefined ? { derived_from_bank_id: patch.derivedFromBankId } : {}),
    ...(patch.derivedFromExamId !== undefined ? { derived_from_exam_id: patch.derivedFromExamId } : {}),
    ...(patch.derivedFromMatrixId !== undefined ? { derived_from_matrix_id: patch.derivedFromMatrixId } : {}),
    ...(patch.derivedFromVersionNumber !== undefined ? { derived_from_version_number: patch.derivedFromVersionNumber } : {}),
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.latestVersion !== undefined ? { latest_version: patch.latestVersion } : {}),
    ...(patch.originalAuthorId !== undefined ? { original_author_id: patch.originalAuthorId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.tenantId !== undefined ? { tenant_id: patch.tenantId } : {}),
    ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
    ...(patch.withdrawnAt !== undefined ? { withdrawn_at: patch.withdrawnAt } : {}),
    ...(patch.withdrawnBy !== undefined ? { withdrawn_by: patch.withdrawnBy } : {}),
    ...(patch.withdrawnReason !== undefined ? { withdrawn_reason: patch.withdrawnReason } : {}),
  };
}

/** Một dòng của bảng `exam_versions` (hình dạng camelCase phía tiêu thụ dùng). */
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

/** Dữ kiện ghi một dòng `exam_versions` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
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

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_versions` (dùng cho cả select lẫn returning). */
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

/**
 * Ánh xạ dữ kiện ghi dòng `exam_versions` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examVersionInsertValues(values: NewExamVersion): InsertObject<CentreDB, 'exam_versions'> {
  return {
    created_by: values.createdBy,
    exam_id: values.examId,
    name: values.name,
    version: values.version,
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.durationMinutes !== undefined ? { duration_minutes: values.durationMinutes } : {}),
    ...(values.examKind !== undefined ? { exam_kind: values.examKind } : {}),
    ...(values.grade !== undefined ? { grade: values.grade } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.matrixId !== undefined ? { matrix_id: values.matrixId } : {}),
    ...(values.matrixVersion !== undefined ? { matrix_version: values.matrixVersion } : {}),
    ...(values.matrixVersionId !== undefined ? { matrix_version_id: values.matrixVersionId } : {}),
    ...(values.subjectId !== undefined ? { subject_id: values.subjectId } : {}),
    ...(values.tfScale !== undefined ? { tf_scale: jsonbField(values.tfScale) } : {}),
    ...(values.totalScore !== undefined ? { total_score: values.totalScore } : {}),
  };
}

/** Một dòng của bảng `exam_slots` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamSlotRow {
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

/** Dữ kiện ghi một dòng `exam_slots` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamSlot {
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

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_slots` (dùng cho cả select lẫn returning). */
export const EXAM_SLOT_COLUMNS = [
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

/**
 * Ánh xạ dữ kiện ghi dòng `exam_slots` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examSlotInsertValues(values: NewExamSlot): InsertObject<CentreDB, 'exam_slots'> {
  return {
    exam_version_id: values.examVersionId,
    position: values.position,
    question_id: values.questionId,
    ...(values.clusterId !== undefined ? { cluster_id: values.clusterId } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.matrixCellId !== undefined ? { matrix_cell_id: values.matrixCellId } : {}),
    ...(values.maxMark !== undefined ? { max_mark: values.maxMark } : {}),
    ...(values.pinnedVersionId !== undefined ? { pinned_version_id: values.pinnedVersionId } : {}),
    ...(values.pinnedVersionNumber !== undefined ? { pinned_version_number: values.pinnedVersionNumber } : {}),
    ...(values.section !== undefined ? { section: values.section } : {}),
  };
}

/** Một dòng của bảng `exam_contributions` (hình dạng camelCase phía tiêu thụ dùng). */
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

/** Dữ kiện ghi một dòng `exam_contributions` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
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

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_contributions` (dùng cho cả select lẫn returning). */
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

/**
 * Ánh xạ dữ kiện ghi dòng `exam_contributions` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examContributionInsertValues(values: NewExamContribution): InsertObject<CentreDB, 'exam_contributions'> {
  return {
    exam_id: values.examId,
    proposer_id: values.proposerId,
    target_bank_id: values.targetBankId,
    ...(values.contentHash !== undefined ? { content_hash: values.contentHash } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.dossierExamVersionId !== undefined ? { dossier_exam_version_id: values.dossierExamVersionId } : {}),
    ...(values.dossierExamVersionNumber !== undefined ? { dossier_exam_version_number: values.dossierExamVersionNumber } : {}),
    ...(values.dossierMatrixId !== undefined ? { dossier_matrix_id: values.dossierMatrixId } : {}),
    ...(values.dossierMatrixVersion !== undefined ? { dossier_matrix_version: values.dossierMatrixVersion } : {}),
    ...(values.dossierMatrixVersionId !== undefined ? { dossier_matrix_version_id: values.dossierMatrixVersionId } : {}),
    ...(values.dossierSpecSnapshot !== undefined ? { dossier_spec_snapshot: jsonbField(values.dossierSpecSnapshot) } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.mode !== undefined ? { mode: values.mode } : {}),
    ...(values.nearDuplicateOf !== undefined ? { near_duplicate_of: values.nearDuplicateOf } : {}),
    ...(values.note !== undefined ? { note: values.note } : {}),
    ...(values.rejectReason !== undefined ? { reject_reason: values.rejectReason } : {}),
    ...(values.resultExamId !== undefined ? { result_exam_id: values.resultExamId } : {}),
    ...(values.reviewerId !== undefined ? { reviewer_id: values.reviewerId } : {}),
    ...(values.sourceDossierId !== undefined ? { source_dossier_id: values.sourceDossierId } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.targetExamId !== undefined ? { target_exam_id: values.targetExamId } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/**
 * Ánh xạ một patch cập nhật dòng `exam_contributions` (camelCase) sang set
 * update (snake_case), LOẠI mọi trường `undefined` — patch chỉ
 * chứa trường nào thì chỉ trường đó đổi (quy tắc T-4); giá trị
 * jsonb đi qua `jsonbValue`. Mốc `updated_at` do repository
 * gắn sau cùng.
 */
function examContributionUpdateSet(patch: Partial<ExamContributionRow>): UpdateObject<CentreDB, 'exam_contributions'> {
  return {
    ...(patch.contentHash !== undefined ? { content_hash: patch.contentHash } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
    ...(patch.dossierExamVersionId !== undefined ? { dossier_exam_version_id: patch.dossierExamVersionId } : {}),
    ...(patch.dossierExamVersionNumber !== undefined ? { dossier_exam_version_number: patch.dossierExamVersionNumber } : {}),
    ...(patch.dossierMatrixId !== undefined ? { dossier_matrix_id: patch.dossierMatrixId } : {}),
    ...(patch.dossierMatrixVersion !== undefined ? { dossier_matrix_version: patch.dossierMatrixVersion } : {}),
    ...(patch.dossierMatrixVersionId !== undefined ? { dossier_matrix_version_id: patch.dossierMatrixVersionId } : {}),
    ...(patch.dossierSpecSnapshot !== undefined ? { dossier_spec_snapshot: jsonbField(patch.dossierSpecSnapshot) } : {}),
    ...(patch.examId !== undefined ? { exam_id: patch.examId } : {}),
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
    ...(patch.nearDuplicateOf !== undefined ? { near_duplicate_of: patch.nearDuplicateOf } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.proposerId !== undefined ? { proposer_id: patch.proposerId } : {}),
    ...(patch.rejectReason !== undefined ? { reject_reason: patch.rejectReason } : {}),
    ...(patch.resultExamId !== undefined ? { result_exam_id: patch.resultExamId } : {}),
    ...(patch.reviewerId !== undefined ? { reviewer_id: patch.reviewerId } : {}),
    ...(patch.sourceDossierId !== undefined ? { source_dossier_id: patch.sourceDossierId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.targetBankId !== undefined ? { target_bank_id: patch.targetBankId } : {}),
    ...(patch.targetExamId !== undefined ? { target_exam_id: patch.targetExamId } : {}),
    ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
  };
}

/** Một dòng của bảng `exam_contribution_reviews` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamContributionReviewRow {
  contributionId: string;
  createdAt: Date;
  decision: string;
  id: string;
  level: number;
  reason: string | null;
  reviewerId: string;
}

/** Dữ kiện ghi một dòng `exam_contribution_reviews` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamContributionReview {
  contributionId: string;
  createdAt?: Date;
  decision: string;
  id?: string;
  level: number;
  reason?: string | null;
  reviewerId: string;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_contribution_reviews` (dùng cho cả select lẫn returning). */
const EXAM_CONTRIBUTION_REVIEW_COLUMNS = [
  'contribution_id as contributionId',
  'created_at as createdAt',
  'decision',
  'id',
  'level',
  'reason',
  'reviewer_id as reviewerId',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_contribution_reviews` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examContributionReviewInsertValues(values: NewExamContributionReview): InsertObject<CentreDB, 'exam_contribution_reviews'> {
  return {
    contribution_id: values.contributionId,
    decision: values.decision,
    level: values.level,
    reviewer_id: values.reviewerId,
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.reason !== undefined ? { reason: values.reason } : {}),
  };
}

/** Một dòng của bảng `exam_dossiers` (hình dạng camelCase phía tiêu thụ dùng). */
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

/** Dữ kiện ghi một dòng `exam_dossiers` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
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

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_dossiers` (dùng cho cả select lẫn returning). */
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

/**
 * Ánh xạ dữ kiện ghi dòng `exam_dossiers` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examDossierInsertValues(values: NewExamDossier): InsertObject<CentreDB, 'exam_dossiers'> {
  return {
    exam_id: values.examId,
    proposer_id: values.proposerId,
    target_bank_id: values.targetBankId,
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.examVersionId !== undefined ? { exam_version_id: values.examVersionId } : {}),
    ...(values.examVersionNumber !== undefined ? { exam_version_number: values.examVersionNumber } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.matrixId !== undefined ? { matrix_id: values.matrixId } : {}),
    ...(values.matrixVersion !== undefined ? { matrix_version: values.matrixVersion } : {}),
    ...(values.matrixVersionId !== undefined ? { matrix_version_id: values.matrixVersionId } : {}),
    ...(values.note !== undefined ? { note: values.note } : {}),
    ...(values.resultExamId !== undefined ? { result_exam_id: values.resultExamId } : {}),
    ...(values.specSnapshot !== undefined ? { spec_snapshot: jsonbField(values.specSnapshot) } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/**
 * Ánh xạ một patch cập nhật dòng `exam_dossiers` (camelCase) sang set
 * update (snake_case), LOẠI mọi trường `undefined` — patch chỉ
 * chứa trường nào thì chỉ trường đó đổi (quy tắc T-4); giá trị
 * jsonb đi qua `jsonbValue`. Mốc `updated_at` do repository
 * gắn sau cùng.
 */
function examDossierUpdateSet(patch: Partial<ExamDossierRow>): UpdateObject<CentreDB, 'exam_dossiers'> {
  return {
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
    ...(patch.examId !== undefined ? { exam_id: patch.examId } : {}),
    ...(patch.examVersionId !== undefined ? { exam_version_id: patch.examVersionId } : {}),
    ...(patch.examVersionNumber !== undefined ? { exam_version_number: patch.examVersionNumber } : {}),
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.matrixId !== undefined ? { matrix_id: patch.matrixId } : {}),
    ...(patch.matrixVersion !== undefined ? { matrix_version: patch.matrixVersion } : {}),
    ...(patch.matrixVersionId !== undefined ? { matrix_version_id: patch.matrixVersionId } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.proposerId !== undefined ? { proposer_id: patch.proposerId } : {}),
    ...(patch.resultExamId !== undefined ? { result_exam_id: patch.resultExamId } : {}),
    ...(patch.specSnapshot !== undefined ? { spec_snapshot: jsonbField(patch.specSnapshot) } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.targetBankId !== undefined ? { target_bank_id: patch.targetBankId } : {}),
    ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
  };
}

/** Một dòng của bảng `exam_dossier_reviews` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamDossierReviewRow {
  createdAt: Date;
  decision: string;
  dossierId: string;
  id: string;
  level: number;
  reason: string | null;
  reviewerId: string;
}

/** Dữ kiện ghi một dòng `exam_dossier_reviews` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamDossierReview {
  createdAt?: Date;
  decision: string;
  dossierId: string;
  id?: string;
  level: number;
  reason?: string | null;
  reviewerId: string;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_dossier_reviews` (dùng cho cả select lẫn returning). */
const EXAM_DOSSIER_REVIEW_COLUMNS = [
  'created_at as createdAt',
  'decision',
  'dossier_id as dossierId',
  'id',
  'level',
  'reason',
  'reviewer_id as reviewerId',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_dossier_reviews` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examDossierReviewInsertValues(values: NewExamDossierReview): InsertObject<CentreDB, 'exam_dossier_reviews'> {
  return {
    decision: values.decision,
    dossier_id: values.dossierId,
    level: values.level,
    reviewer_id: values.reviewerId,
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.reason !== undefined ? { reason: values.reason } : {}),
  };
}
/**
 * Kho dữ liệu của lớp Ngân hàng đề (EB-1): danh tính đề
 * (exam_papers) + version nội dung bất biến (exam_paper_versions) +
 * slots ghim version câu (exam_paper_slots) + đề xuất đóng góp
 * (exam_paper_contributions). Mọi truy vấn là truy vấn thuần; cổng
 * quyền và vòng đời nằm ở ExamsService.
 */
export class ExamsRepository {
  constructor(private readonly handle: CentreDb) {}

  /** Instance gốc (handle định tuyến theo trung tâm do tầng ứng dụng truyền vào). */
  private db(): CentreDb {
    return this.handle;
  }

  /** Mở một transaction trên kho trung tâm. */
  async transaction<T>(fn: (tx: ExamsTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async insertPaper(v: NewExam, db: ExamsDb = this.db()): Promise<ExamRow> {
    const row = await db.insertInto('exams').values(examInsertValues(v)).returning(EXAM_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }

  /** Các lần ghim của một đề (kèm tên khoá + số version đã ghim) — bề mặt thay cho danh sách deployments cũ. */
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
    const row = await db.insertInto('exam_versions').values(examVersionInsertValues(v)).returning(EXAM_VERSION_COLUMNS).executeTakeFirstOrThrow();
    return row;
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

  /**
   * Thông tin hiển thị của các câu trong slots: qtype + NHÃN hiển thị.
   * Câu hỏi không còn trường tên (quyết 12:04 ngày 26/10/2026) nên nhãn
   * là TRÍCH ĐOẠN nội dung thân câu của version mới nhất (text thuần,
   * cắt 120 ký tự) — trường trả về vẫn tên `name` vì đó là nhãn hiển
   * thị của slot ở mọi bề mặt tiêu thụ, không phải tên của câu hỏi.
   */
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

  /**
   * Bản mới nhất của một câu ở trạng thái ready (điểm phân giải ghim
   * khi soạn đề — cùng kỷ luật ghim của quiz.addSlot QB-3). Trả
   * undefined khi câu không có entry nào ở trạng thái ready
   * (draft/hidden đều không được đưa vào đề).
   */
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

  /** Trạng thái entry của các câu (để hiển thị trong chi tiết đề: câu đã rút khỏi ngân hàng vẫn đọc được trong version đã chụp). */
  async listQuestionEntryStatuses(questionIds: string[], db: ExamsDb = this.db()): Promise<{ questionId: string; status: string }[]> {
    if (questionIds.length === 0) return [];
    return db
      .selectFrom('question_bank_entries')
      .select(['question_bank_entries.question_id as questionId', 'question_bank_entries.status as status'])
      .where('question_bank_entries.question_id', 'in', questionIds)
      .execute();
  }

  /** Câu có tồn tại hay không (phân biệt 404 câu với 400 câu-chưa-ready). */
  async questionExists(questionId: string, db: ExamsDb = this.db()): Promise<boolean> {
    const row = await db
      .selectFrom('question')
      .select(['question.id as id'])
      .where('question.id', '=', questionId)
      .executeTakeFirst();
    return !!row;
  }

  async insertContribution(v: NewExamContribution, db: ExamsDb = this.db()): Promise<ExamContributionRow> {
    const row = await db.insertInto('exam_contributions').values(examContributionInsertValues(v)).returning(EXAM_CONTRIBUTION_COLUMNS).executeTakeFirstOrThrow();
    return row;
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

  /**
   * Đóng góp CHƯA CHỐT của cùng một đề vào cùng bank đích — diện
   * "chưa chốt" gồm cả `pending` (chờ cấp 1) và `pending_board`
   * (đã qua cấp 1, chờ ban giám hiệu): cả hai đều là một đề xuất
   * đang sống nên lần đề xuất trùng tiếp theo bị chặn. Mode
   * 'update' phân biệt theo đề đích (target_exam_id) vì một đề
   * nguồn có thể đồng thời đề xuất bản mới cho các đề đích khác
   * nhau ở các bank khác nhau; mode 'new' tra theo (đề, bank đích)
   * như trước.
   */
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

  /** Đóng góp sinh ra từ việc chuyển đổi một bộ hồ sơ cụ thể (neo idempotent của đường chuyển đổi hồ sơ treo). */
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

  /** Ghi một mốc duyệt của đóng góp (cấp 1 hoặc cấp 2) — sổ mốc duyệt của đường đóng góp duy nhất. */
  async insertContributionReview(v: NewExamContributionReview, db: ExamsDb = this.db()): Promise<ExamContributionReviewRow> {
    const row = await db.insertInto('exam_contribution_reviews').values(examContributionReviewInsertValues(v)).returning(EXAM_CONTRIBUTION_REVIEW_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }

  /** Toàn bộ mốc duyệt của một đóng góp theo thứ tự thời gian (cấp 1 trước cấp 2). */
  async listContributionReviews(contributionId: string, db: ExamsDb = this.db()): Promise<ExamContributionReviewRow[]> {
    return db
      .selectFrom('exam_contribution_reviews')
      .select(EXAM_CONTRIBUTION_REVIEW_COLUMNS)
      .where('contribution_id', '=', contributionId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  /**
   * Tăng copy_count của đề nguồn sau một lần copy thành công.
   * Biểu thức tăng giữ nguyên dạng SQL của đường bộ máy cũ
   * (`"exams"."copy_count" + 1`): cấm đổi thành đọc-cộng-ghi vì hai
   * lượt copy đồng thời sẽ mất một lượt tăng.
   */
  async bumpCopyCount(paperId: string, db: ExamsDb = this.db()): Promise<void> {
    await db
      .updateTable('exams')
      .set({ copy_count: sql<number>`"exams"."copy_count" + 1` })
      .where('id', '=', paperId)
      .execute();
  }

  // --- bộ hồ sơ duyệt đề (EB-3) --------------------------------------------------

  /** Tên + số version hiện tại của một ma trận (ghim vào bộ hồ sơ lúc nộp khi paper version không mang sẵn matrixVersion). */
  async getMatrixInfo(matrixId: string, db: ExamsDb = this.db()): Promise<{ name: string; version: number } | undefined> {
    return db
      .selectFrom('exam_matrices')
      .select(['exam_matrices.name as name', 'exam_matrices.version as version'])
      .where('exam_matrices.id', '=', matrixId)
      .executeTakeFirst();
  }

  /**
   * Id của hàng version bất biến tương ứng (ma trận, số version) —
   * điểm neo FK cho exam_versions/exam_dossiers.matrix_version_id.
   * Không có hàng version (ma trận dựng ngoài các đường tạo của
   * service) → null, nơi gọi giữ số version làm căn cứ hiển thị.
   */
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
    const row = await db.insertInto('exam_dossiers').values(examDossierInsertValues(v)).returning(EXAM_DOSSIER_COLUMNS).executeTakeFirstOrThrow();
    return row;
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

  /** Hàng chờ của một bank đích (mới nhất trước) — lọc theo quyền ở tầng service. */
  async listDossiersForBank(targetBankId: string, db: ExamsDb = this.db()): Promise<ExamDossierRow[]> {
    return db
      .selectFrom('exam_dossiers')
      .select(EXAM_DOSSIER_COLUMNS)
      .where('target_bank_id', '=', targetBankId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  /** MỌI bộ hồ sơ trong hệ thống — chỉ dùng cho đợt chuyển đổi hồ sơ treo sang đường đóng góp (chạy một lần ở ngữ cảnh platform). */
  async listAllDossiers(db: ExamsDb = this.db()): Promise<ExamDossierRow[]> {
    return db.selectFrom('exam_dossiers').select(EXAM_DOSSIER_COLUMNS).orderBy('created_at', 'asc').execute();
  }

  /** Mọi bộ hồ sơ của một người đóng góp (xem kết quả duyệt + lý do từ chối xuyên bank). */
  async listDossiersByProposer(proposerId: string, db: ExamsDb = this.db()): Promise<ExamDossierRow[]> {
    return db
      .selectFrom('exam_dossiers')
      .select(EXAM_DOSSIER_COLUMNS)
      .where('proposer_id', '=', proposerId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  /** Bộ hồ sơ ĐANG HIỆU LỰC chờ duyệt (pending/pending_board) của cùng một đề vào cùng bank đích — nộp trùng bị chặn 409. */
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
    const row = await db.insertInto('exam_dossier_reviews').values(examDossierReviewInsertValues(v)).returning(EXAM_DOSSIER_REVIEW_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }

  /** Vết duyệt của một bộ hồ sơ theo thứ tự thời gian (cấp 1 trước, cấp 2 sau). */
  async listDossierReviews(dossierId: string, db: ExamsDb = this.db()): Promise<ExamDossierReviewRow[]> {
    return db
      .selectFrom('exam_dossier_reviews')
      .select(EXAM_DOSSIER_REVIEW_COLUMNS)
      .where('dossier_id', '=', dossierId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * Người dùng có đang DẠY khối `grade` hay không (lớp bảo mật đề
   * định kỳ A.3.4): tồn tại một gán vai archetype giáo viên
   * (teacher/editingteacher) tại context của một khoá có grade khớp.
   */
  async userTeachesGrade(userId: string, grade: number, db: ExamsDb = this.db()): Promise<boolean> {
    const rows = await db
      .selectFrom('role_assignments')
      .innerJoin('role', 'role_assignments.role_id', 'role.id')
      .innerJoin('context', 'role_assignments.context_id', 'context.id')
      .innerJoin('course', 'context.instance_id', 'course.id')
      .select(['role_assignments.id as id'])
      .where('role_assignments.user_id', '=', userId)
      .where('context.context_level', '=', CONTEXT_LEVEL_COURSE)
      .where('course.grade', '=', grade)
      .where('role.archetype', 'in', [...TEACHER_ARCHETYPES])
      .limit(1)
      .execute();
    return rows.length > 0;
  }
}
