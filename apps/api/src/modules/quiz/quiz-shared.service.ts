import { forbidden, notFound } from '../../common/http-errors';
import type { QuizAttemptSummary, QuizView } from '@giaokhoa/contracts';
import { TenantContextService } from '../tenants/tenant-context.service';
import { TenantsService } from '../tenants/tenants.service';
import { ContextsService } from '../access/contexts.service';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { QuestionBanksService } from '../questions/question-banks.service';
import {
  QuestionsService,
  type QuestionView,
  type UsageView,
} from '../questions/questions.service';
import {
  QuizRepository,
  type ExamMatrixCellRow,
  type ExamMatrixRow,
  type ExamAttemptRow,
  type ExamPinRow,
} from '@giaokhoa/db/repositories/quiz';
import type { PinRow, EffectiveSlotRow } from './quiz.service';

export const QUIZ_COMPONENT = 'mod_quiz';

export const QUIZ_CAPABILITIES = {
  view: 'quiz:view',
  attempt: 'quiz:attempt',
  manage: 'quiz:manage',
  manageOverrides: 'quiz:manageoverrides',
  viewMatrix: 'matrix:use',
  addMatrix: 'matrix:add',
  manageMatrix: 'matrix:edit',
  grade: 'quiz:grade',
  gradePaper: 'quiz:gradepaper',
  viewReports: 'quiz:viewreports',
  preview: 'quiz:preview',
} as const;


export class QuizSharedService {
  constructor(
    private readonly repo: QuizRepository,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly questions: QuestionsService,
    private readonly banks: QuestionBanksService,
    private readonly tenantContext: TenantContextService,
    private readonly tenants: TenantsService,
  ) {}

  public async matrixTenantId(): Promise<string> {
    return this.tenantContext.currentTenantId() ?? (await this.tenants.fallbackTenantId());
  }


  async getPin(id: string): Promise<PinRow> {
    const row = await this.repo.getPin(id);
    if (!row || row.preparationState !== 'ready') notFound(`Exam pin ${id} not found`, 'exam.pin_not_found');
    return this.enrichPin(row);
  }

  async getPinRow(id: string): Promise<ExamPinRow | undefined> {
    return this.repo.getPin(id);
  }

  public async enrichPin(row: ExamPinRow): Promise<PinRow> {
    const version = await this.repo.getExamVersion(row.examVersionId);
    if (!version) notFound(`Exam version ${row.examVersionId} not found`, 'exam.version_not_found');
    const exam = await this.repo.getExam(row.examId);
    if (!exam) notFound(`Exam ${row.examId} not found`, 'exam.not_found');
    return {
      ...row,
      course: row.courseId,
      grade: version.totalScore,
      tfScale: version.tfScale,
      matrixId: version.matrixId,
      name: row.name ?? version.name,
      examVersionNumber: version.version,
      examStatus: exam.status,
      examLatestVersion: exam.latestVersion,
      sharedSource: exam.sharedExamVersionId && exam.sharedSourceExamId && exam.sharedSourceVersionNumber !== null
        ? { examId: exam.sharedSourceExamId, versionId: exam.sharedExamVersionId, versionNumber: exam.sharedSourceVersionNumber }
        : null,
    };
  }

  async effectiveSlots(pin: PinRow): Promise<EffectiveSlotRow[]> {
    const slots = await this.repo.listExamSlots(pin.examVersionId);
    const pageBySection = new Map<string, number>();
    return slots.map((sl) => {
      if (!pageBySection.has(sl.section)) pageBySection.set(sl.section, pageBySection.size + 1);
      return {
        id: sl.id, pinId: pin.id, slot: sl.position, page: pageBySection.get(sl.section)!,
        sourceDomain: sl.sourceDomain,
        questionId: sl.questionId, categoryId: null, maxMark: sl.maxMark,
        matrixCellId: sl.matrixCellId,
        versionMode: 'pinned' as const,
        pinnedVersionId: sl.pinnedVersionId, pinnedVersionNumber: sl.pinnedVersionNumber,
      };
    });
  }

  public async getAttemptRow(id: string): Promise<ExamAttemptRow> {
    const row = await this.repo.getAttempt(id);
    if (!row) notFound(`Quiz attempt ${id} not found`, 'quiz.attempt_not_found');
    return row;
  }

  public async cmContextId(quiz: PinRow): Promise<string> {
    if (quiz.cmId) {
      const ctx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.MODULE, quiz.cmId);
      if (ctx) return ctx.id;
    }
    const courseCtx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSE, quiz.course);
    if (!courseCtx) notFound(`No context for quiz ${quiz.id}`, 'quiz.context_missing');
    return courseCtx.id;
  }

  public async requireCap(actorId: string, quiz: PinRow, capability: string): Promise<void> {
    await this.evaluator.requireCapability(actorId, capability, await this.cmContextId(quiz));
  }

  public async hasCap(actorId: string, quiz: PinRow, capability: string): Promise<boolean> {
    return this.evaluator.hasCapability(actorId, capability, await this.cmContextId(quiz));
  }

  async pinView(quiz: PinRow, revealSource = false): Promise<QuizView> {
    const slots = await this.effectiveSlots(quiz);
    const slotViews: QuizView['slots'] = [];
    for (const s of slots) {
      const base = {
        id: s.id, pinId: s.pinId, slot: s.slot, page: s.page,
        questionId: !revealSource && quiz.sharedSource && s.sourceDomain === 'bank-system'
          ? null : s.questionId, categoryId: s.categoryId, maxMark: s.maxMark,
        matrixCellId: s.matrixCellId,
        versionMode: null as 'pinned' | 'follow_latest' | null,
        pinnedVersion: null as number | null,
        latestVersion: null as number | null,
        hasNewerVersion: false,
        bankId: null as string | null,
        bankName: null as string | null,
        bankScope: null as string | null,
        questionStatus: null as string | null,
      };
      if (s.sourceDomain === 'bank-system') {
        base.versionMode = 'pinned';
        base.pinnedVersion = s.pinnedVersionNumber;
        base.bankScope = 'system';
        base.questionStatus = 'published';
      } else if (s.questionId) {
        const info = await this.banks.getQuestionBankInfo(s.questionId);
        base.versionMode = s.versionMode === 'pinned' ? 'pinned' : 'follow_latest';
        base.pinnedVersion = s.versionMode === 'pinned' ? s.pinnedVersionNumber : null;
        base.latestVersion = info?.latestReadyVersionNumber ?? info?.latestVersion ?? null;
        base.hasNewerVersion = s.versionMode === 'pinned'
          && s.pinnedVersionNumber !== null
          && base.latestVersion !== null
          && base.latestVersion > s.pinnedVersionNumber;
        base.bankId = info?.bank?.id ?? null;
        base.bankName = info?.bank?.name ?? null;
        base.bankScope = info?.bank?.scope ?? null;
        base.questionStatus = info?.entryStatus ?? null;
      }
      slotViews.push(base);
    }
    return {
      id: quiz.id,
      courseId: quiz.course,
      cmId: quiz.cmId,
      name: quiz.name,
      intro: quiz.intro,
      timeOpen: quiz.timeOpen?.toISOString() ?? null,
      timeClose: quiz.timeClose?.toISOString() ?? null,
      timeLimitSeconds: quiz.timeLimit,
      attemptsAllowed: quiz.attemptsAllowed,
      gradeMethod: (['highest', 'average', 'first', 'last'].includes(quiz.gradeMethod) ? quiz.gradeMethod : 'highest') as QuizView['gradeMethod'],
      grade: quiz.grade,
      shuffleAnswers: quiz.shuffleAnswers,
      targetGroupId: quiz.targetGroupId,
      hasPassword: quiz.passwordHash !== null,
      subnet: quiz.subnet,
      reviewAttempt: quiz.reviewAttempt,
      reviewCorrectness: quiz.reviewCorrectness,
      reviewMarks: quiz.reviewMarks,
      reviewSpecificFeedback: quiz.reviewSpecificFeedback,
      reviewGeneralFeedback: quiz.reviewGeneralFeedback,
      reviewRightAnswer: quiz.reviewRightAnswer,
      reviewOverallFeedback: quiz.reviewOverallFeedback,
      matrixId: quiz.matrixId,
      examId: quiz.examId,
      examVersionId: quiz.examVersionId,
      examVersionNumber: quiz.examVersionNumber,
      latestExamVersionNumber: quiz.examLatestVersion,
      ...(revealSource ? { sharedSource: quiz.sharedSource } : {}),
      hasNewerExamVersion: quiz.examStatus === 'ready' && quiz.examLatestVersion > quiz.examVersionNumber,
      versionMode: quiz.versionMode === 'float_latest_ready' ? 'float_latest_ready' as const : 'pinned' as const,
      tfScale: quiz.tfScale,
      preset: (quiz.preset as QuizView['preset']) ?? null,
      lateEntryMinutes: quiz.lateEntryMinutes,
      monitorEvents: quiz.monitorEvents,
      slots: slotViews,
      sumGrades: slots.reduce((sum, s) => sum + s.maxMark, 0),
      variants: quiz.variants ?? [],
    };
  }

  public maskSourceQuestionIds(quiz: PinRow, summary: QuizAttemptSummary): QuizAttemptSummary {
    if (!quiz.sharedSource || !summary.appliedSettings) return summary;
    const { questionOrder: _questionOrder, ...appliedSettings } = summary.appliedSettings;
    return { ...summary, appliedSettings };
  }

  public usageTotalMax(usage: UsageView): number {
    return usage.attempts.reduce((sum, a) => sum + a.maxMark, 0);
  }

  public attemptGradeValue(quiz: PinRow, row: ExamAttemptRow, totalMax: number): number | null {
    if (row.sumGrades === null || totalMax <= 0) return null;
    return (row.sumGrades / totalMax) * quiz.grade;
  }

  public async attemptSummary(quiz: PinRow, row: ExamAttemptRow): Promise<QuizAttemptSummary> {
    let totalMax: number | null = null;
    if (row.sumGrades !== null) {
      const totals = await this.questions.usageTotalMaxes([row.usageId]);
      totalMax = totals.get(row.usageId) ?? 0;
    }
    return this.buildAttemptSummary(quiz, row, totalMax);
  }

  public async attemptSummaries(quiz: PinRow, rows: ExamAttemptRow[]): Promise<QuizAttemptSummary[]> {
    const gradedRows = rows.filter((r) => r.sumGrades !== null);
    const totals = gradedRows.length
      ? await this.questions.usageTotalMaxes(gradedRows.map((r) => r.usageId))
      : new Map<string, number>();
    return rows.map((row) => this.buildAttemptSummary(
      quiz, row, row.sumGrades !== null ? (totals.get(row.usageId) ?? 0) : null,
    ));
  }

  private buildAttemptSummary(quiz: PinRow, row: ExamAttemptRow, totalMax: number | null): QuizAttemptSummary {
    const grade = totalMax === null ? null : this.attemptGradeValue(quiz, row, totalMax);
    return {
      id: row.id, pinId: row.pinId, userId: row.userId, attemptNumber: row.attemptNumber,
      usageId: row.usageId, state: row.state, preview: row.preview,
      timeStart: row.timeStart.toISOString(), timeFinish: row.timeFinish?.toISOString() ?? null,
      sumGrades: row.sumGrades, grade,
      makeup: row.makeup,
      appliedSettings: row.appliedSettings ?? null,
    };
  }

  public syncFromUsage(usage: UsageView): { sumGrades: number; pendingManual: number } {
    let sum = 0;
    let pending = 0;
    for (const a of usage.attempts) {
      if (a.state === 'needsgrading') pending += 1;
      else if (a.fraction !== null && a.fraction !== undefined) sum += a.fraction * a.maxMark;
    }
    return { sumGrades: sum, pendingManual: pending };
  }

  public async getMatrixRow(id: string): Promise<ExamMatrixRow> {
    const row = await this.repo.getMatrix(id);
    if (!row) notFound(`Exam matrix ${id} not found`, 'quiz.matrix_not_found');
    return row;
  }

  public async requireMatrixCap(actorId: string, matrix: ExamMatrixRow, capability: string): Promise<void> {
    if (matrix.bankId) {
      const bank = await this.banks.findBankById(matrix.bankId);
      if (bank) {
        if (await this.banks.isForeignPersonalBank(actorId, bank)) {
          notFound(`Exam matrix ${matrix.id} not found`, 'quiz.matrix_not_found');
        }
        await this.banks.syncBankMembership(bank);
        const caps = await this.banks.bankLocalMatrixCaps(actorId, bank);
        const ok = capability === QUIZ_CAPABILITIES.viewMatrix ? caps.view
          : capability === QUIZ_CAPABILITIES.addMatrix ? caps.add
          : caps.manage;
        if (!ok) {
          forbidden(`Missing capability ${capability} in matrix bank ${bank.id}`, 'access.capability_denied');
        }
        return;
      }
    }
    await this.evaluator.requireCapability(actorId, capability, matrix.contextId);
  }

  public async cellCandidates(cell: Pick<ExamMatrixCellRow, 'curriculumNodeId' | 'cognitiveLevel' | 'qtype'>): Promise<QuestionView[]> {
    return this.questions.listQuestionsByCurriculumFilter({
      nodeId: cell.curriculumNodeId, cognitiveLevel: cell.cognitiveLevel,
      qtype: cell.qtype, status: 'ready',
    });
  }

  public async cellCandidatesForUser(actorId: string, cell: Pick<ExamMatrixCellRow, 'curriculumNodeId' | 'cognitiveLevel' | 'qtype'>): Promise<QuestionView[]> {
    const all = await this.cellCandidates(cell);
    const out: QuestionView[] = [];
    const usableByContext = new Map<string, boolean>();
    for (const view of all) {
      const category = await this.questions.getCategory(view.entry.questionCategoryId);
      let usable = usableByContext.get(category.contextId);
      if (usable === undefined) {
        usable = await this.evaluator.hasCapability(actorId, 'question:useall', category.contextId);
        usableByContext.set(category.contextId, usable);
      }
      if (usable) out.push(view);
    }
    return out;
  }

  public async cellCandidateCountForUser(actorId: string, cell: Pick<ExamMatrixCellRow, 'curriculumNodeId' | 'cognitiveLevel' | 'qtype'>): Promise<number> {
    const groups = await this.questions.countQuestionsByCurriculumFilterByCategory({
      nodeId: cell.curriculumNodeId, cognitiveLevel: cell.cognitiveLevel,
      qtype: cell.qtype, status: 'ready',
    });
    let total = 0;
    const usableByContext = new Map<string, boolean>();
    for (const group of groups) {
      const category = await this.questions.getCategory(group.categoryId);
      let usable = usableByContext.get(category.contextId);
      if (usable === undefined) {
        usable = await this.evaluator.hasCapability(actorId, 'question:useall', category.contextId);
        usableByContext.set(category.contextId, usable);
      }
      if (usable) total += group.count;
    }
    return total;
  }


  public async requireAnyViewCap(actorId: string, quiz: PinRow): Promise<void> {
    const ctx = await this.cmContextId(quiz);
    for (const cap of [QUIZ_CAPABILITIES.view, QUIZ_CAPABILITIES.attempt, QUIZ_CAPABILITIES.manage, QUIZ_CAPABILITIES.grade, QUIZ_CAPABILITIES.viewReports, QUIZ_CAPABILITIES.preview]) {
      if (await this.evaluator.hasCapability(actorId, cap, ctx)) return;
    }
    await this.evaluator.requireCapability(actorId, QUIZ_CAPABILITIES.view, ctx);
  }

  public async requireAttemptReadable(actorId: string, quiz: PinRow, row: ExamAttemptRow): Promise<void> {
    if (row.userId === actorId) return;
    const ctx = await this.cmContextId(quiz);
    for (const cap of [QUIZ_CAPABILITIES.grade, QUIZ_CAPABILITIES.viewReports, QUIZ_CAPABILITIES.manage]) {
      if (await this.evaluator.hasCapability(actorId, cap, ctx)) return;
    }
    forbidden('This attempt belongs to another user', 'quiz.attempt_forbidden');
  }
}
