import type { ExamQuestionSnapshot } from '../jsonb-types';
import { sql, type RawBuilder } from 'kysely';
import type { CentreDb, CentreTx } from '../client';
import type { LearningOutcomeDoc } from '../jsonb-types';
import type { Json } from '../types/centre-db';
import { pickDefined } from './mapping';


export type QuestionsDb = CentreDb | CentreTx;
export type QuestionsTx = CentreTx;


export interface QCategoryRow {
  id: string;
  name: string;
  contextId: string;
  bankId: string | null;
  info: string;
  parent: string | null;
  sortOrder: number;
  stamp: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionBankRow {
  id: string;
  tenantId: string | null;
  name: string;
  bankKind: string;
  scope: string;
  ownerId: string | null;
  scopeRefId: string | null;
  contextId: string;
  status: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionRow {
  id: string;
  category: string;
  qtype: string;
  createdBy: string | null;
  modifiedBy: string | null;
  derivedFromQuestionId: string | null;
  derivedFromVersionId: string | null;
  derivedFromBankId: string | null;
  originalAuthorId: string | null;
  sourceKind: string | null;
  sourceRef: string | null;
  idnumber: string | null;
  copyCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntryRow {
  id: string;
  questionCategoryId: string;
  questionId: string;
  latestVersion: number;
  status: string;
  withdrawnReason: string | null;
  withdrawnBy: string | null;
  withdrawnAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VersionRow {
  id: string;
  questionBankEntryId: string;
  questionId: string;
  version: number;
  status: string;
  questionText: unknown;
  generalFeedback: unknown;
  defaultMark: number;
  penalty: number;
  stimulusId: string | null;
  createdAt: Date;
}

export interface StimulusRow {
  id: string;
  categoryId: string;
  createdBy: string | null;
  content: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnswerRow {
  id: string;
  questionVersionId: string;
  answer: unknown;
  isCorrect: boolean;
  feedback: unknown;
  sortOrder: number;
}

export interface AnswerKeyRow {
  id: string;
  questionVersionId: string;
  guidance: unknown;
  solution: unknown;
}

export interface MultichoiceOptionsRow {
  id: string;
  questionVersionId: string;
  shuffleAnswers: boolean;
  answerNumbering: string;
  correctFeedback: unknown;
  incorrectFeedback: unknown;
  showStandardInstruction: boolean;
}

export interface TruefalseOptionsRow {
  id: string;
  questionVersionId: string;
  trueAnswer: string;
  falseAnswer: string;
  showStandardInstruction: boolean;
}

export interface ShortanswerOptionsRow {
  id: string;
  questionVersionId: string;
  useCase: boolean;
  numericAnswer: boolean;
  numericMaxLength: number | null;
  numericAllowSign: boolean;
  numericAllowDecimal: boolean;
}

export interface EssayOptionsRow {
  id: string;
  questionVersionId: string;
  responseFormat: string;
  responseRequired: boolean;
  responseFieldLines: number;
  minWordLimit: number | null;
  maxWordLimit: number | null;
  graderInfo: unknown;
  responseTemplate: unknown;
}

export interface UsageRow {
  id: string;
  component: string;
  instanceId: string | null;
  owningContextId: string | null;
  preferredBehaviour: string;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuizAttemptLinkRow {
  id: string;
  pinId: string;
  userId: string;
  attemptNumber: number;
  usageId: string;
  state: string;
  preview: boolean;
  makeup: boolean;
  appliedSettings: Record<string, unknown> | null;
  timeStart: Date;
  timeFinish: Date | null;
  sumGrades: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttemptRow {
  id: string;
  questionUsageId: string;
  slot: number;
  behaviour: string;
  questionId: string;
  questionVersionId: string | null;
  variant: number;
  maxMark: number;
  minFraction: number;
  maxFraction: number;
  flagged: boolean;
  questionSummary: string | null;
  responseSummary: string | null;
  rightAnswer: string | null;
  state: string;
  fraction: number | null;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StepRow {
  id: string;
  questionAttemptId: string;
  sequenceNumber: number;
  state: string;
  fraction: number | null;
  userId: string | null;
  createdAt: Date;
}

export interface StepDataRow {
  id: string;
  attemptStepId: string;
  name: string;
  value: string | null;
}

export interface QuestionSubjectLinkRow {
  id: string;
  questionId: string;
  subjectId: string;
  createdAt: Date;
}

export interface QuestionOutcomeLinkRow {
  id: string;
  questionId: string;
  learningOutcomeId: string;
  cognitiveLevel: string;
  createdAt: Date;
}

export interface SubjectRow {
  id: string;
  contextId: string;
  name: string;
  slug: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LearningOutcomeRow {
  id: string;
  tenantId: string | null;
  nodeId: string;
  content: LearningOutcomeDoc;
  position: number;
  sourceKind: string;
  sourceRef: string | null;
  derivedFromId: string | null;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CurriculumNodeRow {
  id: string;
  curriculumId: string;
  parentId: string | null;
  title: string;
  kind: string;
  position: number;
  durationPeriods: number | null;
  durationPercent: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CurriculumRow {
  id: string;
  subjectId: string;
  grade: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutcomeChain {
  outcome: LearningOutcomeRow;
  node: CurriculumNodeRow;
  curriculum: CurriculumRow;
  subject: SubjectRow;
}


export interface NewQCategory {
  id?: string;
  name: string;
  contextId: string;
  bankId?: string | null;
  info?: string;
  parent?: string | null;
  sortOrder?: number;
  stamp?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewQuestion {
  id?: string;
  category: string;
  qtype: string;
  createdBy?: string | null;
  modifiedBy?: string | null;
  derivedFromQuestionId?: string | null;
  derivedFromVersionId?: string | null;
  derivedFromBankId?: string | null;
  originalAuthorId?: string | null;
  sourceKind?: string | null;
  sourceRef?: string | null;
  idnumber?: string | null;
  copyCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewEntry {
  id?: string;
  questionCategoryId: string;
  questionId: string;
  latestVersion?: number;
  status?: string;
  withdrawnReason?: string | null;
  withdrawnBy?: string | null;
  withdrawnAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewVersion {
  id?: string;
  questionBankEntryId: string;
  questionId: string;
  version: number;
  status?: string;
  questionText?: unknown;
  generalFeedback?: unknown;
  defaultMark?: number;
  penalty?: number;
  stimulusId?: string | null;
  createdAt?: Date;
}

export interface NewStimulus {
  id?: string;
  categoryId: string;
  createdBy?: string | null;
  content: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewAnswer {
  id?: string;
  questionVersionId: string;
  answer: unknown;
  isCorrect?: boolean;
  feedback?: unknown;
  sortOrder?: number;
}

export interface NewAnswerKey {
  id?: string;
  questionVersionId: string;
  guidance?: unknown;
  solution?: unknown;
}

export interface NewMultichoiceOptions {
  id?: string;
  questionVersionId: string;
  shuffleAnswers?: boolean;
  answerNumbering?: string;
  correctFeedback?: unknown;
  incorrectFeedback?: unknown;
  showStandardInstruction?: boolean;
}

export interface NewTruefalseOptions {
  id?: string;
  questionVersionId: string;
  trueAnswer: string;
  falseAnswer: string;
  showStandardInstruction?: boolean;
}

export interface NewShortanswerOptions {
  id?: string;
  questionVersionId: string;
  useCase?: boolean;
  numericAnswer?: boolean;
  numericMaxLength?: number | null;
  numericAllowSign?: boolean;
  numericAllowDecimal?: boolean;
}

export interface NewEssayOptions {
  id?: string;
  questionVersionId: string;
  responseFormat?: string;
  responseRequired?: boolean;
  responseFieldLines?: number;
  minWordLimit?: number | null;
  maxWordLimit?: number | null;
  graderInfo?: unknown;
  responseTemplate?: unknown;
}

export interface NewUsage {
  id?: string;
  component: string;
  instanceId?: string | null;
  owningContextId?: string | null;
  preferredBehaviour?: string;
  userId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewAttempt {
  contentSnapshot?: ExamQuestionSnapshot;
  id?: string;
  questionUsageId: string;
  slot: number;
  behaviour?: string;
  questionId: string;
  questionVersionId?: string | null;
  variant?: number;
  maxMark?: number;
  minFraction?: number;
  maxFraction?: number;
  flagged?: boolean;
  questionSummary?: string | null;
  responseSummary?: string | null;
  rightAnswer?: string | null;
  state?: string;
  fraction?: number | null;
  userId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewStep {
  id?: string;
  questionAttemptId: string;
  sequenceNumber: number;
  state: string;
  fraction?: number | null;
  userId?: string | null;
  createdAt?: Date;
}

export interface NewStepData {
  id?: string;
  attemptStepId: string;
  name: string;
  value?: string | null;
}

export interface NewQuestionSubjectLink {
  id?: string;
  questionId: string;
  subjectId: string;
  createdAt?: Date;
}

export interface NewQuestionOutcomeLink {
  id?: string;
  questionId: string;
  learningOutcomeId: string;
  cognitiveLevel: string;
  createdAt?: Date;
}


const Q_CATEGORY_COLUMNS = [
  'id', 'name', 'context_id as contextId', 'bank_id as bankId', 'info',
  'parent', 'sort_order as sortOrder', 'stamp',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const QUESTION_BANK_COLUMNS = [
  'id', 'tenant_id as tenantId', 'name', 'bank_kind as bankKind', 'scope',
  'owner_id as ownerId', 'scope_ref_id as scopeRefId',
  'context_id as contextId', 'status', 'created_by as createdBy',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const QUESTION_COLUMNS = [
  'id', 'category', 'qtype', 'created_by as createdBy',
  'modified_by as modifiedBy',
  'derived_from_question_id as derivedFromQuestionId',
  'derived_from_version_id as derivedFromVersionId',
  'derived_from_bank_id as derivedFromBankId',
  'original_author_id as originalAuthorId', 'source_kind as sourceKind',
  'source_ref as sourceRef', 'idnumber', 'copy_count as copyCount',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const QUESTION_COLUMNS_Q = [
  'q.id as id', 'q.category as category', 'q.qtype as qtype',
  'q.created_by as createdBy', 'q.modified_by as modifiedBy',
  'q.derived_from_question_id as derivedFromQuestionId',
  'q.derived_from_version_id as derivedFromVersionId',
  'q.derived_from_bank_id as derivedFromBankId',
  'q.original_author_id as originalAuthorId',
  'q.source_kind as sourceKind', 'q.source_ref as sourceRef',
  'q.idnumber as idnumber', 'q.copy_count as copyCount',
  'q.created_at as createdAt', 'q.updated_at as updatedAt',
] as const;

const ENTRY_COLUMNS = [
  'id', 'question_category_id as questionCategoryId',
  'question_id as questionId', 'latest_version as latestVersion', 'status',
  'withdrawn_reason as withdrawnReason', 'withdrawn_by as withdrawnBy',
  'withdrawn_at as withdrawnAt',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const VERSION_COLUMNS = [
  'id', 'question_bank_entry_id as questionBankEntryId',
  'question_id as questionId', 'version', 'status',
  'question_text as questionText', 'general_feedback as generalFeedback',
  'default_mark as defaultMark', 'penalty', 'stimulus_id as stimulusId',
  'created_at as createdAt',
] as const;

const VERSION_COLUMNS_V = [
  'v.id as id', 'v.question_bank_entry_id as questionBankEntryId',
  'v.question_id as questionId', 'v.version as version',
  'v.status as status', 'v.question_text as questionText',
  'v.general_feedback as generalFeedback',
  'v.default_mark as defaultMark', 'v.penalty as penalty',
  'v.stimulus_id as stimulusId', 'v.created_at as createdAt',
] as const;

const STIMULUS_COLUMNS = [
  'id', 'category_id as categoryId', 'created_by as createdBy', 'content',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const ANSWER_COLUMNS = [
  'id', 'question_version_id as questionVersionId', 'answer',
  'is_correct as isCorrect', 'feedback', 'sort_order as sortOrder',
] as const;

const ANSWER_KEY_COLUMNS = [
  'id', 'question_version_id as questionVersionId', 'guidance', 'solution',
] as const;

const MULTICHOICE_OPTIONS_COLUMNS = [
  'id', 'question_version_id as questionVersionId',
  'shuffle_answers as shuffleAnswers',
  'answer_numbering as answerNumbering',
  'correct_feedback as correctFeedback',
  'incorrect_feedback as incorrectFeedback',
  'show_standard_instruction as showStandardInstruction',
] as const;

const TRUEFALSE_OPTIONS_COLUMNS = [
  'id', 'question_version_id as questionVersionId',
  'true_answer as trueAnswer', 'false_answer as falseAnswer',
  'show_standard_instruction as showStandardInstruction',
] as const;

const SHORTANSWER_OPTIONS_COLUMNS = [
  'id', 'question_version_id as questionVersionId', 'use_case as useCase',
  'numeric_answer as numericAnswer',
  'numeric_max_length as numericMaxLength',
  'numeric_allow_sign as numericAllowSign',
  'numeric_allow_decimal as numericAllowDecimal',
] as const;

const ESSAY_OPTIONS_COLUMNS = [
  'id', 'question_version_id as questionVersionId',
  'response_format as responseFormat',
  'response_required as responseRequired',
  'response_field_lines as responseFieldLines',
  'min_word_limit as minWordLimit', 'max_word_limit as maxWordLimit',
  'grader_info as graderInfo', 'response_template as responseTemplate',
] as const;

const USAGE_COLUMNS = [
  'id', 'component', 'instance_id as instanceId',
  'owning_context_id as owningContextId',
  'preferred_behaviour as preferredBehaviour', 'user_id as userId',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const QUIZ_ATTEMPT_LINK_COLUMNS = [
  'id', 'pin_id as pinId', 'user_id as userId',
  'attempt_number as attemptNumber', 'usage_id as usageId', 'state',
  'preview', 'makeup', 'applied_settings as appliedSettings',
  'time_start as timeStart', 'time_finish as timeFinish',
  'sum_grades as sumGrades',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const ATTEMPT_COLUMNS = [
  'id', 'question_usage_id as questionUsageId', 'slot', 'behaviour',
  'question_id as questionId',
  'question_version_id as questionVersionId', 'variant',
  'max_mark as maxMark', 'min_fraction as minFraction',
  'max_fraction as maxFraction', 'flagged',
  'question_summary as questionSummary',
  'response_summary as responseSummary', 'right_answer as rightAnswer',
  'state', 'fraction', 'user_id as userId',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const STEP_COLUMNS = [
  'id', 'question_attempt_id as questionAttemptId',
  'sequence_number as sequenceNumber', 'state', 'fraction',
  'user_id as userId', 'created_at as createdAt',
] as const;

const STEP_DATA_COLUMNS = [
  'id', 'attempt_step_id as attemptStepId', 'name', 'value',
] as const;

const QUESTION_SUBJECT_LINK_COLUMNS = [
  'id', 'question_id as questionId', 'subject_id as subjectId',
  'created_at as createdAt',
] as const;

const QUESTION_OUTCOME_LINK_COLUMNS = [
  'id', 'question_id as questionId',
  'learning_outcome_id as learningOutcomeId',
  'cognitive_level as cognitiveLevel', 'created_at as createdAt',
] as const;

const SUBJECT_COLUMNS = [
  'id', 'context_id as contextId', 'name', 'slug', 'position',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const LEARNING_OUTCOME_COLUMNS = [
  'id', 'tenant_id as tenantId', 'node_id as nodeId', 'content',
  'position', 'source_kind as sourceKind', 'source_ref as sourceRef',
  'derived_from_id as derivedFromId', 'retired_at as retiredAt',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const CURRICULUM_NODE_COLUMNS = [
  'id', 'curriculum_id as curriculumId', 'parent_id as parentId',
  'title', 'kind', 'position', 'duration_periods as durationPeriods',
  'duration_percent as durationPercent',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;

const CURRICULUM_COLUMNS = [
  'id', 'subject_id as subjectId', 'grade',
  'created_at as createdAt', 'updated_at as updatedAt',
] as const;


function jsonbValue<T>(value: T): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

function jsonbField(value: unknown): RawBuilder<Json> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return jsonbValue(value as Json);
}

function qCategoryInsertValues(v: NewQCategory) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    name: v.name,
    context_id: v.contextId,
    ...pickDefined(v, [
      ['bankId', 'bank_id'],
      ['info', 'info'],
      ['parent', 'parent'],
      ['sortOrder', 'sort_order'],
      ['stamp', 'stamp'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ]),
  };
}

function questionInsertValues(v: NewQuestion) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    category: v.category,
    qtype: v.qtype,
    ...pickDefined(v, [
      ['createdBy', 'created_by'],
      ['modifiedBy', 'modified_by'],
      ['derivedFromQuestionId', 'derived_from_question_id'],
      ['derivedFromVersionId', 'derived_from_version_id'],
      ['derivedFromBankId', 'derived_from_bank_id'],
      ['originalAuthorId', 'original_author_id'],
      ['sourceKind', 'source_kind'],
      ['sourceRef', 'source_ref'],
      ['idnumber', 'idnumber'],
      ['copyCount', 'copy_count'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ]),
  };
}

function questionUpdateSet(patch: Partial<QuestionRow>) {
  return {
    ...pickDefined(patch, [
      ['category', 'category'],
      ['qtype', 'qtype'],
      ['createdBy', 'created_by'],
      ['modifiedBy', 'modified_by'],
      ['derivedFromQuestionId', 'derived_from_question_id'],
      ['derivedFromVersionId', 'derived_from_version_id'],
      ['derivedFromBankId', 'derived_from_bank_id'],
      ['originalAuthorId', 'original_author_id'],
      ['sourceKind', 'source_kind'],
      ['sourceRef', 'source_ref'],
      ['idnumber', 'idnumber'],
      ['copyCount', 'copy_count'],
    ]),
    updated_at: new Date(),
  };
}

function entryInsertValues(v: NewEntry) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_category_id: v.questionCategoryId,
    question_id: v.questionId,
    ...pickDefined(v, [
      ['latestVersion', 'latest_version'],
      ['status', 'status'],
      ['withdrawnReason', 'withdrawn_reason'],
      ['withdrawnBy', 'withdrawn_by'],
      ['withdrawnAt', 'withdrawn_at'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ]),
  };
}

function entryUpdateSet(patch: Partial<EntryRow>) {
  return {
    ...pickDefined(patch, [
      ['questionCategoryId', 'question_category_id'],
      ['questionId', 'question_id'],
      ['latestVersion', 'latest_version'],
      ['status', 'status'],
      ['withdrawnReason', 'withdrawn_reason'],
      ['withdrawnBy', 'withdrawn_by'],
      ['withdrawnAt', 'withdrawn_at'],
    ]),
    updated_at: new Date(),
  };
}

function versionInsertValues(v: NewVersion) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_bank_entry_id: v.questionBankEntryId,
    question_id: v.questionId,
    version: v.version,
    ...pickDefined(v, [
      ['status', 'status'],
      ['questionText', 'question_text', (value) => jsonbValue(value as Json)],
      ['generalFeedback', 'general_feedback', jsonbField],
      ['defaultMark', 'default_mark'],
      ['penalty', 'penalty'],
      ['stimulusId', 'stimulus_id'],
      ['createdAt', 'created_at'],
    ]),
  };
}

function versionUpdateSet(patch: Partial<VersionRow>) {
  return {
    ...pickDefined(patch, [
      ['questionBankEntryId', 'question_bank_entry_id'],
      ['questionId', 'question_id'],
      ['version', 'version'],
      ['status', 'status'],
      ['questionText', 'question_text', (value) => jsonbValue(value as Json)],
      ['generalFeedback', 'general_feedback', jsonbField],
      ['defaultMark', 'default_mark'],
      ['penalty', 'penalty'],
      ['stimulusId', 'stimulus_id'],
    ]),
  };
}

function stimulusInsertValues(v: NewStimulus) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    category_id: v.categoryId,
    ...pickDefined(v, [['createdBy', 'created_by']]),
    content: jsonbValue(v.content as Json),
    ...pickDefined(v, [
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ]),
  };
}

function stimulusUpdateSet(patch: Partial<StimulusRow>) {
  return {
    ...pickDefined(patch, [
      ['categoryId', 'category_id'],
      ['createdBy', 'created_by'],
      ['content', 'content', (value) => jsonbValue(value as Json)],
    ]),
    updated_at: new Date(),
  };
}

function answerInsertValues(v: NewAnswer) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_version_id: v.questionVersionId,
    answer: jsonbValue(v.answer as Json),
    ...pickDefined(v, [
      ['isCorrect', 'is_correct'],
      ['feedback', 'feedback', jsonbField],
      ['sortOrder', 'sort_order'],
    ]),
  };
}

function answerKeyInsertValues(v: NewAnswerKey) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_version_id: v.questionVersionId,
    ...pickDefined(v, [
      ['guidance', 'guidance', jsonbField],
      ['solution', 'solution', jsonbField],
    ]),
  };
}

function multichoiceOptionsInsertValues(v: NewMultichoiceOptions) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_version_id: v.questionVersionId,
    ...pickDefined(v, [
      ['shuffleAnswers', 'shuffle_answers'],
      ['answerNumbering', 'answer_numbering'],
      ['correctFeedback', 'correct_feedback', jsonbField],
      ['incorrectFeedback', 'incorrect_feedback', jsonbField],
      ['showStandardInstruction', 'show_standard_instruction'],
    ]),
  };
}

function truefalseOptionsInsertValues(v: NewTruefalseOptions) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_version_id: v.questionVersionId,
    true_answer: v.trueAnswer,
    false_answer: v.falseAnswer,
    ...pickDefined(v, [['showStandardInstruction', 'show_standard_instruction']]),
  };
}

function shortanswerOptionsInsertValues(v: NewShortanswerOptions) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_version_id: v.questionVersionId,
    ...pickDefined(v, [
      ['useCase', 'use_case'],
      ['numericAnswer', 'numeric_answer'],
      ['numericMaxLength', 'numeric_max_length'],
      ['numericAllowSign', 'numeric_allow_sign'],
      ['numericAllowDecimal', 'numeric_allow_decimal'],
    ]),
  };
}

function essayOptionsInsertValues(v: NewEssayOptions) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_version_id: v.questionVersionId,
    ...pickDefined(v, [
      ['responseFormat', 'response_format'],
      ['responseRequired', 'response_required'],
      ['responseFieldLines', 'response_field_lines'],
      ['minWordLimit', 'min_word_limit'],
      ['maxWordLimit', 'max_word_limit'],
      ['graderInfo', 'grader_info', jsonbField],
      ['responseTemplate', 'response_template', jsonbField],
    ]),
  };
}

function usageInsertValues(v: NewUsage) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    component: v.component,
    ...pickDefined(v, [
      ['instanceId', 'instance_id'],
      ['owningContextId', 'owning_context_id'],
      ['preferredBehaviour', 'preferred_behaviour'],
      ['userId', 'user_id'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ]),
  };
}

function attemptInsertValues(v: NewAttempt) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_usage_id: v.questionUsageId,
    ...pickDefined(v, [['contentSnapshot', 'content_snapshot', (value) => jsonbValue(value)]]),
    slot: v.slot,
    ...pickDefined(v, [['behaviour', 'behaviour']]),
    question_id: v.questionId,
    ...pickDefined(v, [
      ['questionVersionId', 'question_version_id'],
      ['variant', 'variant'],
      ['maxMark', 'max_mark'],
      ['minFraction', 'min_fraction'],
      ['maxFraction', 'max_fraction'],
      ['flagged', 'flagged'],
      ['questionSummary', 'question_summary'],
      ['responseSummary', 'response_summary'],
      ['rightAnswer', 'right_answer'],
      ['state', 'state'],
      ['fraction', 'fraction'],
      ['userId', 'user_id'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ]),
  };
}

function attemptUpdateSet(patch: Partial<AttemptRow>) {
  return {
    ...pickDefined(patch, [
      ['behaviour', 'behaviour'],
      ['questionVersionId', 'question_version_id'],
      ['variant', 'variant'],
      ['maxMark', 'max_mark'],
      ['minFraction', 'min_fraction'],
      ['maxFraction', 'max_fraction'],
      ['flagged', 'flagged'],
      ['questionSummary', 'question_summary'],
      ['responseSummary', 'response_summary'],
      ['rightAnswer', 'right_answer'],
      ['state', 'state'],
      ['fraction', 'fraction'],
      ['userId', 'user_id'],
    ]),
    updated_at: new Date(),
  };
}

function stepInsertValues(v: NewStep) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_attempt_id: v.questionAttemptId,
    sequence_number: v.sequenceNumber,
    state: v.state,
    ...pickDefined(v, [
      ['fraction', 'fraction'],
      ['userId', 'user_id'],
      ['createdAt', 'created_at'],
    ]),
  };
}

function stepDataInsertValues(v: NewStepData) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    attempt_step_id: v.attemptStepId,
    name: v.name,
    ...pickDefined(v, [['value', 'value']]),
  };
}

function questionSubjectLinkInsertValues(v: NewQuestionSubjectLink) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_id: v.questionId,
    subject_id: v.subjectId,
    ...pickDefined(v, [['createdAt', 'created_at']]),
  };
}

function questionOutcomeLinkInsertValues(v: NewQuestionOutcomeLink) {
  return {
    ...pickDefined(v, [['id', 'id']]),
    question_id: v.questionId,
    learning_outcome_id: v.learningOutcomeId,
    cognitive_level: v.cognitiveLevel,
    ...pickDefined(v, [['createdAt', 'created_at']]),
  };
}

export class QuestionsRepository {
  constructor(private readonly handle: CentreDb) {}

  db(): CentreDb {
    return this.handle;
  }

  transaction<T>(fn: (tx: QuestionsTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }


  async insertCategory(v: NewQCategory, tx?: QuestionsDb): Promise<QCategoryRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('question_categories')
      .values(qCategoryInsertValues(v))
      .returning(Q_CATEGORY_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getCategory(id: string, tx?: QuestionsDb): Promise<QCategoryRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_categories')
      .select(Q_CATEGORY_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getCategoriesByIds(ids: string[], tx?: QuestionsDb): Promise<QCategoryRow[]> {
    if (!ids.length) return [];
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_categories')
      .select(Q_CATEGORY_COLUMNS)
      .where('id', 'in', ids)
      .execute();
  }

  async getBankById(id: string, tx?: QuestionsDb): Promise<QuestionBankRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_banks')
      .select(QUESTION_BANK_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getBankByContextId(contextId: string, tx?: QuestionsDb): Promise<QuestionBankRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_banks')
      .select(QUESTION_BANK_COLUMNS)
      .where('context_id', '=', contextId)
      .executeTakeFirst();
  }

  async listCategories(contextId?: string, tx?: QuestionsDb): Promise<QCategoryRow[]> {
    const db = tx ?? this.handle;
    let query = db.selectFrom('question_categories').select(Q_CATEGORY_COLUMNS);
    if (contextId !== undefined) query = query.where('context_id', '=', contextId);
    const rows = await query.execute();
    return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  }


  async insertQuestion(v: NewQuestion, tx?: QuestionsDb): Promise<QuestionRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('question')
      .values(questionInsertValues(v))
      .returning(QUESTION_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getQuestion(id: string, tx?: QuestionsDb): Promise<QuestionRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question')
      .select(QUESTION_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getQuestionsByIds(ids: string[], tx?: QuestionsDb): Promise<QuestionRow[]> {
    if (!ids.length) return [];
    const db = tx ?? this.handle;
    return db
      .selectFrom('question')
      .select(QUESTION_COLUMNS)
      .where('id', 'in', ids)
      .execute();
  }

  async updateQuestion(id: string, patch: Partial<QuestionRow>): Promise<void> {
    await this.handle
      .updateTable('question')
      .set(questionUpdateSet(patch))
      .where('id', '=', id)
      .execute();
  }

  async listQuestionsInCategory(categoryId: string, tx?: QuestionsDb): Promise<QuestionRow[]> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question')
      .select(QUESTION_COLUMNS)
      .where('category', '=', categoryId)
      .orderBy('id')
      .execute();
  }


  async insertEntry(v: NewEntry, tx?: QuestionsDb): Promise<EntryRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('question_bank_entries')
      .values(entryInsertValues(v))
      .returning(ENTRY_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getEntryByQuestion(questionId: string, tx?: QuestionsDb): Promise<EntryRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_bank_entries')
      .select(ENTRY_COLUMNS)
      .where('question_id', '=', questionId)
      .executeTakeFirst();
  }

  async getEntriesByQuestionIds(questionIds: string[], tx?: QuestionsDb): Promise<EntryRow[]> {
    if (!questionIds.length) return [];
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_bank_entries')
      .select(ENTRY_COLUMNS)
      .where('question_id', 'in', questionIds)
      .execute();
  }

  async updateEntry(id: string, patch: Partial<EntryRow>, tx?: QuestionsDb): Promise<void> {
    const db = tx ?? this.handle;
    await db
      .updateTable('question_bank_entries')
      .set(entryUpdateSet(patch))
      .where('id', '=', id)
      .execute();
  }

  async updateVersion(id: string, patch: Partial<VersionRow>): Promise<void> {
    await this.handle
      .updateTable('question_versions')
      .set(versionUpdateSet(patch))
      .where('id', '=', id)
      .execute();
  }

  async insertVersion(v: NewVersion, tx?: QuestionsDb): Promise<VersionRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('question_versions')
      .values(versionInsertValues(v))
      .returning(VERSION_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getVersion(id: string, tx?: QuestionsDb): Promise<VersionRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_versions')
      .select(VERSION_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getVersionByNumber(entryId: string, version: number, tx?: QuestionsDb): Promise<VersionRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_versions')
      .select(VERSION_COLUMNS)
      .where('question_bank_entry_id', '=', entryId)
      .where('version', '=', version)
      .executeTakeFirst();
  }

  async listVersions(entryId: string, tx?: QuestionsDb): Promise<VersionRow[]> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_versions')
      .select(VERSION_COLUMNS)
      .where('question_bank_entry_id', '=', entryId)
      .orderBy('version')
      .execute();
  }

  async listVersionsForEntries(entryIds: string[], tx?: QuestionsDb): Promise<VersionRow[]> {
    if (!entryIds.length) return [];
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_versions')
      .select(VERSION_COLUMNS)
      .where('question_bank_entry_id', 'in', entryIds)
      .orderBy('question_bank_entry_id')
      .orderBy('version')
      .execute();
  }


  async insertStimulus(v: NewStimulus, tx?: QuestionsDb): Promise<StimulusRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('stimuli')
      .values(stimulusInsertValues(v))
      .returning(STIMULUS_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getStimulus(id: string, tx?: QuestionsDb): Promise<StimulusRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('stimuli')
      .select(STIMULUS_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listStimuliInCategory(categoryId: string, tx?: QuestionsDb): Promise<StimulusRow[]> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('stimuli')
      .select(STIMULUS_COLUMNS)
      .where('category_id', '=', categoryId)
      .execute();
  }

  async updateStimulus(id: string, patch: Partial<StimulusRow>): Promise<void> {
    await this.handle
      .updateTable('stimuli')
      .set(stimulusUpdateSet(patch))
      .where('id', '=', id)
      .execute();
  }

  async deleteStimulus(id: string): Promise<void> {
    await this.handle.deleteFrom('stimuli').where('id', '=', id).execute();
  }

  async countVersionsReferencingStimulus(stimulusId: string, tx?: QuestionsDb): Promise<number> {
    const db = tx ?? this.handle;
    const rows = await db
      .selectFrom('question_versions')
      .select('id')
      .where('stimulus_id', '=', stimulusId)
      .execute();
    return rows.length;
  }


  async insertAnswer(v: NewAnswer, tx?: QuestionsDb): Promise<AnswerRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('question_answers')
      .values(answerInsertValues(v))
      .returning(ANSWER_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async listAnswers(versionId: string, tx?: QuestionsDb): Promise<AnswerRow[]> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_answers')
      .select(ANSWER_COLUMNS)
      .where('question_version_id', '=', versionId)
      .orderBy('sort_order')
      .orderBy('id')
      .execute();
  }

  async insertAnswerKey(v: NewAnswerKey, tx?: QuestionsDb): Promise<AnswerKeyRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('question_answer_keys')
      .values(answerKeyInsertValues(v))
      .returning(ANSWER_KEY_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getAnswerKey(versionId: string, tx?: QuestionsDb): Promise<AnswerKeyRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_answer_keys')
      .select(ANSWER_KEY_COLUMNS)
      .where('question_version_id', '=', versionId)
      .executeTakeFirst();
  }

  async insertMultichoiceOptions(v: NewMultichoiceOptions, tx?: QuestionsDb): Promise<MultichoiceOptionsRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('qtype_multichoice_options')
      .values(multichoiceOptionsInsertValues(v))
      .returning(MULTICHOICE_OPTIONS_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getMultichoiceOptions(versionId: string, tx?: QuestionsDb): Promise<MultichoiceOptionsRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('qtype_multichoice_options')
      .select(MULTICHOICE_OPTIONS_COLUMNS)
      .where('question_version_id', '=', versionId)
      .executeTakeFirst();
  }

  async insertTruefalseOptions(v: NewTruefalseOptions, tx?: QuestionsDb): Promise<TruefalseOptionsRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('question_truefalse')
      .values(truefalseOptionsInsertValues(v))
      .returning(TRUEFALSE_OPTIONS_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getTruefalseOptions(versionId: string, tx?: QuestionsDb): Promise<TruefalseOptionsRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('question_truefalse')
      .select(TRUEFALSE_OPTIONS_COLUMNS)
      .where('question_version_id', '=', versionId)
      .executeTakeFirst();
  }

  async insertShortanswerOptions(v: NewShortanswerOptions, tx?: QuestionsDb): Promise<ShortanswerOptionsRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('qtype_shortanswer_options')
      .values(shortanswerOptionsInsertValues(v))
      .returning(SHORTANSWER_OPTIONS_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getShortanswerOptions(versionId: string, tx?: QuestionsDb): Promise<ShortanswerOptionsRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('qtype_shortanswer_options')
      .select(SHORTANSWER_OPTIONS_COLUMNS)
      .where('question_version_id', '=', versionId)
      .executeTakeFirst();
  }

  async insertEssayOptions(v: NewEssayOptions, tx?: QuestionsDb): Promise<EssayOptionsRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('qtype_essay_options')
      .values(essayOptionsInsertValues(v))
      .returning(ESSAY_OPTIONS_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getEssayOptions(versionId: string, tx?: QuestionsDb): Promise<EssayOptionsRow | undefined> {
    const db = tx ?? this.handle;
    return db
      .selectFrom('qtype_essay_options')
      .select(ESSAY_OPTIONS_COLUMNS)
      .where('question_version_id', '=', versionId)
      .executeTakeFirst();
  }


  async insertUsage(v: NewUsage): Promise<UsageRow> {
    return this.handle
      .insertInto('question_usages')
      .values(usageInsertValues(v))
      .returning(USAGE_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async getUsage(id: string): Promise<UsageRow | undefined> {
    return this.handle
      .selectFrom('question_usages')
      .select(USAGE_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getUsagesByIds(ids: string[]): Promise<UsageRow[]> {
    if (!ids.length) return [];
    return this.handle
      .selectFrom('question_usages')
      .select(USAGE_COLUMNS)
      .where('id', 'in', ids)
      .execute();
  }

  async deleteUsage(id: string): Promise<void> {
    await this.handle.deleteFrom('question_usages').where('id', '=', id).execute();
  }

  async findQuizAttemptByUsageId(usageId: string): Promise<QuizAttemptLinkRow | undefined> {
    return this.handle
      .selectFrom('exam_attempts')
      .select(QUIZ_ATTEMPT_LINK_COLUMNS)
      .where('usage_id', '=', usageId)
      .executeTakeFirst();
  }

  async insertAttempt(v: NewAttempt): Promise<AttemptRow> {
    return this.handle
      .insertInto('question_attempts')
      .values(attemptInsertValues(v))
      .returning(ATTEMPT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async usageHasSnapshots(usageId: string): Promise<boolean> {
    return !!(await this.db().selectFrom('question_attempts').select('id')
      .where('question_usage_id', '=', usageId).where('content_snapshot', 'is not', null).limit(1).executeTakeFirst());
  }

  async getAttemptSnapshot(id: string): Promise<ExamQuestionSnapshot | null> {
    const row = await this.db().selectFrom('question_attempts').select('content_snapshot')
      .where('id', '=', id).executeTakeFirst();
    return row?.content_snapshot ?? null;
  }

  async getAttempt(id: string): Promise<AttemptRow | undefined> {
    return this.handle
      .selectFrom('question_attempts')
      .select(ATTEMPT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listAttempts(usageId: string): Promise<AttemptRow[]> {
    return this.handle
      .selectFrom('question_attempts')
      .select(ATTEMPT_COLUMNS)
      .where('question_usage_id', '=', usageId)
      .orderBy('slot')
      .execute();
  }

  async listAttemptsForUsages(usageIds: string[]): Promise<AttemptRow[]> {
    if (!usageIds.length) return [];
    return this.handle
      .selectFrom('question_attempts')
      .select(ATTEMPT_COLUMNS)
      .where('question_usage_id', 'in', usageIds)
      .orderBy('question_usage_id')
      .orderBy('slot')
      .execute();
  }

  async updateAttempt(id: string, patch: Partial<AttemptRow>): Promise<void> {
    await this.handle
      .updateTable('question_attempts')
      .set(attemptUpdateSet(patch))
      .where('id', '=', id)
      .execute();
  }

  async insertStep(v: NewStep, tx?: QuestionsDb): Promise<StepRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('question_attempt_steps')
      .values(stepInsertValues(v))
      .returning(STEP_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async listSteps(attemptId: string): Promise<StepRow[]> {
    return this.handle
      .selectFrom('question_attempt_steps')
      .select(STEP_COLUMNS)
      .where('question_attempt_id', '=', attemptId)
      .orderBy('sequence_number')
      .execute();
  }

  async listStepsForAttempts(attemptIds: string[]): Promise<StepRow[]> {
    if (!attemptIds.length) return [];
    return this.handle
      .selectFrom('question_attempt_steps')
      .select(STEP_COLUMNS)
      .where('question_attempt_id', 'in', attemptIds)
      .orderBy('question_attempt_id')
      .orderBy('sequence_number')
      .execute();
  }

  async insertStepData(v: NewStepData, tx?: QuestionsDb): Promise<void> {
    const db = tx ?? this.handle;
    await db.insertInto('question_attempt_step_data').values(stepDataInsertValues(v)).execute();
  }

  async listStepData(stepId: string): Promise<StepDataRow[]> {
    return this.handle
      .selectFrom('question_attempt_step_data')
      .select(STEP_DATA_COLUMNS)
      .where('attempt_step_id', '=', stepId)
      .execute();
  }

  async listStepDataForSteps(stepIds: string[]): Promise<StepDataRow[]> {
    if (!stepIds.length) return [];
    return this.handle
      .selectFrom('question_attempt_step_data')
      .select(STEP_DATA_COLUMNS)
      .where('attempt_step_id', 'in', stepIds)
      .execute();
  }


  async markSystemImportDerived(questionId: string, tx: QuestionsDb): Promise<void> {
    await tx
      .updateTable('system_question_imports')
      .set({ kind: 'derived' })
      .where('question_id', '=', questionId)
      .where('kind', '=', 'pristine')
      .execute();
  }


  async getSubjectRow(id: string): Promise<SubjectRow | undefined> {
    return this.handle
      .selectFrom('subjects')
      .select(SUBJECT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getOutcomeChain(id: string): Promise<OutcomeChain | undefined> {
    const outcome = await this.handle
      .selectFrom('learning_outcomes')
      .select(LEARNING_OUTCOME_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!outcome) return undefined;
    const node = await this.handle
      .selectFrom('curriculum_nodes')
      .select(CURRICULUM_NODE_COLUMNS)
      .where('id', '=', outcome.nodeId)
      .executeTakeFirst();
    if (!node) return undefined;
    const curriculum = await this.handle
      .selectFrom('curricula')
      .select(CURRICULUM_COLUMNS)
      .where('id', '=', node.curriculumId)
      .executeTakeFirst();
    if (!curriculum) return undefined;
    const subject = await this.getSubjectRow(curriculum.subjectId);
    if (!subject) return undefined;
    return { outcome, node, curriculum, subject };
  }

  async listQuestionSubjectLinks(questionId: string): Promise<QuestionSubjectLinkRow[]> {
    return this.handle
      .selectFrom('question_subjects')
      .select(QUESTION_SUBJECT_LINK_COLUMNS)
      .where('question_id', '=', questionId)
      .orderBy('created_at')
      .execute();
  }

  async listQuestionSubjectLinksForQuestions(questionIds: string[]): Promise<QuestionSubjectLinkRow[]> {
    if (!questionIds.length) return [];
    return this.handle
      .selectFrom('question_subjects')
      .select(QUESTION_SUBJECT_LINK_COLUMNS)
      .where('question_id', 'in', questionIds)
      .orderBy('question_id')
      .orderBy('created_at')
      .execute();
  }

  async getQuestionSubjectLink(questionId: string, subjectId: string): Promise<QuestionSubjectLinkRow | undefined> {
    return this.handle
      .selectFrom('question_subjects')
      .select(QUESTION_SUBJECT_LINK_COLUMNS)
      .where('question_id', '=', questionId)
      .where('subject_id', '=', subjectId)
      .executeTakeFirst();
  }

  async insertQuestionSubjectLink(v: NewQuestionSubjectLink, tx?: QuestionsDb): Promise<QuestionSubjectLinkRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('question_subjects')
      .values(questionSubjectLinkInsertValues(v))
      .returning(QUESTION_SUBJECT_LINK_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async deleteQuestionSubjectLink(questionId: string, subjectId: string): Promise<boolean> {
    const rows = await this.handle
      .deleteFrom('question_subjects')
      .where('question_id', '=', questionId)
      .where('subject_id', '=', subjectId)
      .returningAll()
      .execute();
    return rows.length > 0;
  }

  async listQuestionOutcomeLinks(questionId: string): Promise<QuestionOutcomeLinkRow[]> {
    return this.handle
      .selectFrom('question_learning_outcomes')
      .select(QUESTION_OUTCOME_LINK_COLUMNS)
      .where('question_id', '=', questionId)
      .orderBy('created_at')
      .execute();
  }

  async listQuestionOutcomeLinksForQuestions(questionIds: string[]): Promise<QuestionOutcomeLinkRow[]> {
    if (!questionIds.length) return [];
    return this.handle
      .selectFrom('question_learning_outcomes')
      .select(QUESTION_OUTCOME_LINK_COLUMNS)
      .where('question_id', 'in', questionIds)
      .orderBy('question_id')
      .orderBy('created_at')
      .execute();
  }

  async getQuestionOutcomeLink(questionId: string, outcomeId: string): Promise<QuestionOutcomeLinkRow | undefined> {
    return this.handle
      .selectFrom('question_learning_outcomes')
      .select(QUESTION_OUTCOME_LINK_COLUMNS)
      .where('question_id', '=', questionId)
      .where('learning_outcome_id', '=', outcomeId)
      .executeTakeFirst();
  }

  async insertQuestionOutcomeLink(v: NewQuestionOutcomeLink, tx?: QuestionsDb): Promise<QuestionOutcomeLinkRow> {
    const db = tx ?? this.handle;
    return db
      .insertInto('question_learning_outcomes')
      .values(questionOutcomeLinkInsertValues(v))
      .returning(QUESTION_OUTCOME_LINK_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async updateQuestionOutcomeLink(questionId: string, outcomeId: string, cognitiveLevel: string): Promise<void> {
    await this.handle
      .updateTable('question_learning_outcomes')
      .set({ cognitive_level: cognitiveLevel })
      .where('question_id', '=', questionId)
      .where('learning_outcome_id', '=', outcomeId)
      .execute();
  }

  async deleteQuestionOutcomeLink(questionId: string, outcomeId: string): Promise<boolean> {
    const rows = await this.handle
      .deleteFrom('question_learning_outcomes')
      .where('question_id', '=', questionId)
      .where('learning_outcome_id', '=', outcomeId)
      .returningAll()
      .execute();
    return rows.length > 0;
  }


  async getEntriesByQuestions(questionIds: string[]): Promise<EntryRow[]> {
    if (!questionIds.length) return [];
    return this.handle
      .selectFrom('question_bank_entries')
      .select(ENTRY_COLUMNS)
      .where('question_id', 'in', questionIds)
      .execute();
  }

  async getLatestVersionsByEntries(entries: EntryRow[]): Promise<VersionRow[]> {
    if (!entries.length) return [];
    return this.handle
      .selectFrom('question_versions as v')
      .innerJoin('question_bank_entries as e', (join) =>
        join
          .onRef('v.question_bank_entry_id', '=', 'e.id')
          .onRef('v.version', '=', 'e.latest_version'))
      .select(VERSION_COLUMNS_V)
      .where('e.id', 'in', entries.map((e) => e.id))
      .execute();
  }

  async listAnswersByVersions(versionIds: string[]): Promise<AnswerRow[]> {
    if (!versionIds.length) return [];
    return this.handle
      .selectFrom('question_answers')
      .select(ANSWER_COLUMNS)
      .where('question_version_id', 'in', versionIds)
      .orderBy('sort_order')
      .orderBy('id')
      .execute();
  }

  async listAnswerKeysByVersions(versionIds: string[]): Promise<AnswerKeyRow[]> {
    if (!versionIds.length) return [];
    return this.handle
      .selectFrom('question_answer_keys')
      .select(ANSWER_KEY_COLUMNS)
      .where('question_version_id', 'in', versionIds)
      .execute();
  }

  async listMultichoiceOptionsByVersions(versionIds: string[]): Promise<MultichoiceOptionsRow[]> {
    if (!versionIds.length) return [];
    return this.handle
      .selectFrom('qtype_multichoice_options')
      .select(MULTICHOICE_OPTIONS_COLUMNS)
      .where('question_version_id', 'in', versionIds)
      .execute();
  }

  async listShortanswerOptionsByVersions(versionIds: string[]): Promise<ShortanswerOptionsRow[]> {
    if (!versionIds.length) return [];
    return this.handle
      .selectFrom('qtype_shortanswer_options')
      .select(SHORTANSWER_OPTIONS_COLUMNS)
      .where('question_version_id', 'in', versionIds)
      .execute();
  }

  async listEssayOptionsByVersions(versionIds: string[]): Promise<EssayOptionsRow[]> {
    if (!versionIds.length) return [];
    return this.handle
      .selectFrom('qtype_essay_options')
      .select(ESSAY_OPTIONS_COLUMNS)
      .where('question_version_id', 'in', versionIds)
      .execute();
  }

  async listStimuliByIds(ids: string[]): Promise<StimulusRow[]> {
    if (!ids.length) return [];
    return this.handle
      .selectFrom('stimuli')
      .select(STIMULUS_COLUMNS)
      .where('id', 'in', ids)
      .execute();
  }


  async filterQuestionsByCurriculumLinks(filter: CurriculumLinkFilter): Promise<QuestionRow[]> {
    const candidateIds = await this.resolveCurriculumCandidateIds(filter);
    if (candidateIds !== null && candidateIds.size === 0) return [];
    let query = this.handle
      .selectFrom('question as q')
      .innerJoin('question_bank_entries as e', 'e.question_id', 'q.id')
      .select(QUESTION_COLUMNS_Q)
      .orderBy('q.created_at');
    if (candidateIds !== null) query = query.where('q.id', 'in', [...candidateIds]);
    if (filter.qtype !== undefined) query = query.where('q.qtype', '=', filter.qtype);
    if (filter.status !== undefined) query = query.where('e.status', '=', filter.status);
    return query.execute();
  }

  async countQuestionsByCurriculumFilterPerCategory(
    filter: CurriculumLinkFilter,
  ): Promise<{ categoryId: string; count: number }[]> {
    const candidateIds = await this.resolveCurriculumCandidateIds(filter);
    if (candidateIds !== null && candidateIds.size === 0) return [];
    let query = this.handle
      .selectFrom('question as q')
      .innerJoin('question_bank_entries as e', 'e.question_id', 'q.id')
      .select(['e.question_category_id as categoryId', sql<number>`count(*)::int`.as('count')])
      .groupBy('e.question_category_id');
    if (candidateIds !== null) query = query.where('q.id', 'in', [...candidateIds]);
    if (filter.qtype !== undefined) query = query.where('q.qtype', '=', filter.qtype);
    if (filter.status !== undefined) query = query.where('e.status', '=', filter.status);
    return query.execute();
  }

  private async resolveCurriculumCandidateIds(filter: CurriculumLinkFilter): Promise<Set<string> | null> {
    const idSets: Set<string>[] = [];
    if (filter.subjectId !== undefined) {
      const viaSubjects = await this.handle
        .selectFrom('question_subjects')
        .select('question_id as questionId')
        .where('subject_id', '=', filter.subjectId)
        .execute();
      const viaOutcomes = await this.handle
        .selectFrom('question_learning_outcomes as qlo')
        .innerJoin('learning_outcomes as lo', 'lo.id', 'qlo.learning_outcome_id')
        .leftJoin('learning_outcomes as learning_outcome_root', 'learning_outcome_root.id', 'lo.derived_from_id')
        .innerJoin('curriculum_nodes as n', 'n.id', 'lo.node_id')
        .innerJoin('curricula as c', 'c.id', 'n.curriculum_id')
        .select('qlo.question_id as questionId')
        .where('c.subject_id', '=', filter.subjectId)
        .where('lo.retired_at', 'is', null)
        .where((eb) =>
          eb.or([
            eb('lo.derived_from_id', 'is', null),
            eb('learning_outcome_root.retired_at', 'is', null),
          ]))
        .execute();
      idSets.push(new Set([...viaSubjects.map((r) => r.questionId), ...viaOutcomes.map((r) => r.questionId)]));
    }
    if (filter.outcomeId !== undefined || filter.nodeId !== undefined || filter.cognitiveLevel !== undefined) {
      let rows: { questionId: string }[];
      if (filter.nodeId !== undefined) {
        let query = this.handle
          .selectFrom('question_learning_outcomes as qlo')
          .innerJoin('learning_outcomes as lo', 'lo.id', 'qlo.learning_outcome_id')
          .leftJoin('learning_outcomes as learning_outcome_root', 'learning_outcome_root.id', 'lo.derived_from_id')
          .select('qlo.question_id as questionId')
          .where('lo.node_id', '=', filter.nodeId)
          .where('lo.retired_at', 'is', null)
          .where((eb) =>
            eb.or([
              eb('lo.derived_from_id', 'is', null),
              eb('learning_outcome_root.retired_at', 'is', null),
            ]));
        if (filter.outcomeId !== undefined) query = query.where('qlo.learning_outcome_id', '=', filter.outcomeId);
        if (filter.cognitiveLevel !== undefined) query = query.where('qlo.cognitive_level', '=', filter.cognitiveLevel);
        rows = await query.execute();
      } else {
        let query = this.handle
          .selectFrom('question_learning_outcomes')
          .select('question_id as questionId');
        if (filter.outcomeId !== undefined) query = query.where('learning_outcome_id', '=', filter.outcomeId);
        if (filter.cognitiveLevel !== undefined) query = query.where('cognitive_level', '=', filter.cognitiveLevel);
        rows = await query.execute();
      }
      idSets.push(new Set(rows.map((r) => r.questionId)));
    }
    let candidateIds: Set<string> | null = null;
    for (const set of idSets) {
      if (candidateIds === null) {
        candidateIds = set;
        continue;
      }
      const current: Set<string> = candidateIds;
      candidateIds = new Set([...current].filter((id) => set.has(id)));
    }
    return candidateIds;
  }
}

interface CurriculumLinkFilter {
  subjectId?: string;
  outcomeId?: string;
  nodeId?: string;
  cognitiveLevel?: string;
  qtype?: string;
  status?: string;
}
