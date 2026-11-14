import { badRequest, conflict, forbidden, notFound } from '../../common/http-errors';
import type {
  ExamMatrixCellView,
  ExamMatrixView,
  MatrixCellAvailability,
  MatrixImportCellAvailability,
} from '@giaokhoa/contracts';
import { OutboxService } from '../../infra/events/outbox.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { CurriculumService } from '../curriculum/curriculum.service';
import { QuestionBanksService } from '../questions/question-banks.service';
import type { QuestionBankRow } from '@giaokhoa/db/repositories/question-banks';
import type {
  CreateExamMatrixCellDto,
  CreateExamMatrixDto,
  UpdateExamMatrixCellDto,
  UpdateExamMatrixDto,
  WithdrawExamMatrixDto,
} from './dto/quiz.dto';
import { isValidTfScale, MATRIX_PRESETS, matrixWarnings } from './domain/matrix';
import {
  QuizRepository,
  type ExamMatrixCellRow,
  type ExamMatrixRow,
  type ExamMatrixVersionRow,
  type QuizTx,
} from '@giaokhoa/db/repositories/quiz';
import {
  isMatrixContentSignatureConflict,
  matrixContentSignature,
} from './matrix-content-signature';
import { QuizSharedService } from './quiz-shared.service';
import { QUIZ_CAPABILITIES } from './quiz-shared.service';


export class QuizMatricesService {
  constructor(
    private readonly repo: QuizRepository,
    private readonly evaluator: PermissionEvaluator,
    private readonly banks: QuestionBanksService,
    private readonly curriculum: CurriculumService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
    private readonly shared: QuizSharedService,
  ) {}

  private assertValidTfScale(scale: number[] | null | undefined): void {
    if (scale !== undefined && scale !== null && !isValidTfScale(scale)) {
      badRequest('tfScale must be 5 percentages (0..100), non-decreasing, ending at 100', 'quiz.tf_scale_invalid');
    }
  }


  async requirePersonalMatrixBankManage(actorId: string): Promise<QuestionBankRow> {
    const bank = await this.banks.ensurePersonalBank(actorId, 'matrix');
    await this.banks.syncBankMembership(bank);
    const caps = await this.banks.bankLocalMatrixCaps(actorId, bank);
    if (!caps.manage) {
      forbidden(`Missing capability ${QUIZ_CAPABILITIES.manageMatrix} in matrix bank ${bank.id}`, 'access.capability_denied');
    }
    return bank;
  }

  private matrixCellView(row: ExamMatrixCellRow): ExamMatrixCellView {
    return {
      id: row.id, matrixId: row.matrixId, curriculumNodeId: row.curriculumNodeId,
      cognitiveLevel: row.cognitiveLevel as ExamMatrixCellView['cognitiveLevel'],
      qtype: row.qtype as ExamMatrixCellView['qtype'],
      questionCount: row.questionCount, cellScore: row.cellScore,
      minutes: row.minutes, tfScale: row.tfScale, position: row.position,
    };
  }

  private async matrixView(row: ExamMatrixRow): Promise<ExamMatrixView> {
    const cells = await this.repo.listMatrixCells(row.id);
    return {
      id: row.id, name: row.name, subjectId: row.subjectId, curriculumId: row.curriculumId,
      contextId: row.contextId,
      presetKind: row.presetKind as ExamMatrixView['presetKind'],
      targetFormPercents: row.targetFormPercents, targetLevelPercents: row.targetLevelPercents,
      levelSet: row.levelSet as ExamMatrixView['levelSet'],
      scopeNote: row.scopeNote, scopeNodeIds: row.scopeNodeIds,
      totalScore: row.totalScore, createdBy: row.createdBy,
      bankId: row.bankId, status: row.status as ExamMatrixView['status'],
      isTemplate: row.isTemplate, derivedFromMatrixId: row.derivedFromMatrixId,
      derivedFromBankId: row.derivedFromBankId, originalAuthorId: row.originalAuthorId,
      copyCount: row.copyCount,
      withdrawnReason: row.withdrawnReason, withdrawnBy: row.withdrawnBy,
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      version: row.version,
      cells: cells.map((c) => this.matrixCellView(c)),
      warnings: matrixWarnings({
        cells, targetFormPercents: row.targetFormPercents,
        targetLevelPercents: row.targetLevelPercents, totalScore: row.totalScore,
      }),
    };
  }

  async viewMatrixRow(row: ExamMatrixRow): Promise<ExamMatrixView> {
    return this.matrixView(row);
  }

  async createMatrix(actorId: string, input: CreateExamMatrixDto): Promise<ExamMatrixView> {
    const subject = await this.curriculum.getSubjectReference(input.subjectId);
    const curriculum = await this.curriculum.getCurriculumReference(input.curriculumId);
    if (curriculum.subjectId !== subject.id) {
      badRequest('Curriculum does not belong to the subject', 'quiz.matrix_curriculum_mismatch');
    }
    let bankTenantId: string | null | undefined;
    if (input.bankId) {
      const bank = await this.banks.findBankById(input.bankId);
      bankTenantId = bank?.tenantId;
      if (!bank) notFound(`Matrix bank ${input.bankId} not found`, 'quiz.matrix_bank_not_found');
      if (bank.bankKind !== 'matrix') {
        badRequest('Target bank is not a matrix bank', 'quiz.matrix_bank_kind_mismatch');
      }
      await this.banks.syncBankMembership(bank);
      const caps = await this.banks.bankLocalMatrixCaps(actorId, bank);
      if (!caps.add) {
        forbidden(`Missing capability ${QUIZ_CAPABILITIES.addMatrix} in matrix bank ${bank.id}`, 'access.capability_denied');
      }
    } else {
      await this.evaluator.requireCapability(actorId, QUIZ_CAPABILITIES.addMatrix, subject.contextId);
    }
    const presetKind = 'cv7991_periodic';
    const preset = MATRIX_PRESETS[presetKind];
    const tenantId = bankTenantId !== undefined ? bankTenantId : await this.shared.matrixTenantId();
    const contentSignature = matrixContentSignature({
      name: input.name, subjectId: subject.id, curriculumId: curriculum.id,
      levelSet: input.levelSet ?? 'three', totalScore: input.totalScore ?? 10,
      scopeNote: input.scopeNote ?? null, scopeNodeIds: input.scopeNodeIds ?? null,
      cells: [],
    });
    let row: ExamMatrixRow;
    try {
      row = await this.repo.transaction(async (tx) => {
        const created = await this.repo.insertMatrix({
          tenantId,
          name: input.name, subjectId: subject.id, curriculumId: curriculum.id,
          contextId: subject.contextId, presetKind,
          targetFormPercents: input.targetFormPercents !== undefined ? input.targetFormPercents : (preset?.targetFormPercents ?? null),
          targetLevelPercents: input.targetLevelPercents !== undefined ? input.targetLevelPercents : (preset?.targetLevelPercents ?? null),
          levelSet: input.levelSet ?? 'three',
          scopeNote: input.scopeNote ?? null,
          scopeNodeIds: input.scopeNodeIds ?? null,
          totalScore: input.totalScore ?? 10,
          contentSignature,
          createdBy: actorId,
          bankId: input.bankId ?? null,
          status: input.status ?? 'draft',
          isTemplate: input.isTemplate ?? false,
          derivedFromMatrixId: input.derivedFromMatrixId ?? null,
        }, tx);
        await this.repo.insertMatrixVersion({
          matrixId: created.id, version: 1, ...this.matrixVersionConfigOf(created), createdBy: actorId,
        }, tx);
        return created;
      });
    } catch (err) {
      this.rethrowAsDuplicateContentConflict(err);
    }
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'exam_matrix_created', payload: { matrixId: row.id, subjectId: subject.id, actorId } });
    return this.matrixView(row);
  }

  private importedMatrixSignature(input: {
    name: string; subjectId: string; curriculumId: string;
    levelSet: string; totalScore: number; scopeNote: string | null;
    scopeNodeIds: string[] | null;
    cells: { curriculumNodeId: string; cognitiveLevel: string; qtype: string; questionCount: number; cellScore: number }[];
  }): string {
    return matrixContentSignature(input);
  }

  private async refreshMatrixContentSignature(matrixId: string, tx?: QuizTx): Promise<void> {
    const row = await this.repo.getMatrix(matrixId, tx);
    if (!row) return;
    const cells = await this.repo.listMatrixCells(matrixId, tx);
    await this.repo.updateMatrix(matrixId, {
      contentSignature: matrixContentSignature({ ...row, cells }),
    }, tx);
  }

  private rethrowAsDuplicateContentConflict(err: unknown): never {
    if (isMatrixContentSignatureConflict(err)) {
      conflict('A matrix with identical content already exists in the target bank', 'quiz.matrix_duplicate_content');
    }
    throw err;
  }

  async createMatrixFromImport(actorId: string, input: {
    name: string; subjectId: string; curriculumId: string;
    levelSet: 'three' | 'four'; totalScore: number; scopeNote: string | null;
    scopeNodeIds: string[];
    cells: { curriculumNodeId: string; cognitiveLevel: string; qtype: string; questionCount: number; cellScore: number; position: number }[];
  }): Promise<ExamMatrixView> {
    const subject = await this.curriculum.getSubjectReference(input.subjectId);
    const curriculum = await this.curriculum.getCurriculumReference(input.curriculumId);
    if (curriculum.subjectId !== subject.id) {
      badRequest('Curriculum does not belong to the subject', 'quiz.matrix_curriculum_mismatch');
    }
    const bank = await this.requirePersonalMatrixBankManage(actorId);
    const signature = this.importedMatrixSignature(input);
    const candidates = (await this.repo.listMatricesByBank(bank.id))
      .filter((r) => r.createdBy === actorId && r.name === input.name
        && r.subjectId === subject.id && r.curriculumId === curriculum.id);
    for (const candidate of candidates) {
      if (candidate.contentSignature !== null) {
        if (candidate.contentSignature === signature) return this.matrixView(candidate);
        continue;
      }
      const existingCells = await this.repo.listMatrixCells(candidate.id);
      if (this.importedMatrixSignature({ ...candidate, cells: existingCells }) === signature) {
        return this.matrixView(candidate);
      }
    }
    const preset = MATRIX_PRESETS['cv7991_periodic'];
    let row: ExamMatrixRow;
    try {
      row = await this.repo.transaction(async (tx) => {
        const matrix = await this.repo.insertMatrix({
          tenantId: bank.tenantId,
          name: input.name, subjectId: subject.id, curriculumId: curriculum.id,
          contextId: subject.contextId, presetKind: 'cv7991_periodic',
          targetFormPercents: preset?.targetFormPercents ?? null,
          targetLevelPercents: preset?.targetLevelPercents ?? null,
          levelSet: input.levelSet,
          scopeNote: input.scopeNote,
          scopeNodeIds: input.scopeNodeIds,
          totalScore: input.totalScore,
          contentSignature: signature,
          createdBy: actorId,
          bankId: bank.id,
          status: 'draft',
          isTemplate: false,
          derivedFromMatrixId: null,
        }, tx);
        const firstVersion = await this.repo.insertMatrixVersion({
          matrixId: matrix.id, version: 1, ...this.matrixVersionConfigOf(matrix), createdBy: actorId,
        }, tx);
        for (const cell of input.cells) {
          await this.repo.insertMatrixCell({
            matrixId: matrix.id, matrixVersionId: firstVersion.id, curriculumNodeId: cell.curriculumNodeId,
            cognitiveLevel: cell.cognitiveLevel, qtype: cell.qtype,
            questionCount: cell.questionCount, cellScore: cell.cellScore,
            minutes: null, tfScale: null, position: cell.position,
          }, tx);
        }
        return matrix;
      });
    } catch (err) {
      if (isMatrixContentSignatureConflict(err)) {
        const winner = await this.repo.findMatrixByBankAndSignature(bank.id, signature);
        if (winner) return this.matrixView(winner);
      }
      throw err;
    }
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'exam_matrix_created', payload: { matrixId: row.id, subjectId: subject.id, actorId } });
    return this.matrixView(row);
  }

  async getMatrix(actorId: string, matrixId: string): Promise<ExamMatrixView> {
    const row = await this.shared.getMatrixRow(matrixId);
    const activeTenant = this.tenantContext.currentTenantId();
    if (activeTenant !== undefined && row.tenantId !== null && row.tenantId !== activeTenant) {
      notFound(`Exam matrix ${matrixId} not found`, 'quiz.matrix_not_found');
    }
    await this.shared.requireMatrixCap(actorId, row, QUIZ_CAPABILITIES.viewMatrix);
    return this.matrixView(row);
  }

  async getMatrixVersion(actorId: string, matrixId: string, version: number): Promise<ExamMatrixView> {
    const row = await this.shared.getMatrixRow(matrixId);
    const activeTenant = this.tenantContext.currentTenantId();
    if (activeTenant !== undefined && row.tenantId !== null && row.tenantId !== activeTenant) {
      notFound(`Exam matrix ${matrixId} not found`, 'quiz.matrix_not_found');
    }
    await this.shared.requireMatrixCap(actorId, row, QUIZ_CAPABILITIES.viewMatrix);
    const versionRow = await this.repo.getMatrixVersionRow(matrixId, version);
    if (!versionRow) {
      notFound(`Exam matrix ${matrixId} has no version ${version}`, 'quiz.matrix_version_not_found');
    }
    const cells = await this.repo.listMatrixCellsByVersionId(versionRow.id);
    return {
      id: row.id, name: row.name, subjectId: row.subjectId, curriculumId: row.curriculumId,
      contextId: row.contextId,
      presetKind: versionRow.presetKind as ExamMatrixView['presetKind'],
      targetFormPercents: versionRow.targetFormPercents, targetLevelPercents: versionRow.targetLevelPercents,
      levelSet: versionRow.levelSet as ExamMatrixView['levelSet'],
      scopeNote: versionRow.scopeNote, scopeNodeIds: versionRow.scopeNodeIds,
      totalScore: versionRow.totalScore, createdBy: row.createdBy,
      bankId: row.bankId, status: row.status as ExamMatrixView['status'],
      isTemplate: row.isTemplate, derivedFromMatrixId: row.derivedFromMatrixId,
      derivedFromBankId: row.derivedFromBankId, originalAuthorId: row.originalAuthorId,
      copyCount: row.copyCount,
      withdrawnReason: row.withdrawnReason, withdrawnBy: row.withdrawnBy,
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      version: versionRow.version,
      cells: cells.map((c) => this.matrixCellView(c)),
      warnings: matrixWarnings({
        cells, targetFormPercents: versionRow.targetFormPercents,
        targetLevelPercents: versionRow.targetLevelPercents, totalScore: versionRow.totalScore,
      }),
    };
  }

  async listGeneratedExams(actorId: string, matrixId: string) {
    const row = await this.shared.getMatrixRow(matrixId);
    const activeTenant = this.tenantContext.currentTenantId();
    if (activeTenant !== undefined && row.tenantId !== null && row.tenantId !== activeTenant) {
      notFound(`Exam matrix ${matrixId} not found`, 'quiz.matrix_not_found');
    }
    await this.shared.requireMatrixCap(actorId, row, QUIZ_CAPABILITIES.viewMatrix);
    return this.repo.listExamVersionsByMatrix(matrixId);
  }

  async listMatrices(actorId: string, subjectId: string): Promise<ExamMatrixView[]> {
    const subject = await this.curriculum.getSubjectReference(subjectId);
    const rows = await this.repo.listMatricesBySubject(subject.id);
    const visibleByBank = new Map<string, boolean>();
    const out: ExamMatrixView[] = [];
    for (const r of rows) {
      let visible: boolean;
      if (r.bankId) {
        const cached = visibleByBank.get(r.bankId);
        if (cached !== undefined) {
          visible = cached;
        } else {
          const bank = await this.banks.findBankById(r.bankId);
          if (bank) {
            visible = !(await this.banks.isForeignPersonalBank(actorId, bank));
            if (visible) {
              await this.banks.syncBankMembership(bank);
              visible = (await this.banks.bankLocalMatrixCaps(actorId, bank)).view;
            }
            visibleByBank.set(r.bankId, visible);
          } else {
            visible = await this.evaluator.hasCapability(actorId, QUIZ_CAPABILITIES.viewMatrix, r.contextId);
          }
        }
      } else {
        visible = await this.evaluator.hasCapability(actorId, QUIZ_CAPABILITIES.viewMatrix, r.contextId);
      }
      if (visible) out.push(await this.matrixView(r));
    }
    return out;
  }

  async updateMatrix(actorId: string, matrixId: string, input: UpdateExamMatrixDto): Promise<ExamMatrixView> {
    const row = await this.shared.getMatrixRow(matrixId);
    await this.shared.requireMatrixCap(actorId, row, QUIZ_CAPABILITIES.manageMatrix);
    if (row.withdrawnAt && input.status !== undefined && input.status !== row.status) {
      conflict('Matrix is withdrawn; restore it before changing its status', 'quiz.matrix_status_withdrawn');
    }
    if (input.bankId !== undefined && input.bankId !== null && input.bankId !== row.bankId) {
      const target = await this.banks.findBankById(input.bankId);
      if (!target) notFound(`Matrix bank ${input.bankId} not found`, 'quiz.matrix_bank_not_found');
      if (target.bankKind !== 'matrix') {
        badRequest('Target bank is not a matrix bank', 'quiz.matrix_bank_kind_mismatch');
      }
      await this.banks.syncBankMembership(target);
      const targetCaps = await this.banks.bankLocalMatrixCaps(actorId, target);
      if (!targetCaps.add) {
        forbidden(`Missing capability ${QUIZ_CAPABILITIES.addMatrix} in matrix bank ${target.id}`, 'access.capability_denied');
      }
    }
    if (input.levelSet === 'three' && row.levelSet !== 'three') {
      const cells = await this.repo.listMatrixCells(row.id);
      if (cells.some((c) => c.cognitiveLevel === 'van_dung_cao')) {
        badRequest('Cells already use van_dung_cao; remove them before switching to the three-level set', 'quiz.matrix_level_in_use');
      }
    }
    const patch: Partial<ExamMatrixRow> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.targetFormPercents !== undefined) patch.targetFormPercents = input.targetFormPercents;
    if (input.targetLevelPercents !== undefined) patch.targetLevelPercents = input.targetLevelPercents;
    if (input.levelSet !== undefined) patch.levelSet = input.levelSet;
    if (input.scopeNote !== undefined) patch.scopeNote = input.scopeNote;
    if (input.scopeNodeIds !== undefined) patch.scopeNodeIds = input.scopeNodeIds;
    if (input.totalScore !== undefined) patch.totalScore = input.totalScore;
    if (input.bankId !== undefined) patch.bankId = input.bankId;
    if (input.status !== undefined) patch.status = input.status;
    if (input.isTemplate !== undefined) patch.isTemplate = input.isTemplate;
    const contentChanged = ['name', 'targetFormPercents', 'targetLevelPercents', 'levelSet', 'scopeNote', 'scopeNodeIds', 'totalScore']
      .some((k) => (patch as Record<string, unknown>)[k] !== undefined);
    const signatureChanged = ['name', 'levelSet', 'scopeNote', 'scopeNodeIds', 'totalScore', 'bankId']
      .some((k) => (patch as Record<string, unknown>)[k] !== undefined);
    if (signatureChanged) {
      const cells = await this.repo.listMatrixCells(row.id);
      patch.contentSignature = matrixContentSignature({
        name: patch.name ?? row.name,
        subjectId: row.subjectId,
        curriculumId: row.curriculumId,
        levelSet: patch.levelSet ?? row.levelSet,
        totalScore: patch.totalScore ?? row.totalScore,
        scopeNote: patch.scopeNote !== undefined ? patch.scopeNote : row.scopeNote,
        scopeNodeIds: patch.scopeNodeIds !== undefined ? patch.scopeNodeIds : row.scopeNodeIds,
        cells,
      });
    }
    if (contentChanged && row.status !== 'draft') {
      const config = {
        presetKind: row.presetKind,
        targetFormPercents: patch.targetFormPercents !== undefined ? patch.targetFormPercents : row.targetFormPercents,
        targetLevelPercents: patch.targetLevelPercents !== undefined ? patch.targetLevelPercents : row.targetLevelPercents,
        levelSet: patch.levelSet !== undefined ? patch.levelSet : row.levelSet,
        scopeNote: patch.scopeNote !== undefined ? patch.scopeNote : row.scopeNote,
        scopeNodeIds: patch.scopeNodeIds !== undefined ? patch.scopeNodeIds : row.scopeNodeIds,
        totalScore: patch.totalScore !== undefined ? patch.totalScore : row.totalScore,
      };
      try {
        await this.repo.transaction(async (tx) => {
          await this.forkMatrixVersion(row, actorId, config, tx);
          if (Object.keys(patch).length) await this.repo.updateMatrix(row.id, patch, tx);
        });
      } catch (err) {
        this.rethrowAsDuplicateContentConflict(err);
      }
    } else if (Object.keys(patch).length) {
      try {
        await this.repo.updateMatrix(row.id, patch);
      } catch (err) {
        this.rethrowAsDuplicateContentConflict(err);
      }
    }
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'exam_matrix_updated', payload: { matrixId: row.id, actorId } });
    return this.matrixView(await this.shared.getMatrixRow(matrixId));
  }

  async withdrawMatrix(actorId: string, matrixId: string, input: WithdrawExamMatrixDto): Promise<{ matrixId: string; status: string }> {
    const row = await this.shared.getMatrixRow(matrixId);
    await this.shared.requireMatrixCap(actorId, row, QUIZ_CAPABILITIES.manageMatrix);
    if (row.status === 'hidden') {
      conflict('Matrix is already withdrawn', 'quiz.matrix_already_withdrawn');
    }
    await this.repo.updateMatrix(row.id, {
      status: 'hidden',
      withdrawnReason: input.reason,
      withdrawnBy: actorId,
      withdrawnAt: new Date(),
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'exam_matrix_withdrawn',
      payload: { matrixId: row.id, actorId, reason: input.reason },
    });
    return { matrixId: row.id, status: 'hidden' };
  }

  async restoreMatrix(actorId: string, matrixId: string): Promise<{ matrixId: string; status: string }> {
    const row = await this.shared.getMatrixRow(matrixId);
    await this.shared.requireMatrixCap(actorId, row, QUIZ_CAPABILITIES.manageMatrix);
    if (row.status !== 'hidden') {
      conflict('Matrix is not withdrawn', 'quiz.matrix_not_withdrawn');
    }
    await this.repo.updateMatrix(row.id, {
      status: 'ready', withdrawnReason: null, withdrawnBy: null, withdrawnAt: null,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'exam_matrix_restored',
      payload: { matrixId: row.id, actorId },
    });
    return { matrixId: row.id, status: 'ready' };
  }

  async deleteMatrix(actorId: string, matrixId: string): Promise<void> {
    const row = await this.shared.getMatrixRow(matrixId);
    await this.shared.requireMatrixCap(actorId, row, QUIZ_CAPABILITIES.manageMatrix);
    await this.repo.deleteMatrix(row.id);
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'exam_matrix_deleted', payload: { matrixId: row.id, actorId } });
  }

  private matrixVersionConfigOf(source: {
    presetKind: string; targetFormPercents: Record<string, number> | null;
    targetLevelPercents: Record<string, number> | null; levelSet: string;
    scopeNote: string | null; scopeNodeIds: string[] | null; totalScore: number;
  }): {
    presetKind: string; targetFormPercents: Record<string, number> | null;
    targetLevelPercents: Record<string, number> | null; levelSet: string;
    scopeNote: string | null; scopeNodeIds: string[] | null; totalScore: number;
  } {
    return {
      presetKind: source.presetKind, targetFormPercents: source.targetFormPercents,
      targetLevelPercents: source.targetLevelPercents, levelSet: source.levelSet,
      scopeNote: source.scopeNote, scopeNodeIds: source.scopeNodeIds, totalScore: source.totalScore,
    };
  }

  private async ensureCurrentMatrixVersionRow(
    matrix: ExamMatrixRow, actorId: string, tx?: QuizTx,
  ): Promise<ExamMatrixVersionRow> {
    const existing = await this.repo.getMatrixVersionRow(matrix.id, matrix.version, tx);
    if (existing) return existing;
    return this.repo.insertMatrixVersion({
      matrixId: matrix.id, version: matrix.version,
      ...this.matrixVersionConfigOf(matrix),
      createdBy: matrix.createdBy ?? actorId,
    }, tx);
  }

  private async forkMatrixVersion(
    matrix: ExamMatrixRow, actorId: string,
    config: ReturnType<QuizMatricesService['matrixVersionConfigOf']>,
    tx: QuizTx,
  ): Promise<ExamMatrixVersionRow> {
    const current = await this.ensureCurrentMatrixVersionRow(matrix, actorId, tx);
    const currentCells = await this.repo.listMatrixCellsByVersionId(current.id, tx);
    const next = await this.repo.insertMatrixVersion({
      matrixId: matrix.id, version: matrix.version + 1, ...config, createdBy: actorId,
    }, tx);
    for (const cell of currentCells) {
      await this.repo.insertMatrixCell({
        matrixId: matrix.id, matrixVersionId: next.id,
        curriculumNodeId: cell.curriculumNodeId, cognitiveLevel: cell.cognitiveLevel,
        qtype: cell.qtype, questionCount: cell.questionCount, cellScore: cell.cellScore,
        minutes: cell.minutes, tfScale: cell.tfScale, position: cell.position,
      }, tx);
    }
    await this.repo.updateMatrix(matrix.id, { version: matrix.version + 1 }, tx);
    return next;
  }

  private async getMatrixCellRow(matrix: ExamMatrixRow, cellId: string): Promise<ExamMatrixCellRow> {
    const row = await this.repo.getMatrixCell(cellId);
    if (!row || row.matrixId !== matrix.id) {
      notFound(`Exam matrix cell ${cellId} not found`, 'quiz.matrix_cell_not_found');
    }
    return row;
  }

  async createMatrixCell(actorId: string, matrixId: string, input: CreateExamMatrixCellDto): Promise<ExamMatrixView> {
    const matrix = await this.shared.getMatrixRow(matrixId);
    await this.shared.requireMatrixCap(actorId, matrix, QUIZ_CAPABILITIES.manageMatrix);
    this.assertValidTfScale(input.tfScale);
    if (matrix.levelSet === 'three' && input.cognitiveLevel === 'van_dung_cao') {
      badRequest('van_dung_cao is not part of the three-level set of this matrix', 'quiz.matrix_level_not_in_set');
    }
    if (matrix.scopeNodeIds && matrix.scopeNodeIds.length && !matrix.scopeNodeIds.includes(input.curriculumNodeId)) {
      badRequest('Curriculum node is outside the taught scope of this matrix', 'quiz.matrix_cell_out_of_scope');
    }
    const node = await this.curriculum.getNode(actorId, input.curriculumNodeId);
    if (node.curriculumId !== matrix.curriculumId) {
      badRequest('Curriculum node does not belong to the curriculum of this matrix', 'quiz.matrix_cell_node_mismatch');
    }
    const cells = await this.repo.listMatrixCells(matrix.id);
    if (cells.some((c) => c.curriculumNodeId === input.curriculumNodeId && c.cognitiveLevel === input.cognitiveLevel && c.qtype === input.qtype)) {
      badRequest('A cell already exists for this curriculum node, level and question type', 'quiz.matrix_cell_exists');
    }
    const position = input.position ?? (cells.length ? Math.max(...cells.map((c) => c.position)) + 1 : 1);
    const cellValues = {
      matrixId: matrix.id, curriculumNodeId: input.curriculumNodeId,
      cognitiveLevel: input.cognitiveLevel, qtype: input.qtype,
      questionCount: input.questionCount, cellScore: input.cellScore,
      minutes: input.minutes ?? null, tfScale: input.tfScale ?? null, position,
    };
    try {
      if (matrix.status !== 'draft') {
        await this.repo.transaction(async (tx) => {
          const next = await this.forkMatrixVersion(matrix, actorId, this.matrixVersionConfigOf(matrix), tx);
          await this.repo.insertMatrixCell({ ...cellValues, matrixVersionId: next.id }, tx);
          await this.refreshMatrixContentSignature(matrix.id, tx);
        });
      } else {
        await this.repo.transaction(async (tx) => {
          const current = await this.ensureCurrentMatrixVersionRow(matrix, actorId, tx);
          await this.repo.insertMatrixCell({ ...cellValues, matrixVersionId: current.id }, tx);
          await this.refreshMatrixContentSignature(matrix.id, tx);
        });
      }
    } catch (err) {
      this.rethrowAsDuplicateContentConflict(err);
    }
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'exam_matrix_cell_created', payload: { matrixId: matrix.id, actorId } });
    return this.matrixView(await this.shared.getMatrixRow(matrixId));
  }

  async updateMatrixCell(actorId: string, matrixId: string, cellId: string, input: UpdateExamMatrixCellDto): Promise<ExamMatrixView> {
    const matrix = await this.shared.getMatrixRow(matrixId);
    await this.shared.requireMatrixCap(actorId, matrix, QUIZ_CAPABILITIES.manageMatrix);
    const cell = await this.getMatrixCellRow(matrix, cellId);
    this.assertValidTfScale(input.tfScale);
    const patch: Partial<ExamMatrixCellRow> = {};
    if (input.questionCount !== undefined) patch.questionCount = input.questionCount;
    if (input.cellScore !== undefined) patch.cellScore = input.cellScore;
    if (input.minutes !== undefined) patch.minutes = input.minutes;
    if (input.tfScale !== undefined) patch.tfScale = input.tfScale;
    if (input.position !== undefined) patch.position = input.position;
    if (Object.keys(patch).length) {
      const touchesSignature = patch.questionCount !== undefined || patch.cellScore !== undefined;
      if (matrix.status !== 'draft') {
        try {
          await this.repo.transaction(async (tx) => {
            const next = await this.forkMatrixVersion(matrix, actorId, this.matrixVersionConfigOf(matrix), tx);
            const copies = await this.repo.listMatrixCellsByVersionId(next.id, tx);
            const copy = copies.find((c) => c.curriculumNodeId === cell.curriculumNodeId
              && c.cognitiveLevel === cell.cognitiveLevel && c.qtype === cell.qtype);
            if (copy) await this.repo.updateMatrixCell(copy.id, patch, tx);
            if (touchesSignature) await this.refreshMatrixContentSignature(matrix.id, tx);
          });
        } catch (err) {
          this.rethrowAsDuplicateContentConflict(err);
        }
      } else if (touchesSignature) {
        try {
          await this.repo.transaction(async (tx) => {
            await this.repo.updateMatrixCell(cell.id, patch, tx);
            await this.refreshMatrixContentSignature(matrix.id, tx);
          });
        } catch (err) {
          this.rethrowAsDuplicateContentConflict(err);
        }
      } else {
        await this.repo.updateMatrixCell(cell.id, patch);
      }
    }
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'exam_matrix_cell_updated', payload: { matrixId: matrix.id, cellId: cell.id, actorId } });
    return this.matrixView(await this.shared.getMatrixRow(matrixId));
  }

  async deleteMatrixCell(actorId: string, matrixId: string, cellId: string): Promise<ExamMatrixView> {
    const matrix = await this.shared.getMatrixRow(matrixId);
    await this.shared.requireMatrixCap(actorId, matrix, QUIZ_CAPABILITIES.manageMatrix);
    const cell = await this.getMatrixCellRow(matrix, cellId);
    try {
      if (matrix.status !== 'draft') {
        await this.repo.transaction(async (tx) => {
          const next = await this.forkMatrixVersion(matrix, actorId, this.matrixVersionConfigOf(matrix), tx);
          const copies = await this.repo.listMatrixCellsByVersionId(next.id, tx);
          const copy = copies.find((c) => c.curriculumNodeId === cell.curriculumNodeId
            && c.cognitiveLevel === cell.cognitiveLevel && c.qtype === cell.qtype);
          if (copy) await this.repo.deleteMatrixCell(copy.id, tx);
          await this.refreshMatrixContentSignature(matrix.id, tx);
        });
      } else {
        await this.repo.transaction(async (tx) => {
          await this.repo.deleteMatrixCell(cell.id, tx);
          await this.refreshMatrixContentSignature(matrix.id, tx);
        });
      }
    } catch (err) {
      this.rethrowAsDuplicateContentConflict(err);
    }
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'exam_matrix_cell_deleted', payload: { matrixId: matrix.id, cellId: cell.id, actorId } });
    return this.matrixView(await this.shared.getMatrixRow(matrixId));
  }

  private async cellAvailableCount(actorId: string, cell: Pick<ExamMatrixCellRow, 'curriculumNodeId' | 'cognitiveLevel' | 'qtype'>): Promise<number> {
    return this.shared.cellCandidateCountForUser(actorId, cell);
  }

  async matrixAvailability(actorId: string, matrixId: string): Promise<{ matrixId: string; cells: MatrixCellAvailability[]; sufficient: boolean }> {
    const matrix = await this.shared.getMatrixRow(matrixId);
    await this.shared.requireMatrixCap(actorId, matrix, QUIZ_CAPABILITIES.viewMatrix);
    const cells = await this.repo.listMatrixCells(matrix.id);
    const out: MatrixCellAvailability[] = [];
    for (const cell of cells) {
      const available = await this.cellAvailableCount(actorId, cell);
      out.push({ cellId: cell.id, required: cell.questionCount, available, deficit: Math.max(0, cell.questionCount - available) });
    }
    return { matrixId: matrix.id, cells: out, sufficient: out.every((c) => c.deficit === 0) };
  }

  async importAvailability(actorId: string, cells: { curriculumNodeId: string; cognitiveLevel: string; qtype: string; questionCount: number }[]): Promise<MatrixImportCellAvailability[]> {
    const out: MatrixImportCellAvailability[] = [];
    for (const cell of cells) {
      const available = await this.cellAvailableCount(actorId, cell);
      out.push({
        curriculumNodeId: cell.curriculumNodeId,
        cognitiveLevel: cell.cognitiveLevel as MatrixImportCellAvailability['cognitiveLevel'],
        qtype: cell.qtype as MatrixImportCellAvailability['qtype'],
        required: cell.questionCount, available, deficit: Math.max(0, cell.questionCount - available),
      });
    }
    return out;
  }
}
