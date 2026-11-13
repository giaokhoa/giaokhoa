import { sql, type Insertable, type InsertObject, type RawBuilder, type Updateable, type UpdateObject } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';
import type { ExamQuestionSnapshot, ExamVariant } from '../jsonb-types';
import { EXAM_COLUMNS, EXAM_SLOT_COLUMNS, EXAM_VERSION_COLUMNS, type ExamRow, type ExamSlotRow, type ExamVersionRow } from './exams';

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
  if (values.questionSnapshots !== undefined) row.question_snapshots = values.questionSnapshots === null ? null : jsonbValue(values.questionSnapshots);
  if (values.requestId !== undefined) row.request_id = values.requestId;
  if (values.requestedSectionId !== undefined) row.requested_section_id = values.requestedSectionId;
  if (values.preparationState !== undefined) row.preparation_state = values.preparationState;
  if (values.pendingSnapshotId !== undefined) row.pending_snapshot_id = values.pendingSnapshotId;
  if (values.attemptsAllowed !== undefined) row.attempts_allowed = values.attemptsAllowed;
  if (values.cmId !== undefined) row.cm_id = values.cmId;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.gradeMethod !== undefined) row.grade_method = values.gradeMethod;
  if (values.id !== undefined) row.id = values.id;
  if (values.intro !== undefined) row.intro = values.intro;
  if (values.lateEntryMinutes !== undefined) row.late_entry_minutes = values.lateEntryMinutes;
  if (values.monitorEvents !== undefined) row.monitor_events = values.monitorEvents;
  if (values.name !== undefined) row.name = values.name;
  if (values.passwordHash !== undefined) row.password_hash = values.passwordHash;
  if (values.preset !== undefined) row.preset = values.preset;
  if (values.resultsPublishedAt !== undefined) row.results_published_at = values.resultsPublishedAt;
  if (values.reviewAttempt !== undefined) row.review_attempt = values.reviewAttempt;
  if (values.reviewCorrectness !== undefined) row.review_correctness = values.reviewCorrectness;
  if (values.reviewGeneralFeedback !== undefined) row.review_general_feedback = values.reviewGeneralFeedback;
  if (values.reviewMarks !== undefined) row.review_marks = values.reviewMarks;
  if (values.reviewOverallFeedback !== undefined) row.review_overall_feedback = values.reviewOverallFeedback;
  if (values.reviewRightAnswer !== undefined) row.review_right_answer = values.reviewRightAnswer;
  if (values.reviewSpecificFeedback !== undefined) row.review_specific_feedback = values.reviewSpecificFeedback;
  if (values.shuffleAnswers !== undefined) row.shuffle_answers = values.shuffleAnswers;
  if (values.subnet !== undefined) row.subnet = values.subnet;
  if (values.targetGroupId !== undefined) row.target_group_id = values.targetGroupId;
  if (values.timeClose !== undefined) row.time_close = values.timeClose;
  if (values.timeLimit !== undefined) row.time_limit = values.timeLimit;
  if (values.timeOpen !== undefined) row.time_open = values.timeOpen;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  if (values.variantCount !== undefined) row.variant_count = values.variantCount;
  if (values.versionMode !== undefined) row.version_mode = values.versionMode;
  return row;
}

function examPinUpdateSet(patch: Partial<ExamPinRow>): UpdateObject<CentreDB, 'exam_pins'> {
  const set: UpdateObject<CentreDB, 'exam_pins'> = {};
  if (patch.questionSnapshots !== undefined) set.question_snapshots = patch.questionSnapshots === null ? null : jsonbValue(patch.questionSnapshots);
  if (patch.requestedSectionId !== undefined) set.requested_section_id = patch.requestedSectionId;
  if (patch.preparationState !== undefined) set.preparation_state = patch.preparationState;
  if (patch.pendingSnapshotId !== undefined) set.pending_snapshot_id = patch.pendingSnapshotId;
  if (patch.attemptsAllowed !== undefined) set.attempts_allowed = patch.attemptsAllowed;
  if (patch.cmId !== undefined) set.cm_id = patch.cmId;
  if (patch.courseId !== undefined) set.course_id = patch.courseId;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  if (patch.createdBy !== undefined) set.created_by = patch.createdBy;
  if (patch.examId !== undefined) set.exam_id = patch.examId;
  if (patch.examVersionId !== undefined) set.exam_version_id = patch.examVersionId;
  if (patch.gradeMethod !== undefined) set.grade_method = patch.gradeMethod;
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.intro !== undefined) set.intro = patch.intro;
  if (patch.lateEntryMinutes !== undefined) set.late_entry_minutes = patch.lateEntryMinutes;
  if (patch.monitorEvents !== undefined) set.monitor_events = patch.monitorEvents;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.passwordHash !== undefined) set.password_hash = patch.passwordHash;
  if (patch.preset !== undefined) set.preset = patch.preset;
  if (patch.resultsPublishedAt !== undefined) set.results_published_at = patch.resultsPublishedAt;
  if (patch.reviewAttempt !== undefined) set.review_attempt = patch.reviewAttempt;
  if (patch.reviewCorrectness !== undefined) set.review_correctness = patch.reviewCorrectness;
  if (patch.reviewGeneralFeedback !== undefined) set.review_general_feedback = patch.reviewGeneralFeedback;
  if (patch.reviewMarks !== undefined) set.review_marks = patch.reviewMarks;
  if (patch.reviewOverallFeedback !== undefined) set.review_overall_feedback = patch.reviewOverallFeedback;
  if (patch.reviewRightAnswer !== undefined) set.review_right_answer = patch.reviewRightAnswer;
  if (patch.reviewSpecificFeedback !== undefined) set.review_specific_feedback = patch.reviewSpecificFeedback;
  if (patch.shuffleAnswers !== undefined) set.shuffle_answers = patch.shuffleAnswers;
  if (patch.subnet !== undefined) set.subnet = patch.subnet;
  if (patch.targetGroupId !== undefined) set.target_group_id = patch.targetGroupId;
  if (patch.timeClose !== undefined) set.time_close = patch.timeClose;
  if (patch.timeLimit !== undefined) set.time_limit = patch.timeLimit;
  if (patch.timeOpen !== undefined) set.time_open = patch.timeOpen;
  if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt;
  if (patch.variantCount !== undefined) set.variant_count = patch.variantCount;
  if (patch.variants !== undefined) set.variants = jsonbValue(patch.variants);
  if (patch.versionMode !== undefined) set.version_mode = patch.versionMode;
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
  if (values.appliedSettings !== undefined) row.applied_settings = values.appliedSettings === null ? null : jsonbValue(values.appliedSettings);
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.id !== undefined) row.id = values.id;
  if (values.makeup !== undefined) row.makeup = values.makeup;
  if (values.preview !== undefined) row.preview = values.preview;
  if (values.state !== undefined) row.state = values.state;
  if (values.sumGrades !== undefined) row.sum_grades = values.sumGrades;
  if (values.timeFinish !== undefined) row.time_finish = values.timeFinish;
  if (values.timeStart !== undefined) row.time_start = values.timeStart;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function examAttemptUpdateSet(patch: Partial<ExamAttemptRow>): UpdateObject<CentreDB, 'exam_attempts'> {
  const set: UpdateObject<CentreDB, 'exam_attempts'> = {};
  if (patch.appliedSettings !== undefined) set.applied_settings = patch.appliedSettings === null ? null : jsonbValue(patch.appliedSettings);
  if (patch.attemptNumber !== undefined) set.attempt_number = patch.attemptNumber;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.makeup !== undefined) set.makeup = patch.makeup;
  if (patch.pinId !== undefined) set.pin_id = patch.pinId;
  if (patch.preview !== undefined) set.preview = patch.preview;
  if (patch.state !== undefined) set.state = patch.state;
  if (patch.sumGrades !== undefined) set.sum_grades = patch.sumGrades;
  if (patch.timeFinish !== undefined) set.time_finish = patch.timeFinish;
  if (patch.timeStart !== undefined) set.time_start = patch.timeStart;
  if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt;
  if (patch.usageId !== undefined) set.usage_id = patch.usageId;
  if (patch.userId !== undefined) set.user_id = patch.userId;
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
  if (values.attempts !== undefined) row.attempts = values.attempts;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.groupId !== undefined) row.group_id = values.groupId;
  if (values.id !== undefined) row.id = values.id;
  if (values.passwordHash !== undefined) row.password_hash = values.passwordHash;
  if (values.reason !== undefined) row.reason = values.reason;
  if (values.timeClose !== undefined) row.time_close = values.timeClose;
  if (values.timeLimit !== undefined) row.time_limit = values.timeLimit;
  if (values.timeOpen !== undefined) row.time_open = values.timeOpen;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  if (values.userId !== undefined) row.user_id = values.userId;
  return row;
}

function examPinOverrideUpdateSet(patch: Partial<ExamPinOverrideRow>): Updateable<CentreDB['exam_pin_overrides']> {
  const set: Updateable<CentreDB['exam_pin_overrides']> = {};
  if (patch.attempts !== undefined) set.attempts = patch.attempts;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  if (patch.groupId !== undefined) set.group_id = patch.groupId;
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.passwordHash !== undefined) set.password_hash = patch.passwordHash;
  if (patch.pinId !== undefined) set.pin_id = patch.pinId;
  if (patch.reason !== undefined) set.reason = patch.reason;
  if (patch.timeClose !== undefined) set.time_close = patch.timeClose;
  if (patch.timeLimit !== undefined) set.time_limit = patch.timeLimit;
  if (patch.timeOpen !== undefined) set.time_open = patch.timeOpen;
  if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt;
  if (patch.userId !== undefined) set.user_id = patch.userId;
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
  if (values.bankId !== undefined) row.bank_id = values.bankId;
  if (values.contentSignature !== undefined) row.content_signature = values.contentSignature;
  if (values.copyCount !== undefined) row.copy_count = values.copyCount;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.createdBy !== undefined) row.created_by = values.createdBy;
  if (values.derivedFromBankId !== undefined) row.derived_from_bank_id = values.derivedFromBankId;
  if (values.derivedFromMatrixId !== undefined) row.derived_from_matrix_id = values.derivedFromMatrixId;
  if (values.id !== undefined) row.id = values.id;
  if (values.isTemplate !== undefined) row.is_template = values.isTemplate;
  if (values.levelSet !== undefined) row.level_set = values.levelSet;
  if (values.originalAuthorId !== undefined) row.original_author_id = values.originalAuthorId;
  if (values.presetKind !== undefined) row.preset_kind = values.presetKind;
  if (values.scopeNodeIds !== undefined) row.scope_node_ids = values.scopeNodeIds === null ? null : jsonbValue(values.scopeNodeIds);
  if (values.scopeNote !== undefined) row.scope_note = values.scopeNote;
  if (values.status !== undefined) row.status = values.status;
  if (values.targetFormPercents !== undefined) row.target_form_percents = values.targetFormPercents === null ? null : jsonbValue(values.targetFormPercents);
  if (values.targetLevelPercents !== undefined) row.target_level_percents = values.targetLevelPercents === null ? null : jsonbValue(values.targetLevelPercents);
  if (values.tenantId !== undefined) row.tenant_id = values.tenantId;
  if (values.totalScore !== undefined) row.total_score = values.totalScore;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  if (values.version !== undefined) row.version = values.version;
  if (values.withdrawnAt !== undefined) row.withdrawn_at = values.withdrawnAt;
  if (values.withdrawnBy !== undefined) row.withdrawn_by = values.withdrawnBy;
  if (values.withdrawnReason !== undefined) row.withdrawn_reason = values.withdrawnReason;
  return row;
}

function examMatrixUpdateSet(patch: Partial<ExamMatrixRow>): UpdateObject<CentreDB, 'exam_matrices'> {
  const set: UpdateObject<CentreDB, 'exam_matrices'> = {};
  if (patch.bankId !== undefined) set.bank_id = patch.bankId;
  if (patch.contentSignature !== undefined) set.content_signature = patch.contentSignature;
  if (patch.contextId !== undefined) set.context_id = patch.contextId;
  if (patch.copyCount !== undefined) set.copy_count = patch.copyCount;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  if (patch.createdBy !== undefined) set.created_by = patch.createdBy;
  if (patch.curriculumId !== undefined) set.curriculum_id = patch.curriculumId;
  if (patch.derivedFromBankId !== undefined) set.derived_from_bank_id = patch.derivedFromBankId;
  if (patch.derivedFromMatrixId !== undefined) set.derived_from_matrix_id = patch.derivedFromMatrixId;
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.isTemplate !== undefined) set.is_template = patch.isTemplate;
  if (patch.levelSet !== undefined) set.level_set = patch.levelSet;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.originalAuthorId !== undefined) set.original_author_id = patch.originalAuthorId;
  if (patch.presetKind !== undefined) set.preset_kind = patch.presetKind;
  if (patch.scopeNodeIds !== undefined) set.scope_node_ids = patch.scopeNodeIds === null ? null : jsonbValue(patch.scopeNodeIds);
  if (patch.scopeNote !== undefined) set.scope_note = patch.scopeNote;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.subjectId !== undefined) set.subject_id = patch.subjectId;
  if (patch.targetFormPercents !== undefined) set.target_form_percents = patch.targetFormPercents === null ? null : jsonbValue(patch.targetFormPercents);
  if (patch.targetLevelPercents !== undefined) set.target_level_percents = patch.targetLevelPercents === null ? null : jsonbValue(patch.targetLevelPercents);
  if (patch.tenantId !== undefined) set.tenant_id = patch.tenantId;
  if (patch.totalScore !== undefined) set.total_score = patch.totalScore;
  if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt;
  if (patch.version !== undefined) set.version = patch.version;
  if (patch.withdrawnAt !== undefined) set.withdrawn_at = patch.withdrawnAt;
  if (patch.withdrawnBy !== undefined) set.withdrawn_by = patch.withdrawnBy;
  if (patch.withdrawnReason !== undefined) set.withdrawn_reason = patch.withdrawnReason;
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
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.id !== undefined) row.id = values.id;
  if (values.levelSet !== undefined) row.level_set = values.levelSet;
  if (values.presetKind !== undefined) row.preset_kind = values.presetKind;
  if (values.scopeNodeIds !== undefined) row.scope_node_ids = values.scopeNodeIds === null ? null : jsonbValue(values.scopeNodeIds);
  if (values.scopeNote !== undefined) row.scope_note = values.scopeNote;
  if (values.targetFormPercents !== undefined) row.target_form_percents = values.targetFormPercents === null ? null : jsonbValue(values.targetFormPercents);
  if (values.targetLevelPercents !== undefined) row.target_level_percents = values.targetLevelPercents === null ? null : jsonbValue(values.targetLevelPercents);
  if (values.totalScore !== undefined) row.total_score = values.totalScore;
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
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.id !== undefined) row.id = values.id;
  if (values.minutes !== undefined) row.minutes = values.minutes;
  if (values.position !== undefined) row.position = values.position;
  if (values.tfScale !== undefined) row.tf_scale = values.tfScale === null ? null : jsonbValue(values.tfScale);
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function examMatrixCellUpdateSet(patch: Partial<ExamMatrixCellRow>): UpdateObject<CentreDB, 'exam_matrix_cells'> {
  const set: UpdateObject<CentreDB, 'exam_matrix_cells'> = {};
  if (patch.cellScore !== undefined) set.cell_score = patch.cellScore;
  if (patch.cognitiveLevel !== undefined) set.cognitive_level = patch.cognitiveLevel;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  if (patch.curriculumNodeId !== undefined) set.curriculum_node_id = patch.curriculumNodeId;
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.matrixId !== undefined) set.matrix_id = patch.matrixId;
  if (patch.matrixVersionId !== undefined) set.matrix_version_id = patch.matrixVersionId;
  if (patch.minutes !== undefined) set.minutes = patch.minutes;
  if (patch.position !== undefined) set.position = patch.position;
  if (patch.qtype !== undefined) set.qtype = patch.qtype;
  if (patch.questionCount !== undefined) set.question_count = patch.questionCount;
  if (patch.tfScale !== undefined) set.tf_scale = patch.tfScale === null ? null : jsonbValue(patch.tfScale);
  if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt;
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
  if (values.contentHash !== undefined) row.content_hash = values.contentHash;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.id !== undefined) row.id = values.id;
  if (values.nearDuplicateOf !== undefined) row.near_duplicate_of = values.nearDuplicateOf;
  if (values.note !== undefined) row.note = values.note;
  if (values.rejectReason !== undefined) row.reject_reason = values.rejectReason;
  if (values.resultMatrixId !== undefined) row.result_matrix_id = values.resultMatrixId;
  if (values.reviewerId !== undefined) row.reviewer_id = values.reviewerId;
  if (values.status !== undefined) row.status = values.status;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function examMatrixContributionUpdateSet(patch: Partial<ExamMatrixContributionRow>): Updateable<CentreDB['exam_matrix_contributions']> {
  const set: Updateable<CentreDB['exam_matrix_contributions']> = {};
  if (patch.contentHash !== undefined) set.content_hash = patch.contentHash;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.matrixId !== undefined) set.matrix_id = patch.matrixId;
  if (patch.nearDuplicateOf !== undefined) set.near_duplicate_of = patch.nearDuplicateOf;
  if (patch.note !== undefined) set.note = patch.note;
  if (patch.proposerId !== undefined) set.proposer_id = patch.proposerId;
  if (patch.rejectReason !== undefined) set.reject_reason = patch.rejectReason;
  if (patch.resultMatrixId !== undefined) set.result_matrix_id = patch.resultMatrixId;
  if (patch.reviewerId !== undefined) set.reviewer_id = patch.reviewerId;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.targetBankId !== undefined) set.target_bank_id = patch.targetBankId;
  if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt;
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
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.id !== undefined) row.id = values.id;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
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
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.data !== undefined) row.data = values.data === null ? null : jsonbValue(values.data);
  if (values.id !== undefined) row.id = values.id;
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
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.id !== undefined) row.id = values.id;
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
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.id !== undefined) row.id = values.id;
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
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.id !== undefined) row.id = values.id;
  if (values.newFraction !== undefined) row.new_fraction = values.newFraction;
  if (values.newSumGrades !== undefined) row.new_sum_grades = values.newSumGrades;
  if (values.oldFraction !== undefined) row.old_fraction = values.oldFraction;
  if (values.oldSumGrades !== undefined) row.old_sum_grades = values.oldSumGrades;
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
