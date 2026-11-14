import { sql, type Insertable, type InsertObject, type RawBuilder, type Updateable, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { ExamQuestionSnapshot, ExamVariant } from '../jsonb-types';
import { EXAM_COLUMNS, EXAM_SLOT_COLUMNS, EXAM_VERSION_COLUMNS, type ExamRow, type ExamSlotRow, type ExamVersionRow } from './exams';
import { applyDefined } from './mapping';

export type QuizTx = CentreTx;
export type QuizDb = CentreDb | CentreTx;

export const QUIZ_PIN_ATTEMPTS_LIMIT = 10_000;

function jsonbValue<T>(value: T): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

export interface ExamPinRow {
  questionSnapshots: ExamQuestionSnapshot[] | null;
  requestId: string | null;
  requestedSectionId: string | null;
  preparationState: string;
  pendingSnapshotId: string | null;
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

export interface NewExamPin {
  questionSnapshots?: ExamQuestionSnapshot[] | null;
  requestId?: string | null;
  requestedSectionId?: string | null;
  preparationState?: string;
  pendingSnapshotId?: string | null;
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

const EXAM_PIN_COLUMNS = [
  'question_snapshots as questionSnapshots',
  'request_id as requestId',
  'requested_section_id as requestedSectionId',
  'preparation_state as preparationState',
  'pending_snapshot_id as pendingSnapshotId',
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

function examPinInsertValues(values: NewExamPin): InsertObject<CentreDB, 'exam_pins'> {
  const row: InsertObject<CentreDB, 'exam_pins'> = {
    course_id: values.courseId,
    created_by: values.createdBy,
    exam_id: values.examId,
    exam_version_id: values.examVersionId,
    variants: jsonbValue(values.variants),
  };
  applyDefined(row, values, [
    ['questionSnapshots', 'question_snapshots', (value) => (value === null ? null : jsonbValue(value))],
    ['requestId', 'request_id'],
    ['requestedSectionId', 'requested_section_id'],
    ['preparationState', 'preparation_state'],
    ['pendingSnapshotId', 'pending_snapshot_id'],
    ['attemptsAllowed', 'attempts_allowed'],
    ['cmId', 'cm_id'],
    ['createdAt', 'created_at'],
    ['gradeMethod', 'grade_method'],
    ['id', 'id'],
    ['intro', 'intro'],
    ['lateEntryMinutes', 'late_entry_minutes'],
    ['monitorEvents', 'monitor_events'],
    ['name', 'name'],
    ['passwordHash', 'password_hash'],
    ['preset', 'preset'],
    ['resultsPublishedAt', 'results_published_at'],
    ['reviewAttempt', 'review_attempt'],
    ['reviewCorrectness', 'review_correctness'],
    ['reviewGeneralFeedback', 'review_general_feedback'],
    ['reviewMarks', 'review_marks'],
    ['reviewOverallFeedback', 'review_overall_feedback'],
    ['reviewRightAnswer', 'review_right_answer'],
    ['reviewSpecificFeedback', 'review_specific_feedback'],
    ['shuffleAnswers', 'shuffle_answers'],
    ['subnet', 'subnet'],
    ['targetGroupId', 'target_group_id'],
    ['timeClose', 'time_close'],
    ['timeLimit', 'time_limit'],
    ['timeOpen', 'time_open'],
    ['updatedAt', 'updated_at'],
    ['variantCount', 'variant_count'],
    ['versionMode', 'version_mode'],
  ]);
  return row;
}

function examPinUpdateSet(patch: Partial<ExamPinRow>): UpdateObject<CentreDB, 'exam_pins'> {
  const set: UpdateObject<CentreDB, 'exam_pins'> = {};
  applyDefined(set, patch, [
    ['questionSnapshots', 'question_snapshots', (value) => (value === null ? null : jsonbValue(value))],
    ['requestedSectionId', 'requested_section_id'],
    ['preparationState', 'preparation_state'],
    ['pendingSnapshotId', 'pending_snapshot_id'],
    ['attemptsAllowed', 'attempts_allowed'],
    ['cmId', 'cm_id'],
    ['courseId', 'course_id'],
    ['createdAt', 'created_at'],
    ['createdBy', 'created_by'],
    ['examId', 'exam_id'],
    ['examVersionId', 'exam_version_id'],
    ['gradeMethod', 'grade_method'],
    ['id', 'id'],
    ['intro', 'intro'],
    ['lateEntryMinutes', 'late_entry_minutes'],
    ['monitorEvents', 'monitor_events'],
    ['name', 'name'],
    ['passwordHash', 'password_hash'],
    ['preset', 'preset'],
    ['resultsPublishedAt', 'results_published_at'],
    ['reviewAttempt', 'review_attempt'],
    ['reviewCorrectness', 'review_correctness'],
    ['reviewGeneralFeedback', 'review_general_feedback'],
    ['reviewMarks', 'review_marks'],
    ['reviewOverallFeedback', 'review_overall_feedback'],
    ['reviewRightAnswer', 'review_right_answer'],
    ['reviewSpecificFeedback', 'review_specific_feedback'],
    ['shuffleAnswers', 'shuffle_answers'],
    ['subnet', 'subnet'],
    ['targetGroupId', 'target_group_id'],
    ['timeClose', 'time_close'],
    ['timeLimit', 'time_limit'],
    ['timeOpen', 'time_open'],
    ['updatedAt', 'updated_at'],
    ['variantCount', 'variant_count'],
    ['variants', 'variants', (value) => jsonbValue(value)],
    ['versionMode', 'version_mode'],
  ]);
  return set;
}

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

function examAttemptInsertValues(values: NewExamAttempt): InsertObject<CentreDB, 'exam_attempts'> {
  const row: InsertObject<CentreDB, 'exam_attempts'> = {
    attempt_number: values.attemptNumber,
    pin_id: values.pinId,
    usage_id: values.usageId,
    user_id: values.userId,
  };
  applyDefined(row, values, [
    ['appliedSettings', 'applied_settings', (value) => (value === null ? null : jsonbValue(value))],
    ['createdAt', 'created_at'],
    ['id', 'id'],
    ['makeup', 'makeup'],
    ['preview', 'preview'],
    ['state', 'state'],
    ['sumGrades', 'sum_grades'],
    ['timeFinish', 'time_finish'],
    ['timeStart', 'time_start'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function examAttemptUpdateSet(patch: Partial<ExamAttemptRow>): UpdateObject<CentreDB, 'exam_attempts'> {
  const set: UpdateObject<CentreDB, 'exam_attempts'> = {};
  applyDefined(set, patch, [
    ['appliedSettings', 'applied_settings', (value) => (value === null ? null : jsonbValue(value))],
    ['attemptNumber', 'attempt_number'],
    ['createdAt', 'created_at'],
    ['id', 'id'],
    ['makeup', 'makeup'],
    ['pinId', 'pin_id'],
    ['preview', 'preview'],
    ['state', 'state'],
    ['sumGrades', 'sum_grades'],
    ['timeFinish', 'time_finish'],
    ['timeStart', 'time_start'],
    ['updatedAt', 'updated_at'],
    ['usageId', 'usage_id'],
    ['userId', 'user_id'],
  ]);
  return set;
}

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

function examPinOverrideInsertValues(values: NewExamPinOverride): Insertable<CentreDB['exam_pin_overrides']> {
  const row: Insertable<CentreDB['exam_pin_overrides']> = {
    pin_id: values.pinId,
  };
  applyDefined(row, values, [
    ['attempts', 'attempts'],
    ['createdAt', 'created_at'],
    ['groupId', 'group_id'],
    ['id', 'id'],
    ['passwordHash', 'password_hash'],
    ['reason', 'reason'],
    ['timeClose', 'time_close'],
    ['timeLimit', 'time_limit'],
    ['timeOpen', 'time_open'],
    ['updatedAt', 'updated_at'],
    ['userId', 'user_id'],
  ]);
  return row;
}

function examPinOverrideUpdateSet(patch: Partial<ExamPinOverrideRow>): Updateable<CentreDB['exam_pin_overrides']> {
  const set: Updateable<CentreDB['exam_pin_overrides']> = {};
  applyDefined(set, patch, [
    ['attempts', 'attempts'],
    ['createdAt', 'created_at'],
    ['groupId', 'group_id'],
    ['id', 'id'],
    ['passwordHash', 'password_hash'],
    ['pinId', 'pin_id'],
    ['reason', 'reason'],
    ['timeClose', 'time_close'],
    ['timeLimit', 'time_limit'],
    ['timeOpen', 'time_open'],
    ['updatedAt', 'updated_at'],
    ['userId', 'user_id'],
  ]);
  return set;
}

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

function examMatrixInsertValues(values: NewExamMatrix): InsertObject<CentreDB, 'exam_matrices'> {
  const row: InsertObject<CentreDB, 'exam_matrices'> = {
    context_id: values.contextId,
    curriculum_id: values.curriculumId,
    name: values.name,
    subject_id: values.subjectId,
  };
  applyDefined(row, values, [
    ['bankId', 'bank_id'],
    ['contentSignature', 'content_signature'],
    ['copyCount', 'copy_count'],
    ['createdAt', 'created_at'],
    ['createdBy', 'created_by'],
    ['derivedFromBankId', 'derived_from_bank_id'],
    ['derivedFromMatrixId', 'derived_from_matrix_id'],
    ['id', 'id'],
    ['isTemplate', 'is_template'],
    ['levelSet', 'level_set'],
    ['originalAuthorId', 'original_author_id'],
    ['presetKind', 'preset_kind'],
    ['scopeNodeIds', 'scope_node_ids', (value) => (value === null ? null : jsonbValue(value))],
    ['scopeNote', 'scope_note'],
    ['status', 'status'],
    ['targetFormPercents', 'target_form_percents', (value) => (value === null ? null : jsonbValue(value))],
    ['targetLevelPercents', 'target_level_percents', (value) => (value === null ? null : jsonbValue(value))],
    ['tenantId', 'tenant_id'],
    ['totalScore', 'total_score'],
    ['updatedAt', 'updated_at'],
    ['version', 'version'],
    ['withdrawnAt', 'withdrawn_at'],
    ['withdrawnBy', 'withdrawn_by'],
    ['withdrawnReason', 'withdrawn_reason'],
  ]);
  return row;
}

function examMatrixUpdateSet(patch: Partial<ExamMatrixRow>): UpdateObject<CentreDB, 'exam_matrices'> {
  const set: UpdateObject<CentreDB, 'exam_matrices'> = {};
  applyDefined(set, patch, [
    ['bankId', 'bank_id'],
    ['contentSignature', 'content_signature'],
    ['contextId', 'context_id'],
    ['copyCount', 'copy_count'],
    ['createdAt', 'created_at'],
    ['createdBy', 'created_by'],
    ['curriculumId', 'curriculum_id'],
    ['derivedFromBankId', 'derived_from_bank_id'],
    ['derivedFromMatrixId', 'derived_from_matrix_id'],
    ['id', 'id'],
    ['isTemplate', 'is_template'],
    ['levelSet', 'level_set'],
    ['name', 'name'],
    ['originalAuthorId', 'original_author_id'],
    ['presetKind', 'preset_kind'],
    ['scopeNodeIds', 'scope_node_ids', (value) => (value === null ? null : jsonbValue(value))],
    ['scopeNote', 'scope_note'],
    ['status', 'status'],
    ['subjectId', 'subject_id'],
    ['targetFormPercents', 'target_form_percents', (value) => (value === null ? null : jsonbValue(value))],
    ['targetLevelPercents', 'target_level_percents', (value) => (value === null ? null : jsonbValue(value))],
    ['tenantId', 'tenant_id'],
    ['totalScore', 'total_score'],
    ['updatedAt', 'updated_at'],
    ['version', 'version'],
    ['withdrawnAt', 'withdrawn_at'],
    ['withdrawnBy', 'withdrawn_by'],
    ['withdrawnReason', 'withdrawn_reason'],
  ]);
  return set;
}

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

function examMatrixVersionInsertValues(values: NewExamMatrixVersion): InsertObject<CentreDB, 'exam_matrix_versions'> {
  const row: InsertObject<CentreDB, 'exam_matrix_versions'> = {
    created_by: values.createdBy,
    matrix_id: values.matrixId,
    version: values.version,
  };
  applyDefined(row, values, [
    ['createdAt', 'created_at'],
    ['id', 'id'],
    ['levelSet', 'level_set'],
    ['presetKind', 'preset_kind'],
    ['scopeNodeIds', 'scope_node_ids', (value) => (value === null ? null : jsonbValue(value))],
    ['scopeNote', 'scope_note'],
    ['targetFormPercents', 'target_form_percents', (value) => (value === null ? null : jsonbValue(value))],
    ['targetLevelPercents', 'target_level_percents', (value) => (value === null ? null : jsonbValue(value))],
    ['totalScore', 'total_score'],
  ]);
  return row;
}

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

function examMatrixCellInsertValues(values: NewExamMatrixCell): InsertObject<CentreDB, 'exam_matrix_cells'> {
  const row: InsertObject<CentreDB, 'exam_matrix_cells'> = {
    cell_score: values.cellScore,
    cognitive_level: values.cognitiveLevel,
    curriculum_node_id: values.curriculumNodeId,
    matrix_id: values.matrixId,
    matrix_version_id: values.matrixVersionId,
    qtype: values.qtype,
    question_count: values.questionCount,
  };
  applyDefined(row, values, [
    ['createdAt', 'created_at'],
    ['id', 'id'],
    ['minutes', 'minutes'],
    ['position', 'position'],
    ['tfScale', 'tf_scale', (value) => (value === null ? null : jsonbValue(value))],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function examMatrixCellUpdateSet(patch: Partial<ExamMatrixCellRow>): UpdateObject<CentreDB, 'exam_matrix_cells'> {
  const set: UpdateObject<CentreDB, 'exam_matrix_cells'> = {};
  applyDefined(set, patch, [
    ['cellScore', 'cell_score'],
    ['cognitiveLevel', 'cognitive_level'],
    ['createdAt', 'created_at'],
    ['curriculumNodeId', 'curriculum_node_id'],
    ['id', 'id'],
    ['matrixId', 'matrix_id'],
    ['matrixVersionId', 'matrix_version_id'],
    ['minutes', 'minutes'],
    ['position', 'position'],
    ['qtype', 'qtype'],
    ['questionCount', 'question_count'],
    ['tfScale', 'tf_scale', (value) => (value === null ? null : jsonbValue(value))],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

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

function examMatrixContributionInsertValues(values: NewExamMatrixContribution): Insertable<CentreDB['exam_matrix_contributions']> {
  const row: Insertable<CentreDB['exam_matrix_contributions']> = {
    matrix_id: values.matrixId,
    proposer_id: values.proposerId,
    target_bank_id: values.targetBankId,
  };
  applyDefined(row, values, [
    ['contentHash', 'content_hash'],
    ['createdAt', 'created_at'],
    ['id', 'id'],
    ['nearDuplicateOf', 'near_duplicate_of'],
    ['note', 'note'],
    ['rejectReason', 'reject_reason'],
    ['resultMatrixId', 'result_matrix_id'],
    ['reviewerId', 'reviewer_id'],
    ['status', 'status'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

function examMatrixContributionUpdateSet(patch: Partial<ExamMatrixContributionRow>): Updateable<CentreDB['exam_matrix_contributions']> {
  const set: Updateable<CentreDB['exam_matrix_contributions']> = {};
  applyDefined(set, patch, [
    ['contentHash', 'content_hash'],
    ['createdAt', 'created_at'],
    ['id', 'id'],
    ['matrixId', 'matrix_id'],
    ['nearDuplicateOf', 'near_duplicate_of'],
    ['note', 'note'],
    ['proposerId', 'proposer_id'],
    ['rejectReason', 'reject_reason'],
    ['resultMatrixId', 'result_matrix_id'],
    ['reviewerId', 'reviewer_id'],
    ['status', 'status'],
    ['targetBankId', 'target_bank_id'],
    ['updatedAt', 'updated_at'],
  ]);
  return set;
}

export interface ExamPinFeedbackRow {
  createdAt: Date;
  feedback: string;
  id: string;
  maxPercent: number;
  minPercent: number;
  pinId: string;
  updatedAt: Date;
}

export interface NewExamPinFeedback {
  createdAt?: Date;
  feedback: string;
  id?: string;
  maxPercent: number;
  minPercent: number;
  pinId: string;
  updatedAt?: Date;
}

const EXAM_PIN_FEEDBACK_COLUMNS = [
  'created_at as createdAt',
  'feedback',
  'id',
  'max_percent as maxPercent',
  'min_percent as minPercent',
  'pin_id as pinId',
  'updated_at as updatedAt',
] as const;

function examPinFeedbackInsertValues(values: NewExamPinFeedback): Insertable<CentreDB['exam_pin_feedbacks']> {
  const row: Insertable<CentreDB['exam_pin_feedbacks']> = {
    feedback: values.feedback,
    max_percent: values.maxPercent,
    min_percent: values.minPercent,
    pin_id: values.pinId,
  };
  applyDefined(row, values, [
    ['createdAt', 'created_at'],
    ['id', 'id'],
    ['updatedAt', 'updated_at'],
  ]);
  return row;
}

export interface ExamAttemptEventRow {
  attemptId: string;
  createdAt: Date;
  data: Record<string, unknown> | null;
  id: string;
  type: string;
}

export interface NewExamAttemptEvent {
  attemptId: string;
  createdAt?: Date;
  data?: Record<string, unknown> | null;
  id?: string;
  type: string;
}

const EXAM_ATTEMPT_EVENT_COLUMNS = [
  'attempt_id as attemptId',
  'created_at as createdAt',
  'data',
  'id',
  'type',
] as const;

function examAttemptEventInsertValues(values: NewExamAttemptEvent): InsertObject<CentreDB, 'exam_attempt_events'> {
  const row: InsertObject<CentreDB, 'exam_attempt_events'> = {
    attempt_id: values.attemptId,
    type: values.type,
  };
  applyDefined(row, values, [
    ['createdAt', 'created_at'],
    ['data', 'data', (value) => (value === null ? null : jsonbValue(value))],
    ['id', 'id'],
  ]);
  return row;
}

export interface ExamPinVersionUpdateRow {
  actorId: string;
  createdAt: Date;
  fromExamVersionId: string;
  id: string;
  pinId: string;
  toExamVersionId: string;
}

export interface NewExamPinVersionUpdate {
  actorId: string;
  createdAt?: Date;
  fromExamVersionId: string;
  id?: string;
  pinId: string;
  toExamVersionId: string;
}

const EXAM_PIN_VERSION_UPDATE_COLUMNS = [
  'actor_id as actorId',
  'created_at as createdAt',
  'from_exam_version_id as fromExamVersionId',
  'id',
  'pin_id as pinId',
  'to_exam_version_id as toExamVersionId',
] as const;

function examPinVersionUpdateInsertValues(values: NewExamPinVersionUpdate): Insertable<CentreDB['exam_pin_version_updates']> {
  const row: Insertable<CentreDB['exam_pin_version_updates']> = {
    actor_id: values.actorId,
    from_exam_version_id: values.fromExamVersionId,
    pin_id: values.pinId,
    to_exam_version_id: values.toExamVersionId,
  };
  applyDefined(row, values, [
    ['createdAt', 'created_at'],
    ['id', 'id'],
  ]);
  return row;
}

export interface ExamAttemptRegradeRow {
  actorId: string;
  createdAt: Date;
  fromVersionId: string;
  id: string;
  pinId: string;
  questionId: string;
  toVersionId: string;
}

export interface NewExamAttemptRegrade {
  actorId: string;
  createdAt?: Date;
  fromVersionId: string;
  id?: string;
  pinId: string;
  questionId: string;
  toVersionId: string;
}

const EXAM_ATTEMPT_REGRADE_COLUMNS = [
  'actor_id as actorId',
  'created_at as createdAt',
  'from_version_id as fromVersionId',
  'id',
  'pin_id as pinId',
  'question_id as questionId',
  'to_version_id as toVersionId',
] as const;

function examAttemptRegradeInsertValues(values: NewExamAttemptRegrade): Insertable<CentreDB['exam_attempt_regrades']> {
  const row: Insertable<CentreDB['exam_attempt_regrades']> = {
    actor_id: values.actorId,
    from_version_id: values.fromVersionId,
    pin_id: values.pinId,
    question_id: values.questionId,
    to_version_id: values.toVersionId,
  };
  applyDefined(row, values, [
    ['createdAt', 'created_at'],
    ['id', 'id'],
  ]);
  return row;
}

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

function examAttemptRegradeItemInsertValues(values: NewExamAttemptRegradeItem): Insertable<CentreDB['exam_attempt_regrade_items']> {
  const row: Insertable<CentreDB['exam_attempt_regrade_items']> = {
    exam_attempt_id: values.examAttemptId,
    question_attempt_id: values.questionAttemptId,
    regrade_id: values.regradeId,
    user_id: values.userId,
  };
  applyDefined(row, values, [
    ['createdAt', 'created_at'],
    ['id', 'id'],
    ['newFraction', 'new_fraction'],
    ['newSumGrades', 'new_sum_grades'],
    ['oldFraction', 'old_fraction'],
    ['oldSumGrades', 'old_sum_grades'],
  ]);
  return row;
}
export class QuizRepository {
  constructor(private readonly handle: CentreDb) {}

  private db(): CentreDb {
    return this.handle;
  }

  async transaction<T>(fn: (tx: QuizTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async withPinRequestLock<T>(courseId: string, actorId: string, requestId: string, action: () => Promise<T>): Promise<T> {
    const key = `exam-pin:${courseId}:${actorId}:${requestId}`;
    return this.db().connection().execute(async (connection) => {
      await sql`select pg_advisory_lock(hashtextextended(${key}, 0))`.execute(connection);
      try {
        return await action();
      } finally {
        await sql`select pg_advisory_unlock(hashtextextended(${key}, 0))`.execute(connection);
      }
    });
  }

  async insertPin(v: NewExamPin, db: QuizDb = this.db()): Promise<ExamPinRow> {
    const rows = await db.insertInto('exam_pins').values(examPinInsertValues(v)).returning(EXAM_PIN_COLUMNS).execute();
    return rows[0]!;
  }
  async getPinByRequest(courseId: string, actorId: string, requestId: string): Promise<ExamPinRow | undefined> {
    return this.db().selectFrom('exam_pins').select(EXAM_PIN_COLUMNS)
      .where('course_id', '=', courseId).where('created_by', '=', actorId).where('request_id', '=', requestId).executeTakeFirst();
  }

  async getPin(id: string, db: QuizDb = this.db()): Promise<ExamPinRow | undefined> {
    return db.selectFrom('exam_pins').select(EXAM_PIN_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  async listPinsInCourse(courseId: string, db: QuizDb = this.db()): Promise<ExamPinRow[]> {
    return db
      .selectFrom('exam_pins')
      .select(EXAM_PIN_COLUMNS)
      .where('course_id', '=', courseId)
      .where('preparation_state', '=', 'ready')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
  async updatePin(id: string, patch: Partial<ExamPinRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_pins')
      .set({ ...examPinUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
  async deletePin(id: string, db: QuizDb = this.db()): Promise<void> {
    await db.deleteFrom('exam_pins').where('id', '=', id).execute();
  }


  async getExam(id: string, db: QuizDb = this.db()): Promise<ExamRow | undefined> {
    return db.selectFrom('exams').select(EXAM_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async getExamVersion(id: string, db: QuizDb = this.db()): Promise<ExamVersionRow | undefined> {
    return db.selectFrom('exam_versions').select(EXAM_VERSION_COLUMNS).where('id', '=', id).limit(1).executeTakeFirst();
  }

  async listExamSlots(examVersionId: string, db: QuizDb = this.db()): Promise<ExamSlotRow[]> {
    return db
      .selectFrom('exam_slots')
      .select(EXAM_SLOT_COLUMNS)
      .where('exam_version_id', '=', examVersionId)
      .orderBy('position', 'asc')
      .execute();
  }

  async listExamVersions(examId: string, db: QuizDb = this.db()): Promise<ExamVersionRow[]> {
    return db
      .selectFrom('exam_versions')
      .select(EXAM_VERSION_COLUMNS)
      .where('exam_id', '=', examId)
      .orderBy('version', 'asc')
      .execute();
  }

  async insertAttempt(v: NewExamAttempt, db: QuizDb = this.db()): Promise<ExamAttemptRow> {
    const rows = await db.insertInto('exam_attempts').values(examAttemptInsertValues(v)).returning(EXAM_ATTEMPT_COLUMNS).execute();
    return rows[0]!;
  }
  async getAttempt(id: string, db: QuizDb = this.db()): Promise<ExamAttemptRow | undefined> {
    return db.selectFrom('exam_attempts').select(EXAM_ATTEMPT_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
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
  async updateAttempt(id: string, patch: Partial<ExamAttemptRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_attempts')
      .set({ ...examAttemptUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }


  async insertOverride(v: NewExamPinOverride, db: QuizDb = this.db()): Promise<ExamPinOverrideRow> {
    const rows = await db.insertInto('exam_pin_overrides').values(examPinOverrideInsertValues(v)).returning(EXAM_PIN_OVERRIDE_COLUMNS).execute();
    return rows[0]!;
  }
  async getOverride(id: string, db: QuizDb = this.db()): Promise<ExamPinOverrideRow | undefined> {
    return db.selectFrom('exam_pin_overrides').select(EXAM_PIN_OVERRIDE_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  async listOverrides(pinId: string, db: QuizDb = this.db()): Promise<ExamPinOverrideRow[]> {
    return db
      .selectFrom('exam_pin_overrides')
      .select(EXAM_PIN_OVERRIDE_COLUMNS)
      .where('pin_id', '=', pinId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
  async sessionLatestClose(pinId: string, db: QuizDb = this.db()): Promise<{ hasUnbounded: boolean; latest: Date | null }> {
    const pinRow = await db
      .selectFrom('exam_pins')
      .select(['time_close as timeClose'])
      .where('id', '=', pinId)
      .executeTakeFirst();
    const base = pinRow?.timeClose ?? null;
    const overrides = await this.listOverrides(pinId, db);
    const hasUnbounded = base === null;
    let latest = base;
    for (const o of overrides) {
      if (o.timeClose === null) continue;
      if (latest === null || o.timeClose > latest) latest = o.timeClose;
    }
    return { hasUnbounded, latest };
  }

  async updateOverride(id: string, patch: Partial<ExamPinOverrideRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_pin_overrides')
      .set({ ...examPinOverrideUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
  async deleteOverride(id: string, db: QuizDb = this.db()): Promise<void> {
    await db.deleteFrom('exam_pin_overrides').where('id', '=', id).execute();
  }


  async insertMatrix(v: NewExamMatrix, db: QuizDb = this.db()): Promise<ExamMatrixRow> {
    const rows = await db.insertInto('exam_matrices').values(examMatrixInsertValues(v)).returning(EXAM_MATRIX_COLUMNS).execute();
    return rows[0]!;
  }
  async getMatrix(id: string, db: QuizDb = this.db()): Promise<ExamMatrixRow | undefined> {
    return db.selectFrom('exam_matrices').select(EXAM_MATRIX_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  async findMatrixByBankAndSignature(bankId: string, contentSignature: string, db: QuizDb = this.db()): Promise<ExamMatrixRow | undefined> {
    return db
      .selectFrom('exam_matrices')
      .select(EXAM_MATRIX_COLUMNS)
      .where('bank_id', '=', bankId)
      .where('content_signature', '=', contentSignature)
      .executeTakeFirst();
  }
  async listMatricesBySubject(subjectId: string, db: QuizDb = this.db()): Promise<ExamMatrixRow[]> {
    return db
      .selectFrom('exam_matrices')
      .select(EXAM_MATRIX_COLUMNS)
      .where('subject_id', '=', subjectId)
      .orderBy('name', 'asc')
      .execute();
  }
  async updateMatrix(id: string, patch: Partial<ExamMatrixRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_matrices')
      .set({ ...examMatrixUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
  async bumpMatrixCopyCount(id: string, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_matrices')
      .set({ copy_count: sql<number>`"exam_matrices"."copy_count" + 1` })
      .where('id', '=', id)
      .execute();
  }
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
  async deleteMatrix(id: string, db: QuizDb = this.db()): Promise<void> {
    await db.deleteFrom('exam_matrices').where('id', '=', id).execute();
  }
  async insertMatrixVersion(v: NewExamMatrixVersion, db: QuizDb = this.db()): Promise<ExamMatrixVersionRow> {
    const rows = await db.insertInto('exam_matrix_versions').values(examMatrixVersionInsertValues(v)).returning(EXAM_MATRIX_VERSION_COLUMNS).execute();
    return rows[0]!;
  }
  async getMatrixVersionRow(matrixId: string, version: number, db: QuizDb = this.db()): Promise<ExamMatrixVersionRow | undefined> {
    return db
      .selectFrom('exam_matrix_versions')
      .select(EXAM_MATRIX_VERSION_COLUMNS)
      .where('matrix_id', '=', matrixId)
      .where('version', '=', version)
      .executeTakeFirst();
  }
  async getMatrixVersionById(id: string, db: QuizDb = this.db()): Promise<ExamMatrixVersionRow | undefined> {
    return db.selectFrom('exam_matrix_versions').select(EXAM_MATRIX_VERSION_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  async insertMatrixCell(v: NewExamMatrixCell, db: QuizDb = this.db()): Promise<ExamMatrixCellRow> {
    const rows = await db.insertInto('exam_matrix_cells').values(examMatrixCellInsertValues(v)).returning(EXAM_MATRIX_CELL_COLUMNS).execute();
    return rows[0]!;
  }
  async getMatrixCell(id: string, db: QuizDb = this.db()): Promise<ExamMatrixCellRow | undefined> {
    return db.selectFrom('exam_matrix_cells').select(EXAM_MATRIX_CELL_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
  async listMatrixCells(matrixId: string, db: QuizDb = this.db()): Promise<ExamMatrixCellRow[]> {
    const matrix = await this.getMatrix(matrixId, db);
    const versionRow = matrix ? await this.getMatrixVersionRow(matrixId, matrix.version, db) : undefined;
    let query = db.selectFrom('exam_matrix_cells').select(EXAM_MATRIX_CELL_COLUMNS);
    query = versionRow
      ? query.where('matrix_version_id', '=', versionRow.id)
      : query.where('matrix_id', '=', matrixId);
    return query.orderBy('position', 'asc').orderBy('id', 'asc').execute();
  }
  async listMatrixCellsByVersionId(matrixVersionId: string, db: QuizDb = this.db()): Promise<ExamMatrixCellRow[]> {
    return db
      .selectFrom('exam_matrix_cells')
      .select(EXAM_MATRIX_CELL_COLUMNS)
      .where('matrix_version_id', '=', matrixVersionId)
      .orderBy('position', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
  async updateMatrixCell(id: string, patch: Partial<ExamMatrixCellRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_matrix_cells')
      .set({ ...examMatrixCellUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
  async deleteMatrixCell(id: string, db: QuizDb = this.db()): Promise<void> {
    await db.deleteFrom('exam_matrix_cells').where('id', '=', id).execute();
  }


  async listMatricesByBank(bankId: string, db: QuizDb = this.db()): Promise<ExamMatrixRow[]> {
    return db
      .selectFrom('exam_matrices')
      .select(EXAM_MATRIX_COLUMNS)
      .where('bank_id', '=', bankId)
      .orderBy('name', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
  async insertMatrixContribution(v: NewExamMatrixContribution, db: QuizDb = this.db()): Promise<ExamMatrixContributionRow> {
    const rows = await db.insertInto('exam_matrix_contributions').values(examMatrixContributionInsertValues(v)).returning(EXAM_MATRIX_CONTRIBUTION_COLUMNS).execute();
    return rows[0]!;
  }
  async getMatrixContribution(id: string, db: QuizDb = this.db()): Promise<ExamMatrixContributionRow | undefined> {
    return db.selectFrom('exam_matrix_contributions').select(EXAM_MATRIX_CONTRIBUTION_COLUMNS).where('id', '=', id).executeTakeFirst();
  }
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
  async listMatrixContributionsByProposer(proposerId: string, db: QuizDb = this.db()): Promise<ExamMatrixContributionRow[]> {
    return db
      .selectFrom('exam_matrix_contributions')
      .select(EXAM_MATRIX_CONTRIBUTION_COLUMNS)
      .where('proposer_id', '=', proposerId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
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
  async updateMatrixContribution(id: string, patch: Partial<ExamMatrixContributionRow>, db: QuizDb = this.db()): Promise<void> {
    await db
      .updateTable('exam_matrix_contributions')
      .set({ ...examMatrixContributionUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }


  async listFeedbacks(pinId: string, db: QuizDb = this.db()): Promise<ExamPinFeedbackRow[]> {
    return db
      .selectFrom('exam_pin_feedbacks')
      .select(EXAM_PIN_FEEDBACK_COLUMNS)
      .where('pin_id', '=', pinId)
      .orderBy('min_percent', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async insertFeedback(v: NewExamPinFeedback, db: QuizDb = this.db()): Promise<ExamPinFeedbackRow> {
    const rows = await db.insertInto('exam_pin_feedbacks').values(examPinFeedbackInsertValues(v)).returning(EXAM_PIN_FEEDBACK_COLUMNS).execute();
    return rows[0]!;
  }

  async deleteFeedback(id: string, db: QuizDb = this.db()): Promise<void> {
    await db.deleteFrom('exam_pin_feedbacks').where('id', '=', id).execute();
  }

  async getFeedback(id: string, db: QuizDb = this.db()): Promise<ExamPinFeedbackRow | undefined> {
    return db
      .selectFrom('exam_pin_feedbacks')
      .select(EXAM_PIN_FEEDBACK_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
  }

  async insertAttemptEvent(v: NewExamAttemptEvent, db: QuizDb = this.db()): Promise<ExamAttemptEventRow> {
    const rows = await db.insertInto('exam_attempt_events').values(examAttemptEventInsertValues(v)).returning(EXAM_ATTEMPT_EVENT_COLUMNS).execute();
    return rows[0]!;
  }

  async listAttemptEvents(attemptId: string, db: QuizDb = this.db()): Promise<ExamAttemptEventRow[]> {
    return db
      .selectFrom('exam_attempt_events')
      .select(EXAM_ATTEMPT_EVENT_COLUMNS)
      .where('attempt_id', '=', attemptId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }


  async insertPinVersionUpdate(v: NewExamPinVersionUpdate, db: QuizDb = this.db()): Promise<ExamPinVersionUpdateRow> {
    const rows = await db.insertInto('exam_pin_version_updates').values(examPinVersionUpdateInsertValues(v)).returning(EXAM_PIN_VERSION_UPDATE_COLUMNS).execute();
    return rows[0]!;
  }

  async listPinVersionUpdates(pinId: string, db: QuizDb = this.db()): Promise<ExamPinVersionUpdateRow[]> {
    return db
      .selectFrom('exam_pin_version_updates')
      .select(EXAM_PIN_VERSION_UPDATE_COLUMNS)
      .where('pin_id', '=', pinId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async insertRegrade(v: NewExamAttemptRegrade, db: QuizDb = this.db()): Promise<ExamAttemptRegradeRow> {
    const rows = await db.insertInto('exam_attempt_regrades').values(examAttemptRegradeInsertValues(v)).returning(EXAM_ATTEMPT_REGRADE_COLUMNS).execute();
    return rows[0]!;
  }

  async insertRegradeItem(v: NewExamAttemptRegradeItem, db: QuizDb = this.db()): Promise<ExamAttemptRegradeItemRow> {
    const rows = await db.insertInto('exam_attempt_regrade_items').values(examAttemptRegradeItemInsertValues(v)).returning(EXAM_ATTEMPT_REGRADE_ITEM_COLUMNS).execute();
    return rows[0]!;
  }

  async listRegrades(pinId: string, db: QuizDb = this.db()): Promise<ExamAttemptRegradeRow[]> {
    return db
      .selectFrom('exam_attempt_regrades')
      .select(EXAM_ATTEMPT_REGRADE_COLUMNS)
      .where('pin_id', '=', pinId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async listRegradeItems(regradeId: string, db: QuizDb = this.db()): Promise<ExamAttemptRegradeItemRow[]> {
    return db
      .selectFrom('exam_attempt_regrade_items')
      .select(EXAM_ATTEMPT_REGRADE_ITEM_COLUMNS)
      .where('regrade_id', '=', regradeId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

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
