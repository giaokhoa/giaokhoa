import { Injectable } from '@nestjs/common';
import { badRequest, conflict, forbidden, notFound } from '../../common/http-errors';
import { createHash } from 'node:crypto';
import type { ExamMatrixContributionView, ExamMatrixView } from '@giaokhoa/contracts';
import { OutboxService } from '../../infra/events/outbox.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { QuestionBanksService } from '../questions/question-banks.service';
import type { QuestionBankRow } from '@giaokhoa/db/repositories/question-banks';
import type { CopyExamMatrixDto, CreateMatrixContributionDto, RejectMatrixContributionDto } from './dto/quiz.dto';
import { QuizRepository, type ExamMatrixCellRow, type ExamMatrixContributionRow, type ExamMatrixRow } from '@giaokhoa/db/repositories/quiz';
import { QuizService } from './quiz.service';
import { isMatrixContentSignatureConflict, matrixContentSignature } from './matrix-content-signature';

export interface MatrixAttributionView {
  matrixId: string;
  isCopy: boolean;
  derivedFromMatrixId: string | null;
  originalAuthorId: string | null;
  originalAuthorName: string | null;
  sourceBankId: string | null;
  sourceBankName: string | null;
  copyCount: number;
  useCount: number;
}

export const MATRIX_BANK_CAPS = {
  view: 'matrix:use',
  add: 'matrix:add',
  manage: 'matrix:edit',
  copy: 'matrix:copy',
  share: 'matrix:share',
  moderate: 'matrix:moderate',
} as const;

@Injectable()
export class MatrixBanksService {
  constructor(
    private readonly repo: QuizRepository,
    private readonly quiz: QuizService,
    private readonly banks: QuestionBanksService,
    private readonly evaluator: PermissionEvaluator,
    private readonly outbox: OutboxService,
  ) {}


  private async getMatrixBankOrThrow(bankId: string): Promise<QuestionBankRow> {
    const bank = await this.banks.findBankById(bankId);
    if (!bank) notFound(`Matrix bank ${bankId} not found`, 'quiz.matrix_bank_not_found');
    if (bank.bankKind !== 'matrix') {
      badRequest('Bank is not a matrix bank', 'quiz.matrix_bank_kind_mismatch');
    }
    return bank;
  }

  private async getMatrixRow(id: string): Promise<ExamMatrixRow> {
    const row = await this.repo.getMatrix(id);
    if (!row) notFound(`Exam matrix ${id} not found`, 'quiz.matrix_not_found');
    return row;
  }

  private async sourceCapsOf(actorId: string, matrix: ExamMatrixRow): Promise<{
    view: boolean; add: boolean; manage: boolean; copy: boolean; share: boolean; moderate: boolean;
  }> {
    if (matrix.bankId) {
      const bank = await this.banks.findBankById(matrix.bankId);
      if (bank) {
        await this.banks.syncBankMembership(bank);
        return this.banks.bankLocalMatrixCaps(actorId, bank);
      }
    }
    const at = async (cap: string) => this.evaluator.hasCapability(actorId, cap, matrix.contextId);
    const [view, add, manage, copy, share, moderate] = await Promise.all([
      at(MATRIX_BANK_CAPS.view), at(MATRIX_BANK_CAPS.add), at(MATRIX_BANK_CAPS.manage), at(MATRIX_BANK_CAPS.copy),
      at(MATRIX_BANK_CAPS.share), at(MATRIX_BANK_CAPS.moderate),
    ]);
    return { view, add, manage, copy, share, moderate };
  }

  private async deepCopyMatrix(actorId: string, source: ExamMatrixRow, targetBank: QuestionBankRow, opts: {
    status: 'draft' | 'ready'; isTemplate: boolean; name?: string;
  }): Promise<ExamMatrixRow> {
    const cells = await this.repo.listMatrixCells(source.id);
    const contentSignature = matrixContentSignature({
      name: opts.name ?? source.name,
      subjectId: source.subjectId, curriculumId: source.curriculumId,
      levelSet: source.levelSet, totalScore: source.totalScore,
      scopeNote: source.scopeNote, scopeNodeIds: source.scopeNodeIds,
      cells,
    });
    try {
      return await this.repo.transaction(async (tx) => {
        const copy = await this.repo.insertMatrix({
          tenantId: targetBank.tenantId,
          name: opts.name ?? source.name,
          subjectId: source.subjectId, curriculumId: source.curriculumId,
          contextId: source.contextId,
          bankId: targetBank.id, status: opts.status, isTemplate: opts.isTemplate,
          derivedFromMatrixId: source.id, version: 1,
          derivedFromBankId: source.bankId,
          originalAuthorId: source.originalAuthorId ?? source.createdBy,
          presetKind: source.presetKind,
          targetFormPercents: source.targetFormPercents, targetLevelPercents: source.targetLevelPercents,
          levelSet: source.levelSet, scopeNote: source.scopeNote, scopeNodeIds: source.scopeNodeIds,
          totalScore: source.totalScore, contentSignature, createdBy: actorId,
        }, tx);
        const firstVersion = await this.repo.insertMatrixVersion({
          matrixId: copy.id, version: 1,
          presetKind: source.presetKind,
          targetFormPercents: source.targetFormPercents, targetLevelPercents: source.targetLevelPercents,
          levelSet: source.levelSet, scopeNote: source.scopeNote, scopeNodeIds: source.scopeNodeIds,
          totalScore: source.totalScore, createdBy: actorId,
        }, tx);
        for (const cell of cells) {
          await this.repo.insertMatrixCell({
            matrixId: copy.id, matrixVersionId: firstVersion.id, curriculumNodeId: cell.curriculumNodeId,
            cognitiveLevel: cell.cognitiveLevel, qtype: cell.qtype,
            questionCount: cell.questionCount, cellScore: cell.cellScore,
            minutes: cell.minutes, tfScale: cell.tfScale, position: cell.position,
          }, tx);
        }
        await this.repo.bumpMatrixCopyCount(source.id, tx);
        return copy;
      });
    } catch (err) {
      if (isMatrixContentSignatureConflict(err)) {
        conflict('A matrix with identical content already exists in the target bank', 'quiz.matrix_duplicate_content');
      }
      throw err;
    }
  }

  private async contributionView(row: ExamMatrixContributionRow): Promise<ExamMatrixContributionView> {
    const [names, matrix] = await Promise.all([
      this.banks.displayNames([row.proposerId]),
      this.repo.getMatrix(row.matrixId),
    ]);
    return {
      id: row.id, matrixId: row.matrixId, matrixName: matrix?.name ?? null,
      targetBankId: row.targetBankId, proposerId: row.proposerId,
      proposerName: names.get(row.proposerId) ?? null,
      note: row.note, contentHash: row.contentHash, nearDuplicateOf: row.nearDuplicateOf,
      status: row.status as ExamMatrixContributionView['status'],
      rejectReason: row.rejectReason, reviewerId: row.reviewerId, resultMatrixId: row.resultMatrixId,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  private matrixContentHash(matrix: ExamMatrixRow, cells: ExamMatrixCellRow[]): string {
    const config = [
      matrix.presetKind, matrix.levelSet, String(matrix.totalScore),
      JSON.stringify(matrix.targetFormPercents), JSON.stringify(matrix.targetLevelPercents),
      JSON.stringify(matrix.scopeNodeIds), matrix.scopeNote ?? '',
    ].join('::');
    const body = [...cells]
      .sort((a, b) => a.position - b.position)
      .map((c) => [
        c.curriculumNodeId ?? '', c.cognitiveLevel, c.qtype,
        c.questionCount, c.cellScore, c.minutes ?? '', JSON.stringify(c.tfScale),
      ].join('@'))
      .join('|');
    return createHash('sha256').update(`${config}::${body}`).digest('hex');
  }

  async findMatrixById(matrixId: string): Promise<ExamMatrixRow | undefined> {
    return this.repo.getMatrix(matrixId);
  }


  async listBankMatrices(actorId: string, bankId: string): Promise<ExamMatrixView[]> {
    const bank = await this.getMatrixBankOrThrow(bankId);
    if (await this.banks.isForeignPersonalBank(actorId, bank)) {
      notFound(`Matrix bank ${bankId} not found`, 'quiz.matrix_bank_not_found');
    }
    await this.banks.syncBankMembership(bank);
    const caps = await this.banks.bankLocalMatrixCaps(actorId, bank);
    if (!caps.view) {
      forbidden(`No access to matrix bank ${bankId}`, 'quiz.matrix_bank_forbidden');
    }
    const isAdmin = await this.evaluator.isSiteAdmin(actorId);
    const rows = await this.repo.listMatricesByBank(bank.id);
    const visible = rows.filter((r) => r.status === 'ready' || r.createdBy === actorId || caps.manage || isAdmin);
    const out: ExamMatrixView[] = [];
    for (const row of visible) out.push(await this.quiz.viewMatrixRow(row));
    return out;
  }


  async copyMatrix(actorId: string, matrixId: string, input: CopyExamMatrixDto): Promise<ExamMatrixView> {
    const source = await this.getMatrixRow(matrixId);
    const sourceCaps = await this.sourceCapsOf(actorId, source);
    if (!sourceCaps.copy) {
      forbidden('No matrix:copy on the source matrix', 'quiz.matrix_copy_source_forbidden');
    }
    if (source.status === 'hidden' && source.createdBy !== actorId && !sourceCaps.moderate) {
      forbidden('Hidden matrices can only be copied by their owner or a moderator', 'quiz.matrix_hidden');
    }
    const target = input.targetBankId
      ? await this.getMatrixBankOrThrow(input.targetBankId)
      : await this.banks.ensurePersonalBank(actorId, 'matrix', { forCopy: true });
    await this.banks.syncBankMembership(target);
    const targetCaps = await this.banks.bankLocalMatrixCaps(actorId, target);
    if (!targetCaps.add) {
      forbidden('No matrix:add on the target matrix bank', 'quiz.matrix_copy_target_forbidden');
    }
    const copy = await this.deepCopyMatrix(actorId, source, target, { status: 'ready', isTemplate: false, name: input.name });
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'exam_matrix_copied',
      payload: { sourceMatrixId: source.id, newMatrixId: copy.id, sourceBankId: source.bankId, targetBankId: target.id, actorId },
    });
    return this.quiz.viewMatrixRow(copy);
  }


  async proposeContribution(actorId: string, matrixId: string, input: CreateMatrixContributionDto): Promise<ExamMatrixContributionView> {
    const target = await this.getMatrixBankOrThrow(input.targetBankId);
    if (target.scope === 'personal') {
      badRequest('Contributions target shared matrix banks, not a personal bank', 'quiz.matrix_contribution_target_personal');
    }
    const source = await this.getMatrixRow(matrixId);
    if (source.status !== 'ready') {
      badRequest('Only a ready matrix can be proposed as a contribution', 'quiz.matrix_contribution_source_not_ready');
    }
    const sourceCaps = await this.sourceCapsOf(actorId, source);
    if (!sourceCaps.view) {
      forbidden('No access to the source matrix', 'quiz.matrix_contribution_source_forbidden');
    }
    if (!sourceCaps.share) {
      forbidden('No matrix:share on the source matrix', 'quiz.matrix_share_forbidden');
    }
    const pending = await this.repo.findPendingMatrixContribution(source.id, target.id, actorId);
    if (pending) {
      conflict('A pending contribution for this matrix to this bank already exists', 'quiz.matrix_contribution_pending_exists');
    }
    const hash = this.matrixContentHash(source, await this.repo.listMatrixCells(source.id));
    let nearDuplicateOf: string | null = null;
    for (const other of await this.repo.listMatricesByBank(target.id)) {
      const otherHash = this.matrixContentHash(other, await this.repo.listMatrixCells(other.id));
      if (otherHash === hash) { nearDuplicateOf = other.id; break; }
    }
    const row = await this.repo.insertMatrixContribution({
      matrixId: source.id, targetBankId: target.id, proposerId: actorId, note: input.note ?? '',
      contentHash: hash, nearDuplicateOf,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'exam_matrix_contribution_proposed',
      payload: { contributionId: row.id, matrixId: source.id, targetBankId: target.id, actorId, nearDuplicateOf },
    });
    return this.contributionView(row);
  }

  async listContributions(actorId: string, bankId: string, status?: string): Promise<ExamMatrixContributionView[]> {
    const bank = await this.getMatrixBankOrThrow(bankId);
    await this.banks.syncBankMembership(bank);
    const caps = await this.banks.bankLocalMatrixCaps(actorId, bank);
    if (!caps.view) {
      forbidden(`No access to matrix bank ${bankId}`, 'quiz.matrix_bank_forbidden');
    }
    let rows = await this.repo.listMatrixContributions(bank.id, status);
    if (!caps.moderate) rows = rows.filter((r) => r.proposerId === actorId);
    const out: ExamMatrixContributionView[] = [];
    for (const row of rows) out.push(await this.contributionView(row));
    return out;
  }

  async listMyContributions(actorId: string): Promise<ExamMatrixContributionView[]> {
    const rows = await this.repo.listMatrixContributionsByProposer(actorId);
    const out: ExamMatrixContributionView[] = [];
    for (const row of rows) out.push(await this.contributionView(row));
    return out;
  }

  private async getPendingContribution(bank: QuestionBankRow, contributionId: string): Promise<ExamMatrixContributionRow> {
    const row = await this.repo.getMatrixContribution(contributionId);
    if (!row || row.targetBankId !== bank.id) {
      notFound(`Matrix contribution ${contributionId} not found`, 'quiz.matrix_contribution_not_found');
    }
    if (row.status !== 'pending') {
      conflict('Contribution is no longer pending', 'quiz.matrix_contribution_not_pending');
    }
    return row;
  }

  private async requireModerator(actorId: string, bank: QuestionBankRow): Promise<void> {
    await this.banks.syncBankMembership(bank);
    const caps = await this.banks.bankLocalMatrixCaps(actorId, bank);
    if (!caps.moderate) {
      forbidden('No matrix:moderate on the target matrix bank', 'quiz.matrix_moderate_forbidden');
    }
  }

  async approveContribution(actorId: string, bankId: string, contributionId: string): Promise<ExamMatrixContributionView> {
    const bank = await this.getMatrixBankOrThrow(bankId);
    await this.requireModerator(actorId, bank);
    const contribution = await this.getPendingContribution(bank, contributionId);
    const source = await this.getMatrixRow(contribution.matrixId);
    const inTarget = await this.repo.listMatricesByBank(bank.id);
    if (inTarget.some((m) => m.derivedFromMatrixId === source.id)) {
      conflict(`An identical matrix already exists in the target bank (copied from ${source.id})`, 'quiz.matrix_duplicate_in_bank');
    }
    const copy = await this.deepCopyMatrix(actorId, source, bank, {
      status: 'ready', isTemplate: bank.scope === 'personal' ? source.isTemplate : true,
    });
    await this.repo.updateMatrixContribution(contribution.id, {
      status: 'approved', reviewerId: actorId, resultMatrixId: copy.id, rejectReason: null,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'exam_matrix_contribution_approved',
      payload: { contributionId: contribution.id, matrixId: source.id, newMatrixId: copy.id, targetBankId: bank.id, actorId },
    });
    return this.contributionView((await this.repo.getMatrixContribution(contribution.id))!);
  }

  async getAttribution(actorId: string, matrixId: string): Promise<MatrixAttributionView> {
    const matrix = await this.getMatrixRow(matrixId);
    const caps = await this.sourceCapsOf(actorId, matrix);
    if (!caps.view) {
      forbidden('No access to the source matrix', 'quiz.matrix_attribution_source_forbidden');
    }
    const [names, generated, sourceBank] = await Promise.all([
      matrix.originalAuthorId ? this.banks.displayNames([matrix.originalAuthorId]) : Promise.resolve(new Map<string, string>()),
      this.repo.listExamVersionsByMatrix(matrix.id),
      matrix.derivedFromBankId ? this.banks.findBankById(matrix.derivedFromBankId) : Promise.resolve(undefined),
    ]);
    return {
      matrixId: matrix.id,
      isCopy: matrix.derivedFromMatrixId !== null,
      derivedFromMatrixId: matrix.derivedFromMatrixId,
      originalAuthorId: matrix.originalAuthorId,
      originalAuthorName: matrix.originalAuthorId ? (names.get(matrix.originalAuthorId) ?? null) : null,
      sourceBankId: matrix.derivedFromBankId,
      sourceBankName: sourceBank?.name ?? null,
      copyCount: matrix.copyCount,
      useCount: generated.length,
    };
  }

  async rejectContribution(actorId: string, bankId: string, contributionId: string, input: RejectMatrixContributionDto): Promise<ExamMatrixContributionView> {
    const bank = await this.getMatrixBankOrThrow(bankId);
    await this.requireModerator(actorId, bank);
    const contribution = await this.getPendingContribution(bank, contributionId);
    await this.repo.updateMatrixContribution(contribution.id, {
      status: 'rejected', reviewerId: actorId, rejectReason: input.reason, resultMatrixId: null,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'exam_matrix_contribution_rejected',
      payload: { contributionId: contribution.id, targetBankId: bank.id, actorId },
    });
    return this.contributionView((await this.repo.getMatrixContribution(contribution.id))!);
  }
}
