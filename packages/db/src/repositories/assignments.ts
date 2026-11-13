/**
 * Repository của cụm BÀI TẬP (assignments) trên Kysely.
 *
 * Vai trò: mọi truy cập tới mười hai bảng của hoạt động Bài tập nộp tệp/ảnh (mod_assign) tập trung ở đây:
 * - `assignments` — bản ghi bài tập (instance của course module):
 *   hạn nộp, số tệp tối đa, loại tệp nhận, thang điểm và chế độ kết quả.
 * - `assign_submissions` — bài nộp hiện hành của học sinh cho bài
 *   tập (một dòng cho mỗi cặp bài tập + học sinh, theo lần nộp).
 * - `assign_submission_files` — quan hệ bài nộp ↔ tệp (nội dung vật
 *   lý ở module Files).
 * - `assign_grades` — gói chấm hiện hành của học sinh: điểm/mức, các
 *   trường phản hồi và trạng thái công bố (một dòng cho mỗi cặp bài tập + học sinh).
 * - `assign_annotations` — các dấu chấm vector của giáo viên trên
 *   bài nộp; cột `points` là jsonb mang mảng điểm của nét vẽ.
 * - `assign_rubrics`, `assign_rubric_criteria`, `assign_rubric_levels`
 *   — bảng chấm của bài tập và cây tiêu chí/mức của nó.
 * - `assign_rubric_evaluations` — kết quả theo tiêu chí của một gói
 *   chấm (một dòng cho mỗi cặp gói chấm + tiêu chí).
 * - `assign_grade_revisions` — vết kiểm toán mỗi lần sửa gói chấm
 *   sau khi đã trả bài (chỉ thêm, không sửa).
 * - `assign_feedback_messages` — hội thoại phản hồi trên gói chấm.
 * - `teacher_comment_bank` — ngân hàng lời phê mẫu của từng giáo
 *   viên.
 *
 * Hai thao tác ghi dạng ghi/đè (gói chấm và kết quả theo tiêu chí) khoá theo khoá duy nhất tự nhiên của bảng và dùng ĐÚNG tập cột cập nhật của đường cũ trước đây — gồm cả quy ước ghi tường minh `null` cho các trường phản hồi/điểm vắng mặt trong dữ kiện ghi (gói chấm bị ghi đè là thay toàn bộ gói, không giữ trường cũ). Mọi phương thức ghi còn lại nhận thêm handle giao dịch tuỳ chọn:
 * kiểm kê phía gọi hiện hành cho thấy không phía gọi nào truyền handle vào (mọi giao dịch của module nằm ở các tầng khác), tham số được giữ để hợp đồng không đổi và để phía gọi tương lai ghép thao tác vào MỘT giao dịch Kysely duy nhất — không bao giờ lai với giao dịch của ORM còn lại.
 *
 * Khuôn hình dạng dữ liệu ở biên repository (khuôn của pilot kho control plane, xem sổ tay trong `AGENTS.md` của package): bên trong dùng tên bảng/cột snake_case của interface schema sinh bằng codegen; bên ngoài trả/nhận hình dạng camelCase như phía tiêu thụ đang dùng qua danh sách cột tường minh có bí danh và các hàm ánh xạ ghi `*InsertValues`/`*UpdateSet`. Giá trị `undefined` bị LOẠI khỏi values/set trong các hàm ánh xạ (thử nghiệm T-4 đã đo ở pilot). Giá trị ghi vào cột jsonb (`points` của dấu chấm) đi qua helper serialize tường minh + ép kiểu `::jsonb` — driver `pg` hiểu MẢNG ở cấp cao nhất là mảng PostgreSQL nên ghi thẳng sẽ lỗi, đúng khuôn đã chốt ở pilot. Kiểu của `points` ở biên công khai giữ là `unknown` như hợp đồng `$inferSelect` của cột jsonb không khai `$type` trước đây; phía tiêu thụ tự ép kiểu khi đọc. Repository không import từ `apps/*`, không đọc ALS/ngữ cảnh ứng dụng, không tự mở pool.
 */
import {type InsertObject, type UpdateObject} from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import { jsonbValue, jsonbField } from '../jsonb';

/** Handle đọc/ghi mà repository nhận: instance gốc hoặc transaction đang mở của kho trung tâm. */
export type AssignmentsDb = CentreDb | CentreTx;

/** Một dòng bài tập (instance của course module). */
export interface AssignmentRow {
  id: string;
  course: string;
  /** Course module chứa bài tập; null trong khoảnh khắc trước khi module được tạo xong. */
  cmId: string | null;
  name: string;
  intro: string;
  /** Hạn nộp; null = không đặt hạn. */
  dueDate: Date | null;
  maxFiles: number;
  /** Danh sách loại tệp được nhận (chuỗi cấu hình); null = không giới hạn theo loại. */
  acceptedFileTypes: string | null;
  /** Thang điểm tối đa của bài tập. */
  grade: number;
  /** score_feedback | level_only — chế độ kết quả trả cho học sinh. */
  resultMode: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Một dòng bài nộp của học sinh cho một bài tập. */
export interface AssignSubmissionRow {
  id: string;
  assignmentId: string;
  userId: string;
  /** draft | submitted. */
  status: string;
  attemptNumber: number;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Một dòng quan hệ bài nộp ↔ tệp. */
export interface AssignSubmissionFileRow {
  id: string;
  submissionId: string;
  fileId: string;
  createdAt: Date;
}

/** Một dòng gói chấm hiện hành của học sinh cho một bài tập. */
export interface AssignGradeRow {
  id: string;
  assignmentId: string;
  userId: string;
  /** Giáo viên chấm gần nhất. */
  graderId: string;
  attemptNumber: number;
  grade: number | null;
  level: string | null;
  feedback: string | null;
  feedbackProgress: string | null;
  feedbackStrengths: string | null;
  feedbackWeaknesses: string | null;
  /** draft | released. */
  status: string;
  releasedAt: Date | null;
  releasedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Một dòng dấu chấm vector trên bài nộp. */
export interface AssignAnnotationRow {
  id: string;
  submissionId: string;
  fileId: string;
  page: number;
  x: number;
  y: number;
  kind: string;
  color: string | null;
  text: string | null;
  /** Mảng điểm của nét vẽ (jsonb không khai hình dạng ở tầng schema); phía tiêu thụ tự ép kiểu. */
  points: unknown;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Một dòng bảng chấm của một bài tập. */
export interface AssignRubricRow {
  id: string;
  assignmentId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Một dòng tiêu chí của bảng chấm. */
export interface AssignRubricCriterionRow {
  id: string;
  rubricId: string;
  name: string;
  descriptionForStudent: string | null;
  descriptionForGrader: string | null;
  /** levels | score — tiêu chí chấm theo mức hay nhập điểm trực tiếp. */
  mode: string;
  maxScore: number | null;
  outcomeId: string | null;
  outcomeText: string | null;
  sortOrder: number;
}

/** Một dòng mức của một tiêu chí chấm theo mức. */
export interface AssignRubricLevelRow {
  id: string;
  criterionId: string;
  label: string;
  score: number;
  sortOrder: number;
}

/** Một dòng kết quả theo tiêu chí của một gói chấm. */
export interface AssignRubricEvaluationRow {
  id: string;
  gradeId: string;
  criterionId: string;
  levelId: string | null;
  score: number | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Một dòng vết kiểm toán sửa gói chấm sau trả bài. */
export interface AssignGradeRevisionRow {
  id: string;
  gradeId: string;
  actorId: string;
  previousGrade: number | null;
  newGrade: number | null;
  previousLevel: string | null;
  newLevel: string | null;
  previousFeedback: string | null;
  newFeedback: string | null;
  reason: string | null;
  createdAt: Date;
}

/** Một dòng hội thoại phản hồi trên gói chấm. */
export interface AssignFeedbackMessageRow {
  id: string;
  gradeId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

/** Một dòng ngân hàng lời phê mẫu của giáo viên. */
export interface TeacherCommentBankRow {
  id: string;
  ownerId: string;
  category: string | null;
  text: string;
  createdAt: Date;
}

/** Dữ kiện ghi một bài tập mới. */
export interface NewAssignment {
  id?: string;
  course: string;
  cmId?: string | null;
  name: string;
  intro?: string;
  dueDate?: Date | null;
  maxFiles?: number;
  acceptedFileTypes?: string | null;
  grade?: number;
  resultMode?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Dữ kiện ghi một bài nộp mới. */
export interface NewSubmission {
  id?: string;
  assignmentId: string;
  userId: string;
  status?: string;
  attemptNumber?: number;
  submittedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Dữ kiện gắn một tệp vào bài nộp. */
export interface NewSubmissionFile {
  id?: string;
  submissionId: string;
  fileId: string;
  createdAt?: Date;
}

/**
 * Dữ kiện ghi một gói chấm. `graderId` và `attemptNumber` là bắt buộc theo schema; các trường điểm/phản hồi/công bố vắng mặt trong nhánh cập nhật-khi-trùng được ghi thành `null` tường minh (gói chấm bị ghi đè là thay toàn bộ), đúng hành vi của đường bộ máy cũ trước đây.
 */
export interface NewGrade {
  id?: string;
  assignmentId: string;
  userId: string;
  graderId: string;
  attemptNumber: number;
  grade?: number | null;
  level?: string | null;
  feedback?: string | null;
  feedbackProgress?: string | null;
  feedbackStrengths?: string | null;
  feedbackWeaknesses?: string | null;
  status?: string;
  releasedAt?: Date | null;
  releasedBy?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Dữ kiện ghi một dấu chấm mới. */
export interface NewAnnotation {
  id?: string;
  submissionId: string;
  fileId: string;
  page?: number;
  x: number;
  y: number;
  kind: string;
  color?: string | null;
  text?: string | null;
  points?: { x: number; y: number }[] | null;
  authorId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Dữ kiện ghi một bảng chấm mới. */
export interface NewRubric {
  id?: string;
  assignmentId: string;
  title?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Dữ kiện ghi một tiêu chí của bảng chấm. */
export interface NewRubricCriterion {
  id?: string;
  rubricId: string;
  name: string;
  descriptionForStudent?: string | null;
  descriptionForGrader?: string | null;
  mode?: string;
  maxScore?: number | null;
  outcomeId?: string | null;
  outcomeText?: string | null;
  sortOrder?: number;
}

/** Dữ kiện ghi một mức của tiêu chí. */
export interface NewRubricLevel {
  id?: string;
  criterionId: string;
  label: string;
  score?: number;
  sortOrder?: number;
}

/**
 * Dữ kiện ghi kết quả của một tiêu chí trong gói chấm; các trường kết quả vắng mặt được ghi thành `null` tường minh ở nhánh cập nhật-khi-trùng như đường cũ trước đây.
 */
export interface NewRubricEvaluation {
  id?: string;
  gradeId: string;
  criterionId: string;
  levelId?: string | null;
  score?: number | null;
  note?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Dữ kiện ghi một dòng vết kiểm toán sửa gói chấm. */
export interface NewGradeRevision {
  id?: string;
  gradeId: string;
  actorId: string;
  previousGrade?: number | null;
  newGrade?: number | null;
  previousLevel?: string | null;
  newLevel?: string | null;
  previousFeedback?: string | null;
  newFeedback?: string | null;
  reason?: string | null;
  createdAt?: Date;
}

/** Dữ kiện ghi một tin nhắn phản hồi. */
export interface NewFeedbackMessage {
  id?: string;
  gradeId: string;
  authorId: string;
  body: string;
  createdAt?: Date;
}

/** Dữ kiện ghi một câu vào ngân hàng lời phê. */
export interface NewCommentBankEntry {
  id?: string;
  ownerId: string;
  category?: string | null;
  text: string;
  createdAt?: Date;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng bài tập (dùng cho cả select lẫn returning). */
const ASSIGNMENT_COLUMNS = [
  'id',
  'course',
  'cm_id as cmId',
  'name',
  'intro',
  'due_date as dueDate',
  'max_files as maxFiles',
  'accepted_file_types as acceptedFileTypes',
  'grade',
  'result_mode as resultMode',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng bài nộp. */
const SUBMISSION_COLUMNS = [
  'id',
  'assignment_id as assignmentId',
  'user_id as userId',
  'status',
  'attempt_number as attemptNumber',
  'submitted_at as submittedAt',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng quan hệ bài nộp ↔ tệp. */
const SUBMISSION_FILE_COLUMNS = [
  'id',
  'submission_id as submissionId',
  'file_id as fileId',
  'created_at as createdAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng gói chấm. */
const GRADE_COLUMNS = [
  'id',
  'assignment_id as assignmentId',
  'user_id as userId',
  'grader_id as graderId',
  'attempt_number as attemptNumber',
  'grade',
  'level',
  'feedback',
  'feedback_progress as feedbackProgress',
  'feedback_strengths as feedbackStrengths',
  'feedback_weaknesses as feedbackWeaknesses',
  'status',
  'released_at as releasedAt',
  'released_by as releasedBy',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng dấu chấm. */
const ANNOTATION_COLUMNS = [
  'id',
  'submission_id as submissionId',
  'file_id as fileId',
  'page',
  'x',
  'y',
  'kind',
  'color',
  'text',
  'points',
  'author_id as authorId',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng bảng chấm. */
const RUBRIC_COLUMNS = [
  'id',
  'assignment_id as assignmentId',
  'title',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng tiêu chí của bảng chấm (bảng không có hai mốc created/updated). */
const RUBRIC_CRITERION_COLUMNS = [
  'id',
  'rubric_id as rubricId',
  'name',
  'description_for_student as descriptionForStudent',
  'description_for_grader as descriptionForGrader',
  'mode',
  'max_score as maxScore',
  'outcome_id as outcomeId',
  'outcome_text as outcomeText',
  'sort_order as sortOrder',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng mức của tiêu chí (bảng không có hai mốc created/updated). */
const RUBRIC_LEVEL_COLUMNS = [
  'id',
  'criterion_id as criterionId',
  'label',
  'score',
  'sort_order as sortOrder',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng kết quả theo tiêu chí. */
const RUBRIC_EVALUATION_COLUMNS = [
  'id',
  'grade_id as gradeId',
  'criterion_id as criterionId',
  'level_id as levelId',
  'score',
  'note',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng vết kiểm toán sửa gói chấm. */
const GRADE_REVISION_COLUMNS = [
  'id',
  'grade_id as gradeId',
  'actor_id as actorId',
  'previous_grade as previousGrade',
  'new_grade as newGrade',
  'previous_level as previousLevel',
  'new_level as newLevel',
  'previous_feedback as previousFeedback',
  'new_feedback as newFeedback',
  'reason',
  'created_at as createdAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng hội thoại phản hồi. */
const FEEDBACK_MESSAGE_COLUMNS = [
  'id',
  'grade_id as gradeId',
  'author_id as authorId',
  'body',
  'created_at as createdAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng ngân hàng lời phê. */
const COMMENT_BANK_COLUMNS = [
  'id',
  'owner_id as ownerId',
  'category',
  'text',
  'created_at as createdAt',
] as const;

/**
 * Ánh xạ dữ kiện ghi bài tập (camelCase) sang values insert
 * (snake_case), LOẠI mọi trường `undefined` — trường vắng mặt để
 * default của database quyết định (quy tắc T-4 trong sổ tay của
 * package). Mọi hàm ánh xạ ghi của file này giữ cùng quy tắc.
 */
function assignmentInsertValues(values: NewAssignment): InsertObject<CentreDB, 'assignments'> {
  return {
    course: values.course,
    name: values.name,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.cmId !== undefined ? { cm_id: values.cmId } : {}),
    ...(values.intro !== undefined ? { intro: values.intro } : {}),
    ...(values.dueDate !== undefined ? { due_date: values.dueDate } : {}),
    ...(values.maxFiles !== undefined ? { max_files: values.maxFiles } : {}),
    ...(values.acceptedFileTypes !== undefined ? { accepted_file_types: values.acceptedFileTypes } : {}),
    ...(values.grade !== undefined ? { grade: values.grade } : {}),
    ...(values.resultMode !== undefined ? { result_mode: values.resultMode } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/**
 * Ánh xạ một patch cập nhật bài tập (camelCase) sang set update
 * (snake_case), LOẠI mọi trường `undefined` — patch chứa trường nào
 * thì chỉ trường đó đổi (quy tắc T-4). Mọi hàm ánh xạ set của file
 * này giữ cùng quy tắc.
 */
function assignmentUpdateSet(patch: Partial<AssignmentRow>): UpdateObject<CentreDB, 'assignments'> {
  return {
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.course !== undefined ? { course: patch.course } : {}),
    ...(patch.cmId !== undefined ? { cm_id: patch.cmId } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.intro !== undefined ? { intro: patch.intro } : {}),
    ...(patch.dueDate !== undefined ? { due_date: patch.dueDate } : {}),
    ...(patch.maxFiles !== undefined ? { max_files: patch.maxFiles } : {}),
    ...(patch.acceptedFileTypes !== undefined ? { accepted_file_types: patch.acceptedFileTypes } : {}),
    ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
    ...(patch.resultMode !== undefined ? { result_mode: patch.resultMode } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi bài nộp (camelCase) sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function submissionInsertValues(values: NewSubmission): InsertObject<CentreDB, 'assign_submissions'> {
  return {
    assignment_id: values.assignmentId,
    user_id: values.userId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.attemptNumber !== undefined ? { attempt_number: values.attemptNumber } : {}),
    ...(values.submittedAt !== undefined ? { submitted_at: values.submittedAt } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/** Ánh xạ một patch cập nhật bài nộp (camelCase) sang set update (snake_case), loại `undefined` (quy tắc T-4). */
function submissionUpdateSet(patch: Partial<AssignSubmissionRow>): UpdateObject<CentreDB, 'assign_submissions'> {
  return {
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.assignmentId !== undefined ? { assignment_id: patch.assignmentId } : {}),
    ...(patch.userId !== undefined ? { user_id: patch.userId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.attemptNumber !== undefined ? { attempt_number: patch.attemptNumber } : {}),
    ...(patch.submittedAt !== undefined ? { submitted_at: patch.submittedAt } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện gắn tệp vào bài nộp (camelCase) sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function submissionFileInsertValues(values: NewSubmissionFile): InsertObject<CentreDB, 'assign_submission_files'> {
  return {
    submission_id: values.submissionId,
    file_id: values.fileId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi gói chấm (camelCase) sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function gradeInsertValues(values: NewGrade): InsertObject<CentreDB, 'assign_grades'> {
  return {
    assignment_id: values.assignmentId,
    user_id: values.userId,
    grader_id: values.graderId,
    attempt_number: values.attemptNumber,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.grade !== undefined ? { grade: values.grade } : {}),
    ...(values.level !== undefined ? { level: values.level } : {}),
    ...(values.feedback !== undefined ? { feedback: values.feedback } : {}),
    ...(values.feedbackProgress !== undefined ? { feedback_progress: values.feedbackProgress } : {}),
    ...(values.feedbackStrengths !== undefined ? { feedback_strengths: values.feedbackStrengths } : {}),
    ...(values.feedbackWeaknesses !== undefined ? { feedback_weaknesses: values.feedbackWeaknesses } : {}),
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.releasedAt !== undefined ? { released_at: values.releasedAt } : {}),
    ...(values.releasedBy !== undefined ? { released_by: values.releasedBy } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/** Ánh xạ một patch cập nhật gói chấm (camelCase) sang set update (snake_case), loại `undefined` (quy tắc T-4). */
function gradeUpdateSet(patch: Partial<AssignGradeRow>): UpdateObject<CentreDB, 'assign_grades'> {
  return {
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.assignmentId !== undefined ? { assignment_id: patch.assignmentId } : {}),
    ...(patch.userId !== undefined ? { user_id: patch.userId } : {}),
    ...(patch.graderId !== undefined ? { grader_id: patch.graderId } : {}),
    ...(patch.attemptNumber !== undefined ? { attempt_number: patch.attemptNumber } : {}),
    ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
    ...(patch.level !== undefined ? { level: patch.level } : {}),
    ...(patch.feedback !== undefined ? { feedback: patch.feedback } : {}),
    ...(patch.feedbackProgress !== undefined ? { feedback_progress: patch.feedbackProgress } : {}),
    ...(patch.feedbackStrengths !== undefined ? { feedback_strengths: patch.feedbackStrengths } : {}),
    ...(patch.feedbackWeaknesses !== undefined ? { feedback_weaknesses: patch.feedbackWeaknesses } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.releasedAt !== undefined ? { released_at: patch.releasedAt } : {}),
    ...(patch.releasedBy !== undefined ? { released_by: patch.releasedBy } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
  };
}

/**
 * Ánh xạ dữ kiện ghi dấu chấm (camelCase) sang values insert
 * (snake_case), loại `undefined` (quy tắc T-4). Cột `points` là
 * jsonb: mảng điểm đi qua {@link jsonbField}; `null` tường minh giữ
 * là `null`; vắng mặt thì cột không có trong values.
 */
function annotationInsertValues(values: NewAnnotation): InsertObject<CentreDB, 'assign_annotations'> {
  return {
    submission_id: values.submissionId,
    file_id: values.fileId,
    x: values.x,
    y: values.y,
    kind: values.kind,
    author_id: values.authorId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.page !== undefined ? { page: values.page } : {}),
    ...(values.color !== undefined ? { color: values.color } : {}),
    ...(values.text !== undefined ? { text: values.text } : {}),
    ...(values.points !== undefined ? { points: jsonbField(values.points) } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/**
 * Ánh xạ một patch cập nhật dấu chấm (camelCase) sang set update
 * (snake_case), loại `undefined` (quy tắc T-4). Cột `points` KHÔNG
 * nằm trong set này: kiểu `Updateable` của cột jsonb là kiểu giá trị
 * JSON thuần, không mang biểu thức thô ở tầng type, nên `points`
 * được gắn riêng ở phương thức cập nhật bằng biểu thức `::jsonb`
 * (điểm gọi `.set()` chấp nhận biểu thức thô qua `ValueExpression`).
 */
function annotationUpdateSet(patch: Partial<AssignAnnotationRow>): UpdateObject<CentreDB, 'assign_annotations'> {
  return {
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    ...(patch.submissionId !== undefined ? { submission_id: patch.submissionId } : {}),
    ...(patch.fileId !== undefined ? { file_id: patch.fileId } : {}),
    ...(patch.page !== undefined ? { page: patch.page } : {}),
    ...(patch.x !== undefined ? { x: patch.x } : {}),
    ...(patch.y !== undefined ? { y: patch.y } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.text !== undefined ? { text: patch.text } : {}),
    ...(patch.authorId !== undefined ? { author_id: patch.authorId } : {}),
    ...(patch.createdAt !== undefined ? { created_at: patch.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi bảng chấm (camelCase) sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function rubricInsertValues(values: NewRubric): InsertObject<CentreDB, 'assign_rubrics'> {
  return {
    assignment_id: values.assignmentId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.title !== undefined ? { title: values.title } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi tiêu chí (camelCase) sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function rubricCriterionInsertValues(values: NewRubricCriterion): InsertObject<CentreDB, 'assign_rubric_criteria'> {
  return {
    rubric_id: values.rubricId,
    name: values.name,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.descriptionForStudent !== undefined ? { description_for_student: values.descriptionForStudent } : {}),
    ...(values.descriptionForGrader !== undefined ? { description_for_grader: values.descriptionForGrader } : {}),
    ...(values.mode !== undefined ? { mode: values.mode } : {}),
    ...(values.maxScore !== undefined ? { max_score: values.maxScore } : {}),
    ...(values.outcomeId !== undefined ? { outcome_id: values.outcomeId } : {}),
    ...(values.outcomeText !== undefined ? { outcome_text: values.outcomeText } : {}),
    ...(values.sortOrder !== undefined ? { sort_order: values.sortOrder } : {}),
  };
}

/** Ánh xạ dữ kiện ghi mức của tiêu chí (camelCase) sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function rubricLevelInsertValues(values: NewRubricLevel): InsertObject<CentreDB, 'assign_rubric_levels'> {
  return {
    criterion_id: values.criterionId,
    label: values.label,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.score !== undefined ? { score: values.score } : {}),
    ...(values.sortOrder !== undefined ? { sort_order: values.sortOrder } : {}),
  };
}

/** Ánh xạ dữ kiện ghi kết quả theo tiêu chí (camelCase) sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function rubricEvaluationInsertValues(values: NewRubricEvaluation): InsertObject<CentreDB, 'assign_rubric_evaluations'> {
  return {
    grade_id: values.gradeId,
    criterion_id: values.criterionId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.levelId !== undefined ? { level_id: values.levelId } : {}),
    ...(values.score !== undefined ? { score: values.score } : {}),
    ...(values.note !== undefined ? { note: values.note } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
    ...(values.updatedAt !== undefined ? { updated_at: values.updatedAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi vết kiểm toán (camelCase) sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function gradeRevisionInsertValues(values: NewGradeRevision): InsertObject<CentreDB, 'assign_grade_revisions'> {
  return {
    grade_id: values.gradeId,
    actor_id: values.actorId,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.previousGrade !== undefined ? { previous_grade: values.previousGrade } : {}),
    ...(values.newGrade !== undefined ? { new_grade: values.newGrade } : {}),
    ...(values.previousLevel !== undefined ? { previous_level: values.previousLevel } : {}),
    ...(values.newLevel !== undefined ? { new_level: values.newLevel } : {}),
    ...(values.previousFeedback !== undefined ? { previous_feedback: values.previousFeedback } : {}),
    ...(values.newFeedback !== undefined ? { new_feedback: values.newFeedback } : {}),
    ...(values.reason !== undefined ? { reason: values.reason } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi tin nhắn phản hồi (camelCase) sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function feedbackMessageInsertValues(values: NewFeedbackMessage): InsertObject<CentreDB, 'assign_feedback_messages'> {
  return {
    grade_id: values.gradeId,
    author_id: values.authorId,
    body: values.body,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
  };
}

/** Ánh xạ dữ kiện ghi câu lời phê (camelCase) sang values insert (snake_case), loại `undefined` (quy tắc T-4). */
function commentBankInsertValues(values: NewCommentBankEntry): InsertObject<CentreDB, 'teacher_comment_bank'> {
  return {
    owner_id: values.ownerId,
    text: values.text,
    ...(values.id !== undefined ? { id: values.id } : {}),
    ...(values.category !== undefined ? { category: values.category } : {}),
    ...(values.createdAt !== undefined ? { created_at: values.createdAt } : {}),
  };
}

/**
 * Kho dữ liệu của hoạt động Bài tập nộp tệp/ảnh trên Kysely: bản ghi
 * bài tập (instance của course module), bài nộp của học sinh, quan
 * hệ bài nộp ↔ tệp (nội dung vật lý ở module Files) và điểm/lời phê
 * của giáo viên.
 *
 * Handle gốc được truyền lúc khởi tạo (facade định tuyến của kho
 * trung tâm do tầng ứng dụng cấp); mọi phương thức nhận thêm handle
 * tuỳ chọn để phía gọi ghép thao tác vào transaction đang mở của
 * chúng — repository không tự mở transaction ngoài phương thức
 * `transaction` tường minh.
 */
export class AssignmentsRepository {
  constructor(private readonly handle: AssignmentsDb) {}

  /** Instance gốc của repository. */
  private db(): AssignmentsDb {
    return this.handle;
  }

  /** Mở một transaction trên kho trung tâm và chạy `fn` với handle giao dịch. */
  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  /** Chèn bản ghi bài tập. */
  async insertAssignment(v: NewAssignment, db: AssignmentsDb = this.db()): Promise<AssignmentRow> {
    const row = await db
      .insertInto('assignments')
      .values(assignmentInsertValues(v))
      .returning(ASSIGNMENT_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Lấy bài tập theo id. */
  async getAssignment(id: string, db: AssignmentsDb = this.db()): Promise<AssignmentRow | undefined> {
    return db
      .selectFrom('assignments')
      .select(ASSIGNMENT_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
  }

  /** Các bài tập trong một khoá học, theo thứ tự tạo. */
  async listAssignmentsInCourse(courseId: string, db: AssignmentsDb = this.db()): Promise<AssignmentRow[]> {
    return db
      .selectFrom('assignments')
      .select(ASSIGNMENT_COLUMNS)
      .where('course', '=', courseId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Cập nhật bài tập; mốc `updatedAt` luôn lấy thời điểm cập nhật. */
  async updateAssignment(
    id: string,
    patch: Partial<AssignmentRow>,
    db: AssignmentsDb = this.db(),
  ): Promise<void> {
    await db
      .updateTable('assignments')
      .set({ ...assignmentUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Xoá bài tập (bài nộp, tệp liên kết và điểm cascade theo khoá ngoại). */
  async deleteAssignment(id: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db.deleteFrom('assignments').where('id', '=', id).execute();
  }

  /** Bài nộp hiện hành của một học sinh cho một bài tập (nếu có). */
  async getSubmission(
    assignmentId: string,
    userId: string,
    db: AssignmentsDb = this.db(),
  ): Promise<AssignSubmissionRow | undefined> {
    return db
      .selectFrom('assign_submissions')
      .select(SUBMISSION_COLUMNS)
      .where('assignment_id', '=', assignmentId)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
  }

  /** Mọi bài nộp của một bài tập, theo thứ tự tạo. */
  async listSubmissions(assignmentId: string, db: AssignmentsDb = this.db()): Promise<AssignSubmissionRow[]> {
    return db
      .selectFrom('assign_submissions')
      .select(SUBMISSION_COLUMNS)
      .where('assignment_id', '=', assignmentId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Chèn bài nộp mới. */
  async insertSubmission(v: NewSubmission, db: AssignmentsDb = this.db()): Promise<AssignSubmissionRow> {
    const row = await db
      .insertInto('assign_submissions')
      .values(submissionInsertValues(v))
      .returning(SUBMISSION_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Cập nhật bài nộp; mốc `updatedAt` luôn lấy thời điểm cập nhật. */
  async updateSubmission(
    id: string,
    patch: Partial<AssignSubmissionRow>,
    db: AssignmentsDb = this.db(),
  ): Promise<void> {
    await db
      .updateTable('assign_submissions')
      .set({ ...submissionUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Các tệp của một bài nộp theo thứ tự thêm vào. */
  async listSubmissionFiles(submissionId: string, db: AssignmentsDb = this.db()): Promise<AssignSubmissionFileRow[]> {
    return db
      .selectFrom('assign_submission_files')
      .select(SUBMISSION_FILE_COLUMNS)
      .where('submission_id', '=', submissionId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Gắn một tệp vào bài nộp. */
  async insertSubmissionFile(v: NewSubmissionFile, db: AssignmentsDb = this.db()): Promise<AssignSubmissionFileRow> {
    const row = await db
      .insertInto('assign_submission_files')
      .values(submissionFileInsertValues(v))
      .returning(SUBMISSION_FILE_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Gỡ quan hệ tệp ↔ bài nộp (bản ghi files được xoá ở tầng Files). */
  async deleteSubmissionFile(submissionId: string, fileId: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db
      .deleteFrom('assign_submission_files')
      .where('submission_id', '=', submissionId)
      .where('file_id', '=', fileId)
      .execute();
  }

  /** Điểm/lời phê hiện hành của một học sinh cho một bài tập (nếu có). */
  async getGrade(
    assignmentId: string,
    userId: string,
    db: AssignmentsDb = this.db(),
  ): Promise<AssignGradeRow | undefined> {
    return db
      .selectFrom('assign_grades')
      .select(GRADE_COLUMNS)
      .where('assignment_id', '=', assignmentId)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
  }

  /** Mọi điểm/lời phê của một bài tập. */
  async listGrades(assignmentId: string, db: AssignmentsDb = this.db()): Promise<AssignGradeRow[]> {
    return db
      .selectFrom('assign_grades')
      .select(GRADE_COLUMNS)
      .where('assignment_id', '=', assignmentId)
      .execute();
  }

  /**
   * Ghi hoặc cập nhật gói chấm (một bản ghi hiện hành cho mỗi học
   * sinh). Nhánh cập nhật khi trùng khoá duy nhất (bài tập + học
   * sinh) thay toàn bộ gói: người chấm và lần nộp lấy theo dữ kiện
   * mới; điểm/mức/các trường phản hồi/trạng thái công bố vắng mặt
   * trong dữ kiện ghi thì về `null` (trạng thái về `draft`), đúng
   * tập set của đường cũ trước đây.
   */
  async upsertGrade(v: NewGrade, db: AssignmentsDb = this.db()): Promise<AssignGradeRow> {
    const row = await db
      .insertInto('assign_grades')
      .values(gradeInsertValues(v))
      .onConflict((oc) =>
        oc.columns(['assignment_id', 'user_id']).doUpdateSet({
          grader_id: v.graderId,
          attempt_number: v.attemptNumber,
          grade: v.grade ?? null,
          level: v.level ?? null,
          feedback: v.feedback ?? null,
          feedback_progress: v.feedbackProgress ?? null,
          feedback_strengths: v.feedbackStrengths ?? null,
          feedback_weaknesses: v.feedbackWeaknesses ?? null,
          status: v.status ?? 'draft',
          released_at: v.releasedAt ?? null,
          released_by: v.releasedBy ?? null,
          updated_at: new Date(),
        }),
      )
      .returning(GRADE_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Cập nhật một phần gói chấm theo id; mốc `updatedAt` luôn lấy thời điểm cập nhật. */
  async updateGrade(id: string, patch: Partial<AssignGradeRow>, db: AssignmentsDb = this.db()): Promise<void> {
    await db
      .updateTable('assign_grades')
      .set({ ...gradeUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Các dấu chấm vector trên một bài nộp, theo thứ tự tạo. */
  async listAnnotations(submissionId: string, db: AssignmentsDb = this.db()): Promise<AssignAnnotationRow[]> {
    return db
      .selectFrom('assign_annotations')
      .select(ANNOTATION_COLUMNS)
      .where('submission_id', '=', submissionId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Một dấu chấm theo id. */
  async getAnnotation(id: string, db: AssignmentsDb = this.db()): Promise<AssignAnnotationRow | undefined> {
    return db
      .selectFrom('assign_annotations')
      .select(ANNOTATION_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
  }

  /** Thêm một dấu chấm. */
  async insertAnnotation(v: NewAnnotation, db: AssignmentsDb = this.db()): Promise<AssignAnnotationRow> {
    const row = await db
      .insertInto('assign_annotations')
      .values(annotationInsertValues(v))
      .returning(ANNOTATION_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * Sửa một dấu chấm; mốc `updatedAt` luôn lấy thời điểm cập nhật.
   * `points` trong patch được gắn riêng ngoài set đã ánh xạ (xem
   * {@link annotationUpdateSet}): có mặt là `null` thì xoá mảng
   * điểm (ghi NULL); có mặt là mảng thì ghi qua {@link jsonbField}
   * như đường insert; vắng mặt thì mảng điểm giữ nguyên.
   */
  async updateAnnotation(
    id: string,
    patch: Partial<AssignAnnotationRow>,
    db: AssignmentsDb = this.db(),
  ): Promise<void> {
    await db
      .updateTable('assign_annotations')
      .set({
        ...annotationUpdateSet(patch),
        ...(patch.points !== undefined
          ? { points: jsonbField(patch.points) }
          : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  /** Xoá một dấu chấm. */
  async deleteAnnotation(id: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db.deleteFrom('assign_annotations').where('id', '=', id).execute();
  }

  /** Bảng chấm của một bài tập (nếu có). */
  async getRubric(assignmentId: string, db: AssignmentsDb = this.db()): Promise<AssignRubricRow | undefined> {
    return db
      .selectFrom('assign_rubrics')
      .select(RUBRIC_COLUMNS)
      .where('assignment_id', '=', assignmentId)
      .limit(1)
      .executeTakeFirst();
  }

  /** Tạo bảng chấm mới. */
  async insertRubric(v: NewRubric, db: AssignmentsDb = this.db()): Promise<AssignRubricRow> {
    const row = await db
      .insertInto('assign_rubrics')
      .values(rubricInsertValues(v))
      .returning(RUBRIC_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Xoá bảng chấm của bài (tiêu chí/mức/đánh giá cascade theo khoá ngoại). */
  async deleteRubricByAssignment(assignmentId: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db.deleteFrom('assign_rubrics').where('assignment_id', '=', assignmentId).execute();
  }

  /** Các tiêu chí của một bảng chấm theo thứ tự hiển thị. */
  async listCriteria(rubricId: string, db: AssignmentsDb = this.db()): Promise<AssignRubricCriterionRow[]> {
    return db
      .selectFrom('assign_rubric_criteria')
      .select(RUBRIC_CRITERION_COLUMNS)
      .where('rubric_id', '=', rubricId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Thêm một tiêu chí. */
  async insertCriterion(v: NewRubricCriterion, db: AssignmentsDb = this.db()): Promise<AssignRubricCriterionRow> {
    const row = await db
      .insertInto('assign_rubric_criteria')
      .values(rubricCriterionInsertValues(v))
      .returning(RUBRIC_CRITERION_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Các mức của một tiêu chí theo thứ tự hiển thị. */
  async listLevels(criterionId: string, db: AssignmentsDb = this.db()): Promise<AssignRubricLevelRow[]> {
    return db
      .selectFrom('assign_rubric_levels')
      .select(RUBRIC_LEVEL_COLUMNS)
      .where('criterion_id', '=', criterionId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Thêm một mức cho tiêu chí. */
  async insertLevel(v: NewRubricLevel, db: AssignmentsDb = this.db()): Promise<AssignRubricLevelRow> {
    const row = await db
      .insertInto('assign_rubric_levels')
      .values(rubricLevelInsertValues(v))
      .returning(RUBRIC_LEVEL_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Kết quả theo tiêu chí của một gói chấm, theo thứ tự tạo. */
  async listEvaluations(gradeId: string, db: AssignmentsDb = this.db()): Promise<AssignRubricEvaluationRow[]> {
    return db
      .selectFrom('assign_rubric_evaluations')
      .select(RUBRIC_EVALUATION_COLUMNS)
      .where('grade_id', '=', gradeId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * Ghi/cập nhật kết quả của một tiêu chí trong gói chấm. Nhánh cập
   * nhật khi trùng khoá duy nhất (gói chấm + tiêu chí) ghi `null`
   * tường minh cho mức/điểm/ghi chú vắng mặt trong dữ kiện ghi, đúng
   * tập set của đường cũ trước đây.
   */
  async upsertEvaluation(v: NewRubricEvaluation, db: AssignmentsDb = this.db()): Promise<AssignRubricEvaluationRow> {
    const row = await db
      .insertInto('assign_rubric_evaluations')
      .values(rubricEvaluationInsertValues(v))
      .onConflict((oc) =>
        oc.columns(['grade_id', 'criterion_id']).doUpdateSet({
          level_id: v.levelId ?? null,
          score: v.score ?? null,
          note: v.note ?? null,
          updated_at: new Date(),
        }),
      )
      .returning(RUBRIC_EVALUATION_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Xoá toàn bộ kết quả theo tiêu chí của gói chấm (khi giáo viên gửi lại bộ đánh giá mới). */
  async deleteEvaluations(gradeId: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db.deleteFrom('assign_rubric_evaluations').where('grade_id', '=', gradeId).execute();
  }

  /** Ghi một dòng vết kiểm toán sửa gói chấm sau trả bài. */
  async insertRevision(v: NewGradeRevision, db: AssignmentsDb = this.db()): Promise<AssignGradeRevisionRow> {
    const row = await db
      .insertInto('assign_grade_revisions')
      .values(gradeRevisionInsertValues(v))
      .returning(GRADE_REVISION_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Các dòng vết kiểm toán của một gói chấm, cũ → mới. */
  async listRevisions(gradeId: string, db: AssignmentsDb = this.db()): Promise<AssignGradeRevisionRow[]> {
    return db
      .selectFrom('assign_grade_revisions')
      .select(GRADE_REVISION_COLUMNS)
      .where('grade_id', '=', gradeId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Hội thoại phản hồi của một gói chấm, cũ → mới. */
  async listMessages(gradeId: string, db: AssignmentsDb = this.db()): Promise<AssignFeedbackMessageRow[]> {
    return db
      .selectFrom('assign_feedback_messages')
      .select(FEEDBACK_MESSAGE_COLUMNS)
      .where('grade_id', '=', gradeId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Thêm một tin nhắn vào hội thoại phản hồi. */
  async insertMessage(v: NewFeedbackMessage, db: AssignmentsDb = this.db()): Promise<AssignFeedbackMessageRow> {
    const row = await db
      .insertInto('assign_feedback_messages')
      .values(feedbackMessageInsertValues(v))
      .returning(FEEDBACK_MESSAGE_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Ngân hàng lời phê của một giáo viên, theo thứ tự tạo tăng dần như đường cũ. */
  async listCommentBank(ownerId: string, db: AssignmentsDb = this.db()): Promise<TeacherCommentBankRow[]> {
    return db
      .selectFrom('teacher_comment_bank')
      .select(COMMENT_BANK_COLUMNS)
      .where('owner_id', '=', ownerId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** Thêm một câu vào ngân hàng lời phê. */
  async insertCommentBankEntry(v: NewCommentBankEntry, db: AssignmentsDb = this.db()): Promise<TeacherCommentBankRow> {
    const row = await db
      .insertInto('teacher_comment_bank')
      .values(commentBankInsertValues(v))
      .returning(COMMENT_BANK_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Xoá một câu khỏi ngân hàng lời phê của chính chủ sở hữu. */
  async deleteCommentBankEntry(id: string, ownerId: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db
      .deleteFrom('teacher_comment_bank')
      .where('id', '=', id)
      .where('owner_id', '=', ownerId)
      .execute();
  }
}
