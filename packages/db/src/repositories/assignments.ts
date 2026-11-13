import { sql, type Insertable, type InsertObject, type RawBuilder, type Updateable } from 'kysely';
import type { CentreDb, CentreTx, CentreDB } from '../client';

export type AssignmentsDb = CentreDb | CentreTx;

export interface AssignmentRow {
  id: string;
  course: string;
  cmId: string | null;
  name: string;
  intro: string;
  dueDate: Date | null;
  maxFiles: number;
  acceptedFileTypes: string | null;
  grade: number;
  resultMode: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignSubmissionRow {
  id: string;
  assignmentId: string;
  userId: string;
  status: string;
  attemptNumber: number;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignSubmissionFileRow {
  id: string;
  submissionId: string;
  fileId: string;
  createdAt: Date;
}

export interface AssignGradeRow {
  id: string;
  assignmentId: string;
  userId: string;
  graderId: string;
  attemptNumber: number;
  grade: number | null;
  level: string | null;
  feedback: string | null;
  feedbackProgress: string | null;
  feedbackStrengths: string | null;
  feedbackWeaknesses: string | null;
  status: string;
  releasedAt: Date | null;
  releasedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

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
  points: unknown;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignRubricRow {
  id: string;
  assignmentId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignRubricCriterionRow {
  id: string;
  rubricId: string;
  name: string;
  descriptionForStudent: string | null;
  descriptionForGrader: string | null;
  mode: string;
  maxScore: number | null;
  outcomeId: string | null;
  outcomeText: string | null;
  sortOrder: number;
}

export interface AssignRubricLevelRow {
  id: string;
  criterionId: string;
  label: string;
  score: number;
  sortOrder: number;
}

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

export interface AssignFeedbackMessageRow {
  id: string;
  gradeId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export interface TeacherCommentBankRow {
  id: string;
  ownerId: string;
  category: string | null;
  text: string;
  createdAt: Date;
}

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

export interface NewSubmissionFile {
  id?: string;
  submissionId: string;
  fileId: string;
  createdAt?: Date;
}

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

export interface NewRubric {
  id?: string;
  assignmentId: string;
  title?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

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

export interface NewRubricLevel {
  id?: string;
  criterionId: string;
  label: string;
  score?: number;
  sortOrder?: number;
}

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

export interface NewFeedbackMessage {
  id?: string;
  gradeId: string;
  authorId: string;
  body: string;
  createdAt?: Date;
}

export interface NewCommentBankEntry {
  id?: string;
  ownerId: string;
  category?: string | null;
  text: string;
  createdAt?: Date;
}

function jsonbValue<T>(value: T): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

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

const SUBMISSION_FILE_COLUMNS = [
  'id',
  'submission_id as submissionId',
  'file_id as fileId',
  'created_at as createdAt',
] as const;

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

const RUBRIC_COLUMNS = [
  'id',
  'assignment_id as assignmentId',
  'title',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

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

const RUBRIC_LEVEL_COLUMNS = [
  'id',
  'criterion_id as criterionId',
  'label',
  'score',
  'sort_order as sortOrder',
] as const;

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

const FEEDBACK_MESSAGE_COLUMNS = [
  'id',
  'grade_id as gradeId',
  'author_id as authorId',
  'body',
  'created_at as createdAt',
] as const;

const COMMENT_BANK_COLUMNS = [
  'id',
  'owner_id as ownerId',
  'category',
  'text',
  'created_at as createdAt',
] as const;

function assignmentInsertValues(values: NewAssignment): Insertable<CentreDB['assignments']> {
  const row: Insertable<CentreDB['assignments']> = { course: values.course, name: values.name };
  if (values.id !== undefined) row.id = values.id;
  if (values.cmId !== undefined) row.cm_id = values.cmId;
  if (values.intro !== undefined) row.intro = values.intro;
  if (values.dueDate !== undefined) row.due_date = values.dueDate;
  if (values.maxFiles !== undefined) row.max_files = values.maxFiles;
  if (values.acceptedFileTypes !== undefined) row.accepted_file_types = values.acceptedFileTypes;
  if (values.grade !== undefined) row.grade = values.grade;
  if (values.resultMode !== undefined) row.result_mode = values.resultMode;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function assignmentUpdateSet(patch: Partial<AssignmentRow>): Updateable<CentreDB['assignments']> {
  const set: Updateable<CentreDB['assignments']> = {};
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.course !== undefined) set.course = patch.course;
  if (patch.cmId !== undefined) set.cm_id = patch.cmId;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.intro !== undefined) set.intro = patch.intro;
  if (patch.dueDate !== undefined) set.due_date = patch.dueDate;
  if (patch.maxFiles !== undefined) set.max_files = patch.maxFiles;
  if (patch.acceptedFileTypes !== undefined) set.accepted_file_types = patch.acceptedFileTypes;
  if (patch.grade !== undefined) set.grade = patch.grade;
  if (patch.resultMode !== undefined) set.result_mode = patch.resultMode;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  return set;
}

function submissionInsertValues(values: NewSubmission): Insertable<CentreDB['assign_submissions']> {
  const row: Insertable<CentreDB['assign_submissions']> = {
    assignment_id: values.assignmentId,
    user_id: values.userId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.status !== undefined) row.status = values.status;
  if (values.attemptNumber !== undefined) row.attempt_number = values.attemptNumber;
  if (values.submittedAt !== undefined) row.submitted_at = values.submittedAt;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function submissionUpdateSet(patch: Partial<AssignSubmissionRow>): Updateable<CentreDB['assign_submissions']> {
  const set: Updateable<CentreDB['assign_submissions']> = {};
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.assignmentId !== undefined) set.assignment_id = patch.assignmentId;
  if (patch.userId !== undefined) set.user_id = patch.userId;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.attemptNumber !== undefined) set.attempt_number = patch.attemptNumber;
  if (patch.submittedAt !== undefined) set.submitted_at = patch.submittedAt;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  return set;
}

function submissionFileInsertValues(values: NewSubmissionFile): Insertable<CentreDB['assign_submission_files']> {
  const row: Insertable<CentreDB['assign_submission_files']> = {
    submission_id: values.submissionId,
    file_id: values.fileId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  return row;
}

function gradeInsertValues(values: NewGrade): Insertable<CentreDB['assign_grades']> {
  const row: Insertable<CentreDB['assign_grades']> = {
    assignment_id: values.assignmentId,
    user_id: values.userId,
    grader_id: values.graderId,
    attempt_number: values.attemptNumber,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.grade !== undefined) row.grade = values.grade;
  if (values.level !== undefined) row.level = values.level;
  if (values.feedback !== undefined) row.feedback = values.feedback;
  if (values.feedbackProgress !== undefined) row.feedback_progress = values.feedbackProgress;
  if (values.feedbackStrengths !== undefined) row.feedback_strengths = values.feedbackStrengths;
  if (values.feedbackWeaknesses !== undefined) row.feedback_weaknesses = values.feedbackWeaknesses;
  if (values.status !== undefined) row.status = values.status;
  if (values.releasedAt !== undefined) row.released_at = values.releasedAt;
  if (values.releasedBy !== undefined) row.released_by = values.releasedBy;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function gradeUpdateSet(patch: Partial<AssignGradeRow>): Updateable<CentreDB['assign_grades']> {
  const set: Updateable<CentreDB['assign_grades']> = {};
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.assignmentId !== undefined) set.assignment_id = patch.assignmentId;
  if (patch.userId !== undefined) set.user_id = patch.userId;
  if (patch.graderId !== undefined) set.grader_id = patch.graderId;
  if (patch.attemptNumber !== undefined) set.attempt_number = patch.attemptNumber;
  if (patch.grade !== undefined) set.grade = patch.grade;
  if (patch.level !== undefined) set.level = patch.level;
  if (patch.feedback !== undefined) set.feedback = patch.feedback;
  if (patch.feedbackProgress !== undefined) set.feedback_progress = patch.feedbackProgress;
  if (patch.feedbackStrengths !== undefined) set.feedback_strengths = patch.feedbackStrengths;
  if (patch.feedbackWeaknesses !== undefined) set.feedback_weaknesses = patch.feedbackWeaknesses;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.releasedAt !== undefined) set.released_at = patch.releasedAt;
  if (patch.releasedBy !== undefined) set.released_by = patch.releasedBy;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  return set;
}

function annotationInsertValues(values: NewAnnotation): InsertObject<CentreDB, 'assign_annotations'> {
  const row: InsertObject<CentreDB, 'assign_annotations'> = {
    submission_id: values.submissionId,
    file_id: values.fileId,
    x: values.x,
    y: values.y,
    kind: values.kind,
    author_id: values.authorId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.page !== undefined) row.page = values.page;
  if (values.color !== undefined) row.color = values.color;
  if (values.text !== undefined) row.text = values.text;
  if (values.points !== undefined) row.points = values.points === null ? null : jsonbValue(values.points);
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function annotationUpdateSet(patch: Partial<AssignAnnotationRow>): Updateable<CentreDB['assign_annotations']> {
  const set: Updateable<CentreDB['assign_annotations']> = {};
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.submissionId !== undefined) set.submission_id = patch.submissionId;
  if (patch.fileId !== undefined) set.file_id = patch.fileId;
  if (patch.page !== undefined) set.page = patch.page;
  if (patch.x !== undefined) set.x = patch.x;
  if (patch.y !== undefined) set.y = patch.y;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.text !== undefined) set.text = patch.text;
  if (patch.authorId !== undefined) set.author_id = patch.authorId;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  return set;
}

function rubricInsertValues(values: NewRubric): Insertable<CentreDB['assign_rubrics']> {
  const row: Insertable<CentreDB['assign_rubrics']> = { assignment_id: values.assignmentId };
  if (values.id !== undefined) row.id = values.id;
  if (values.title !== undefined) row.title = values.title;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function rubricCriterionInsertValues(values: NewRubricCriterion): Insertable<CentreDB['assign_rubric_criteria']> {
  const row: Insertable<CentreDB['assign_rubric_criteria']> = {
    rubric_id: values.rubricId,
    name: values.name,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.descriptionForStudent !== undefined) row.description_for_student = values.descriptionForStudent;
  if (values.descriptionForGrader !== undefined) row.description_for_grader = values.descriptionForGrader;
  if (values.mode !== undefined) row.mode = values.mode;
  if (values.maxScore !== undefined) row.max_score = values.maxScore;
  if (values.outcomeId !== undefined) row.outcome_id = values.outcomeId;
  if (values.outcomeText !== undefined) row.outcome_text = values.outcomeText;
  if (values.sortOrder !== undefined) row.sort_order = values.sortOrder;
  return row;
}

function rubricLevelInsertValues(values: NewRubricLevel): Insertable<CentreDB['assign_rubric_levels']> {
  const row: Insertable<CentreDB['assign_rubric_levels']> = {
    criterion_id: values.criterionId,
    label: values.label,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.score !== undefined) row.score = values.score;
  if (values.sortOrder !== undefined) row.sort_order = values.sortOrder;
  return row;
}

function rubricEvaluationInsertValues(values: NewRubricEvaluation): Insertable<CentreDB['assign_rubric_evaluations']> {
  const row: Insertable<CentreDB['assign_rubric_evaluations']> = {
    grade_id: values.gradeId,
    criterion_id: values.criterionId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.levelId !== undefined) row.level_id = values.levelId;
  if (values.score !== undefined) row.score = values.score;
  if (values.note !== undefined) row.note = values.note;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function gradeRevisionInsertValues(values: NewGradeRevision): Insertable<CentreDB['assign_grade_revisions']> {
  const row: Insertable<CentreDB['assign_grade_revisions']> = {
    grade_id: values.gradeId,
    actor_id: values.actorId,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.previousGrade !== undefined) row.previous_grade = values.previousGrade;
  if (values.newGrade !== undefined) row.new_grade = values.newGrade;
  if (values.previousLevel !== undefined) row.previous_level = values.previousLevel;
  if (values.newLevel !== undefined) row.new_level = values.newLevel;
  if (values.previousFeedback !== undefined) row.previous_feedback = values.previousFeedback;
  if (values.newFeedback !== undefined) row.new_feedback = values.newFeedback;
  if (values.reason !== undefined) row.reason = values.reason;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  return row;
}

function feedbackMessageInsertValues(values: NewFeedbackMessage): Insertable<CentreDB['assign_feedback_messages']> {
  const row: Insertable<CentreDB['assign_feedback_messages']> = {
    grade_id: values.gradeId,
    author_id: values.authorId,
    body: values.body,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  return row;
}

function commentBankInsertValues(values: NewCommentBankEntry): Insertable<CentreDB['teacher_comment_bank']> {
  const row: Insertable<CentreDB['teacher_comment_bank']> = {
    owner_id: values.ownerId,
    text: values.text,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.category !== undefined) row.category = values.category;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  return row;
}

export class AssignmentsRepository {
  constructor(private readonly handle: AssignmentsDb) {}

  private db(): AssignmentsDb {
    return this.handle;
  }

  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.db().transaction().execute(fn);
  }

  async insertAssignment(v: NewAssignment, db: AssignmentsDb = this.db()): Promise<AssignmentRow> {
    const rows = await db
      .insertInto('assignments')
      .values(assignmentInsertValues(v))
      .returning(ASSIGNMENT_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async getAssignment(id: string, db: AssignmentsDb = this.db()): Promise<AssignmentRow | undefined> {
    return db
      .selectFrom('assignments')
      .select(ASSIGNMENT_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
  }

  async listAssignmentsInCourse(courseId: string, db: AssignmentsDb = this.db()): Promise<AssignmentRow[]> {
    return db
      .selectFrom('assignments')
      .select(ASSIGNMENT_COLUMNS)
      .where('course', '=', courseId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

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

  async deleteAssignment(id: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db.deleteFrom('assignments').where('id', '=', id).execute();
  }

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

  async listSubmissions(assignmentId: string, db: AssignmentsDb = this.db()): Promise<AssignSubmissionRow[]> {
    return db
      .selectFrom('assign_submissions')
      .select(SUBMISSION_COLUMNS)
      .where('assignment_id', '=', assignmentId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async insertSubmission(v: NewSubmission, db: AssignmentsDb = this.db()): Promise<AssignSubmissionRow> {
    const rows = await db
      .insertInto('assign_submissions')
      .values(submissionInsertValues(v))
      .returning(SUBMISSION_COLUMNS)
      .execute();
    return rows[0]!;
  }

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

  async listSubmissionFiles(submissionId: string, db: AssignmentsDb = this.db()): Promise<AssignSubmissionFileRow[]> {
    return db
      .selectFrom('assign_submission_files')
      .select(SUBMISSION_FILE_COLUMNS)
      .where('submission_id', '=', submissionId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async insertSubmissionFile(v: NewSubmissionFile, db: AssignmentsDb = this.db()): Promise<AssignSubmissionFileRow> {
    const rows = await db
      .insertInto('assign_submission_files')
      .values(submissionFileInsertValues(v))
      .returning(SUBMISSION_FILE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async deleteSubmissionFile(submissionId: string, fileId: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db
      .deleteFrom('assign_submission_files')
      .where('submission_id', '=', submissionId)
      .where('file_id', '=', fileId)
      .execute();
  }

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

  async listGrades(assignmentId: string, db: AssignmentsDb = this.db()): Promise<AssignGradeRow[]> {
    return db
      .selectFrom('assign_grades')
      .select(GRADE_COLUMNS)
      .where('assignment_id', '=', assignmentId)
      .execute();
  }

  async upsertGrade(v: NewGrade, db: AssignmentsDb = this.db()): Promise<AssignGradeRow> {
    const rows = await db
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
      .execute();
    return rows[0]!;
  }

  async updateGrade(id: string, patch: Partial<AssignGradeRow>, db: AssignmentsDb = this.db()): Promise<void> {
    await db
      .updateTable('assign_grades')
      .set({ ...gradeUpdateSet(patch), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async listAnnotations(submissionId: string, db: AssignmentsDb = this.db()): Promise<AssignAnnotationRow[]> {
    return db
      .selectFrom('assign_annotations')
      .select(ANNOTATION_COLUMNS)
      .where('submission_id', '=', submissionId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async getAnnotation(id: string, db: AssignmentsDb = this.db()): Promise<AssignAnnotationRow | undefined> {
    return db
      .selectFrom('assign_annotations')
      .select(ANNOTATION_COLUMNS)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
  }

  async insertAnnotation(v: NewAnnotation, db: AssignmentsDb = this.db()): Promise<AssignAnnotationRow> {
    const rows = await db
      .insertInto('assign_annotations')
      .values(annotationInsertValues(v))
      .returning(ANNOTATION_COLUMNS)
      .execute();
    return rows[0]!;
  }

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
          ? { points: patch.points === null ? null : jsonbValue(patch.points as { x: number; y: number }[]) }
          : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async deleteAnnotation(id: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db.deleteFrom('assign_annotations').where('id', '=', id).execute();
  }

  async getRubric(assignmentId: string, db: AssignmentsDb = this.db()): Promise<AssignRubricRow | undefined> {
    return db
      .selectFrom('assign_rubrics')
      .select(RUBRIC_COLUMNS)
      .where('assignment_id', '=', assignmentId)
      .limit(1)
      .executeTakeFirst();
  }

  async insertRubric(v: NewRubric, db: AssignmentsDb = this.db()): Promise<AssignRubricRow> {
    const rows = await db
      .insertInto('assign_rubrics')
      .values(rubricInsertValues(v))
      .returning(RUBRIC_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async deleteRubricByAssignment(assignmentId: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db.deleteFrom('assign_rubrics').where('assignment_id', '=', assignmentId).execute();
  }

  async listCriteria(rubricId: string, db: AssignmentsDb = this.db()): Promise<AssignRubricCriterionRow[]> {
    return db
      .selectFrom('assign_rubric_criteria')
      .select(RUBRIC_CRITERION_COLUMNS)
      .where('rubric_id', '=', rubricId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async insertCriterion(v: NewRubricCriterion, db: AssignmentsDb = this.db()): Promise<AssignRubricCriterionRow> {
    const rows = await db
      .insertInto('assign_rubric_criteria')
      .values(rubricCriterionInsertValues(v))
      .returning(RUBRIC_CRITERION_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listLevels(criterionId: string, db: AssignmentsDb = this.db()): Promise<AssignRubricLevelRow[]> {
    return db
      .selectFrom('assign_rubric_levels')
      .select(RUBRIC_LEVEL_COLUMNS)
      .where('criterion_id', '=', criterionId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async insertLevel(v: NewRubricLevel, db: AssignmentsDb = this.db()): Promise<AssignRubricLevelRow> {
    const rows = await db
      .insertInto('assign_rubric_levels')
      .values(rubricLevelInsertValues(v))
      .returning(RUBRIC_LEVEL_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listEvaluations(gradeId: string, db: AssignmentsDb = this.db()): Promise<AssignRubricEvaluationRow[]> {
    return db
      .selectFrom('assign_rubric_evaluations')
      .select(RUBRIC_EVALUATION_COLUMNS)
      .where('grade_id', '=', gradeId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async upsertEvaluation(v: NewRubricEvaluation, db: AssignmentsDb = this.db()): Promise<AssignRubricEvaluationRow> {
    const rows = await db
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
      .execute();
    return rows[0]!;
  }

  async deleteEvaluations(gradeId: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db.deleteFrom('assign_rubric_evaluations').where('grade_id', '=', gradeId).execute();
  }

  async insertRevision(v: NewGradeRevision, db: AssignmentsDb = this.db()): Promise<AssignGradeRevisionRow> {
    const rows = await db
      .insertInto('assign_grade_revisions')
      .values(gradeRevisionInsertValues(v))
      .returning(GRADE_REVISION_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listRevisions(gradeId: string, db: AssignmentsDb = this.db()): Promise<AssignGradeRevisionRow[]> {
    return db
      .selectFrom('assign_grade_revisions')
      .select(GRADE_REVISION_COLUMNS)
      .where('grade_id', '=', gradeId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async listMessages(gradeId: string, db: AssignmentsDb = this.db()): Promise<AssignFeedbackMessageRow[]> {
    return db
      .selectFrom('assign_feedback_messages')
      .select(FEEDBACK_MESSAGE_COLUMNS)
      .where('grade_id', '=', gradeId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async insertMessage(v: NewFeedbackMessage, db: AssignmentsDb = this.db()): Promise<AssignFeedbackMessageRow> {
    const rows = await db
      .insertInto('assign_feedback_messages')
      .values(feedbackMessageInsertValues(v))
      .returning(FEEDBACK_MESSAGE_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async listCommentBank(ownerId: string, db: AssignmentsDb = this.db()): Promise<TeacherCommentBankRow[]> {
    return db
      .selectFrom('teacher_comment_bank')
      .select(COMMENT_BANK_COLUMNS)
      .where('owner_id', '=', ownerId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async insertCommentBankEntry(v: NewCommentBankEntry, db: AssignmentsDb = this.db()): Promise<TeacherCommentBankRow> {
    const rows = await db
      .insertInto('teacher_comment_bank')
      .values(commentBankInsertValues(v))
      .returning(COMMENT_BANK_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async deleteCommentBankEntry(id: string, ownerId: string, db: AssignmentsDb = this.db()): Promise<void> {
    await db
      .deleteFrom('teacher_comment_bank')
      .where('id', '=', id)
      .where('owner_id', '=', ownerId)
      .execute();
  }
}
