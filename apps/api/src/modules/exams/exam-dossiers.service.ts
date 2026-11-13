import {
  BadRequestException, GoneException, Injectable, NotFoundException,
} from '@nestjs/common';
import type {
  CreateExamDossier, ExamDossierView, RejectExamDossier,
} from '@giaokhoa/contracts';
import { OutboxService } from '../../infra/events/outbox.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { QuestionBanksService } from '../questions/question-banks.service';
import { QuizService, type MatrixSpecification } from '../quiz/quiz.service';
import {
  ExamsRepository,
  type ExamDossierRow,
} from '@giaokhoa/db/repositories/exams';
import { ExamsService, EXAM_CAPABILITIES, examPaperContentHash } from './exams.service';

@Injectable()
export class ExamDossiersService {
  constructor(
    private readonly repo: ExamsRepository,
    private readonly papers: ExamsService,
    private readonly banks: QuestionBanksService,
    private readonly evaluator: PermissionEvaluator,
    private readonly quiz: QuizService,
    private readonly outbox: OutboxService,
  ) {}


  async boardApprovalRequired(dossier?: ExamDossierRow): Promise<boolean> {
    if (!dossier) return false;
    const bank = await this.banks.findBankById(dossier.targetBankId);
    if (!bank) return false;
    return this.papers.boardApprovalRequiredForBank(bank);
  }



  private async getDossierOrThrow(id: string): Promise<ExamDossierRow> {
    const row = await this.repo.getDossier(id);
    if (!row) throw new NotFoundException({ message: `Exam dossier ${id} not found`, code: 'exam.dossier_not_found' });
    return row;
  }

  private static pathClosed(): GoneException {
    return new GoneException({
      message: 'The dossier path is closed: contribute the paper through the single contribution path (with an attached dossier when the paper is an official exam)',
      code: 'exam.dossier_path_closed',
    });
  }


  private async canViewDossier(actorId: string, dossier: ExamDossierRow): Promise<boolean> {
    if (dossier.proposerId === actorId) return true;
    if (await this.evaluator.isSiteAdmin(actorId)) return true;
    const bank = await this.banks.findBankById(dossier.targetBankId);
    if (!bank) return false;
    return this.evaluator.hasCapability(actorId, EXAM_CAPABILITIES.moderate, bank.contextId);
  }

  private async dossierView(row: ExamDossierRow): Promise<ExamDossierView> {
    const paper = await this.repo.getPaper(row.examId);
    let examName: string | null = null;
    if (paper) {
      const version = row.examVersionId
        ? await this.repo.getVersion(row.examVersionId)
        : await this.papers.currentVersion(paper).catch(() => undefined);
      examName = version?.name ?? null;
    }
    const matrixInfo = row.matrixId ? await this.repo.getMatrixInfo(row.matrixId) : undefined;
    const reviews = await this.repo.listDossierReviews(row.id);
    const names = await this.banks.displayNames([row.proposerId, ...reviews.map((r) => r.reviewerId)]);
    return {
      id: row.id,
      examId: row.examId,
      examName,
      sourceBankId: paper?.bankId ?? null,
      targetBankId: row.targetBankId,
      proposerId: row.proposerId,
      proposerName: names.get(row.proposerId) ?? null,
      note: row.note,
      status: row.status as ExamDossierView['status'],
      examVersionId: row.examVersionId,
      examVersionNumber: row.examVersionNumber,
      matrixId: row.matrixId,
      matrixName: matrixInfo?.name ?? null,
      matrixVersion: row.matrixVersion,
      matrixVersionId: row.matrixVersionId,
      boardApprovalRequired: await this.boardApprovalRequired(row),
      resultExamId: row.resultExamId,
      reviews: reviews.map((r) => ({
        id: r.id,
        dossierId: r.dossierId,
        level: r.level,
        reviewerId: r.reviewerId,
        reviewerName: names.get(r.reviewerId) ?? null,
        decision: r.decision as 'approved' | 'rejected',
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }


  async createDossier(_actorId: string, _examId: string, _input: CreateExamDossier): Promise<ExamDossierView> {
    throw ExamDossiersService.pathClosed();
  }

  async submitDossier(_actorId: string, _dossierId: string): Promise<ExamDossierView> {
    throw ExamDossiersService.pathClosed();
  }

  async deleteDossier(_actorId: string, _dossierId: string): Promise<{ id: string; deleted: true }> {
    throw ExamDossiersService.pathClosed();
  }



  async getDossier(actorId: string, dossierId: string): Promise<ExamDossierView> {
    const dossier = await this.getDossierOrThrow(dossierId);
    if (!(await this.canViewDossier(actorId, dossier))) {
      throw new NotFoundException({ message: `Exam dossier ${dossierId} not found`, code: 'exam.dossier_not_found' });
    }
    return this.dossierView(dossier);
  }

  async listBankDossiers(actorId: string, bankId: string): Promise<ExamDossierView[]> {
    const bank = await this.papers.getExamBank(actorId, bankId);
    const canModerate = await this.evaluator.hasCapability(actorId, EXAM_CAPABILITIES.moderate, bank.contextId);
    const all = await this.repo.listDossiersForBank(bank.id);
    const rows = canModerate ? all : all.filter((r) => r.proposerId === actorId);
    const views: ExamDossierView[] = [];
    for (const row of rows) views.push(await this.dossierView(row));
    return views;
  }

  async listMyDossiers(actorId: string): Promise<ExamDossierView[]> {
    const rows = await this.repo.listDossiersByProposer(actorId);
    const views: ExamDossierView[] = [];
    for (const row of rows) views.push(await this.dossierView(row));
    return views;
  }

  async getDossierSpecification(actorId: string, dossierId: string): Promise<Record<string, unknown>> {
    const dossier = await this.getDossierOrThrow(dossierId);
    if (!(await this.canViewDossier(actorId, dossier))) {
      throw new NotFoundException({ message: `Exam dossier ${dossierId} not found`, code: 'exam.dossier_not_found' });
    }
    if (!dossier.specSnapshot) {
      throw new BadRequestException({ message: 'The dossier has not been submitted yet; it carries no specification', code: 'exam.dossier_not_submitted' });
    }
    const bank = await this.banks.findBankById(dossier.targetBankId);
    const isModerator = bank
      ? await this.evaluator.hasCapability(actorId, EXAM_CAPABILITIES.moderate, bank.contextId)
      : false;
    if (isModerator && dossier.proposerId !== actorId) {
      await this.outbox.enqueueStandalone({
        aggregate: 'exam_paper', type: 'exam_dossier_spec_viewed',
        payload: { dossierId: dossier.id, examId: dossier.examId, targetBankId: dossier.targetBankId, actorId },
      });
    }
    return dossier.specSnapshot;
  }

  async exportDossierSpecification(actorId: string, dossierId: string, format: string): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
    const snapshot = await this.getDossierSpecification(actorId, dossierId);
    return this.quiz.renderSpecification(snapshot as unknown as MatrixSpecification, format);
  }


  async approveDossier(_actorId: string, _dossierId: string): Promise<ExamDossierView> {
    throw ExamDossiersService.pathClosed();
  }

  async rejectDossier(_actorId: string, _dossierId: string, _input: RejectExamDossier): Promise<ExamDossierView> {
    throw ExamDossiersService.pathClosed();
  }

  async boardApproveDossier(_actorId: string, _dossierId: string): Promise<ExamDossierView> {
    throw ExamDossiersService.pathClosed();
  }

  async boardRejectDossier(_actorId: string, _dossierId: string, _input: RejectExamDossier): Promise<ExamDossierView> {
    throw ExamDossiersService.pathClosed();
  }


  async convertLegacyDossiers(): Promise<{
    before: Record<string, number>;
    converted: number;
    alreadyConverted: number;
    draftsFrozen: number;
  }> {
    const dossiers = await this.repo.listAllDossiers();
    const before: Record<string, number> = {};
    for (const d of dossiers) before[d.status] = (before[d.status] ?? 0) + 1;
    let converted = 0;
    let alreadyConverted = 0;
    let draftsFrozen = 0;
    for (const dossier of dossiers) {
      if (dossier.status === 'pending' || dossier.status === 'pending_board') {
        const existing = await this.repo.findContributionBySourceDossier(dossier.id);
        if (existing) { alreadyConverted += 1; continue; }
        let contentHash = '';
        let nearDuplicateOf: string | null = null;
        const pinned = dossier.examVersionId ? await this.repo.getVersion(dossier.examVersionId) : undefined;
        if (pinned) {
          const slots = await this.repo.listSlots(pinned.id);
          contentHash = examPaperContentHash(pinned, slots);
          for (const other of await this.repo.listPapersInBank(dossier.targetBankId)) {
            const otherVersion = await this.papers.currentVersion(other);
            const otherSlots = await this.repo.listSlots(otherVersion.id);
            if (examPaperContentHash(otherVersion, otherSlots) === contentHash) { nearDuplicateOf = other.id; break; }
          }
        }
        const contribution = await this.repo.insertContribution({
          examId: dossier.examId, targetBankId: dossier.targetBankId, proposerId: dossier.proposerId,
          note: dossier.note, mode: 'new', status: dossier.status,
          contentHash, nearDuplicateOf,
          dossierExamVersionId: dossier.examVersionId,
          dossierExamVersionNumber: dossier.examVersionNumber,
          dossierMatrixId: dossier.matrixId,
          dossierMatrixVersion: dossier.matrixVersion,
          dossierMatrixVersionId: dossier.matrixVersionId,
          dossierSpecSnapshot: dossier.specSnapshot,
          sourceDossierId: dossier.id,
          createdAt: dossier.createdAt, updatedAt: dossier.updatedAt,
        });
        for (const review of await this.repo.listDossierReviews(dossier.id)) {
          await this.repo.insertContributionReview({
            contributionId: contribution.id, level: review.level,
            reviewerId: review.reviewerId, decision: review.decision,
            reason: review.reason, createdAt: review.createdAt,
          });
        }
        await this.outbox.enqueueStandalone({
          aggregate: 'exam_paper', type: 'exam_dossier_converted',
          payload: {
            dossierId: dossier.id, contributionId: contribution.id,
            examId: dossier.examId, targetBankId: dossier.targetBankId,
            proposerId: dossier.proposerId, status: dossier.status,
          },
        });
        converted += 1;
      } else if (dossier.status === 'draft') {
        await this.outbox.enqueueStandalone({
          aggregate: 'exam_paper', type: 'exam_dossier_frozen',
          payload: {
            dossierId: dossier.id, examId: dossier.examId,
            targetBankId: dossier.targetBankId, proposerId: dossier.proposerId,
          },
        });
        draftsFrozen += 1;
      }
    }
    return { before, converted, alreadyConverted, draftsFrozen };
  }
}
