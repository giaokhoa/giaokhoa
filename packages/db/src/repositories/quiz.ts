/**
 * Repository của cụm GHIM ĐỀ + LƯỢT LÀM trên Kysely.
 *
 * Vai trò: mọi truy cập tới các bảng của lần ghim đề (exam_pins), ghi đè cài đặt (exam_pin_overrides), dải nhận xét (exam_pin_feedbacks), lượt làm (exam_attempts), sự kiện lượt làm (exam_attempt_events), vết cập nhật version của pin (exam_pin_version_updates), chấm lại theo đáp án (exam_attempt_regrades + exam_attempt_regrade_items) và ma trận đề (exam_matrices, exam_matrix_versions, exam_matrix_cells, exam_matrix_contributions) tập trung ở đây; thêm ba đường đọc tham chiếu đề đã ghim (exams, exam_versions, exam_slots — định danh/nội dung đề sống ở repository exams cùng package). Repository không chứa luật nghiệp vụ — cổng quyền, vòng đời lượt làm và giao dịch nằm ở tầng service phía ứng dụng; repository chỉ nhận handle
 * (instance gốc hoặc transaction đang mở) để phía gọi ghép nhiều
 * thao tác vào một transaction khi cần.
 *
 * Ràng buộc về truy vấn và hình dạng dữ liệu tại biên repository:
 * - Bên trong repository, truy vấn viết trên interface schema sinh
 *   bằng codegen: tên bảng/cột giữ nguyên snake_case của database, kiểu dòng nội bộ qua `Selectable`/`Insertable`/`Updateable`.
 * - Bên ngoài, repository trả NHẬN các hình dạng dòng camelCase như
 *   phía tiêu thụ đang dùng: cột được chọn bằng danh sách tường minh có bí danh (`course_id as courseId`), giá trị ghi được ánh xạ từng trường từ camelCase sang snake_case ở các hàm `*InsertValues`/`*UpdateSet` trong file này. Phía tiêu thụ vì vậy chỉ đổi điểm import khi kho này chuyển đổi.
 * - Giá trị `undefined` bị LOẠI khỏi values/set trước khi gọi
 *   builder (thử nghiệm T-4 của pilot): trường vắng mặt phải để default của database quyết định; ngược lại `undefined` lọt vào mệnh đề WHERE sẽ bị driver gắn NULL và lặng lẽ không khớp dòng nào — vì vậy mọi giá trị where trong repository đều là tham số bắt buộc, không bao giờ `undefined`.
 * - Mọi giá trị jsonb khi ghi đều qua `jsonbValue` (serialize tường
 *   minh + `::jsonb`): driver `pg` hiểu nhầm một MẢNG ở cấp cao nhất là mảng PostgreSQL thay vì JSON (đo tại pilot).
 * - Repository không import từ `apps/*`, không đọc ALS/ngữ cảnh
 *   ứng dụng, không tự mở pool, không đọc biến môi trường: handle do tầng ứng dụng dựng bằng factory của package rồi truyền vào.
 */
import {sql, type InsertObject, type UpdateObject} from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { ExamVariant } from '../jsonb-types';
import { EXAM_COLUMNS, EXAM_SLOT_COLUMNS, EXAM_VERSION_COLUMNS, type ExamRow, type ExamSlotRow, type ExamVersionRow } from './exams';
import { jsonbValue, jsonbField } from '../jsonb';

/** Handle giao dịch của kho trung tâm — kiểu `Transaction<CentreDB>` của package. */
export type QuizTx = CentreTx;
/** Handle đọc/ghi mà repository nhận: transaction đang mở hoặc chính instance gốc. */
export type QuizDb = CentreDb | CentreTx;

/**
 * Trần an toàn cho số lượt làm đọc theo một lần ghim (issue #489):
 * các đường đọc kết quả cần toàn bộ lượt để tính điểm/thống kê nên đây không phải cỡ trang — chỉ là mốc chặn truy vấn vô hạn khi dữ kiện bất thường. Mọi nơi gọi `listAttempts` đều truyền tường minh.
 */
export const QUIZ_PIN_ATTEMPTS_LIMIT = 10_000;

/** Một dòng của bảng `exam_pins` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamPinRow {
  attemptsAllowed: number;
  cmId: string | null;
  courseId: string;
  createdAt: Date;
  createdBy: string;
  examId: string;
  examVersionId: string;
  gradeMethod: string;
  id: string;
  intro: string;
  lateEntryMinutes: number | null;
  monitorEvents: boolean;
  name: string | null;
  passwordHash: string | null;
  preset: string | null;
  resultsPublishedAt: Date | null;
  reviewAttempt: number;
  reviewCorrectness: number;
  reviewGeneralFeedback: number;
  reviewMarks: number;
  reviewOverallFeedback: number;
  reviewRightAnswer: number;
  reviewSpecificFeedback: number;
  shuffleAnswers: boolean;
  subnet: string | null;
  targetGroupId: string | null;
  timeClose: Date | null;
  timeLimit: number | null;
  timeOpen: Date | null;
  updatedAt: Date;
  variantCount: number;
  variants: ExamVariant[];
  versionMode: string;
}

/** Dữ kiện ghi một dòng `exam_pins` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamPin {
  attemptsAllowed?: number;
  cmId?: string | null;
  courseId: string;
  createdAt?: Date;
  createdBy: string;
  examId: string;
  examVersionId: string;
  gradeMethod?: string;
  id?: string;
  intro?: string;
  lateEntryMinutes?: number | null;
  monitorEvents?: boolean;
  name?: string | null;
  passwordHash?: string | null;
  preset?: string | null;
  resultsPublishedAt?: Date | null;
  reviewAttempt?: number;
  reviewCorrectness?: number;
  reviewGeneralFeedback?: number;
  reviewMarks?: number;
  reviewOverallFeedback?: number;
  reviewRightAnswer?: number;
  reviewSpecificFeedback?: number;
  shuffleAnswers?: boolean;
  subnet?: string | null;
  targetGroupId?: string | null;
  timeClose?: Date | null;
  timeLimit?: number | null;
  timeOpen?: Date | null;
  updatedAt?: Date;
  variantCount?: number;
  variants: ExamVariant[];
  versionMode?: string;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_pins` (dùng cho cả select lẫn returning). */
const EXAM_PIN_COLUMNS = [
  'attempts_allowed as attemptsAllowed',
  'cm_id as cmId',
  'course_id as courseId',
  'created_at as createdAt',
  'created_by as createdBy',
  'exam_id as examId',
  'exam_version_id as examVersionId',
  'grade_method as gradeMethod',
  'id',
  'intro',
  'late_entry_minutes as lateEntryMinutes',
  'monitor_events as monitorEvents',
  'name',
  'password_hash as passwordHash',
  'preset',
  'results_published_at as resultsPublishedAt',
  'review_attempt as reviewAttempt',
  'review_correctness as reviewCorrectness',
  'review_general_feedback as reviewGeneralFeedback',
  'review_marks as reviewMarks',
  'review_overall_feedback as reviewOverallFeedback',
  'review_right_answer as reviewRightAnswer',
  'review_specific_feedback as reviewSpecificFeedback',
  'shuffle_answers as shuffleAnswers',
  'subnet',
  'target_group_id as targetGroupId',
  'time_close as timeClose',
  'time_limit as timeLimit',
  'time_open as timeOpen',
  'updated_at as updatedAt',
  'variant_count as variantCount',
  'variants',
  'version_mode as versionMode',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_pins` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examPinInsertValues(values: NewExamPin): InsertObject<CentreDB, 'exam_pins'> {
  return {
    course_id: values.courseId,
    created_by: values.createdBy,
    exam_id: values.examId,
    exam_version_id: values.examVersionId,
    variants: jsonbValue(values.variants),
    ...(values.attemptsAllowed !== undefined ? { attempts_allowed: values.attemptsAllowed } : {}),
    ...(values.cmId !== undefined ? { cm_id: values.cmId } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.gradeMethod !== undefined ? { grade_method: values.gradeMethod } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.intro !== undefined ? { intro: values.intro } : {}),
    ...(values.lateEntryMinutes !== undefined ? { late_entry_minutes: values.lateEntryMinutes } : {}),
    ...(values.monitorEvents !== undefined ? { monitor_events: values.monitorEvents } : {}),
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.passwordHash !== undefined ? { password_hash: values.passwordHash } : {}),
    ...(values.preset !== undefined ? { preset: values.preset } : {}),
    ...(values.resultsPublishedAt !== undefined ? { results_published_at: values.resultsPublishedAt } : {}),
    ...(values.reviewAttempt !== undefined ? { review_attempt: values.reviewAttempt } : {}),
    ...(values.reviewCorrectness !== undefined ? { review_correctness: values.reviewCorrectness } : {}),
    ...(values.reviewGeneralFeedback !== undefined ? { review_general_feedback: values.reviewGeneralFeedback } : {}),
    ...(values.reviewMarks !== undefined ? { review_marks: values.reviewMarks } : {}),
    ...(values.reviewOverallFeedback !== undefined ? { review_overall_feedback: values.reviewOverallFeedback } : {}),
    ...(values.reviewRightAnswer !== undefined ? { review_right_answer: values.reviewRightAnswer } : {}),
    ...(values.reviewSpecificFeedback !== undefined ? { review_specific_feedback: values.reviewSpecificFeedback } : {}),
    ...(values.shuffleAnswers !== undefined ? { shuffle_answers: values.shuffleAnswers } : {}),
    ...(values.subnet !== undefined ? { subnet: values.subnet } : {}),
    ...(values.targetGroupId !== undefined ? { target_group_id: values.targetGroupId } : {}),
    ...(values.timeClose !== undefined ? { time_close: values.timeClose } : {}),
    ...(values.timeLimit !== undefined ? { time_limit: values.timeLimit } : {}),
    ...(values.timeOpen !== undefined ? { time_open: values.timeOpen } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
    ...(values.variantCount !== undefined ? { variant_count: values.variantCount } : {}),
    ...(values.versionMode !== undefined ? { version_mode: values.versionMode } : {}),
  };
}

/**
 * Ánh xạ một patch cập nhật dòng `exam_pins` (camelCase) sang set
 * update (snake_case), LOẠI mọi trường `undefined` — patch chỉ
 * chứa trường nào thì chỉ trường đó đổi (quy tắc T-4); giá trị
 * jsonb đi qua `jsonbValue`. Mốc `updated_at` do repository
 * gắn sau cùng.
 */
function examPinUpdateSet(patch: Partial<ExamPinRow>): UpdateObject<CentreDB, 'exam_pins'> {
  return {
    ...(patch.attemptsAllowed !== undefined ? { attempts_allowed: patch.attemptsAllowed } : {}),
    ...(patch.cmId !== undefined ? { cm_id: patch.cmId } : {}),
    ...(patch.courseId !== undefined ? { course_id: patch.courseId } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
    ...(patch.createdBy !== undefined ? { created_by: patch.createdBy } : {}),
    ...(patch.examId !== undefined ? { exam_id: patch.examId } : {}),
    ...(patch.examVersionId !== undefined ? { exam_version_id: patch.examVersionId } : {}),
    ...(patch.gradeMethod !== undefined ? { grade_method: patch.gradeMethod } : {}),
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.intro !== undefined ? { intro: patch.intro } : {}),
    ...(patch.lateEntryMinutes !== undefined ? { late_entry_minutes: patch.lateEntryMinutes } : {}),
    ...(patch.monitorEvents !== undefined ? { monitor_events: patch.monitorEvents } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.passwordHash !== undefined ? { password_hash: patch.passwordHash } : {}),
    ...(patch.preset !== undefined ? { preset: patch.preset } : {}),
    ...(patch.resultsPublishedAt !== undefined ? { results_published_at: patch.resultsPublishedAt } : {}),
    ...(patch.reviewAttempt !== undefined ? { review_attempt: patch.reviewAttempt } : {}),
    ...(patch.reviewCorrectness !== undefined ? { review_correctness: patch.reviewCorrectness } : {}),
    ...(patch.reviewGeneralFeedback !== undefined ? { review_general_feedback: patch.reviewGeneralFeedback } : {}),
    ...(patch.reviewMarks !== undefined ? { review_marks: patch.reviewMarks } : {}),
    ...(patch.reviewOverallFeedback !== undefined ? { review_overall_feedback: patch.reviewOverallFeedback } : {}),
    ...(patch.reviewRightAnswer !== undefined ? { review_right_answer: patch.reviewRightAnswer } : {}),
    ...(patch.reviewSpecificFeedback !== undefined ? { review_specific_feedback: patch.reviewSpecificFeedback } : {}),
    ...(patch.shuffleAnswers !== undefined ? { shuffle_answers: patch.shuffleAnswers } : {}),
    ...(patch.subnet !== undefined ? { subnet: patch.subnet } : {}),
    ...(patch.targetGroupId !== undefined ? { target_group_id: patch.targetGroupId } : {}),
    ...(patch.timeClose !== undefined ? { time_close: patch.timeClose } : {}),
    ...(patch.timeLimit !== undefined ? { time_limit: patch.timeLimit } : {}),
    ...(patch.timeOpen !== undefined ? { time_open: patch.timeOpen } : {}),
    ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
    ...(patch.variantCount !== undefined ? { variant_count: patch.variantCount } : {}),
    ...(patch.variants !== undefined ? { variants: jsonbValue(patch.variants) } : {}),
    ...(patch.versionMode !== undefined ? { version_mode: patch.versionMode } : {}),
  };
}

/** Một dòng của bảng `exam_attempts` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamAttemptRow {
  appliedSettings: Record<string, unknown> | null;
  attemptNumber: number;
  createdAt: Date;
  id: string;
  makeup: boolean;
  pinId: string;
  preview: boolean;
  state: string;
  sumGrades: number | null;
  timeFinish: Date | null;
  timeStart: Date;
  updatedAt: Date;
  usageId: string;
  userId: string;
}

/** Dữ kiện ghi một dòng `exam_attempts` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamAttempt {
  appliedSettings?: Record<string, unknown> | null;
  attemptNumber: number;
  createdAt?: Date;
  id?: string;
  makeup?: boolean;
  pinId: string;
  preview?: boolean;
  state?: string;
  sumGrades?: number | null;
  timeFinish?: Date | null;
  timeStart?: Date;
  updatedAt?: Date;
  usageId: string;
  userId: string;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_attempts` (dùng cho cả select lẫn returning). */
const EXAM_ATTEMPT_COLUMNS = [
  'applied_settings as appliedSettings',
  'attempt_number as attemptNumber',
  'created_at as createdAt',
  'id',
  'makeup',
  'pin_id as pinId',
  'preview',
  'state',
  'sum_grades as sumGrades',
  'time_finish as timeFinish',
  'time_start as timeStart',
  'updated_at as updatedAt',
  'usage_id as usageId',
  'user_id as userId',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_attempts` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examAttemptInsertValues(values: NewExamAttempt): InsertObject<CentreDB, 'exam_attempts'> {
  return {
    attempt_number: values.attemptNumber,
    pin_id: values.pinId,
    usage_id: values.usageId,
    user_id: values.userId,
    ...(values.appliedSettings !== undefined ? { applied_settings: jsonbField(values.appliedSettings) } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.makeup !== undefined ? { makeup: values.makeup } : {}),
    ...(values.preview !== undefined ? { preview: values.preview } : {}),
    ...(values.state !== undefined ? { state: values.state } : {}),
    ...(values.sumGrades !== undefined ? { sum_grades: values.sumGrades } : {}),
    ...(values.timeFinish !== undefined ? { time_finish: values.timeFinish } : {}),
    ...(values.timeStart !== undefined ? { time_start: values.timeStart } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/**
 * Ánh xạ một patch cập nhật dòng `exam_attempts` (camelCase) sang set
 * update (snake_case), LOẠI mọi trường `undefined` — patch chỉ
 * chứa trường nào thì chỉ trường đó đổi (quy tắc T-4); giá trị
 * jsonb đi qua `jsonbValue`. Mốc `updated_at` do repository
 * gắn sau cùng.
 */
function examAttemptUpdateSet(patch: Partial<ExamAttemptRow>): UpdateObject<CentreDB, 'exam_attempts'> {
  return {
    ...(patch.appliedSettings !== undefined ? { applied_settings: jsonbField(patch.appliedSettings) } : {}),
    ...(patch.attemptNumber !== undefined ? { attempt_number: patch.attemptNumber } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.makeup !== undefined ? { makeup: patch.makeup } : {}),
    ...(patch.pinId !== undefined ? { pin_id: patch.pinId } : {}),
    ...(patch.preview !== undefined ? { preview: patch.preview } : {}),
    ...(patch.state !== undefined ? { state: patch.state } : {}),
    ...(patch.sumGrades !== undefined ? { sum_grades: patch.sumGrades } : {}),
    ...(patch.timeFinish !== undefined ? { time_finish: patch.timeFinish } : {}),
    ...(patch.timeStart !== undefined ? { time_start: patch.timeStart } : {}),
    ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
    ...(patch.usageId !== undefined ? { usage_id: patch.usageId } : {}),
    ...(patch.userId !== undefined ? { user_id: patch.userId } : {}),
  };
}

/** Một dòng của bảng `exam_pin_overrides` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamPinOverrideRow {
  attempts: number | null;
  createdAt: Date;
  groupId: string | null;
  id: string;
  passwordHash: string | null;
  pinId: string;
  reason: string | null;
  timeClose: Date | null;
  timeLimit: number | null;
  timeOpen: Date | null;
  updatedAt: Date;
  userId: string | null;
}

/** Dữ kiện ghi một dòng `exam_pin_overrides` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamPinOverride {
  attempts?: number | null;
  createdAt?: Date;
  groupId?: string | null;
  id?: string;
  passwordHash?: string | null;
  pinId: string;
  reason?: string | null;
  timeClose?: Date | null;
  timeLimit?: number | null;
  timeOpen?: Date | null;
  updatedAt?: Date;
  userId?: string | null;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_pin_overrides` (dùng cho cả select lẫn returning). */
const EXAM_PIN_OVERRIDE_COLUMNS = [
  'attempts',
  'created_at as createdAt',
  'group_id as groupId',
  'id',
  'password_hash as passwordHash',
  'pin_id as pinId',
  'reason',
  'time_close as timeClose',
  'time_limit as timeLimit',
  'time_open as timeOpen',
  'updated_at as updatedAt',
  'user_id as userId',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_pin_overrides` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examPinOverrideInsertValues(values: NewExamPinOverride): InsertObject<CentreDB, 'exam_pin_overrides'> {
  return {
    pin_id: values.pinId,
    ...(values.attempts !== undefined ? { attempts: values.attempts } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.groupId !== undefined ? { group_id: values.groupId } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.passwordHash !== undefined ? { password_hash: values.passwordHash } : {}),
    ...(values.reason !== undefined ? { reason: values.reason } : {}),
    ...(values.timeClose !== undefined ? { time_close: values.timeClose } : {}),
    ...(values.timeLimit !== undefined ? { time_limit: values.timeLimit } : {}),
    ...(values.timeOpen !== undefined ? { time_open: values.timeOpen } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
    ...(values.userId !== undefined ? { user_id: values.userId } : {}),
  };
}

/**
 * Ánh xạ một patch cập nhật dòng `exam_pin_overrides` (camelCase) sang set
 * update (snake_case), LOẠI mọi trường `undefined` — patch chỉ
 * chứa trường nào thì chỉ trường đó đổi (quy tắc T-4); giá trị
 * jsonb đi qua `jsonbValue`. Mốc `updated_at` do repository
 * gắn sau cùng.
 */
function examPinOverrideUpdateSet(patch: Partial<ExamPinOverrideRow>): UpdateObject<CentreDB, 'exam_pin_overrides'> {
  return {
    ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
    ...(patch.groupId !== undefined ? { group_id: patch.groupId } : {}),
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.passwordHash !== undefined ? { password_hash: patch.passwordHash } : {}),
    ...(patch.pinId !== undefined ? { pin_id: patch.pinId } : {}),
    ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
    ...(patch.timeClose !== undefined ? { time_close: patch.timeClose } : {}),
    ...(patch.timeLimit !== undefined ? { time_limit: patch.timeLimit } : {}),
    ...(patch.timeOpen !== undefined ? { time_open: patch.timeOpen } : {}),
    ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
    ...(patch.userId !== undefined ? { user_id: patch.userId } : {}),
  };
}

/** Một dòng của bảng `exam_matrices` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamMatrixRow {
  bankId: string | null;
  contentSignature: string | null;
  contextId: string;
  copyCount: number;
  createdAt: Date;
  createdBy: string | null;
  curriculumId: string;
  derivedFromBankId: string | null;
  derivedFromMatrixId: string | null;
  id: string;
  isTemplate: boolean;
  levelSet: string;
  name: string;
  originalAuthorId: string | null;
  presetKind: string;
  scopeNodeIds: string[] | null;
  scopeNote: string | null;
  status: string;
  subjectId: string;
  targetFormPercents: Record<string, number> | null;
  targetLevelPercents: Record<string, number> | null;
  tenantId: string | null;
  totalScore: number;
  updatedAt: Date;
  version: number;
  withdrawnAt: Date | null;
  withdrawnBy: string | null;
  withdrawnReason: string | null;
}

/** Dữ kiện ghi một dòng `exam_matrices` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamMatrix {
  bankId?: string | null;
  contentSignature?: string | null;
  contextId: string;
  copyCount?: number;
  createdAt?: Date;
  createdBy?: string | null;
  curriculumId: string;
  derivedFromBankId?: string | null;
  derivedFromMatrixId?: string | null;
  id?: string;
  isTemplate?: boolean;
  levelSet?: string;
  name: string;
  originalAuthorId?: string | null;
  presetKind?: string;
  scopeNodeIds?: string[] | null;
  scopeNote?: string | null;
  status?: string;
  subjectId: string;
  targetFormPercents?: Record<string, number> | null;
  targetLevelPercents?: Record<string, number> | null;
  tenantId?: string | null;
  totalScore?: number;
  updatedAt?: Date;
  version?: number;
  withdrawnAt?: Date | null;
  withdrawnBy?: string | null;
  withdrawnReason?: string | null;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_matrices` (dùng cho cả select lẫn returning). */
const EXAM_MATRIX_COLUMNS = [
  'bank_id as bankId',
  'content_signature as contentSignature',
  'context_id as contextId',
  'copy_count as copyCount',
  'created_at as createdAt',
  'created_by as createdBy',
  'curriculum_id as curriculumId',
  'derived_from_bank_id as derivedFromBankId',
  'derived_from_matrix_id as derivedFromMatrixId',
  'id',
  'is_template as isTemplate',
  'level_set as levelSet',
  'name',
  'original_author_id as originalAuthorId',
  'preset_kind as presetKind',
  'scope_node_ids as scopeNodeIds',
  'scope_note as scopeNote',
  'status',
  'subject_id as subjectId',
  'target_form_percents as targetFormPercents',
  'target_level_percents as targetLevelPercents',
  'tenant_id as tenantId',
  'total_score as totalScore',
  'updated_at as updatedAt',
  'version',
  'withdrawn_at as withdrawnAt',
  'withdrawn_by as withdrawnBy',
  'withdrawn_reason as withdrawnReason',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_matrices` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examMatrixInsertValues(values: NewExamMatrix): InsertObject<CentreDB, 'exam_matrices'> {
  return {
    context_id: values.contextId,
    curriculum_id: values.curriculumId,
    name: values.name,
    subject_id: values.subjectId,
    ...(values.bankId !== undefined ? { bank_id: values.bankId } : {}),
    ...(values.contentSignature !== undefined ? { content_signature: values.contentSignature } : {}),
    ...(values.copyCount !== undefined ? { copy_count: values.copyCount } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.createdBy !== undefined ? { created_by: values.createdBy } : {}),
    ...(values.derivedFromBankId !== undefined ? { derived_from_bank_id: values.derivedFromBankId } : {}),
    ...(values.derivedFromMatrixId !== undefined ? { derived_from_matrix_id: values.derivedFromMatrixId } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.isTemplate !== undefined ? { is_template: values.isTemplate } : {}),
    ...(values.levelSet !== undefined ? { level_set: values.levelSet } : {}),
    ...(values.originalAuthorId !== undefined ? { original_author_id: values.originalAuthorId } : {}),
    ...(values.presetKind !== undefined ? { preset_kind: values.presetKind } : {}),
    ...(values.scopeNodeIds !== undefined ? { scope_node_ids: jsonbField(values.scopeNodeIds) } : {}),
    ...(values.scopeNote !== undefined ? { scope_note: values.scopeNote } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.targetFormPercents !== undefined ? { target_form_percents: jsonbField(values.targetFormPercents) } : {}),
    ...(values.targetLevelPercents !== undefined ? { target_level_percents: jsonbField(values.targetLevelPercents) } : {}),
    ...(values.tenantId !== undefined ? { tenant_id: values.tenantId } : {}),
    ...(values.totalScore !== undefined ? { total_score: values.totalScore } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
    ...(values.version !== undefined ? { version: values.version } : {}),
    ...(values.withdrawnAt !== undefined ? { withdrawn_at: values.withdrawnAt } : {}),
    ...(values.withdrawnBy !== undefined ? { withdrawn_by: values.withdrawnBy } : {}),
    ...(values.withdrawnReason !== undefined ? { withdrawn_reason: values.withdrawnReason } : {}),
  };
}

/**
 * Ánh xạ một patch cập nhật dòng `exam_matrices` (camelCase) sang set
 * update (snake_case), LOẠI mọi trường `undefined` — patch chỉ
 * chứa trường nào thì chỉ trường đó đổi (quy tắc T-4); giá trị
 * jsonb đi qua `jsonbValue`. Mốc `updated_at` do repository
 * gắn sau cùng.
 */
function examMatrixUpdateSet(patch: Partial<ExamMatrixRow>): UpdateObject<CentreDB, 'exam_matrices'> {
  return {
    ...(patch.bankId !== undefined ? { bank_id: patch.bankId } : {}),
    ...(patch.contentSignature !== undefined ? { content_signature: patch.contentSignature } : {}),
    ...(patch.contextId !== undefined ? { context_id: patch.contextId } : {}),
    ...(patch.copyCount !== undefined ? { copy_count: patch.copyCount } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
    ...(patch.createdBy !== undefined ? { created_by: patch.createdBy } : {}),
    ...(patch.curriculumId !== undefined ? { curriculum_id: patch.curriculumId } : {}),
    ...(patch.derivedFromBankId !== undefined ? { derived_from_bank_id: patch.derivedFromBankId } : {}),
    ...(patch.derivedFromMatrixId !== undefined ? { derived_from_matrix_id: patch.derivedFromMatrixId } : {}),
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.isTemplate !== undefined ? { is_template: patch.isTemplate } : {}),
    ...(patch.levelSet !== undefined ? { level_set: patch.levelSet } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.originalAuthorId !== undefined ? { original_author_id: patch.originalAuthorId } : {}),
    ...(patch.presetKind !== undefined ? { preset_kind: patch.presetKind } : {}),
    ...(patch.scopeNodeIds !== undefined ? { scope_node_ids: jsonbField(patch.scopeNodeIds) } : {}),
    ...(patch.scopeNote !== undefined ? { scope_note: patch.scopeNote } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.subjectId !== undefined ? { subject_id: patch.subjectId } : {}),
    ...(patch.targetFormPercents !== undefined ? { target_form_percents: jsonbField(patch.targetFormPercents) } : {}),
    ...(patch.targetLevelPercents !== undefined ? { target_level_percents: jsonbField(patch.targetLevelPercents) } : {}),
    ...(patch.tenantId !== undefined ? { tenant_id: patch.tenantId } : {}),
    ...(patch.totalScore !== undefined ? { total_score: patch.totalScore } : {}),
    ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
    ...(patch.version !== undefined ? { version: patch.version } : {}),
    ...(patch.withdrawnAt !== undefined ? { withdrawn_at: patch.withdrawnAt } : {}),
    ...(patch.withdrawnBy !== undefined ? { withdrawn_by: patch.withdrawnBy } : {}),
    ...(patch.withdrawnReason !== undefined ? { withdrawn_reason: patch.withdrawnReason } : {}),
  };
}

/** Một dòng của bảng `exam_matrix_versions` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamMatrixVersionRow {
  createdAt: Date;
  createdBy: string;
  id: string;
  levelSet: string;
  matrixId: string;
  presetKind: string;
  scopeNodeIds: string[] | null;
  scopeNote: string | null;
  targetFormPercents: Record<string, number> | null;
  targetLevelPercents: Record<string, number> | null;
  totalScore: number;
  version: number;
}

/** Dữ kiện ghi một dòng `exam_matrix_versions` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamMatrixVersion {
  createdAt?: Date;
  createdBy: string;
  id?: string;
  levelSet?: string;
  matrixId: string;
  presetKind?: string;
  scopeNodeIds?: string[] | null;
  scopeNote?: string | null;
  targetFormPercents?: Record<string, number> | null;
  targetLevelPercents?: Record<string, number> | null;
  totalScore?: number;
  version: number;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_matrix_versions` (dùng cho cả select lẫn returning). */
const EXAM_MATRIX_VERSION_COLUMNS = [
  'created_at as createdAt',
  'created_by as createdBy',
  'id',
  'level_set as levelSet',
  'matrix_id as matrixId',
  'preset_kind as presetKind',
  'scope_node_ids as scopeNodeIds',
  'scope_note as scopeNote',
  'target_form_percents as targetFormPercents',
  'target_level_percents as targetLevelPercents',
  'total_score as totalScore',
  'version',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_matrix_versions` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examMatrixVersionInsertValues(values: NewExamMatrixVersion): InsertObject<CentreDB, 'exam_matrix_versions'> {
  return {
    created_by: values.createdBy,
    matrix_id: values.matrixId,
    version: values.version,
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.levelSet !== undefined ? { level_set: values.levelSet } : {}),
    ...(values.presetKind !== undefined ? { preset_kind: values.presetKind } : {}),
    ...(values.scopeNodeIds !== undefined ? { scope_node_ids: jsonbField(values.scopeNodeIds) } : {}),
    ...(values.scopeNote !== undefined ? { scope_note: values.scopeNote } : {}),
    ...(values.targetFormPercents !== undefined ? { target_form_percents: jsonbField(values.targetFormPercents) } : {}),
    ...(values.targetLevelPercents !== undefined ? { target_level_percents: jsonbField(values.targetLevelPercents) } : {}),
    ...(values.totalScore !== undefined ? { total_score: values.totalScore } : {}),
  };
}

/** Một dòng của bảng `exam_matrix_cells` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamMatrixCellRow {
  cellScore: number;
  cognitiveLevel: string;
  createdAt: Date;
  curriculumNodeId: string;
  id: string;
  matrixId: string;
  matrixVersionId: string;
  minutes: number | null;
  position: number;
  qtype: string;
  questionCount: number;
  tfScale: number[] | null;
  updatedAt: Date;
}

/** Dữ kiện ghi một dòng `exam_matrix_cells` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamMatrixCell {
  cellScore: number;
  cognitiveLevel: string;
  createdAt?: Date;
  curriculumNodeId: string;
  id?: string;
  matrixId: string;
  matrixVersionId: string;
  minutes?: number | null;
  position?: number;
  qtype: string;
  questionCount: number;
  tfScale?: number[] | null;
  updatedAt?: Date;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_matrix_cells` (dùng cho cả select lẫn returning). */
const EXAM_MATRIX_CELL_COLUMNS = [
  'cell_score as cellScore',
  'cognitive_level as cognitiveLevel',
  'created_at as createdAt',
  'curriculum_node_id as curriculumNodeId',
  'id',
  'matrix_id as matrixId',
  'matrix_version_id as matrixVersionId',
  'minutes',
  'position',
  'qtype',
  'question_count as questionCount',
  'tf_scale as tfScale',
  'updated_at as updatedAt',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_matrix_cells` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examMatrixCellInsertValues(values: NewExamMatrixCell): InsertObject<CentreDB, 'exam_matrix_cells'> {
  return {
    cell_score: values.cellScore,
    cognitive_level: values.cognitiveLevel,
    curriculum_node_id: values.curriculumNodeId,
    matrix_id: values.matrixId,
    matrix_version_id: values.matrixVersionId,
    qtype: values.qtype,
    question_count: values.questionCount,
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.minutes !== undefined ? { minutes: values.minutes } : {}),
    ...(values.position !== undefined ? { position: values.position } : {}),
    ...(values.tfScale !== undefined ? { tf_scale: jsonbField(values.tfScale) } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/**
 * Ánh xạ một patch cập nhật dòng `exam_matrix_cells` (camelCase) sang set
 * update (snake_case), LOẠI mọi trường `undefined` — patch chỉ
 * chứa trường nào thì chỉ trường đó đổi (quy tắc T-4); giá trị
 * jsonb đi qua `jsonbValue`. Mốc `updated_at` do repository
 * gắn sau cùng.
 */
function examMatrixCellUpdateSet(patch: Partial<ExamMatrixCellRow>): UpdateObject<CentreDB, 'exam_matrix_cells'> {
  return {
    ...(patch.cellScore !== undefined ? { cell_score: patch.cellScore } : {}),
    ...(patch.cognitiveLevel !== undefined ? { cognitive_level: patch.cognitiveLevel } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
    ...(patch.curriculumNodeId !== undefined ? { curriculum_node_id: patch.curriculumNodeId } : {}),
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.matrixId !== undefined ? { matrix_id: patch.matrixId } : {}),
    ...(patch.matrixVersionId !== undefined ? { matrix_version_id: patch.matrixVersionId } : {}),
    ...(patch.minutes !== undefined ? { minutes: patch.minutes } : {}),
    ...(patch.position !== undefined ? { position: patch.position } : {}),
    ...(patch.qtype !== undefined ? { qtype: patch.qtype } : {}),
    ...(patch.questionCount !== undefined ? { question_count: patch.questionCount } : {}),
    ...(patch.tfScale !== undefined ? { tf_scale: jsonbField(patch.tfScale) } : {}),
    ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
  };
}

/** Một dòng của bảng `exam_matrix_contributions` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamMatrixContributionRow {
  contentHash: string;
  createdAt: Date;
  id: string;
  matrixId: string;
  nearDuplicateOf: string | null;
  note: string;
  proposerId: string;
  rejectReason: string | null;
  resultMatrixId: string | null;
  reviewerId: string | null;
  status: string;
  targetBankId: string;
  updatedAt: Date;
}

/** Dữ kiện ghi một dòng `exam_matrix_contributions` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamMatrixContribution {
  contentHash?: string;
  createdAt?: Date;
  id?: string;
  matrixId: string;
  nearDuplicateOf?: string | null;
  note?: string;
  proposerId: string;
  rejectReason?: string | null;
  resultMatrixId?: string | null;
  reviewerId?: string | null;
  status?: string;
  targetBankId: string;
  updatedAt?: Date;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_matrix_contributions` (dùng cho cả select lẫn returning). */
const EXAM_MATRIX_CONTRIBUTION_COLUMNS = [
  'content_hash as contentHash',
  'created_at as createdAt',
  'id',
  'matrix_id as matrixId',
  'near_duplicate_of as nearDuplicateOf',
  'note',
  'proposer_id as proposerId',
  'reject_reason as rejectReason',
  'result_matrix_id as resultMatrixId',
  'reviewer_id as reviewerId',
  'status',
  'target_bank_id as targetBankId',
  'updated_at as updatedAt',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_matrix_contributions` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examMatrixContributionInsertValues(values: NewExamMatrixContribution): InsertObject<CentreDB, 'exam_matrix_contributions'> {
  return {
    matrix_id: values.matrixId,
    proposer_id: values.proposerId,
    target_bank_id: values.targetBankId,
    ...(values.contentHash !== undefined ? { content_hash: values.contentHash } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.nearDuplicateOf !== undefined ? { near_duplicate_of: values.nearDuplicateOf } : {}),
    ...(values.note !== undefined ? { note: values.note } : {}),
    ...(values.rejectReason !== undefined ? { reject_reason: values.rejectReason } : {}),
    ...(values.resultMatrixId !== undefined ? { result_matrix_id: values.resultMatrixId } : {}),
    ...(values.reviewerId !== undefined ? { reviewer_id: values.reviewerId } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/**
 * Ánh xạ một patch cập nhật dòng `exam_matrix_contributions` (camelCase) sang set
 * update (snake_case), LOẠI mọi trường `undefined` — patch chỉ
 * chứa trường nào thì chỉ trường đó đổi (quy tắc T-4); giá trị
 * jsonb đi qua `jsonbValue`. Mốc `updated_at` do repository
 * gắn sau cùng.
 */
function examMatrixContributionUpdateSet(patch: Partial<ExamMatrixContributionRow>): UpdateObject<CentreDB, 'exam_matrix_contributions'> {
  return {
    ...(patch.contentHash !== undefined ? { content_hash: patch.contentHash } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.matrixId !== undefined ? { matrix_id: patch.matrixId } : {}),
    ...(patch.nearDuplicateOf !== undefined ? { near_duplicate_of: patch.nearDuplicateOf } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.proposerId !== undefined ? { proposer_id: patch.proposerId } : {}),
    ...(patch.rejectReason !== undefined ? { reject_reason: patch.rejectReason } : {}),
    ...(patch.resultMatrixId !== undefined ? { result_matrix_id: patch.resultMatrixId } : {}),
    ...(patch.reviewerId !== undefined ? { reviewer_id: patch.reviewerId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.targetBankId !== undefined ? { target_bank_id: patch.targetBankId } : {}),
    ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
  };
}

/** Một dòng của bảng `exam_pin_feedbacks` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamPinFeedbackRow {
  createdAt: Date;
  feedback: string;
  id: string;
  maxPercent: number;
  minPercent: number;
  pinId: string;
  updatedAt: Date;
}

/** Dữ kiện ghi một dòng `exam_pin_feedbacks` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamPinFeedback {
  createdAt?: Date;
  feedback: string;
  id?: string;
  maxPercent: number;
  minPercent: number;
  pinId: string;
  updatedAt?: Date;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_pin_feedbacks` (dùng cho cả select lẫn returning). */
const EXAM_PIN_FEEDBACK_COLUMNS = [
  'created_at as createdAt',
  'feedback',
  'id',
  'max_percent as maxPercent',
  'min_percent as minPercent',
  'pin_id as pinId',
  'updated_at as updatedAt',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_pin_feedbacks` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examPinFeedbackInsertValues(values: NewExamPinFeedback): InsertObject<CentreDB, 'exam_pin_feedbacks'> {
  return {
    feedback: values.feedback,
    max_percent: values.maxPercent,
    min_percent: values.minPercent,
    pin_id: values.pinId,
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/** Một dòng của bảng `exam_attempt_events` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamAttemptEventRow {
  attemptId: string;
  createdAt: Date;
  data: Record<string, unknown> | null;
  id: string;
  type: string;
}

/** Dữ kiện ghi một dòng `exam_attempt_events` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamAttemptEvent {
  attemptId: string;
  createdAt?: Date;
  data?: Record<string, unknown> | null;
  id?: string;
  type: string;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_attempt_events` (dùng cho cả select lẫn returning). */
const EXAM_ATTEMPT_EVENT_COLUMNS = [
  'attempt_id as attemptId',
  'created_at as createdAt',
  'data',
  'id',
  'type',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_attempt_events` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examAttemptEventInsertValues(values: NewExamAttemptEvent): InsertObject<CentreDB, 'exam_attempt_events'> {
  return {
    attempt_id: values.attemptId,
    type: values.type,
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.data !== undefined ? { data: jsonbField(values.data) } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
  };
}

/** Một dòng của bảng `exam_pin_version_updates` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamPinVersionUpdateRow {
  actorId: string;
  createdAt: Date;
  fromExamVersionId: string;
  id: string;
  pinId: string;
  toExamVersionId: string;
}

/** Dữ kiện ghi một dòng `exam_pin_version_updates` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamPinVersionUpdate {
  actorId: string;
  createdAt?: Date;
  fromExamVersionId: string;
  id?: string;
  pinId: string;
  toExamVersionId: string;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_pin_version_updates` (dùng cho cả select lẫn returning). */
const EXAM_PIN_VERSION_UPDATE_COLUMNS = [
  'actor_id as actorId',
  'created_at as createdAt',
  'from_exam_version_id as fromExamVersionId',
  'id',
  'pin_id as pinId',
  'to_exam_version_id as toExamVersionId',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_pin_version_updates` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examPinVersionUpdateInsertValues(values: NewExamPinVersionUpdate): InsertObject<CentreDB, 'exam_pin_version_updates'> {
  return {
    actor_id: values.actorId,
    from_exam_version_id: values.fromExamVersionId,
    pin_id: values.pinId,
    to_exam_version_id: values.toExamVersionId,
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
  };
}

/** Một dòng của bảng `exam_attempt_regrades` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamAttemptRegradeRow {
  actorId: string;
  createdAt: Date;
  fromVersionId: string;
  id: string;
  pinId: string;
  questionId: string;
  toVersionId: string;
}

/** Dữ kiện ghi một dòng `exam_attempt_regrades` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamAttemptRegrade {
  actorId: string;
  createdAt?: Date;
  fromVersionId: string;
  id?: string;
  pinId: string;
  questionId: string;
  toVersionId: string;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_attempt_regrades` (dùng cho cả select lẫn returning). */
const EXAM_ATTEMPT_REGRADE_COLUMNS = [
  'actor_id as actorId',
  'created_at as createdAt',
  'from_version_id as fromVersionId',
  'id',
  'pin_id as pinId',
  'question_id as questionId',
  'to_version_id as toVersionId',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_attempt_regrades` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examAttemptRegradeInsertValues(values: NewExamAttemptRegrade): InsertObject<CentreDB, 'exam_attempt_regrades'> {
  return {
    actor_id: values.actorId,
    from_version_id: values.fromVersionId,
    pin_id: values.pinId,
    question_id: values.questionId,
    to_version_id: values.toVersionId,
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
  };
}

/** Một dòng của bảng `exam_attempt_regrade_items` (hình dạng camelCase phía tiêu thụ dùng). */
export interface ExamAttemptRegradeItemRow {
  createdAt: Date;
  examAttemptId: string;
  id: string;
  newFraction: number | null;
  newSumGrades: number | null;
  oldFraction: number | null;
  oldSumGrades: number | null;
  questionAttemptId: string;
  regradeId: string;
  userId: string;
}

/** Dữ kiện ghi một dòng `exam_attempt_regrade_items` mới (trường có mặc định ở DB hoặc nullable thì tùy chọn). */
export interface NewExamAttemptRegradeItem {
  createdAt?: Date;
  examAttemptId: string;
  id?: string;
  newFraction?: number | null;
  newSumGrades?: number | null;
  oldFraction?: number | null;
  oldSumGrades?: number | null;
  questionAttemptId: string;
  regradeId: string;
  userId: string;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng `exam_attempt_regrade_items` (dùng cho cả select lẫn returning). */
const EXAM_ATTEMPT_REGRADE_ITEM_COLUMNS = [
  'created_at as createdAt',
  'exam_attempt_id as examAttemptId',
  'id',
  'new_fraction as newFraction',
  'new_sum_grades as newSumGrades',
  'old_fraction as oldFraction',
  'old_sum_grades as oldSumGrades',
  'question_attempt_id as questionAttemptId',
  'regrade_id as regradeId',
  'user_id as userId',
] as const;

/**
 * Ánh xạ dữ kiện ghi dòng `exam_attempt_regrade_items` (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường mang `undefined`: trường vắng mặt
 * phải để default của database quyết định (quy tắc T-4). Giá trị
 * jsonb đi qua `jsonbValue` (serialize + `::jsonb`).
 */
function examAttemptRegradeItemInsertValues(values: NewExamAttemptRegradeItem): InsertObject<CentreDB, 'exam_attempt_regrade_items'> {
  return {
    exam_attempt_id: values.examAttemptId,
    question_attempt_id: values.questionAttemptId,
    regrade_id: values.regradeId,
    user_id: values.userId,
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.newFraction !== undefined ? { new_fraction: values.newFraction } : {}),
    ...(values.newSumGrades !== undefined ? { new_sum_grades: values.newSumGrades } : {}),
    ...(values.oldFraction !== undefined ? { old_fraction: values.oldFraction } : {}),
    ...(values.oldSumGrades !== undefined ? { old_sum_grades: values.oldSumGrades } : {}),
  };
}
/**
 * Kho dữ liệu của lần ghim đề (exam_pins) và các lượt làm: bản ghi pin
 * (instance của course module), các override/feedback của pin và các
 * lượt làm neo vào pin. Nội dung đề của lượt làm đọc thẳng từ
 * exam_slots của exam version đã ghim — kho này không giữ bản chụp
 * slots nào (feat #226). Điểm của câu trong lượt làm sống ở question
 * engine (question_attempts) — kho này chỉ giữ tầng tổ chức: pin nào
 * ghim đề nào, lượt làm nào gắn usage nào và tổng điểm đã chốt.
 */
export class QuizRepository {
  constructor(private readonly handle: CentreDb) {}

  /** Instance gốc (handle định tuyến theo trung tâm do tầng ứng dụng truyền vào). */
  private db(): CentreDb {
    return this.handle;
  }

  /** Mở một transaction trên kho trung tâm. */
  async transaction<T>(fn: (tx: QuizTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  /**
   * Chèn bản ghi lần ghim.
   */
  async insertPin(v: NewExamPin, db: QuizDb = this.db()): Promise<ExamPinRow> {
    const row = await db.insertInto('exam_pins').values(examPinInsertValues(v)).returning(EXAM_PIN_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }
  /**
   * Lấy lần ghim theo id.
   */
  async getPin(id: string, db: QuizDb = this.db()): Promise<ExamPinRow | undefined> {
    return db.selectFrom('exam_pins').select(EXAM_PIN_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  /**
   * Các lần ghim trong một khoá học.
   */
  async listPinsInCourse(courseId: string, db: QuizDb = this.db()): Promise<ExamPinRow[]> {
    return db
      .selectFrom('exam_pins')
      .select(EXAM_PIN_COLUMNS)
      .where('course_id', '=', courseId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
  /**
   * Cập nhật lần ghim.
   */
  async updatePin(id: string, patch: Partial<ExamPinRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_pins')
      .set({ ...examPinUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
  /**
   * Xoá lần ghim (attempts/overrides/feedbacks cascade theo khoá ngoại).
   */
  async deletePin(id: string, db: QuizDb = this.db()): Promise<void> {
    await db.deleteFrom('exam_pins').where('id', '=', id).execute();
  }

  /**
   * Chèn một lượt làm.
   */
  // --- tham chieu de da ghim (chi doc: dinh danh/noi dung de song o module exams) ---

  async getExam(id: string, db: QuizDb = this.db()): Promise<ExamRow | undefined> {
    return db.selectFrom('exams').select(EXAM_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async getExamVersion(id: string, db: QuizDb = this.db()): Promise<ExamVersionRow | undefined> {
    return db.selectFrom('exam_versions').select(EXAM_VERSION_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  /** Slots cua mot exam version theo thu tu position (nguon cau cua pin snapshot). */
  async listExamSlots(examVersionId: string, db: QuizDb = this.db()): Promise<ExamSlotRow[]> {
    return db
      .selectFrom('exam_slots')
      .select(EXAM_SLOT_COLUMNS)
      .where('exam_version_id', '=', examVersionId)
      .orderBy('position', 'asc')
      .execute();
  }

  /** Mọi exam version của một đề theo số version tăng dần (nguồn xác định "bản mới nhất" của đề cho luồng cập nhật pin). */
  async listExamVersions(examId: string, db: QuizDb = this.db()): Promise<ExamVersionRow[]> {
    return db
      .selectFrom('exam_versions')
      .select(EXAM_VERSION_COLUMNS)
      .where('exam_id', '=', examId)
      .orderBy('version', 'asc')
      .execute();
  }

  async insertAttempt(v: NewExamAttempt, db: QuizDb = this.db()): Promise<ExamAttemptRow> {
    const row = await db.insertInto('exam_attempts').values(examAttemptInsertValues(v)).returning(EXAM_ATTEMPT_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }
  /**
   * Lấy một lượt làm.
   */
  async getAttempt(id: string, db: QuizDb = this.db()): Promise<ExamAttemptRow | undefined> {
    return db.selectFrom('exam_attempts').select(EXAM_ATTEMPT_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  /**
   * Các lượt làm của một lần ghim (mọi học sinh), mới nhất theo số lượt.
   * Giới hạn `limit` là TRẦN AN TOÀN tường minh (DL-07 của đợt audit,
   * issue #489), KHÔNG phải phân trang: cả ba nơi gọi (trang kết quả,
   * hàng đợi chấm theo câu, danh sách tóm tắt) đều cần TOÀN BỘ lượt
   * của lần ghim để tính điểm và thống kê, nên trần đặt cao hơn hẳn
   * quy mô một lớp học thật — chạm trần là dấu hiệu dữ kiện bất
   * thường, không phải hành vi nghiệp vụ.
   */
  async listAttempts(pinId: string, limit: number = QUIZ_PIN_ATTEMPTS_LIMIT, db: QuizDb = this.db()): Promise<ExamAttemptRow[]> {
    return db
      .selectFrom('exam_attempts')
      .select(EXAM_ATTEMPT_COLUMNS)
      .where('pin_id', '=', pinId)
      .orderBy('user_id', 'asc')
      .orderBy('attempt_number', 'asc')
      .limit(limit)
      .execute();
  }
  /**
   * Các lượt làm của một học sinh trong một lần ghim (kể cả preview khi `includePreview`).
   */
  async listAttemptsForUser(pinId: string, userId: string, includePreview = false, db: QuizDb = this.db()): Promise<ExamAttemptRow[]> {
    let query = db
      .selectFrom('exam_attempts')
      .select(EXAM_ATTEMPT_COLUMNS)
      .where('pin_id', '=', pinId)
      .where('user_id', '=', userId);
    if (!includePreview) {
      query = query.where('preview', '=', false);
    }
    return query.orderBy('attempt_number', 'asc').execute();
  }
  /**
   * Cập nhật một lượt làm.
   */
  async updateAttempt(id: string, patch: Partial<ExamAttemptRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_attempts')
      .set({ ...examAttemptUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  // --- overrides ---------------------------------------------------------------

  /**
   * Chèn một ghi đè cài đặt thi.
   */
  async insertOverride(v: NewExamPinOverride, db: QuizDb = this.db()): Promise<ExamPinOverrideRow> {
    const row = await db.insertInto('exam_pin_overrides').values(examPinOverrideInsertValues(v)).returning(EXAM_PIN_OVERRIDE_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }
  /**
   * Lấy một ghi đè.
   */
  async getOverride(id: string, db: QuizDb = this.db()): Promise<ExamPinOverrideRow | undefined> {
    return db.selectFrom('exam_pin_overrides').select(EXAM_PIN_OVERRIDE_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  /**
   * Mọi ghi đè của một lần ghim (theo nhóm và theo người dùng).
   */
  async listOverrides(pinId: string, db: QuizDb = this.db()): Promise<ExamPinOverrideRow[]> {
    return db
      .selectFrom('exam_pin_overrides')
      .select(EXAM_PIN_OVERRIDE_COLUMNS)
      .where('pin_id', '=', pinId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
  /**
   * Mốc đóng MUỘN NHẤT của cả đợt thi: max giữa time_close của lần
   * ghim và time_close của MỌI override đang tồn tại (null = có ít
   * nhất một tầng không đặt mốc đóng → đợt chưa đóng hẳn). Dùng cho
   * cửa sổ review "sau khi đóng" khi các ca thi lệch nhau vì
   * override — chống lộ đáp án cho ca sau (hồ sơ thi trực tuyến VN,
   * điểm 5.1.4).
   */
  async sessionLatestClose(pinId: string, db: QuizDb = this.db()): Promise<{ hasUnbounded: boolean; latest: Date | null }> {
    const pinRow = await db
      .selectFrom('exam_pins')
      .select(['time_close as timeClose'])
      .where('id', '=', pinId)
      .executeTakeFirst();
    const base = pinRow?.timeClose ?? null;
    const overrides = await this.listOverrides(pinId, db);
    // Override có time_close null = kế thừa mốc của lần ghim (đã tính);
    // đợt chỉ "chưa đóng hẳn" khi chính lần ghim không có mốc đóng.
    const hasUnbounded = base === null;
    let latest = base;
    for (const o of overrides) {
      if (o.timeClose === null) continue;
      if (latest === null || o.timeClose > latest) latest = o.timeClose;
    }
    return { hasUnbounded, latest };
  }

  /**
   * Cập nhật một ghi đè.
   */
  async updateOverride(id: string, patch: Partial<ExamPinOverrideRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_pin_overrides')
      .set({ ...examPinOverrideUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
  /**
   * Xoá một ghi đè.
   */
  async deleteOverride(id: string, db: QuizDb = this.db()): Promise<void> {
    await db.deleteFrom('exam_pin_overrides').where('id', '=', id).execute();
  }

  // --- ma trận đề (Chặng 3) -------------------------------------------------------

  /**
   * Chèn một ma trận.
   */
  async insertMatrix(v: NewExamMatrix, db: QuizDb = this.db()): Promise<ExamMatrixRow> {
    const row = await db.insertInto('exam_matrices').values(examMatrixInsertValues(v)).returning(EXAM_MATRIX_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }
  /**
   * Lấy một ma trận.
   */
  async getMatrix(id: string, db: QuizDb = this.db()): Promise<ExamMatrixRow | undefined> {
    return db.selectFrom('exam_matrices').select(EXAM_MATRIX_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  /**
   * Ma trận trong một bank theo chữ ký nội dung đã ghi (lát chống
   * trùng của issue #233): đường ghi dùng hàm này sau khi transaction
   * của mình chạm ràng buộc duy nhất (bank, chữ ký) để đọc lại bản
   * thắng cuộc và trả về thay vì lỗi.
   */
  async findMatrixByBankAndSignature(bankId: string, contentSignature: string, db: QuizDb = this.db()): Promise<ExamMatrixRow | undefined> {
    return db
      .selectFrom('exam_matrices')
      .select(EXAM_MATRIX_COLUMNS)
      .where('bank_id', '=', bankId)
      .where('content_signature', '=', contentSignature)
      .executeTakeFirst();
  }
  /**
   * Các ma trận của một môn (mới nhất trước).
   */
  async listMatricesBySubject(subjectId: string, db: QuizDb = this.db()): Promise<ExamMatrixRow[]> {
    return db
      .selectFrom('exam_matrices')
      .select(EXAM_MATRIX_COLUMNS)
      .where('subject_id', '=', subjectId)
      .orderBy('name', 'asc')
      .execute();
  }
  /**
   * Cập nhật một ma trận.
   */
  async updateMatrix(id: string, patch: Partial<ExamMatrixRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_matrices')
      .set({ ...examMatrixUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
  /**
   * Tăng bộ đếm số lượt một ma trận đã được copy đi (tín hiệu truy
   * vết copy — tăng nguyên tử ở tầng SQL như exams.copy_count).
   * Biểu thức tăng giữ nguyên dạng SQL của đường bộ máy cũ
   * (`"exam_matrices"."copy_count" + 1`): cấm đổi thành đọc-cộng-ghi
   * vì hai lượt copy đồng thời sẽ mất một lượt tăng.
   */
  async bumpMatrixCopyCount(id: string, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_matrices')
      .set({ copy_count: sql<number>`"exam_matrices"."copy_count" + 1` })
      .where('id', '=', id)
      .execute();
  }
  /**
   * Các version đề đã sinh từ một ma trận (truy nguồn chiều ngược
   * ma trận → đề): mỗi hàng là một exam version mang matrix_id của
   * ma trận này, kèm định danh đề cha để hiển thị.
   */
  async listExamVersionsByMatrix(matrixId: string, db: QuizDb = this.db()): Promise<{ examId: string; examVersionId: string; version: number; name: string; matrixVersion: number | null }[]> {
    return db
      .selectFrom('exam_versions')
      .select([
        'exam_versions.exam_id as examId',
        'exam_versions.id as examVersionId',
        'exam_versions.version as version',
        'exam_versions.name as name',
        'exam_versions.matrix_version as matrixVersion',
      ])
      .where('exam_versions.matrix_id', '=', matrixId)
      .orderBy('exam_versions.created_at', 'asc')
      .orderBy('exam_versions.id', 'asc')
      .execute();
  }
  /**
   * Xoá một ma trận (ô cascade theo FK; quiz đã sinh giữ matrix_id = null theo FK set null).
   */
  async deleteMatrix(id: string, db: QuizDb = this.db()): Promise<void> {
    await db.deleteFrom('exam_matrices').where('id', '=', id).execute();
  }
  /**
   * Chèn một version bất biến của ma trận (hàng chụp cấu hình của
   * đúng một số version; ô của version gắn qua matrix_version_id).
   */
  async insertMatrixVersion(v: NewExamMatrixVersion, db: QuizDb = this.db()): Promise<ExamMatrixVersionRow> {
    const row = await db.insertInto('exam_matrix_versions').values(examMatrixVersionInsertValues(v)).returning(EXAM_MATRIX_VERSION_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }
  /**
   * Hàng version bất biến theo (ma trận, số version) — căn cứ đọc lại
   * nội dung một version quá khứ nguyên vẹn.
   */
  async getMatrixVersionRow(matrixId: string, version: number, db: QuizDb = this.db()): Promise<ExamMatrixVersionRow | undefined> {
    return db
      .selectFrom('exam_matrix_versions')
      .select(EXAM_MATRIX_VERSION_COLUMNS)
      .where('matrix_id', '=', matrixId)
      .where('version', '=', version)
      .executeTakeFirst();
  }
  /**
   * Hàng version bất biến theo id (điểm neo từ exam_versions /
   * exam_dossiers.matrix_version_id).
   */
  async getMatrixVersionById(id: string, db: QuizDb = this.db()): Promise<ExamMatrixVersionRow | undefined> {
    return db.selectFrom('exam_matrix_versions').select(EXAM_MATRIX_VERSION_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  /**
   * Chèn một ô ma trận.
   */
  async insertMatrixCell(v: NewExamMatrixCell, db: QuizDb = this.db()): Promise<ExamMatrixCellRow> {
    const row = await db.insertInto('exam_matrix_cells').values(examMatrixCellInsertValues(v)).returning(EXAM_MATRIX_CELL_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }
  /**
   * Lấy một ô ma trận.
   */
  async getMatrixCell(id: string, db: QuizDb = this.db()): Promise<ExamMatrixCellRow | undefined> {
    return db.selectFrom('exam_matrix_cells').select(EXAM_MATRIX_CELL_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  /**
   * Các ô của VERSION HIỆN HÀNH của một ma trận theo thứ tự hiển
   * thị: version hiện hành là hàng exam_matrix_versions có số version
   * bằng exam_matrices.version; ô đọc theo matrix_version_id của
   * hàng đó nên sửa version cũ không bao giờ lọt vào bề mặt hiện
   * hành. Ma trận chưa có hàng version (chỉ gặp ở dữ liệu dựng tay
   * ngoài các đường tạo của service) thì đọc theo matrix_id như
   * trước để không mất ô.
   */
  async listMatrixCells(matrixId: string, db: QuizDb = this.db()): Promise<ExamMatrixCellRow[]> {
    const matrix = await this.getMatrix(matrixId, db);
    const versionRow = matrix ? await this.getMatrixVersionRow(matrixId, matrix.version, db) : undefined;
    let query = db.selectFrom('exam_matrix_cells').select(EXAM_MATRIX_CELL_COLUMNS);
    query = versionRow
      ? query.where('matrix_version_id', '=', versionRow.id)
      : query.where('matrix_id', '=', matrixId);
    return query.orderBy('position', 'asc').orderBy('id', 'asc').execute();
  }
  /**
   * Các ô của ĐÚNG một version bất biến (đọc lịch sử / dựng bản đặc
   * tả theo version đã neo) theo thứ tự hiển thị.
   */
  async listMatrixCellsByVersionId(matrixVersionId: string, db: QuizDb = this.db()): Promise<ExamMatrixCellRow[]> {
    return db
      .selectFrom('exam_matrix_cells')
      .select(EXAM_MATRIX_CELL_COLUMNS)
      .where('matrix_version_id', '=', matrixVersionId)
      .orderBy('position', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
  /**
   * Cập nhật một ô ma trận.
   */
  async updateMatrixCell(id: string, patch: Partial<ExamMatrixCellRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_matrix_cells')
      .set({ ...examMatrixCellUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
  /**
   * Xoá một ô ma trận.
   */
  async deleteMatrixCell(id: string, db: QuizDb = this.db()): Promise<void> {
    await db.deleteFrom('exam_matrix_cells').where('id', '=', id).execute();
  }

  // --- ngân hàng ma trận (MB-1, issue #111) ----------------------------------------

  /**
   * Các ma trận trong một bank ma trận (theo tên).
   */
  async listMatricesByBank(bankId: string, db: QuizDb = this.db()): Promise<ExamMatrixRow[]> {
    return db
      .selectFrom('exam_matrices')
      .select(EXAM_MATRIX_COLUMNS)
      .where('bank_id', '=', bankId)
      .orderBy('name', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
  /**
   * Chèn một đề xuất đóng góp ma trận (hàng chờ duyệt).
   */
  async insertMatrixContribution(v: NewExamMatrixContribution, db: QuizDb = this.db()): Promise<ExamMatrixContributionRow> {
    const row = await db.insertInto('exam_matrix_contributions').values(examMatrixContributionInsertValues(v)).returning(EXAM_MATRIX_CONTRIBUTION_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }
  /**
   * Lấy một đề xuất đóng góp ma trận.
   */
  async getMatrixContribution(id: string, db: QuizDb = this.db()): Promise<ExamMatrixContributionRow | undefined> {
    return db.selectFrom('exam_matrix_contributions').select(EXAM_MATRIX_CONTRIBUTION_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  /**
   * Hàng chờ đóng góp của một bank (lọc theo trạng thái nếu có; cũ nhất trước để duyệt theo thứ tự đến).
   */
  async listMatrixContributions(targetBankId: string, status?: string, db: QuizDb = this.db()): Promise<ExamMatrixContributionRow[]> {
    let query = db
      .selectFrom('exam_matrix_contributions')
      .select(EXAM_MATRIX_CONTRIBUTION_COLUMNS)
      .where('target_bank_id', '=', targetBankId);
    if (status !== undefined) {
      query = query.where('status', '=', status);
    }
    return query.orderBy('created_at', 'asc').orderBy('id', 'asc').execute();
  }
  /**
   * Hàng chờ đóng góp do một người gửi (mọi bank) — người gửi xem lại kết quả duyệt/lý do từ chối.
   */
  async listMatrixContributionsByProposer(proposerId: string, db: QuizDb = this.db()): Promise<ExamMatrixContributionRow[]> {
    return db
      .selectFrom('exam_matrix_contributions')
      .select(EXAM_MATRIX_CONTRIBUTION_COLUMNS)
      .where('proposer_id', '=', proposerId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
  /**
   * Đề xuất đang chờ của cùng một ma trận vào cùng một bank (chống gửi trùng hàng chờ).
   */
  async findPendingMatrixContribution(matrixId: string, targetBankId: string, proposerId: string, db: QuizDb = this.db()): Promise<ExamMatrixContributionRow | undefined> {
    return db
      .selectFrom('exam_matrix_contributions')
      .select(EXAM_MATRIX_CONTRIBUTION_COLUMNS)
      .where('matrix_id', '=', matrixId)
      .where('target_bank_id', '=', targetBankId)
      .where('proposer_id', '=', proposerId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
  }
  /**
   * Cập nhật một đề xuất đóng góp (kết quả duyệt).
   */
  async updateMatrixContribution(id: string, patch: Partial<ExamMatrixContributionRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_matrix_contributions')
      .set({ ...examMatrixContributionUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  // --- dải nhận xét tổng quát + nhật ký sự kiện lượt làm -------------------------

  /** Các dải nhận xét tổng quát của một lần ghim theo mốc % tăng dần. */
  async listFeedbacks(pinId: string, db: QuizDb = this.db()): Promise<ExamPinFeedbackRow[]> {
    return db
      .selectFrom('exam_pin_feedbacks')
      .select(EXAM_PIN_FEEDBACK_COLUMNS)
      .where('pin_id', '=', pinId)
      .orderBy('min_percent', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Chèn một dải nhận xét tổng quát. */
  async insertFeedback(v: NewExamPinFeedback, db: QuizDb = this.db()): Promise<ExamPinFeedbackRow> {
    const row = await db.insertInto('exam_pin_feedbacks').values(examPinFeedbackInsertValues(v)).returning(EXAM_PIN_FEEDBACK_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }

  /** Xoá một dải nhận xét tổng quát. */
  async deleteFeedback(id: string, db: QuizDb = this.db()): Promise<void> {
    await db.deleteFrom('exam_pin_feedbacks').where('id', '=', id).execute();
  }

  /** Ghi một sự kiện giám sát của lượt làm (chỉ ghi nhận). */
  async getFeedback(id: string, db: QuizDb = this.db()): Promise<ExamPinFeedbackRow | undefined> {
    return db
      .selectFrom('exam_pin_feedbacks')
      .select(EXAM_PIN_FEEDBACK_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
  }

  async insertAttemptEvent(v: NewExamAttemptEvent, db: QuizDb = this.db()): Promise<ExamAttemptEventRow> {
    const row = await db.insertInto('exam_attempt_events').values(examAttemptEventInsertValues(v)).returning(EXAM_ATTEMPT_EVENT_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }

  /** Nhật ký sự kiện của một lượt làm theo thời gian ghi. */
  async listAttemptEvents(attemptId: string, db: QuizDb = this.db()): Promise<ExamAttemptEventRow[]> {
    return db
      .selectFrom('exam_attempt_events')
      .select(EXAM_ATTEMPT_EVENT_COLUMNS)
      .where('attempt_id', '=', attemptId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  // --- cập nhật version của pin + chấm lại theo đáp án (issue #254) --------------

  /** Ghi vết một lần áp cập nhật exam version đã ghim (ai, khi nào, từ version nào lên version nào). */
  async insertPinVersionUpdate(v: NewExamPinVersionUpdate, db: QuizDb = this.db()): Promise<ExamPinVersionUpdateRow> {
    const row = await db.insertInto('exam_pin_version_updates').values(examPinVersionUpdateInsertValues(v)).returning(EXAM_PIN_VERSION_UPDATE_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }

  /** Các lần cập nhật exam version của một pin theo thời gian (vết truy vết cho giáo viên/quản trị). */
  async listPinVersionUpdates(pinId: string, db: QuizDb = this.db()): Promise<ExamPinVersionUpdateRow[]> {
    return db
      .selectFrom('exam_pin_version_updates')
      .select(EXAM_PIN_VERSION_UPDATE_COLUMNS)
      .where('pin_id', '=', pinId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Ghi một lần chấm lại theo đáp án đã áp thật (dry-run không ghi). */
  async insertRegrade(v: NewExamAttemptRegrade, db: QuizDb = this.db()): Promise<ExamAttemptRegradeRow> {
    const row = await db.insertInto('exam_attempt_regrades').values(examAttemptRegradeInsertValues(v)).returning(EXAM_ATTEMPT_REGRADE_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }

  /** Ghi điểm đổi của một lượt trong một lần chấm lại. */
  async insertRegradeItem(v: NewExamAttemptRegradeItem, db: QuizDb = this.db()): Promise<ExamAttemptRegradeItemRow> {
    const row = await db.insertInto('exam_attempt_regrade_items').values(examAttemptRegradeItemInsertValues(v)).returning(EXAM_ATTEMPT_REGRADE_ITEM_COLUMNS).executeTakeFirstOrThrow();
    return row;
  }

  /** Nhật ký chấm lại theo đáp án của một pin theo thời gian (cũ nhất trước). */
  async listRegrades(pinId: string, db: QuizDb = this.db()): Promise<ExamAttemptRegradeRow[]> {
    return db
      .selectFrom('exam_attempt_regrades')
      .select(EXAM_ATTEMPT_REGRADE_COLUMNS)
      .where('pin_id', '=', pinId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Các mục điểm đổi của một lần chấm lại. */
  async listRegradeItems(regradeId: string, db: QuizDb = this.db()): Promise<ExamAttemptRegradeItemRow[]> {
    return db
      .selectFrom('exam_attempt_regrade_items')
      .select(EXAM_ATTEMPT_REGRADE_ITEM_COLUMNS)
      .where('regrade_id', '=', regradeId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * Các mục điểm đổi của chính một học sinh trong một pin (nguồn cho bề mặt lịch sử sửa điểm của học sinh).
   * Đường bộ máy cũ chọn hình lồng `{ regrade, item }`; đường Kysely chọn
   * phẳng một danh sách cột có bí danh phân biệt hai bảng (hai bảng
   * trùng tên cột `id`/`created_at`) rồi lồng lại ở JS — hình dạng
   * trả về giữ nguyên.
   */
  async listRegradeItemsForUser(pinId: string, userId: string, db: QuizDb = this.db()): Promise<{ regrade: ExamAttemptRegradeRow; item: ExamAttemptRegradeItemRow }[]> {
    const rows = await db
      .selectFrom('exam_attempt_regrade_items')
      .innerJoin('exam_attempt_regrades', 'exam_attempt_regrade_items.regrade_id', 'exam_attempt_regrades.id')
      .select([
        'exam_attempt_regrades.id as rId',
        'exam_attempt_regrades.pin_id as rPinId',
        'exam_attempt_regrades.actor_id as rActorId',
        'exam_attempt_regrades.question_id as rQuestionId',
        'exam_attempt_regrades.from_version_id as rFromVersionId',
        'exam_attempt_regrades.to_version_id as rToVersionId',
        'exam_attempt_regrades.created_at as rCreatedAt',
        'exam_attempt_regrade_items.id as id',
        'exam_attempt_regrade_items.regrade_id as regradeId',
        'exam_attempt_regrade_items.exam_attempt_id as examAttemptId',
        'exam_attempt_regrade_items.question_attempt_id as questionAttemptId',
        'exam_attempt_regrade_items.user_id as userId',
        'exam_attempt_regrade_items.old_fraction as oldFraction',
        'exam_attempt_regrade_items.new_fraction as newFraction',
        'exam_attempt_regrade_items.old_sum_grades as oldSumGrades',
        'exam_attempt_regrade_items.new_sum_grades as newSumGrades',
        'exam_attempt_regrade_items.created_at as createdAt',
      ])
      .where('exam_attempt_regrades.pin_id', '=', pinId)
      .where('exam_attempt_regrade_items.user_id', '=', userId)
      .orderBy('exam_attempt_regrades.created_at', 'asc')
      .orderBy('exam_attempt_regrade_items.id', 'asc')
      .execute();
    return rows.map((r) => ({
      regrade: {
        id: r.rId,
        pinId: r.rPinId,
        actorId: r.rActorId,
        questionId: r.rQuestionId,
        fromVersionId: r.rFromVersionId,
        toVersionId: r.rToVersionId,
        createdAt: r.rCreatedAt,
      },
      item: {
        id: r.id,
        regradeId: r.regradeId,
        examAttemptId: r.examAttemptId,
        questionAttemptId: r.questionAttemptId,
        userId: r.userId,
        oldFraction: r.oldFraction,
        newFraction: r.newFraction,
        oldSumGrades: r.oldSumGrades,
        newSumGrades: r.newSumGrades,
        createdAt: r.createdAt,
      },
    }));
  }
}
