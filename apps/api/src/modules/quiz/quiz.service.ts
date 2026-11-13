import { ConflictException, Injectable } from '@nestjs/common';
import type {
  ExamMatrixView,
  MatrixCellAvailability,
  MatrixImportCellAvailability,
  PaperSlotLayout,
  PinRegradeLogEntry,
  PinRegradeResult,
  PinVersionUpdatePreview,
  QuestionSolution,
  QuizAttemptSummary,
  ExamPinOverrideView,
  QuizView,
  RichTextDocument,
} from '@giaokhoa/contracts';
import { OutboxService } from '../../infra/events/outbox.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import { TenantsService } from '../tenants/tenants.service';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { CoursesService } from '../courses/courses.service';
import { EnrolService } from '../enrol/enrol.service';
import { CurriculumService } from '../curriculum/curriculum.service';
import { FilesService } from '../files/files.service';
import { GradesService } from '../grades/grades.service';
import { GroupsService } from '../groups/groups.service';
import { QuestionBanksService } from '../questions/question-banks.service';
import type { QuestionBankRow } from '@giaokhoa/db/repositories/question-banks';
import { QuestionsService } from '../questions/questions.service';
import { PasswordService } from '../users/password.service';
import { UsersService } from '../users/users.service';
import type {
  CreateExamMatrixCellDto,
  CreateExamMatrixDto,
  CreateExamPinOverrideDto,
  UpdateExamMatrixCellDto,
  UpdateExamMatrixDto,
  UpdateExamPinOverrideDto,
  WithdrawExamMatrixDto,
} from './dto/quiz.dto';
import { type ExamKind } from './domain/matrix';
import {
  QuizRepository,
  type ExamMatrixCellRow,
  type ExamMatrixRow,
  type ExamAttemptEventRow,
  type ExamAttemptRow,
  type ExamPinFeedbackRow,
  type ExamPinRow,
} from '@giaokhoa/db/repositories/quiz';
import { ExamQuestionSnapshotsService } from './exam-question-snapshots.service';
import { QuizSharedService } from './quiz-shared.service';
import { QuizAttemptsService } from './quiz-attempts.service';
import { QuizPinsService } from './quiz-pins.service';
import { QuizMatricesService } from './quiz-matrices.service';
import { QuizGenerationService } from './quiz-generation.service';

export interface MatrixSpecification {
  matrix: { id: string; name: string; presetKind: string; totalScore: number; levelSet: string };
  subject: { id: string; name: string };
  curriculum: { id: string; grade: number };
  purpose: string;
  structure: { qtype: string; questionCount: number; score: number; percent: number }[];
  topics: {
    topicId: string | null;
    topicTitle: string;
    nodes: {
      nodeId: string;
      nodeTitle: string;
      outcomes: {
        outcomeId: string;
        content: string;
        sourceKind: string;
        sourceRef: string | null;
        programContent: string | null;
        derivedContent: string | null;
        position: number | null;
        code: string | null;
      }[];
      cells: {
        cellId: string;
        cognitiveLevel: string;
        qtype: string;
        questionCount: number;
        cellScore: number;
        minutes: number | null;
        slotNumbers: number[] | null;
        drawNote: string | null;
        competencyRefs: string[];
      }[];
    }[];
  }[];
  totals: {
    byForm: { qtype: string; questionCount: number; score: number; percent: number }[];
    totalScore: number;
    totalQuestions: number;
  };
  quiz: { id: string; name: string } | null;
}

export interface SpecificationSlot {
  matrixCellId: string | null;
  slot: number;
  questionId: string | null;
}

export interface EffectiveQuizSettings {
  timeOpen: Date | null;
  timeClose: Date | null;
  timeLimit: number | null;
  attemptsAllowed: number;
  passwordHashes: string[];
  passwordRequired: boolean;
  subnet: string | null;
  userOverrideId: string | null;
  groupOverrideIds: string[];
}

export interface QuizAttemptQuestionView {
  slot: number;
  page: number;
  questionAttemptId: string;
  questionId: string;
  qtype: string;
  questionExcerpt: string;
  questionText: RichTextDocument;
  guidance: RichTextDocument | null;
  solution: QuestionSolution | null;
  stimulus: { id: string; content: RichTextDocument } | null;
  answers: { id: string; text: RichTextDocument }[];
  options: Record<string, unknown> | null;
  maxMark: number;
  state: string;
  response: string | null;
  fraction: number | null;
  mark: number | null;
  rightAnswer: string | null;
  feedback: RichTextDocument | null;
  generalFeedback: RichTextDocument | null;
  manualComment: string | null;
}

export interface QuizAttemptView {
  attempt: QuizAttemptSummary;
  quiz: QuizView;
  questions: QuizAttemptQuestionView[];
  totalMax: number;
  pendingManualCount: number;
  closedDueToTimeLimit: boolean;
  overallFeedback: string | null;
}

export interface QuizQuestionWrongStudent {
  userId: string;
  displayName: string;
  quizAttemptId: string;
  attemptNumber: number;
  fraction: number;
  mark: number;
}

export interface QuizQuestionStat {
  slot: number;
  questionId: string | null;
  questionName: string | null;
  maxMark: number;
  attemptsCount: number;
  gradedCount: number;
  pendingCount: number;
  wrongCount: number;
  fullyWrongCount: number;
  wrongStudents: QuizQuestionWrongStudent[];
  correctCount: number;
  correctStudents: { userId: string; displayName: string }[];
}

export interface QuizResultsSummary {
  enrolledCount: number;
  submittedCount: number;
  notSubmittedStudents: { userId: string; displayName: string }[];
  averageGrade: number | null;
  gradeMax: number;
  distribution: { fromPct: number; toPct: number; count: number }[];
}

export interface QuizNeedsGradingView {
  quizAttemptId: string;
  userId: string;
  attemptNumber: number;
  questionAttemptId: string;
  slot: number;
  questionId: string;
  maxMark: number;
  response: string | null;
}


export type PinRow = ExamPinRow & {
  course: string;
  grade: number;
  tfScale: number[] | null;
  matrixId: string | null;
  name: string;
  examVersionNumber: number;
  examStatus: string;
  examLatestVersion: number;
  sharedSource: { examId: string; versionId: string; versionNumber: number } | null;
};

export interface EffectiveSlotRow {
  sourceDomain?: string;
  id: string;
  pinId: string;
  slot: number;
  page: number;
  questionId: string | null;
  categoryId: string | null;
  maxMark: number;
  matrixCellId: string | null;
  versionMode: 'pinned' | 'follow_latest';
  pinnedVersionId: string | null;
  pinnedVersionNumber: number | null;
}

export { QUIZ_COMPONENT, QUIZ_CAPABILITIES } from './quiz-shared.service';
export { REVIEW_WINDOW, REVIEW_IMMEDIATELY_AFTER_MS } from './quiz-attempts.service';
export { QTYPE_LABELS, LEVEL_LABELS, flattenSpecification } from './quiz-generation.service';


@Injectable()
export class QuizService {
  private readonly shared: QuizSharedService;
  private readonly attempts: QuizAttemptsService;
  private readonly pins: QuizPinsService;
  private readonly matrices: QuizMatricesService;
  private readonly generation: QuizGenerationService;

  constructor(
    private readonly snapshots: ExamQuestionSnapshotsService,
    private readonly repo: QuizRepository,
    private readonly courses: CoursesService,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly questions: QuestionsService,
    private readonly banks: QuestionBanksService,
    private readonly grades: GradesService,
    private readonly users: UsersService,
    private readonly enrol: EnrolService,
    private readonly passwords: PasswordService,
    private readonly groups: GroupsService,
    private readonly curriculum: CurriculumService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
    private readonly tenants: TenantsService,
    private readonly files: FilesService,
  ) {
    this.shared = new QuizSharedService(this.repo, this.contexts, this.evaluator, this.questions, this.banks, this.tenantContext, this.tenants);
    this.attempts = new QuizAttemptsService(this.repo, this.courses, this.questions, this.grades, this.users, this.enrol, this.passwords, this.groups, this.outbox, this.files, this.shared);
    this.pins = new QuizPinsService(this.snapshots, this.files, this.repo, this.courses, this.evaluator, this.questions, this.grades, this.users, this.passwords, this.groups, this.outbox, this.shared, this.attempts);
    this.matrices = new QuizMatricesService(this.repo, this.evaluator, this.banks, this.curriculum, this.outbox, this.tenantContext, this.shared);
    this.generation = new QuizGenerationService(this.repo, this.questions, this.curriculum, this.outbox, this.shared, this.attempts);
  }

  async withPinRequestLock<T>(courseId: string, actorId: string, requestId: string, action: () => Promise<T>): Promise<T> {
    return this.repo.withPinRequestLock(courseId, actorId, requestId, action);
  }

  async getPinRequestRecord(courseId: string, actorId: string, requestId: string): Promise<ExamPinRow | undefined> {
    return this.repo.getPinByRequest(courseId, actorId, requestId);
  }

  async getPinByRequest(courseId: string, actorId: string, requestId: string, sectionId?: string): Promise<QuizView | undefined> {
    const pin = await this.repo.getPinByRequest(courseId, actorId, requestId);
    if (!pin) return undefined;
    if (sectionId && pin.requestedSectionId && pin.requestedSectionId !== sectionId) {
      throw new ConflictException({ code: 'exam.pin_request_conflict' });
    }
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courses.courseContextId(courseId));
    if (pin.preparationState !== 'ready') {
      if (!sectionId) throw new ConflictException({ code: 'exam.pin_preparing' });
      return this.pins.resumePinRecord(actorId, courseId, pin, sectionId);
    }
    return this.shared.pinView(await this.shared.getPin(pin.id), true);
  }

  async getPin(id: string): Promise<PinRow> {
    return this.shared.getPin(id);
  }

  async getPinRow(id: string): Promise<ExamPinRow | undefined> {
    return this.shared.getPinRow(id);
  }

  async effectiveSlots(pin: PinRow): Promise<EffectiveSlotRow[]> {
    return this.shared.effectiveSlots(pin);
  }

  async assertPinUnlocked(pin: PinRow): Promise<void> {
    return this.pins.assertPinUnlocked(pin);
  }

  async pinView(quiz: PinRow): Promise<QuizView> {
    return this.shared.pinView(quiz);
  }

  async createPinRecord(actorId: string, courseId: string, input: {
    requestId?: string;
    sectionId: string; examId: string; examVersionId: string;
    name?: string; intro?: string;
    timeOpen?: string | null; timeClose?: string | null; timeLimitSeconds?: number | null;
    attemptsAllowed?: number; gradeMethod?: string; shuffleAnswers?: boolean;
    password?: string | null; subnet?: string | null;
    reviewAttempt?: number; reviewCorrectness?: number; reviewMarks?: number;
    reviewSpecificFeedback?: number; reviewGeneralFeedback?: number;
    reviewRightAnswer?: number; reviewOverallFeedback?: number;
    preset?: ExamKind | null; lateEntryMinutes?: number | null; monitorEvents?: boolean;
    variantCount?: number; targetGroupId?: string | null;
    versionMode?: 'pinned' | 'float_latest_ready';
  }): Promise<QuizView> {
    return this.pins.createPinRecord(actorId, courseId, input);
  }

  async updatePin(actorId: string, pinId: string, input: {
    name?: string; intro?: string;
    timeOpen?: string | null; timeClose?: string | null; timeLimitSeconds?: number | null;
    attemptsAllowed?: number; gradeMethod?: string; shuffleAnswers?: boolean;
    password?: string | null; subnet?: string | null;
    reviewAttempt?: number; reviewCorrectness?: number; reviewMarks?: number;
    reviewSpecificFeedback?: number; reviewGeneralFeedback?: number;
    reviewRightAnswer?: number; reviewOverallFeedback?: number;
    preset?: ExamKind | null; lateEntryMinutes?: number | null; monitorEvents?: boolean;
    examVersionId?: string; variantCount?: number; targetGroupId?: string | null;
    versionMode?: 'pinned' | 'float_latest_ready';
  }): Promise<QuizView> {
    return this.pins.updatePin(actorId, pinId, input);
  }

  async deletePin(actorId: string, pinId: string): Promise<void> {
    return this.pins.deletePin(actorId, pinId);
  }

  async getPinVersionUpdatePreview(actorId: string, pinId: string): Promise<PinVersionUpdatePreview> {
    return this.pins.getPinVersionUpdatePreview(actorId, pinId);
  }

  async applyPinVersionUpdate(actorId: string, pinId: string, toExamVersionId: string): Promise<QuizView> {
    return this.pins.applyPinVersionUpdate(actorId, pinId, toExamVersionId);
  }

  async regradePinQuestion(actorId: string, pinId: string, input: { questionId: string; toVersionId: string; dryRun: boolean }): Promise<PinRegradeResult> {
    return this.pins.regradePinQuestion(actorId, pinId, input);
  }

  async listPinRegrades(actorId: string, pinId: string): Promise<PinRegradeLogEntry[]> {
    return this.pins.listPinRegrades(actorId, pinId);
  }

  async listMyPinRegrades(actorId: string, pinId: string): Promise<PinRegradeLogEntry[]> {
    return this.pins.listMyPinRegrades(actorId, pinId);
  }

  async listPins(actorId: string, courseId: string): Promise<QuizView[]> {
    return this.pins.listPins(actorId, courseId);
  }

  async publishResults(actorId: string, pinId: string): Promise<QuizView> {
    return this.pins.publishResults(actorId, pinId);
  }

  async unpublishResults(actorId: string, pinId: string): Promise<QuizView> {
    return this.pins.unpublishResults(actorId, pinId);
  }

  async updatePinOverride(actorId: string, overrideId: string, dto: UpdateExamPinOverrideDto): Promise<ExamPinOverrideView> {
    return this.pins.updatePinOverride(actorId, overrideId, dto);
  }

  async deletePinOverride(actorId: string, overrideId: string): Promise<void> {
    return this.pins.deletePinOverride(actorId, overrideId);
  }

  async deletePinFeedback(actorId: string, feedbackId: string): Promise<void> {
    return this.pins.deletePinFeedback(actorId, feedbackId);
  }

  async listOverrides(actorId: string, pinId: string): Promise<ExamPinOverrideView[]> {
    return this.pins.listOverrides(actorId, pinId);
  }

  async createOverride(actorId: string, pinId: string, input: CreateExamPinOverrideDto): Promise<ExamPinOverrideView> {
    return this.pins.createOverride(actorId, pinId, input);
  }

  async updateOverride(actorId: string, pinId: string, overrideId: string, input: UpdateExamPinOverrideDto): Promise<ExamPinOverrideView> {
    return this.pins.updateOverride(actorId, pinId, overrideId, input);
  }

  async deleteOverride(actorId: string, pinId: string, overrideId: string): Promise<void> {
    return this.pins.deleteOverride(actorId, pinId, overrideId);
  }

  async requirePersonalMatrixBankManage(actorId: string): Promise<QuestionBankRow> {
    return this.matrices.requirePersonalMatrixBankManage(actorId);
  }

  async viewMatrixRow(row: ExamMatrixRow): Promise<ExamMatrixView> {
    return this.matrices.viewMatrixRow(row);
  }

  async createMatrix(actorId: string, input: CreateExamMatrixDto): Promise<ExamMatrixView> {
    return this.matrices.createMatrix(actorId, input);
  }

  async createMatrixFromImport(actorId: string, input: {
    name: string; subjectId: string; curriculumId: string;
    levelSet: 'three' | 'four'; totalScore: number; scopeNote: string | null;
    scopeNodeIds: string[];
    cells: { curriculumNodeId: string; cognitiveLevel: string; qtype: string; questionCount: number; cellScore: number; position: number }[];
  }): Promise<ExamMatrixView> {
    return this.matrices.createMatrixFromImport(actorId, input);
  }

  async getMatrix(actorId: string, matrixId: string): Promise<ExamMatrixView> {
    return this.matrices.getMatrix(actorId, matrixId);
  }

  async getMatrixVersion(actorId: string, matrixId: string, version: number): Promise<ExamMatrixView> {
    return this.matrices.getMatrixVersion(actorId, matrixId, version);
  }

  async listGeneratedExams(actorId: string, matrixId: string) {
    return this.matrices.listGeneratedExams(actorId, matrixId);
  }

  async listMatrices(actorId: string, subjectId: string): Promise<ExamMatrixView[]> {
    return this.matrices.listMatrices(actorId, subjectId);
  }

  async updateMatrix(actorId: string, matrixId: string, input: UpdateExamMatrixDto): Promise<ExamMatrixView> {
    return this.matrices.updateMatrix(actorId, matrixId, input);
  }

  async withdrawMatrix(actorId: string, matrixId: string, input: WithdrawExamMatrixDto): Promise<{ matrixId: string; status: string }> {
    return this.matrices.withdrawMatrix(actorId, matrixId, input);
  }

  async restoreMatrix(actorId: string, matrixId: string): Promise<{ matrixId: string; status: string }> {
    return this.matrices.restoreMatrix(actorId, matrixId);
  }

  async deleteMatrix(actorId: string, matrixId: string): Promise<void> {
    return this.matrices.deleteMatrix(actorId, matrixId);
  }

  async createMatrixCell(actorId: string, matrixId: string, input: CreateExamMatrixCellDto): Promise<ExamMatrixView> {
    return this.matrices.createMatrixCell(actorId, matrixId, input);
  }

  async updateMatrixCell(actorId: string, matrixId: string, cellId: string, input: UpdateExamMatrixCellDto): Promise<ExamMatrixView> {
    return this.matrices.updateMatrixCell(actorId, matrixId, cellId, input);
  }

  async deleteMatrixCell(actorId: string, matrixId: string, cellId: string): Promise<ExamMatrixView> {
    return this.matrices.deleteMatrixCell(actorId, matrixId, cellId);
  }

  async matrixAvailability(actorId: string, matrixId: string): Promise<{ matrixId: string; cells: MatrixCellAvailability[]; sufficient: boolean }> {
    return this.matrices.matrixAvailability(actorId, matrixId);
  }

  async importAvailability(actorId: string, cells: { curriculumNodeId: string; cognitiveLevel: string; qtype: string; questionCount: number }[]): Promise<MatrixImportCellAvailability[]> {
    return this.matrices.importAvailability(actorId, cells);
  }

  async matrixForGeneration(actorId: string, matrixId: string): Promise<{ matrix: ExamMatrixRow; cells: ExamMatrixCellRow[] }> {
    return this.generation.matrixForGeneration(actorId, matrixId);
  }

  async drawFixedSlots(actorId: string, cells: ExamMatrixCellRow[]): Promise<{
    questionId: string; matrixCellId: string; maxMark: number; page: number;
  }[]> {
    return this.generation.drawFixedSlots(actorId, cells);
  }

  async cellPoolContains(cellId: string, questionId: string): Promise<boolean> {
    return this.generation.cellPoolContains(cellId, questionId);
  }

  async getMatrixSpecification(actorId: string, matrixId: string, pinId?: string): Promise<MatrixSpecification> {
    return this.generation.getMatrixSpecification(actorId, matrixId, pinId);
  }

  async buildSpecificationForPaper(actorId: string, matrixId: string, paperSlots: { matrixCellId: string | null; position: number; questionId: string | null }[]): Promise<MatrixSpecification> {
    return this.generation.buildSpecificationForPaper(actorId, matrixId, paperSlots);
  }

  async getPinSummary(pinId: string): Promise<{ id: string; name: string; examId: string | null; matrixId: string | null } | null> {
    return this.pins.getPinSummary(pinId);
  }

  async exportMatrixSpecification(actorId: string, matrixId: string, format: string, pinId?: string): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
    return this.generation.exportMatrixSpecification(actorId, matrixId, format, pinId);
  }

  async renderSpecification(spec: MatrixSpecification, format: string): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
    return this.generation.renderSpecification(spec, format);
  }

  async resolveEffectiveSettings(quiz: PinRow, userId: string): Promise<EffectiveQuizSettings> {
    return this.attempts.resolveEffectiveSettings(quiz, userId);
  }

  async currentGradeForUser(quiz: PinRow, userId: string): Promise<number | null> {
    return this.attempts.currentGradeForUser(quiz, userId);
  }

  async getQuizForUser(actorId: string, pinId: string): Promise<{
    quiz: QuizView;
    myAttempts: QuizAttemptSummary[];
    myGrade: number | null;
    canAttempt: boolean;
    attemptBlockedReason: string | null;
    inProgressAttemptId: string | null;
    effective: {
      timeOpen: string | null; timeClose: string | null;
      timeLimitSeconds: number | null; attemptsAllowed: number;
      passwordRequired: boolean; nextAttemptAt: string | null;
    };
    permissions: { manage: boolean; manageOverrides: boolean; grade: boolean; viewReports: boolean; preview: boolean; attempt: boolean };
  }> {
    return this.attempts.getQuizForUser(actorId, pinId);
  }

  async startAttempt(actorId: string, pinId: string, opts: { preview?: boolean; password?: string; clientIp?: string } = {}): Promise<QuizAttemptView> {
    return this.attempts.startAttempt(actorId, pinId, opts);
  }

  async buildAttemptView(quiz: PinRow, row: ExamAttemptRow, closedDueToTimeLimit: boolean, viewerId?: string): Promise<QuizAttemptView> {
    return this.attempts.buildAttemptView(quiz, row, closedDueToTimeLimit, viewerId);
  }

  async getAttemptView(actorId: string, attemptId: string): Promise<QuizAttemptView> {
    return this.attempts.getAttemptView(actorId, attemptId);
  }

  async submitResponse(actorId: string, attemptId: string, input: { questionAttemptId: string; response?: string | null }, clientIp?: string): Promise<QuizAttemptView> {
    return this.attempts.submitResponse(actorId, attemptId, input, clientIp);
  }

  async submitAttempt(actorId: string, attemptId: string): Promise<QuizAttemptView> {
    return this.attempts.submitAttempt(actorId, attemptId);
  }

  async resolvePaperLayout(actorId: string, pinId: string): Promise<{ quiz: PinRow; layout: PaperSlotLayout[] }> {
    return this.generation.resolvePaperLayout(actorId, pinId);
  }

  async recordPaperAttempt(actorId: string, pinId: string, input: {
    studentId: string;
    layout: PaperSlotLayout[];
    responses: (string | null)[];
    scanId: string;
    batchId: string;
    variantCode: string;
  }): Promise<{ attemptId: string; state: string; sumGrades: number | null }> {
    return this.generation.recordPaperAttempt(actorId, pinId, input);
  }

  async getResults(actorId: string, pinId: string): Promise<{
    quiz: QuizView;
    attempts: QuizAttemptSummary[];
    gradesByUser: { userId: string; grade: number | null }[];
    needsGrading: QuizNeedsGradingView[];
    questionStats: QuizQuestionStat[];
    summary: QuizResultsSummary;
  }> {
    return this.attempts.getResults(actorId, pinId);
  }

  async manualGrade(actorId: string, attemptId: string, input: { questionAttemptId: string; mark: number; comment?: string }): Promise<QuizAttemptView> {
    return this.attempts.manualGrade(actorId, attemptId, input);
  }

  async listFeedbacks(actorId: string, pinId: string): Promise<ExamPinFeedbackRow[]> {
    return this.pins.listFeedbacks(actorId, pinId);
  }

  async createFeedback(actorId: string, pinId: string, input: { minPercent: number; maxPercent: number; feedback: string }): Promise<ExamPinFeedbackRow> {
    return this.pins.createFeedback(actorId, pinId, input);
  }

  async deleteFeedback(actorId: string, pinId: string, feedbackId: string): Promise<void> {
    return this.pins.deleteFeedback(actorId, pinId, feedbackId);
  }

  async recordAttemptEvent(actorId: string, attemptId: string, input: { type: string; data?: Record<string, unknown> }): Promise<ExamAttemptEventRow> {
    return this.attempts.recordAttemptEvent(actorId, attemptId, input);
  }

  async listAttemptEvents(actorId: string, attemptId: string): Promise<ExamAttemptEventRow[]> {
    return this.attempts.listAttemptEvents(actorId, attemptId);
  }

  async listQuestionGradingQueue(actorId: string, pinId: string, questionId: string): Promise<{
    attemptId: string; userId: string; displayName: string; attemptNumber: number;
    questionAttemptId: string; slot: number; state: string; response: string | null;
    fraction: number | null; mark: number | null; maxMark: number;
  }[]> {
    return this.attempts.listQuestionGradingQueue(actorId, pinId, questionId);
  }

  async gradeQuestionForAttempts(actorId: string, pinId: string, input: {
    questionId: string;
    grades: { attemptId: string; mark: number; comment?: string }[];
  }): Promise<QuizAttemptSummary[]> {
    return this.attempts.gradeQuestionForAttempts(actorId, pinId, input);
  }

  async listAttemptSummaries(actorId: string, pinId: string): Promise<QuizAttemptSummary[]> {
    return this.attempts.listAttemptSummaries(actorId, pinId);
  }
}
