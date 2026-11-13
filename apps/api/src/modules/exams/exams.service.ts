import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  ApproveExamContribution, CopyExam, CreateExam, CreateExamContribution,
  CreateExamPin, ExamSlotInput, GenerateFromMatrix, QuizView,
  RejectExamContribution, SetExamSlots, SetExamStatus, SwapExamSlot, UpdateExam,
  WithdrawExam,
} from '@giaokhoa/contracts';
import { OutboxService } from '../../infra/events/outbox.service';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { RolesService } from '../access/roles.service';
import { CAP_ALLOW } from '../access/domain/permission';
import { QuestionBanksService, QBANK_LEAD_ROLE, QBANK_MEMBER_ROLE } from '../questions/question-banks.service';
import type { QuestionBankRow } from '@giaokhoa/db/repositories/question-banks';
import { ExamQuestionSnapshotsService } from '../quiz/exam-question-snapshots.service';
import { QuizService, type MatrixSpecification } from '../quiz/quiz.service';
import { SiteConfigService } from '../site-config/site-config.service';
import { TenantConfigService } from '../tenants/tenant-config.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import {
  ExamsRepository,
  type ExamContributionRow, type ExamRow, type ExamSlotRow, type ExamVersionRow,
} from '@giaokhoa/db/repositories/exams';

export const EXAM_CAPABILITIES = {
  view: 'exam:use',
  add: 'exam:add',
  edit: 'exam:edit',
  copy: 'exam:copy',
  share: 'exam:share',
  moderate: 'exam:moderate',
  deploy: 'exam:deploy',
} as const;

export const PERIODIC_EXAM_KINDS = ['midterm', 'final', 'mock'] as const;

export function examPaperContentHash(version: ExamVersionRow, slots: ExamSlotRow[]): string {
  const body = slots
    .map((s) => `${s.questionId}@${s.pinnedVersionNumber ?? 0}:${s.maxMark}`)
    .join('|');
  return createHash('sha256').update(`${version.name}::${body}`).digest('hex');
}

const MEMBER_EXAM_CAPS = [EXAM_CAPABILITIES.view, EXAM_CAPABILITIES.copy];
const LEAD_EXAM_CAPS = [
  EXAM_CAPABILITIES.view, EXAM_CAPABILITIES.add, EXAM_CAPABILITIES.edit, EXAM_CAPABILITIES.copy,
  EXAM_CAPABILITIES.share, EXAM_CAPABILITIES.moderate, EXAM_CAPABILITIES.deploy,
];

export interface ExamCapabilitiesView {
  view: boolean; add: boolean; edit: boolean; copy: boolean; share: boolean; moderate: boolean; deploy: boolean;
}

export interface ExamSlotView {
  position: number;
  section: string;
  questionId: string;
  sourceDomain: string;
  questionName: string | null;
  qtype: string | null;
  entryStatus: string | null;
  pinnedVersionId: string | null;
  pinnedVersionNumber: number | null;
  latestReadyVersionNumber: number | null;
  hasNewerVersion: boolean;
  maxMark: number;
  clusterId: string | null;
  matrixCellId: string | null;
}



export interface ExamView {
  paper: {
    id: string; bankId: string; kind: string; status: string;
    derivedFromExamId: string | null; derivedFromMatrixId: string | null;
    originalAuthorId: string | null; createdBy: string;
    latestVersion: number; copyCount: number;
    withdrawnReason: string | null; withdrawnBy: string | null; withdrawnAt: string | null;
    createdAt: string; updatedAt: string;
  };
  version: {
    id: string; version: number; name: string;
    subjectId: string | null; grade: number | null; examKind: string | null;
    totalScore: number; durationMinutes: number | null;
    tfScale: number[] | null; matrixId: string | null; matrixVersion: number | null;
    createdBy: string; createdAt: string;
  };
  slots: ExamSlotView[];
  attribution: { derivedFromExamId: string; originalAuthorId: string | null; sourceBankId: string; derivedFromVersionNumber: number | null } | null;
  capabilities: ExamCapabilitiesView;
}

export interface ExamPinSummary {
  id: string; courseId: string; courseName: string;
  examVersionId: string; versionNumber: number;
  name: string | null; variantCount: number; variantCodes: string[]; targetGroupId: string | null;
  createdAt: string;
}

export interface ExamSummary {
  id: string; bankId: string; kind: string; status: string;
  name: string; examKind: string | null; grade: number | null; subjectId: string | null;
  slotCount: number; totalScore: number; durationMinutes: number | null;
  latestVersion: number; createdBy: string;
  originalAuthorId: string | null; derivedFromExamId: string | null;
  copyCount: number; updatedAt: string;
  withdrawnReason: string | null; withdrawnBy: string | null; withdrawnAt: string | null;
  capabilities: ExamCapabilitiesView;
}

export interface ExamContributionReviewView {
  id: string;
  contributionId: string;
  level: number;
  reviewerId: string;
  reviewerName: string | null;
  decision: 'approved' | 'rejected';
  reason: string | null;
  createdAt: string;
}

export interface ExamContributionView extends ExamContributionRow {
  paperName: string | null;
  sourceBankId: string | null;
  reviews: ExamContributionReviewView[];
}

@Injectable()
export class ExamsService {
  constructor(
    private readonly snapshots: ExamQuestionSnapshotsService,
    private readonly repo: ExamsRepository,
    private readonly banks: QuestionBanksService,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly roles: RolesService,
    private readonly quiz: QuizService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantConfig: TenantConfigService,
    private readonly siteConfig: SiteConfigService,
  ) {}


  private async ensureExamGrants(bank: QuestionBankRow): Promise<void> {
    if (bank.bankKind !== 'exam') return;
    const [member, lead] = await Promise.all([
      this.roles.getRoleByShortname(QBANK_MEMBER_ROLE),
      this.roles.getRoleByShortname(QBANK_LEAD_ROLE),
    ]);
    if (member) {
      for (const cap of MEMBER_EXAM_CAPS) {
        await this.roles.setCapabilityOverride(member.id, cap, bank.contextId, CAP_ALLOW);
      }
    }
    if (lead) {
      for (const cap of LEAD_EXAM_CAPS) {
        await this.roles.setCapabilityOverride(lead.id, cap, bank.contextId, CAP_ALLOW);
      }
    }
  }

  async getExamBank(actorId: string, bankId: string): Promise<QuestionBankRow> {
    const view = await this.banks.getBank(actorId, bankId);
    if (view.bankKind !== 'exam') {
      throw new NotFoundException({ message: `Bank ${bankId} is not an exam bank`, code: 'exam.not_exam_bank' });
    }
    const bank: QuestionBankRow = view;
    await this.ensureExamGrants(bank);
    return bank;
  }

  async boardApprovalRequiredForBank(bank: QuestionBankRow): Promise<boolean> {
    if (bank.tenantId) {
      return (await this.tenantConfig.getEffectiveValue<boolean>(bank.tenantId, 'exam', 'requireboardapproval')) ?? false;
    }
    return (await this.siteConfig.getValue<boolean>('exam', 'requireboardapproval')) ?? false;
  }

  async bankOfPaper(paper: ExamRow): Promise<QuestionBankRow> {
    const bank = await this.banks.getBankOrThrow(paper.bankId);
    await this.ensureExamGrants(bank);
    return bank;
  }

  private async capabilitiesAt(actorId: string, bank: QuestionBankRow): Promise<ExamCapabilitiesView> {
    const at = (cap: string) => this.evaluator.hasCapability(actorId, cap, bank.contextId);
    const [view, add, edit, copy, share, moderate, deploy] = await Promise.all([
      at(EXAM_CAPABILITIES.view), at(EXAM_CAPABILITIES.add), at(EXAM_CAPABILITIES.edit), at(EXAM_CAPABILITIES.copy),
      at(EXAM_CAPABILITIES.share), at(EXAM_CAPABILITIES.moderate), at(EXAM_CAPABILITIES.deploy),
    ]);
    return { view, add, edit, copy, share, moderate, deploy };
  }

  private async assertCanViewPaper(actorId: string, paper: ExamRow, bank: QuestionBankRow): Promise<void> {
    if ((await this.evaluator.isSiteAdmin(actorId))) return;
    if (paper.status === 'ready') {
      await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.view, bank.contextId);
      return;
    }
    if (paper.createdBy === actorId) return;
    await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.moderate, bank.contextId);
  }


  private async periodicSchoolVersion(paper: ExamRow, bank: QuestionBankRow): Promise<ExamVersionRow | null> {
    if (bank.scope !== 'school' || paper.status !== 'ready') return null;
    const version = await this.currentVersion(paper);
    if (!version.examKind || !(PERIODIC_EXAM_KINDS as readonly string[]).includes(version.examKind)) return null;
    return version;
  }

  async assertCanViewPaperContent(actorId: string, paper: ExamRow, bank: QuestionBankRow): Promise<void> {
    await this.assertCanViewPaper(actorId, paper, bank);
    const version = await this.periodicSchoolVersion(paper, bank);
    if (!version) return;
    if (await this.evaluator.isSiteAdmin(actorId)) return;
    if (paper.createdBy === actorId) return;
    if (await this.evaluator.hasCapability(actorId, EXAM_CAPABILITIES.moderate, bank.contextId)) return;
    if (version.grade !== null && await this.repo.userTeachesGrade(actorId, version.grade)) return;
    throw new ForbiddenException({
      message: 'Periodic exam content in the school bank is restricted to teachers of its grade and bank moderators',
      code: 'exam.periodic_view_forbidden',
    });
  }

  async auditPaperContentView(actorId: string, paper: ExamRow, bank: QuestionBankRow, surface: string): Promise<void> {
    const version = await this.periodicSchoolVersion(paper, bank);
    if (!version) return;
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_content_viewed',
      payload: {
        examId: paper.id, examVersionId: version.id, paperVersion: version.version,
        bankId: bank.id, examKind: version.examKind, grade: version.grade, surface, actorId,
      },
    });
  }

  async assertCanEditPaper(actorId: string, paper: ExamRow, bank: QuestionBankRow): Promise<void> {
    if (await this.evaluator.isSiteAdmin(actorId)) return;
    await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.edit, bank.contextId);
    if (paper.createdBy === actorId) return;
    const moderate = await this.evaluator.hasCapability(actorId, EXAM_CAPABILITIES.moderate, bank.contextId);
    if (!moderate) {
      throw new ForbiddenException({
        message: 'Only the paper author or a bank moderator can modify this paper',
        code: 'exam.edit_not_owner',
      });
    }
  }

  async getPaperOrThrow(id: string): Promise<ExamRow> {
    const paper = await this.repo.getPaper(id);
    if (!paper) throw new NotFoundException({ message: `Exam paper ${id} not found`, code: 'exam.not_found' });
    return paper;
  }

  async currentVersion(paper: ExamRow): Promise<ExamVersionRow> {
    const version = await this.repo.getVersionByNumber(paper.id, paper.latestVersion);
    if (!version) throw new NotFoundException({ message: `Paper ${paper.id} has no version ${paper.latestVersion}`, code: 'exam.version_not_found' });
    return version;
  }


  private async resolveSlots(actorId: string, slots: ExamSlotInput[]): Promise<Omit<import('@giaokhoa/db/repositories/exams').NewExamSlot, 'examVersionId' | 'position'>[]> {
    const resolved = [];
    for (const s of slots) {
      if (s.sourceDomain === 'bank-system') {
        if (!s.sourceVersionNumber) throw new BadRequestException({ code: 'exam.source_version_required' });
        const snapshot = await this.snapshots.readSystem(actorId, s.questionId, s.sourceVersionNumber);
        resolved.push({ questionId: s.questionId, sourceDomain: 'bank-system', sourceSnapshot: snapshot,
          pinnedVersionId: snapshot.versionId, pinnedVersionNumber: snapshot.versionNumber,
          maxMark: s.maxMark ?? snapshot.defaultMark, section: s.section ?? '', clusterId: null });
        continue;
      }
      if (!(await this.repo.questionExists(s.questionId))) {
        throw new NotFoundException({ message: `Question ${s.questionId} not found`, code: 'exam.slot_question_not_found' });
      }
      const ready = await this.repo.resolveReadyVersion(s.questionId);
      if (!ready) throw new BadRequestException({ code: 'exam.slot_question_not_ready' });
      await this.snapshots.readLocal(actorId, s.questionId, ready.versionId);
      resolved.push({ questionId: s.questionId, pinnedVersionId: ready.versionId,
        pinnedVersionNumber: ready.versionNumber, maxMark: s.maxMark ?? ready.defaultMark,
        section: s.section ?? '', clusterId: null });
    }
    return resolved;
  }

  private paperContentHash(version: ExamVersionRow, slots: ExamSlotRow[]): string {
    return examPaperContentHash(version, slots);
  }


  private async slotViews(slots: ExamSlotRow[]): Promise<ExamSlotView[]> {
    const questionIds = [...new Set(slots.filter((s) => s.sourceDomain !== 'bank-system').map((s) => s.questionId))];
    const [infos, statuses] = await Promise.all([
      this.repo.listSlotQuestionInfo(questionIds),
      this.repo.listQuestionEntryStatuses(questionIds),
    ]);
    const infoById = new Map(infos.map((i) => [i.questionId, i]));
    const statusById = new Map(statuses.map((s) => [s.questionId, s.status]));
    const bankInfos = await this.banks.getQuestionBankInfos(questionIds).catch(() => null);
    const latestReadyById = new Map<string, number | null>();
    for (const questionId of questionIds) {
      latestReadyById.set(questionId, bankInfos?.get(questionId)?.latestReadyVersionNumber ?? null);
    }
    return slots.map((s) => {
      const latestReadyVersionNumber = latestReadyById.get(s.questionId) ?? null;
      return {
        position: s.position,
        section: s.section,
        questionId: s.questionId,
        sourceDomain: s.sourceDomain,
        questionName: s.sourceSnapshot ? this.snapshots.excerpt(s.sourceSnapshot) : infoById.get(s.questionId)?.name ?? null,
        qtype: s.sourceSnapshot?.qtype ?? infoById.get(s.questionId)?.qtype ?? null,
        entryStatus: s.sourceDomain === 'bank-system' ? 'published' : statusById.get(s.questionId) ?? null,
        pinnedVersionId: s.pinnedVersionId,
        pinnedVersionNumber: s.pinnedVersionNumber,
        latestReadyVersionNumber,
        hasNewerVersion: s.pinnedVersionNumber !== null
          && latestReadyVersionNumber !== null
          && latestReadyVersionNumber > s.pinnedVersionNumber,
        maxMark: s.maxMark,
        clusterId: s.clusterId,
        matrixCellId: s.matrixCellId,
      };
    });
  }

  async paperView(actorId: string, paper: ExamRow): Promise<ExamView> {
    const bank = await this.bankOfPaper(paper);
    const version = await this.currentVersion(paper);
    const slots = await this.repo.listSlots(version.id);
    const caps = await this.capabilitiesAt(actorId, bank);
    const canEdit = caps.edit && (paper.createdBy === actorId || caps.moderate);
    let attribution: ExamView['attribution'] = null;
    if (paper.derivedFromExamId) {
      const source = await this.repo.getPaper(paper.derivedFromExamId);
      attribution = {
        derivedFromExamId: paper.derivedFromExamId,
        originalAuthorId: paper.originalAuthorId,
        sourceBankId: paper.derivedFromBankId ?? source?.bankId ?? paper.bankId,
        derivedFromVersionNumber: paper.derivedFromVersionNumber,
      };
    }
    return {
      paper: {
        id: paper.id, bankId: paper.bankId, kind: paper.kind, status: paper.status,
        derivedFromExamId: paper.derivedFromExamId, derivedFromMatrixId: paper.derivedFromMatrixId,
        originalAuthorId: paper.originalAuthorId, createdBy: paper.createdBy,
        latestVersion: paper.latestVersion, copyCount: paper.copyCount,
        withdrawnReason: paper.withdrawnReason, withdrawnBy: paper.withdrawnBy,
        withdrawnAt: paper.withdrawnAt?.toISOString() ?? null,
        createdAt: paper.createdAt.toISOString(), updatedAt: paper.updatedAt.toISOString(),
      },
      version: {
        id: version.id, version: version.version, name: version.name,
        subjectId: version.subjectId, grade: version.grade, examKind: version.examKind,
        totalScore: version.totalScore, durationMinutes: version.durationMinutes,
        tfScale: version.tfScale, matrixId: version.matrixId, matrixVersion: version.matrixVersion,
        createdBy: version.createdBy, createdAt: version.createdAt.toISOString(),
      },
      slots: await this.slotViews(slots),
      attribution,
      capabilities: { ...caps, edit: canEdit },
    };
  }


  async listPapers(actorId: string, bankId: string): Promise<ExamSummary[]> {
    const bank = await this.getExamBank(actorId, bankId);
    await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.view, bank.contextId);
    const caps = await this.capabilitiesAt(actorId, bank);
    const isAdmin = await this.evaluator.isSiteAdmin(actorId);
    const papers = await this.repo.listPapersInBank(bank.id);
    const summaries: ExamSummary[] = [];
    for (const paper of papers) {
      const visible = isAdmin || paper.status === 'ready' || paper.createdBy === actorId || caps.moderate;
      if (!visible) continue;
      const version = await this.currentVersion(paper);
      const slots = await this.repo.listSlots(version.id);
      summaries.push({
        id: paper.id, bankId: paper.bankId, kind: paper.kind, status: paper.status,
        name: version.name, examKind: version.examKind, grade: version.grade, subjectId: version.subjectId,
        slotCount: slots.length, totalScore: version.totalScore, durationMinutes: version.durationMinutes,
        latestVersion: paper.latestVersion, createdBy: paper.createdBy,
        originalAuthorId: paper.originalAuthorId, derivedFromExamId: paper.derivedFromExamId,
        copyCount: paper.copyCount, updatedAt: paper.updatedAt.toISOString(),
        withdrawnReason: paper.withdrawnReason, withdrawnBy: paper.withdrawnBy,
        withdrawnAt: paper.withdrawnAt?.toISOString() ?? null,
        capabilities: { ...caps, edit: caps.edit && (paper.createdBy === actorId || caps.moderate) },
      });
    }
    return summaries;
  }

  async getPaper(actorId: string, paperId: string): Promise<ExamView> {
    const paper = await this.getPaperOrThrow(paperId);
    const activeTenant = this.tenantContext.currentTenantId();
    if (activeTenant !== undefined && paper.tenantId !== null && paper.tenantId !== activeTenant) {
      throw new NotFoundException({ message: `Exam paper ${paperId} not found`, code: 'exam.not_found' });
    }
    const bank = await this.bankOfPaper(paper);
    await this.assertCanViewPaperContent(actorId, paper, bank);
    const view = await this.paperView(actorId, paper);
    await this.auditPaperContentView(actorId, paper, bank, 'detail');
    return view;
  }

  async listPins(actorId: string, paperId: string): Promise<ExamPinSummary[]> {
    const paper = await this.getPaperOrThrow(paperId);
    const bank = await this.bankOfPaper(paper);
    await this.assertCanViewPaperContent(actorId, paper, bank);
    const rows = await this.repo.listPinsOfExam(paperId);
    return rows.map((r) => ({
      id: r.id, courseId: r.courseId, courseName: r.courseName,
      examVersionId: r.examVersionId, versionNumber: r.versionNumber,
      name: r.name, variantCount: r.variantCount, variantCodes: (r.variants ?? []).map((v) => v.code),
      targetGroupId: r.targetGroupId, createdAt: r.createdAt.toISOString(),
    }));
  }

  async createPaper(actorId: string, bankId: string, input: CreateExam,
    pinRequest?: { courseId: string; requestId: string }): Promise<ExamView> {
    const bank = await this.getExamBank(actorId, bankId);
    await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.add, bank.contextId);
    const slots = await this.resolveSlots(actorId, input.slots ?? []);
    let paper: ExamRow | undefined;
    await this.repo.transaction(async (tx) => {
      paper = await this.repo.insertPaper({
        tenantId: bank.tenantId, bankId: bank.id, kind: 'snapshot', status: 'draft', createdBy: actorId, latestVersion: 1,
        ...(pinRequest ? { pinRequestId: pinRequest.requestId, pinRequestCourseId: pinRequest.courseId } : {}),
        derivedFromMatrixId: input.matrixId ?? null,
      }, tx);
      const version = await this.repo.insertVersion({
        examId: paper.id, version: 1, name: input.name,
        subjectId: input.subjectId ?? null, grade: input.grade ?? null,
        examKind: input.examKind ?? null, totalScore: input.totalScore ?? 10,
        durationMinutes: input.durationMinutes ?? null, tfScale: input.tfScale ?? null,
        matrixId: input.matrixId ?? null, matrixVersion: null, createdBy: actorId,
      }, tx);
      await this.repo.insertSlots(slots.map((s, i) => ({ examVersionId: version.id, position: i + 1, ...s })), tx);
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_created',
      payload: { paperId: paper!.id, bankId: bank.id, actorId },
    });
    return this.paperView(actorId, paper!);
  }

  async updatePaper(actorId: string, paperId: string, input: UpdateExam): Promise<ExamView> {
    const paper = await this.getPaperOrThrow(paperId);
    const bank = await this.bankOfPaper(paper);
    await this.assertCanEditPaper(actorId, paper, bank);
    const current = await this.currentVersion(paper);
    const currentSlots = await this.repo.listSlots(current.id);
    const next = paper.latestVersion + 1;
    await this.repo.transaction(async (tx) => {
      const version = await this.repo.insertVersion({
        examId: paper.id, version: next,
        name: input.name ?? current.name,
        subjectId: input.subjectId !== undefined ? input.subjectId : current.subjectId,
        grade: input.grade !== undefined ? input.grade : current.grade,
        examKind: input.examKind !== undefined ? input.examKind : current.examKind,
        totalScore: input.totalScore ?? current.totalScore,
        durationMinutes: input.durationMinutes !== undefined ? input.durationMinutes : current.durationMinutes,
        tfScale: input.tfScale !== undefined ? input.tfScale : current.tfScale,
        matrixId: input.matrixId !== undefined ? input.matrixId : current.matrixId,
        matrixVersion: current.matrixVersion,
        matrixVersionId: input.matrixId !== undefined && input.matrixId !== current.matrixId ? null : current.matrixVersionId,
        createdBy: actorId,
      }, tx);
      await this.repo.insertSlots(currentSlots.map((s) => ({
        examVersionId: version.id, position: s.position, section: s.section,
        sourceDomain: s.sourceDomain, sourceSnapshot: s.sourceSnapshot,
        questionId: s.questionId, pinnedVersionId: s.pinnedVersionId,
        pinnedVersionNumber: s.pinnedVersionNumber, maxMark: s.maxMark, clusterId: s.clusterId,
        matrixCellId: s.matrixCellId,
      })), tx);
      await this.repo.updatePaper(paper.id, { latestVersion: next }, tx);
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_updated',
      payload: { examId: paper.id, bankId: bank.id, version: next, actorId },
    });
    return this.paperView(actorId, (await this.repo.getPaper(paper.id))!);
  }

  async setSlots(actorId: string, paperId: string, input: SetExamSlots): Promise<ExamView> {
    const paper = await this.getPaperOrThrow(paperId);
    const bank = await this.bankOfPaper(paper);
    await this.assertCanEditPaper(actorId, paper, bank);
    const current = await this.currentVersion(paper);
    const slots = await this.resolveSlots(actorId, input.slots);
    const next = paper.latestVersion + 1;
    await this.repo.transaction(async (tx) => {
      const version = await this.repo.insertVersion({
        examId: paper.id, version: next, name: current.name,
        subjectId: current.subjectId, grade: current.grade, examKind: current.examKind,
        totalScore: current.totalScore, durationMinutes: current.durationMinutes,
        tfScale: current.tfScale, matrixId: current.matrixId,
        matrixVersion: current.matrixVersion, matrixVersionId: current.matrixVersionId, createdBy: actorId,
      }, tx);
      await this.repo.insertSlots(slots.map((s, i) => ({ examVersionId: version.id, position: i + 1, ...s })), tx);
      await this.repo.updatePaper(paper.id, { latestVersion: next }, tx);
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_slots_set',
      payload: { examId: paper.id, bankId: bank.id, version: next, slotCount: slots.length, actorId },
    });
    return this.paperView(actorId, (await this.repo.getPaper(paper.id))!);
  }

  async setStatus(actorId: string, paperId: string, input: SetExamStatus): Promise<ExamView> {
    const paper = await this.getPaperOrThrow(paperId);
    const bank = await this.bankOfPaper(paper);
    await this.assertCanEditPaper(actorId, paper, bank);
    if (paper.withdrawnAt && input.status !== paper.status) {
      throw new ConflictException({
        message: 'Paper is withdrawn; restore it before changing its status',
        code: 'exam.status_withdrawn',
      });
    }
    if (input.status === 'ready') {
      const version = await this.currentVersion(paper);
      const slots = await this.repo.listSlots(version.id);
      if (slots.length === 0) {
        throw new BadRequestException({
          message: 'A paper needs at least one question before it can be marked ready',
          code: 'exam.ready_requires_slots',
        });
      }
    }
    await this.repo.updatePaper(paper.id, { status: input.status });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_status_changed',
      payload: { examId: paper.id, bankId: bank.id, status: input.status, actorId },
    });
    return this.paperView(actorId, (await this.repo.getPaper(paper.id))!);
  }

  async withdrawPaper(actorId: string, paperId: string, input: WithdrawExam): Promise<{ examId: string; status: string; affectedPinIds: string[] }> {
    const paper = await this.getPaperOrThrow(paperId);
    const bank = await this.bankOfPaper(paper);
    await this.assertCanEditPaper(actorId, paper, bank);
    if (paper.status === 'hidden') {
      throw new ConflictException({ message: 'Paper is already withdrawn', code: 'exam.already_withdrawn' });
    }
    const pins = await this.repo.listPinsOfExam(paper.id);
    await this.repo.updatePaper(paper.id, {
      status: 'hidden',
      withdrawnReason: input.reason,
      withdrawnBy: actorId,
      withdrawnAt: new Date(),
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_withdrawn',
      payload: {
        examId: paper.id, bankId: bank.id, actorId, reason: input.reason,
        affectedPinIds: pins.map((p) => p.id),
      },
    });
    return { examId: paper.id, status: 'hidden', affectedPinIds: pins.map((p) => p.id) };
  }

  async restorePaper(actorId: string, paperId: string): Promise<{ examId: string; status: string }> {
    const paper = await this.getPaperOrThrow(paperId);
    const bank = await this.bankOfPaper(paper);
    await this.assertCanEditPaper(actorId, paper, bank);
    if (paper.status !== 'hidden') {
      throw new ConflictException({ message: 'Paper is not withdrawn', code: 'exam.not_withdrawn' });
    }
    await this.repo.updatePaper(paper.id, {
      status: 'ready', withdrawnReason: null, withdrawnBy: null, withdrawnAt: null,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_restored',
      payload: { examId: paper.id, bankId: bank.id, actorId },
    });
    return { examId: paper.id, status: 'ready' };
  }

  async deletePaper(actorId: string, paperId: string): Promise<{ id: string; deleted: true }> {
    const paper = await this.getPaperOrThrow(paperId);
    const bank = await this.bankOfPaper(paper);
    await this.assertCanEditPaper(actorId, paper, bank);
    await this.repo.deletePaper(paper.id);
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_deleted',
      payload: { examId: paper.id, bankId: bank.id, actorId },
    });
    return { id: paper.id, deleted: true };
  }


  async copyPaper(actorId: string, paperId: string, input: CopyExam): Promise<ExamView> {
    const source = await this.getPaperOrThrow(paperId);
    const sourceBank = await this.bankOfPaper(source);
    await this.assertCanViewPaper(actorId, source, sourceBank);
    await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.copy, sourceBank.contextId);

    let target: QuestionBankRow;
    if (input.targetBankId) {
      target = await this.getExamBank(actorId, input.targetBankId);
    } else {
      const row = await this.banks.ensurePersonalBank(actorId, 'exam', { forCopy: true });
      await this.ensureExamGrants(row);
      target = row;
    }
    await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.add, target.contextId);

    const copied = await this.deepCopyInto(actorId, source, target, input.name);
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_copied',
      payload: {
        paperId: copied.id, sourcePaperId: source.id,
        sourceBankId: sourceBank.id, targetBankId: target.id, actorId,
      },
    });
    return this.paperView(actorId, copied);
  }

  private async deepCopyInto(actorId: string, source: ExamRow, target: QuestionBankRow, nameOverride?: string): Promise<ExamRow> {
    const sourceVersion = await this.currentVersion(source);
    return this.copyPaperVersionIntoBank(actorId, source, sourceVersion, target, { name: nameOverride, status: 'ready' });
  }

  async copyPaperVersionIntoBank(actorId: string, source: ExamRow, sourceVersion: ExamVersionRow, target: QuestionBankRow, opts?: { name?: string; status?: string }): Promise<ExamRow> {
    const sourceSlots = await this.repo.listSlots(sourceVersion.id);
    let created: ExamRow | undefined;
    await this.repo.transaction(async (tx) => {
      created = await this.repo.insertPaper({
        tenantId: target.tenantId, bankId: target.id, kind: source.kind, status: opts?.status ?? 'draft',
        derivedFromExamId: source.id,
        derivedFromMatrixId: sourceVersion.matrixId,
        originalAuthorId: source.originalAuthorId ?? source.createdBy,
        derivedFromBankId: source.bankId,
        derivedFromVersionNumber: sourceVersion.version,
        createdBy: actorId, latestVersion: 1,
      }, tx);
      const version = await this.repo.insertVersion({
        examId: created.id, version: 1, name: opts?.name ?? sourceVersion.name,
        subjectId: sourceVersion.subjectId, grade: sourceVersion.grade, examKind: sourceVersion.examKind,
        totalScore: sourceVersion.totalScore, durationMinutes: sourceVersion.durationMinutes,
        tfScale: sourceVersion.tfScale, matrixId: sourceVersion.matrixId,
        matrixVersion: sourceVersion.matrixVersion, matrixVersionId: sourceVersion.matrixVersionId, createdBy: actorId,
      }, tx);
      await this.repo.insertSlots(sourceSlots.map((s) => ({
        examVersionId: version.id, position: s.position, section: s.section,
        sourceDomain: s.sourceDomain, sourceSnapshot: s.sourceSnapshot,
        questionId: s.questionId, pinnedVersionId: s.pinnedVersionId,
        pinnedVersionNumber: s.pinnedVersionNumber, maxMark: s.maxMark, clusterId: s.clusterId,
        matrixCellId: s.matrixCellId,
      })), tx);
      await this.repo.bumpCopyCount(source.id, tx);
    });
    return created!;
  }


  async proposeContribution(actorId: string, targetBankId: string, input: CreateExamContribution): Promise<ExamContributionRow> {
    const mode = input.mode ?? 'new';
    const target = await this.getExamBank(actorId, targetBankId);
    if (target.scope === 'personal') {
      throw new BadRequestException({ message: 'Cannot contribute into a personal bank', code: 'exam.contribution_target_personal' });
    }
    const paper = await this.getPaperOrThrow(input.examId);
    const sourceBank = await this.bankOfPaper(paper);
    if (paper.bankId === target.id) {
      throw new BadRequestException({ message: 'The paper is already in the target bank', code: 'exam.contribution_same_bank' });
    }
    await this.assertCanViewPaper(actorId, paper, sourceBank);
    await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.share, sourceBank.contextId);
    if (paper.status !== 'ready') {
      throw new BadRequestException({ message: 'Only a ready paper can be contributed', code: 'exam.contribution_source_not_ready' });
    }
    if (mode === 'update') {
      if (!input.targetExamId) {
        throw new BadRequestException({
          message: 'An update contribution needs targetExamId (the paper in the target bank this proposal updates)',
          code: 'exam.contribution_target_required',
        });
      }
      const targetPaper = await this.repo.getPaper(input.targetExamId);
      if (!targetPaper || targetPaper.bankId !== target.id) {
        throw new BadRequestException({
          message: 'The target paper of an update contribution must live in the target bank',
          code: 'exam.contribution_target_not_in_bank',
        });
      }
      if (paper.derivedFromExamId !== input.targetExamId) {
        throw new BadRequestException({
          message: 'Only a paper copied from the target paper can be proposed as its update',
          code: 'exam.contribution_not_derived',
        });
      }
    }
    const existing = await this.repo.findPendingContribution(paper.id, target.id, mode, input.targetExamId);
    if (existing) {
      throw new ConflictException({ message: 'A pending contribution of this paper to the target bank already exists', code: 'exam.contribution_duplicate_pending' });
    }
    const version = await this.currentVersion(paper);
    const slots = await this.repo.listSlots(version.id);
    const hash = this.paperContentHash(version, slots);
    let nearDuplicateOf: string | null = null;
    if (mode === 'new') {
      for (const other of await this.repo.listPapersInBank(target.id)) {
        const otherVersion = await this.currentVersion(other);
        const otherSlots = await this.repo.listSlots(otherVersion.id);
        if (this.paperContentHash(otherVersion, otherSlots) === hash) { nearDuplicateOf = other.id; break; }
      }
    }
    let dossier: {
      dossierExamVersionId: string; dossierExamVersionNumber: number;
      dossierMatrixId: string; dossierMatrixVersion: number | null; dossierMatrixVersionId: string | null;
      dossierSpecSnapshot: Record<string, unknown>;
    } | null = null;
    if (input.withDossier) {
      if (!version.matrixId) {
        throw new BadRequestException({
          message: 'A dossier attachment requires a paper built from a matrix (matrix + specification + paper are reviewed as one set)',
          code: 'exam.contribution_dossier_requires_matrix',
        });
      }
      const matrixInfo = await this.repo.getMatrixInfo(version.matrixId);
      const matrixVersion = version.matrixVersion ?? matrixInfo?.version ?? null;
      const matrixVersionId = version.matrixVersionId
        ?? (matrixVersion !== null ? await this.repo.getMatrixVersionRowId(version.matrixId, matrixVersion) : null);
      const spec = await this.quiz.buildSpecificationForPaper(actorId, version.matrixId, slots.map((s) => ({
        matrixCellId: s.matrixCellId, position: s.position, questionId: s.questionId,
      })));
      dossier = {
        dossierExamVersionId: version.id,
        dossierExamVersionNumber: version.version,
        dossierMatrixId: version.matrixId,
        dossierMatrixVersion: matrixVersion,
        dossierMatrixVersionId: matrixVersionId,
        dossierSpecSnapshot: spec as unknown as Record<string, unknown>,
      };
    }
    const row = await this.repo.insertContribution({
      examId: paper.id, targetBankId: target.id, proposerId: actorId,
      note: input.note ?? '', mode, targetExamId: mode === 'update' ? input.targetExamId! : null,
      contentHash: hash, nearDuplicateOf,
      ...(dossier ?? {}),
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_contribution_proposed',
      payload: {
        contributionId: row.id, targetBankId: target.id, examId: paper.id, proposerId: actorId,
        mode, targetExamId: row.targetExamId, withDossier: dossier !== null, nearDuplicateOf,
      },
    });
    return row;
  }

  async listContributions(actorId: string, bankId: string): Promise<ExamContributionView[]> {
    const bank = await this.getExamBank(actorId, bankId);
    const canModerate = await this.evaluator.hasCapability(actorId, EXAM_CAPABILITIES.moderate, bank.contextId);
    const all = await this.repo.listContributionsForBank(bank.id);
    const rows = canModerate ? all : all.filter((r) => r.proposerId === actorId);
    const views: ExamContributionView[] = [];
    for (const row of rows) {
      const paper = await this.repo.getPaper(row.examId);
      const reviewRows = await this.repo.listContributionReviews(row.id);
      const names = await this.banks.displayNames(reviewRows.map((r) => r.reviewerId));
      views.push({
        ...row,
        paperName: paper ? (await this.currentVersion(paper)).name : null,
        sourceBankId: paper?.bankId ?? null,
        reviews: reviewRows.map((r) => ({
          id: r.id, contributionId: r.contributionId, level: r.level,
          reviewerId: r.reviewerId, reviewerName: names.get(r.reviewerId) ?? null,
          decision: r.decision as 'approved' | 'rejected', reason: r.reason,
          createdAt: r.createdAt.toISOString(),
        })),
      });
    }
    return views;
  }

  private async getContributionForBank(bankId: string, contributionId: string): Promise<ExamContributionRow> {
    const row = await this.repo.getContribution(contributionId);
    if (!row || row.targetBankId !== bankId) {
      throw new NotFoundException({ message: `Contribution ${contributionId} not found`, code: 'exam.contribution_not_found' });
    }
    return row;
  }

  private async contributionNeedsBoard(contribution: ExamContributionRow, bank: QuestionBankRow): Promise<boolean> {
    if (!contribution.dossierExamVersionId) return false;
    return this.boardApprovalRequiredForBank(bank);
  }

  private async finalizeContributionApproval(actorId: string, bank: QuestionBankRow, contribution: ExamContributionRow, level: number): Promise<ExamContributionRow> {
    const source = await this.getPaperOrThrow(contribution.examId);
    let resultExamId: string;
    if (contribution.mode === 'update') {
      const targetPaper = contribution.targetExamId ? await this.repo.getPaper(contribution.targetExamId) : undefined;
      if (!targetPaper || targetPaper.bankId !== bank.id) {
        throw new ConflictException({
          message: 'The target paper of this update contribution no longer lives in the target bank',
          code: 'exam.contribution_target_gone',
        });
      }
      const sourceVersion = await this.currentVersion(source);
      const sourceSlots = await this.repo.listSlots(sourceVersion.id);
      const next = targetPaper.latestVersion + 1;
      await this.repo.transaction(async (tx) => {
        const version = await this.repo.insertVersion({
          examId: targetPaper.id, version: next, name: sourceVersion.name,
          subjectId: sourceVersion.subjectId, grade: sourceVersion.grade, examKind: sourceVersion.examKind,
          totalScore: sourceVersion.totalScore, durationMinutes: sourceVersion.durationMinutes,
          tfScale: sourceVersion.tfScale, matrixId: sourceVersion.matrixId,
          matrixVersion: sourceVersion.matrixVersion, matrixVersionId: sourceVersion.matrixVersionId,
          createdBy: actorId,
        }, tx);
        await this.repo.insertSlots(sourceSlots.map((s) => ({
          examVersionId: version.id, position: s.position, section: s.section,
          sourceDomain: s.sourceDomain, sourceSnapshot: s.sourceSnapshot,
        questionId: s.questionId, pinnedVersionId: s.pinnedVersionId,
          pinnedVersionNumber: s.pinnedVersionNumber, maxMark: s.maxMark,
          clusterId: s.clusterId, matrixCellId: s.matrixCellId,
        })), tx);
        await this.repo.updatePaper(targetPaper.id, { latestVersion: next }, tx);
        await this.repo.bumpCopyCount(source.id, tx);
      });
      resultExamId = targetPaper.id;
    } else {
      const inTarget = await this.repo.listPapersInBank(bank.id);
      if (inTarget.some((p) => p.derivedFromExamId === source.id)) {
        throw new ConflictException({
          message: `An identical paper already exists in the target bank (copied from ${source.id})`,
          code: 'exam.duplicate_in_bank',
        });
      }
      if (contribution.dossierExamVersionId) {
        const pinned = await this.repo.getVersion(contribution.dossierExamVersionId);
        if (!pinned) {
          throw new ConflictException({ message: 'The pinned paper version of this contribution no longer exists', code: 'exam.contribution_dossier_version_gone' });
        }
        resultExamId = (await this.copyPaperVersionIntoBank(actorId, source, pinned, bank, { status: 'ready' })).id;
      } else {
        resultExamId = (await this.deepCopyInto(actorId, source, bank)).id;
      }
    }
    await this.repo.insertContributionReview({
      contributionId: contribution.id, level, reviewerId: actorId, decision: 'approved', reason: null,
    });
    await this.repo.updateContribution(contribution.id, {
      status: 'approved', reviewerId: actorId, resultExamId,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_contribution_approved',
      payload: {
        contributionId: contribution.id, targetBankId: bank.id, paperId: source.id,
        mode: contribution.mode, resultExamId, reviewerId: actorId,
        proposerId: contribution.proposerId, level,
      },
    });
    return (await this.repo.getContribution(contribution.id))!;
  }

  async approveContribution(actorId: string, bankId: string, contributionId: string, input: ApproveExamContribution): Promise<ExamContributionRow> {
    const bank = await this.getExamBank(actorId, bankId);
    const contribution = await this.getContributionForBank(bank.id, contributionId);
    if (contribution.status === 'pending_board' && (await this.hasContributionBoardPermission(actorId))) {
      return this.boardApproveContribution(actorId, bankId, contributionId, input);
    }
    return this.approveContributionLevel1(actorId, bankId, contributionId, input);
  }

  async rejectContribution(actorId: string, bankId: string, contributionId: string, input: RejectExamContribution): Promise<ExamContributionRow> {
    const bank = await this.getExamBank(actorId, bankId);
    const contribution = await this.getContributionForBank(bank.id, contributionId);
    if (contribution.status === 'pending_board' && (await this.hasContributionBoardPermission(actorId))) {
      return this.boardRejectContribution(actorId, bankId, contributionId, input);
    }
    return this.rejectContributionLevel1(actorId, bankId, contributionId, input);
  }

  private async hasContributionBoardPermission(actorId: string): Promise<boolean> {
    const system = await this.contexts.ensureSystemContext();
    return this.evaluator.hasCapability(actorId, EXAM_CAPABILITIES.moderate, system.id);
  }

  private async approveContributionLevel1(actorId: string, bankId: string, contributionId: string, _input: ApproveExamContribution): Promise<ExamContributionRow> {
    const bank = await this.getExamBank(actorId, bankId);
    await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.moderate, bank.contextId);
    const contribution = await this.getContributionForBank(bank.id, contributionId);
    if (contribution.status !== 'pending') {
      throw new ConflictException({ message: 'Contribution is no longer pending', code: 'exam.contribution_not_pending' });
    }
    if (await this.contributionNeedsBoard(contribution, bank)) {
      await this.repo.insertContributionReview({
        contributionId: contribution.id, level: 1, reviewerId: actorId, decision: 'approved', reason: null,
      });
      await this.repo.updateContribution(contribution.id, { status: 'pending_board' });
      await this.outbox.enqueueStandalone({
        aggregate: 'exam_paper', type: 'exam_paper_contribution_level1_approved',
        payload: {
          contributionId: contribution.id, targetBankId: bank.id, paperId: contribution.examId,
          reviewerId: actorId, proposerId: contribution.proposerId,
        },
      });
      return (await this.repo.getContribution(contribution.id))!;
    }
    return this.finalizeContributionApproval(actorId, bank, contribution, 1);
  }

  private async rejectContributionLevel1(actorId: string, bankId: string, contributionId: string, input: RejectExamContribution): Promise<ExamContributionRow> {
    const bank = await this.getExamBank(actorId, bankId);
    await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.moderate, bank.contextId);
    const contribution = await this.getContributionForBank(bank.id, contributionId);
    if (contribution.status !== 'pending') {
      throw new ConflictException({ message: 'Contribution is no longer pending', code: 'exam.contribution_not_pending' });
    }
    await this.repo.insertContributionReview({
      contributionId: contribution.id, level: 1, reviewerId: actorId, decision: 'rejected', reason: input.reason,
    });
    await this.repo.updateContribution(contribution.id, {
      status: 'rejected', reviewerId: actorId, rejectReason: input.reason,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_contribution_rejected',
      payload: {
        contributionId: contribution.id, targetBankId: bank.id, paperId: contribution.examId,
        reviewerId: actorId, proposerId: contribution.proposerId, reason: input.reason, level: 1,
      },
    });
    return (await this.repo.getContribution(contribution.id))!;
  }

  private async requireContributionBoardApprover(actorId: string): Promise<void> {
    const system = await this.contexts.ensureSystemContext();
    const ok = await this.evaluator.hasCapability(actorId, EXAM_CAPABILITIES.moderate, system.id);
    if (!ok) {
      throw new ForbiddenException({
        message: 'Board approval requires exam:moderate at the system context',
        code: 'exam.contribution_board_forbidden',
      });
    }
  }

  async boardApproveContribution(actorId: string, bankId: string, contributionId: string, _input: ApproveExamContribution): Promise<ExamContributionRow> {
    const bank = await this.getExamBank(actorId, bankId);
    await this.requireContributionBoardApprover(actorId);
    const contribution = await this.getContributionForBank(bank.id, contributionId);
    if (contribution.status !== 'pending_board') {
      throw new ConflictException({ message: 'Contribution is not waiting for board review', code: 'exam.contribution_not_pending_board' });
    }
    return this.finalizeContributionApproval(actorId, bank, contribution, 2);
  }

  async boardRejectContribution(actorId: string, bankId: string, contributionId: string, input: RejectExamContribution): Promise<ExamContributionRow> {
    const bank = await this.getExamBank(actorId, bankId);
    await this.requireContributionBoardApprover(actorId);
    const contribution = await this.getContributionForBank(bank.id, contributionId);
    if (contribution.status !== 'pending_board') {
      throw new ConflictException({ message: 'Contribution is not waiting for board review', code: 'exam.contribution_not_pending_board' });
    }
    await this.repo.insertContributionReview({
      contributionId: contribution.id, level: 2, reviewerId: actorId, decision: 'rejected', reason: input.reason,
    });
    await this.repo.updateContribution(contribution.id, {
      status: 'rejected', reviewerId: actorId, rejectReason: input.reason,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_contribution_rejected',
      payload: {
        contributionId: contribution.id, targetBankId: bank.id, paperId: contribution.examId,
        reviewerId: actorId, proposerId: contribution.proposerId, reason: input.reason, level: 2,
      },
    });
    return (await this.repo.getContribution(contribution.id))!;
  }



  async createPin(actorId: string, courseId: string, input: CreateExamPin): Promise<QuizView> {
    if (input.newExam && !input.requestId) {
      throw new BadRequestException({ code: 'exam.pin_request_id_required' });
    }
    if (input.requestId) {
      return this.quiz.withPinRequestLock(courseId, actorId, input.requestId,
        () => this.createPinLocked(actorId, courseId, input));
    }
    return this.createPinLocked(actorId, courseId, input);
  }

  private async createPinLocked(actorId: string, courseId: string, input: CreateExamPin): Promise<QuizView> {
    const existing = input.requestId
      ? await this.quiz.getPinByRequest(courseId, actorId, input.requestId, input.sectionId)
      : undefined;
    if (existing) return existing;
    let examId = input.examId;
    let examVersionId = input.examVersionId;
    if (input.newExam) {
      if (examId) {
        throw new BadRequestException({ message: 'Provide either examId or newExam, not both', code: 'exam.pin_source_ambiguous' });
      }
      const bankRow = await this.banks.ensurePersonalBank(actorId, 'exam');
      await this.ensureExamGrants(bankRow);
      const prior = input.requestId
        ? await this.repo.findPaperByPinRequest(actorId, courseId, input.requestId)
        : undefined;
      if (prior) {
        const version = await this.repo.getVersionByNumber(prior.id, 1);
        if (!version || prior.bankId !== bankRow.id) throw new ConflictException({ code: 'exam.pin_request_conflict' });
        examId = prior.id;
        examVersionId = version.id;
      } else {
        const created = await this.createPaper(actorId, bankRow.id, input.newExam,
          input.requestId ? { courseId, requestId: input.requestId } : undefined);
        examId = created.paper.id;
        examVersionId = created.version.id;
      }
    }
    if (!examId) {
      throw new BadRequestException({ message: 'An exam pin needs either examId or newExam', code: 'exam.pin_source_required' });
    }
    const paper = await this.getPaperOrThrow(examId);
    const bank = await this.bankOfPaper(paper);
    await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.deploy, bank.contextId);
    if (!input.newExam && paper.status !== 'ready') {
      throw new BadRequestException({
        message: `Only a ready exam can be pinned (current status: ${paper.status})`,
        code: 'exam.pin_requires_ready',
      });
    }
    const version = examVersionId ? await this.repo.getVersion(examVersionId) : await this.currentVersion(paper);
    if (!version || version.examId !== paper.id) {
      throw new NotFoundException({ message: `Exam version ${examVersionId} not found for exam ${paper.id}`, code: 'exam.version_not_found' });
    }
    try {
      return await this.quiz.createPinRecord(actorId, courseId, {
      requestId: input.requestId,
      sectionId: input.sectionId, examId: paper.id, examVersionId: version.id,
      name: input.name, intro: input.intro,
      timeOpen: input.timeOpen, timeClose: input.timeClose, timeLimitSeconds: input.timeLimitSeconds,
      attemptsAllowed: input.attemptsAllowed, gradeMethod: input.gradeMethod, shuffleAnswers: input.shuffleAnswers,
      password: input.password, subnet: input.subnet,
      reviewAttempt: input.reviewAttempt, reviewCorrectness: input.reviewCorrectness,
      reviewMarks: input.reviewMarks, reviewSpecificFeedback: input.reviewSpecificFeedback,
      reviewGeneralFeedback: input.reviewGeneralFeedback, reviewRightAnswer: input.reviewRightAnswer,
      reviewOverallFeedback: input.reviewOverallFeedback,
      preset: input.preset, lateEntryMinutes: input.lateEntryMinutes, monitorEvents: input.monitorEvents,
      variantCount: input.variantCount,
      versionMode: input.versionMode,
      targetGroupId: input.targetGroupId ?? null,
      });
    } catch (error) {
      if (input.requestId && (error as { code?: string; constraint?: string }).code === '23505'
        && (error as { constraint?: string }).constraint === 'exam_pins_request_idx') {
        const existing = await this.quiz.getPinByRequest(courseId, actorId, input.requestId);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async generateFromMatrix(actorId: string, matrixId: string, input: GenerateFromMatrix): Promise<QuizView & { examId: string; matrixId: string }> {
    const { matrix, cells } = await this.quiz.matrixForGeneration(actorId, matrixId);
    const cellScale = cells.find((c) => c.tfScale !== null)?.tfScale ?? null;
    const drawn = await this.quiz.drawFixedSlots(actorId, cells);

    const bankRow = await this.banks.ensurePersonalBank(actorId, 'exam');
    await this.ensureExamGrants(bankRow);
    await this.evaluator.requireCapability(actorId, EXAM_CAPABILITIES.add, bankRow.contextId);

    const drawnPinned = await Promise.all(drawn.map(async (d) => {
      const ready = await this.repo.resolveReadyVersion(d.questionId);
      if (!ready) {
        throw new BadRequestException({
          message: `Question ${d.questionId} has no ready version; only ready questions can enter a paper`,
          code: 'exam.slot_question_not_ready',
        });
      }
      return { ...d, pinnedVersionId: ready.versionId, pinnedVersionNumber: ready.versionNumber };
    }));
    let paper: ExamRow | undefined;
    await this.repo.transaction(async (tx) => {
      paper = await this.repo.insertPaper({
        tenantId: bankRow.tenantId, bankId: bankRow.id,
        kind: 'snapshot',
        status: 'ready', createdBy: actorId, latestVersion: 1,
        derivedFromMatrixId: matrix.id,
      }, tx);
      const matrixVersionId = await this.repo.getMatrixVersionRowId(matrix.id, matrix.version, tx);
      const version = await this.repo.insertVersion({
        examId: paper.id, version: 1, name: input.name,
        subjectId: matrix.subjectId, grade: null, examKind: null,
        totalScore: matrix.totalScore, durationMinutes: null, tfScale: cellScale,
        matrixId: matrix.id, matrixVersion: matrix.version, matrixVersionId,
        createdBy: actorId,
      }, tx);
      if (drawnPinned) {
        await this.repo.insertSlots(drawnPinned.map((d, i) => ({
          examVersionId: version.id, position: i + 1,
          section: `Ô ${d.page}`,
          questionId: d.questionId,
          pinnedVersionId: d.pinnedVersionId, pinnedVersionNumber: d.pinnedVersionNumber,
          maxMark: d.maxMark, clusterId: null, matrixCellId: d.matrixCellId,
        })), tx);
      }
    });
    const totalMinutes = cells.reduce((sum, c) => sum + (c.minutes ?? 0), 0);
    const timeLimitSeconds = input.timeLimitSeconds !== undefined && input.timeLimitSeconds !== null
      ? input.timeLimitSeconds
      : (totalMinutes > 0 ? totalMinutes * 60 : null);
    const pin = await this.createPin(actorId, input.courseId, {
      sectionId: input.sectionId, examId: paper!.id, name: input.name, timeLimitSeconds,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_generated_from_matrix',
      payload: { paperId: paper!.id, matrixId: matrix.id, matrixVersion: matrix.version, pinId: pin.id, actorId },
    });
    return { ...pin, examId: paper!.id, matrixId: matrix.id };
  }


  async swapSlot(actorId: string, paperId: string, input: SwapExamSlot): Promise<ExamView> {
    const paper = await this.getPaperOrThrow(paperId);
    const bank = await this.bankOfPaper(paper);
    await this.assertCanEditPaper(actorId, paper, bank);
    const current = await this.currentVersion(paper);
    const slots = await this.repo.listSlots(current.id);
    const slot = slots.find((s) => s.position === input.position);
    if (!slot) throw new NotFoundException({ message: `Paper slot ${input.position} not found`, code: 'exam.slot_not_found' });
    if (!slot.matrixCellId) {
      throw new BadRequestException({ message: 'This slot has no source matrix cell; same-cell swap only applies to slots generated from a matrix', code: 'exam.swap_no_source_cell' });
    }
    if (slot.clusterId) {
      throw new BadRequestException({ message: 'A cluster member cannot be swapped on its own', code: 'exam.swap_cluster_member' });
    }
    if (!(await this.quiz.cellPoolContains(slot.matrixCellId, input.questionId))) {
      throw new BadRequestException({ message: 'The replacement question is not in the pool of this slot\'s matrix cell', code: 'exam.swap_candidate_out_of_cell' });
    }
    if (slots.some((s) => s.id !== slot.id && s.questionId === input.questionId)) {
      throw new BadRequestException({ message: 'The replacement question is already in this paper', code: 'exam.swap_candidate_duplicate' });
    }
    const ready = await this.repo.resolveReadyVersion(input.questionId);
    if (!ready) {
      throw new BadRequestException({
        message: `Question ${input.questionId} has no ready version; only ready questions can enter a paper`,
        code: 'exam.slot_question_not_ready',
      });
    }
    const next = paper.latestVersion + 1;
    await this.repo.transaction(async (tx) => {
      const version = await this.repo.insertVersion({
        examId: paper.id, version: next, name: current.name,
        subjectId: current.subjectId, grade: current.grade, examKind: current.examKind,
        totalScore: current.totalScore, durationMinutes: current.durationMinutes,
        tfScale: current.tfScale, matrixId: current.matrixId,
        matrixVersion: current.matrixVersion, matrixVersionId: current.matrixVersionId, createdBy: actorId,
      }, tx);
      await this.repo.insertSlots(slots.map((s) => ({
        examVersionId: version.id, position: s.position, section: s.section,
        sourceDomain: s.id === slot.id ? 'centre' : s.sourceDomain,
        sourceSnapshot: s.id === slot.id ? null : s.sourceSnapshot,
        questionId: s.id === slot.id ? input.questionId : s.questionId,
        pinnedVersionId: s.id === slot.id ? ready.versionId : s.pinnedVersionId,
        pinnedVersionNumber: s.id === slot.id ? ready.versionNumber : s.pinnedVersionNumber,
        maxMark: s.maxMark, clusterId: s.clusterId, matrixCellId: s.matrixCellId,
      })), tx);
      await this.repo.updatePaper(paper.id, { latestVersion: next }, tx);
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_paper', type: 'exam_paper_slot_swapped',
      payload: { examId: paper.id, position: input.position, questionId: input.questionId, cellId: slot.matrixCellId, actorId },
    });
    return this.paperView(actorId, (await this.repo.getPaper(paper.id))!);
  }


  async getPaperSpecification(actorId: string, paperId: string, pinId?: string): Promise<MatrixSpecification & { paper: { id: string; versionId: string; version: number; name: string } }> {
    const paper = await this.getPaperOrThrow(paperId);
    const bank = await this.bankOfPaper(paper);
    await this.assertCanViewPaperContent(actorId, paper, bank);
    const version = await this.currentVersion(paper);
    if (!version.matrixId) {
      throw new BadRequestException({
        message: 'This paper is not built from a matrix; it has no specification grid',
        code: 'exam.spec_requires_matrix',
      });
    }
    let pinInfo: { id: string; name: string } | null = null;
    if (pinId) {
      const summary = await this.quiz.getPinSummary(pinId);
      if (!summary || summary.examId !== paper.id) {
        throw new BadRequestException({ message: 'The quiz was not deployed from this paper', code: 'exam.spec_pin_mismatch' });
      }
      pinInfo = { id: summary.id, name: summary.name };
    }
    const slots = await this.repo.listSlots(version.id);
    const spec = await this.quiz.buildSpecificationForPaper(actorId, version.matrixId, slots.map((s) => ({
      matrixCellId: s.matrixCellId, position: s.position, questionId: s.questionId,
    })));
    await this.auditPaperContentView(actorId, paper, bank, 'specification');
    return {
      ...spec,
      quiz: pinInfo ?? spec.quiz,
      paper: { id: paper.id, versionId: version.id, version: version.version, name: version.name },
    };
  }

  async exportPaperSpecification(actorId: string, paperId: string, format: string, pinId?: string): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
    const spec = await this.getPaperSpecification(actorId, paperId, pinId);
    return this.quiz.renderSpecification(spec, format);
  }


  async printPaperHtml(actorId: string, paperId: string, pinId: string, variantCode: string): Promise<string> {
    const paper = await this.getPaperOrThrow(paperId);
    const bank = await this.bankOfPaper(paper);
    await this.assertCanViewPaperContent(actorId, paper, bank);
    await this.auditPaperContentView(actorId, paper, bank, 'print');
    const pin = await this.quiz.getPinRow(pinId);
    if (!pin || pin.examId !== paper.id) {
      throw new NotFoundException({ message: `Pin ${pinId} not found for this exam`, code: 'exam.pin_not_found' });
    }
    const variant = (pin.variants ?? []).find((v) => v.code === variantCode);
    if (!variant) {
      throw new NotFoundException({ message: `Variant ${variantCode} not found in this deployment`, code: 'exam.variant_not_found' });
    }
    const version = await this.repo.getVersion(pin.examVersionId);
    if (!version) throw new NotFoundException({ message: 'Deployed paper version not found', code: 'exam.version_not_found' });
    const slots = await this.repo.listSlots(version.id);
    const views = await this.slotViews(slots);
    let state = variant.seed >>> 0;
    const rand = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const ordered = [...views];
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j]!, ordered[i]!];
    }
    const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = ordered.map((v, i) => `<tr><td>${i + 1}</td><td>${esc(v.questionName ?? v.questionId)}</td><td>${esc(v.qtype ?? '')}</td><td>${v.maxMark}</td></tr>`).join('');
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(version.name)} — Mã đề ${esc(variant.code)}</title></head><body><h1>${esc(version.name)}</h1><p><strong>Mã đề: ${esc(variant.code)}</strong> · Tổng điểm: ${version.totalScore}${version.durationMinutes ? ` · Thời gian: ${version.durationMinutes} phút` : ''}</p><table border="1" cellspacing="0" cellpadding="6"><thead><tr><th>STT</th><th>Câu hỏi</th><th>Dạng</th><th>Điểm</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  }
}
