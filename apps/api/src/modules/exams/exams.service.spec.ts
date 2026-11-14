import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ExamsService } from './exams.service';

const ACTOR = 'actor-1';
const OTHER = 'actor-2';
const CTX = 'ctx-1';
const SYSTEM_CTX = 'ctx-system';

function paperRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, bankId: 'bank-1', kind: 'snapshot', status: 'ready', tenantId: null,
    createdBy: ACTOR, latestVersion: 1, copyCount: 0,
    withdrawnReason: null, withdrawnBy: null, withdrawnAt: null,
    createdAt: new Date(), updatedAt: new Date(),
    derivedFromExamId: null, derivedFromMatrixId: null, derivedFromBankId: null,
    derivedFromVersionNumber: null, originalAuthorId: null,
    pinRequestId: null, pinRequestCourseId: null, sharedExamVersionId: null,
    systemExamForkVersionId: null, sharedSourceExamId: null, sharedSourceVersionNumber: null,
    sharedRequestedSectionId: null, sharedRequestChecksum: null, ...overrides,
  };
}

function versionRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, examId: 'paper-1', version: 1, name: 'Đề giữa kỳ',
    subjectId: null, grade: null, examKind: null, totalScore: 10,
    durationMinutes: null, tfScale: null, matrixId: null,
    matrixVersion: null, matrixVersionId: null,
    createdBy: ACTOR, createdAt: new Date(), ...overrides,
  };
}

function bankRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, tenantId: null, name: 'Ngân hàng đề thi', bankKind: 'exam', scope: 'course',
    ownerId: null, scopeRefId: null, contextId: CTX, status: 'ready',
    createdBy: ACTOR, createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function contributionRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, examId: 'paper-1', targetBankId: 'bank-1', proposerId: ACTOR,
    note: '', mode: 'new', targetExamId: null, contentHash: 'hash-1',
    nearDuplicateOf: null, status: 'pending', reviewerId: null,
    rejectReason: null, resultExamId: null,
    dossierExamVersionId: null, dossierExamVersionNumber: null,
    dossierMatrixId: null, dossierMatrixVersion: null,
    dossierMatrixVersionId: null, dossierSpecSnapshot: null,
    sourceDossierId: null, createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function buildService() {
  const repo = {
    getPaper: vi.fn(async () => undefined),
    getVersionByNumber: vi.fn(async () => undefined),
    getVersion: vi.fn(async () => undefined),
    listSlots: vi.fn(async () => []),
    listSlotQuestionInfo: vi.fn(async () => []),
    listQuestionEntryStatuses: vi.fn(async () => []),
    listPinsOfExam: vi.fn(async () => []),
    questionExists: vi.fn(async () => false),
    resolveReadyVersion: vi.fn(async () => undefined),
    getContribution: vi.fn(async () => undefined),
    deletePaper: vi.fn(async () => undefined),
    updatePaper: vi.fn(async () => undefined),
    insertVersion: vi.fn(async (input: Record<string, unknown>) => versionRow('v-new', input)),
    insertSlots: vi.fn(async () => undefined),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
  };
  const banks = {
    getBank: vi.fn(async () => undefined),
    getBankOrThrow: vi.fn(async () => undefined),
    ensurePersonalBank: vi.fn(async () => undefined),
    getQuestionBankInfos: vi.fn(async () => new Map()),
    displayNames: vi.fn(async () => new Map()),
  };
  const contexts = {
    ensureSystemContext: vi.fn(async () => ({ id: SYSTEM_CTX })),
  };
  const evaluator = {
    requireCapability: vi.fn(async () => undefined),
    hasCapability: vi.fn(async () => true),
    isSiteAdmin: vi.fn(async () => false),
  };
  const roles = {
    getRoleByShortname: vi.fn(async () => undefined),
    setCapabilityOverride: vi.fn(async () => undefined),
  };
  const quiz = {
    getPinRow: vi.fn(async () => undefined),
    createPinRecord: vi.fn(async () => undefined),
    getPinByRequest: vi.fn(async () => undefined),
    cellPoolContains: vi.fn(async () => false),
  };
  const snapshots = {
    readSystem: vi.fn(async () => undefined),
    readLocal: vi.fn(async () => undefined),
    excerpt: vi.fn(() => null),
  };
  const outbox = {
    enqueueStandalone: vi.fn(async () => undefined),
  };
  const tenantContext = {
    currentTenantId: vi.fn(() => undefined as string | undefined),
  };
  const tenantConfig = {
    getEffectiveValue: vi.fn(async () => undefined),
  };
  const siteConfig = {
    getValue: vi.fn(async () => undefined),
  };
  const service = new ExamsService(
    snapshots as never, repo as never, banks as never, contexts as never,
    evaluator as never, roles as never, quiz as never, outbox as never,
    tenantContext as never, tenantConfig as never, siteConfig as never,
  );
  return { service, repo, banks, contexts, evaluator, roles, quiz, snapshots, outbox, tenantContext };
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

function problem(error: unknown): { message?: string; code?: string } {
  return (error as { getResponse(): { message?: string; code?: string } }).getResponse();
}

describe('ExamsService — thứ tự guard và mã lỗi not-found giữ nguyên khi gom helper', () => {
  it('đề thi không tồn tại thì getPaperOrThrow báo exam.not_found kèm id', async () => {
    const { service } = buildService();
    const error = await capture(service.getPaperOrThrow('paper-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Exam paper paper-9 not found', code: 'exam.not_found' });
  });

  it('đề thi không phải snapshot thì getPaperOrThrow báo exam.not_found kèm id', async () => {
    const { service, repo } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1', { kind: 'template' }) as never);
    const error = await capture(service.getPaperOrThrow('paper-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Exam paper paper-1 not found', code: 'exam.not_found' });
  });

  it('đề thi snapshot tồn tại thì getPaperOrThrow trả về đúng đề thi', async () => {
    const { service, repo } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1') as never);
    await expect(service.getPaperOrThrow('paper-1')).resolves.toMatchObject({ id: 'paper-1' });
  });

  it('đề thi thiếu phiên bản hiện tại thì currentVersion báo exam.version_not_found kèm id và số phiên bản', async () => {
    const { service, repo } = buildService();
    repo.getVersionByNumber.mockResolvedValue(undefined as never);
    const error = await capture(service.currentVersion(paperRow('paper-1', { latestVersion: 3 }) as never));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Paper paper-1 has no version 3', code: 'exam.version_not_found' });
  });

  it('ngân hàng không phải exam thì getExamBank báo exam.not_exam_bank kèm id', async () => {
    const { service, banks, roles } = buildService();
    banks.getBank.mockResolvedValue(bankRow('bank-1', { bankKind: 'course' }) as never);
    const error = await capture(service.getExamBank(ACTOR, 'bank-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Bank bank-1 is not an exam bank', code: 'exam.not_exam_bank' });
    expect(roles.getRoleByShortname).not.toHaveBeenCalled();
  });

  it('ngân hàng exam thì getExamBank trả về ngân hàng đó', async () => {
    const { service, banks } = buildService();
    banks.getBank.mockResolvedValue(bankRow('bank-1') as never);
    await expect(service.getExamBank(ACTOR, 'bank-1')).resolves.toMatchObject({ id: 'bank-1', bankKind: 'exam' });
  });

  it('đề thi thuộc tenant khác thì getPaper báo exam.not_found và chưa chạm tới ngân hàng', async () => {
    const { service, repo, banks, tenantContext } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1', { tenantId: 'tenant-1' }) as never);
    tenantContext.currentTenantId.mockReturnValue('tenant-x');
    const error = await capture(service.getPaper(ACTOR, 'paper-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Exam paper paper-1 not found', code: 'exam.not_found' });
    expect(banks.getBankOrThrow).not.toHaveBeenCalled();
  });

  it('đề thi xem được thì getPaper trả về khung nhìn của đề thi', async () => {
    const { service, repo, banks, evaluator, outbox } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1') as never);
    repo.getVersionByNumber.mockResolvedValue(versionRow('v-1') as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    evaluator.isSiteAdmin.mockResolvedValue(true);
    const view = await service.getPaper(ACTOR, 'paper-1');
    expect(view.paper.id).toBe('paper-1');
    expect(view.version.name).toBe('Đề giữa kỳ');
    expect(outbox.enqueueStandalone).not.toHaveBeenCalled();
  });

  it('cập nhật đề thi không tồn tại thì báo exam.not_found trước khi kiểm tra quyền', async () => {
    const { service, banks, evaluator } = buildService();
    const error = await capture(service.updatePaper(ACTOR, 'paper-9', {}));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Exam paper paper-9 not found', code: 'exam.not_found' });
    expect(banks.getBankOrThrow).not.toHaveBeenCalled();
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
  });

  it('người không phải tác giả và không có quyền moderate thì cập nhật đề thi bị chặn bằng exam.edit_not_owner', async () => {
    const { service, repo, banks, evaluator } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1', { createdBy: OTHER }) as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    evaluator.hasCapability.mockResolvedValue(false);
    const error = await capture(service.updatePaper(ACTOR, 'paper-1', {}));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(problem(error)).toEqual({
      message: 'Only the paper author or a bank moderator can modify this paper',
      code: 'exam.edit_not_owner',
    });
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('quản trị viên hệ thống xóa đề thi thì bỏ qua kiểm tra quyền edit', async () => {
    const { service, repo, banks, evaluator } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1', { createdBy: OTHER }) as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    evaluator.isSiteAdmin.mockResolvedValue(true);
    await expect(service.deletePaper(ACTOR, 'paper-1')).resolves.toEqual({ id: 'paper-1', deleted: true });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
    expect(repo.deletePaper).toHaveBeenCalledWith('paper-1');
  });

  it('liệt kê pin của đề thi không tồn tại thì báo exam.not_found và chưa kiểm tra quyền xem', async () => {
    const { service, repo, evaluator } = buildService();
    const error = await capture(service.listPins(ACTOR, 'paper-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Exam paper paper-9 not found', code: 'exam.not_found' });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
    expect(repo.listPinsOfExam).not.toHaveBeenCalled();
  });

  it('đề thi nháp của người khác mà thiếu quyền moderate thì liệt kê pin bị chặn ngay tại cổng xem', async () => {
    const { service, repo, banks, evaluator } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1', { status: 'draft', createdBy: OTHER }) as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    evaluator.requireCapability.mockRejectedValue(new Error('khong-co-quyen-xem'));
    const error = await capture(service.listPins(ACTOR, 'paper-1'));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('khong-co-quyen-xem');
    expect(repo.listPinsOfExam).not.toHaveBeenCalled();
  });

  it('đề thi ready thì liệt kê pin trả về danh sách pin của đề thi', async () => {
    const { service, repo, banks } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1') as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    await expect(service.listPins(ACTOR, 'paper-1')).resolves.toEqual([]);
  });

  it('gán câu hỏi không tồn tại vào đề thi thì báo exam.slot_question_not_found chứ không phải question.not_found', async () => {
    const { service, repo, banks } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1') as never);
    repo.getVersionByNumber.mockResolvedValue(versionRow('v-1') as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    repo.questionExists.mockResolvedValue(false);
    const error = await capture(service.setSlots(ACTOR, 'paper-1', { slots: [{ questionId: 'q-9' }] }));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-9 not found', code: 'exam.slot_question_not_found' });
    expect(repo.resolveReadyVersion).not.toHaveBeenCalled();
  });

  it('gán câu hỏi chưa có phiên bản ready thì báo exam.slot_question_not_ready', async () => {
    const { service, repo, banks, snapshots } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1') as never);
    repo.getVersionByNumber.mockResolvedValue(versionRow('v-1') as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    repo.questionExists.mockResolvedValue(true);
    repo.resolveReadyVersion.mockResolvedValue(undefined as never);
    const error = await capture(service.setSlots(ACTOR, 'paper-1', { slots: [{ questionId: 'q-1' }] }));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(problem(error)).toEqual({ code: 'exam.slot_question_not_ready' });
    expect(snapshots.readLocal).not.toHaveBeenCalled();
  });

  it('duyệt đóng góp không tồn tại thì báo exam.contribution_not_found trước khi kiểm tra quyền', async () => {
    const { service, banks, evaluator } = buildService();
    banks.getBank.mockResolvedValue(bankRow('bank-1') as never);
    const error = await capture(service.approveContribution(ACTOR, 'bank-1', 'contrib-9', {}));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Contribution contrib-9 not found', code: 'exam.contribution_not_found' });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
    expect(evaluator.hasCapability).not.toHaveBeenCalled();
  });

  it('đóng góp đã hết pending thì duyệt cấp 1 báo exam.contribution_not_pending', async () => {
    const { service, repo, banks } = buildService();
    banks.getBank.mockResolvedValue(bankRow('bank-1') as never);
    repo.getContribution.mockResolvedValue(contributionRow('contrib-1', { status: 'approved' }) as never);
    const error = await capture(service.approveContribution(ACTOR, 'bank-1', 'contrib-1', {}));
    expect(error).toBeInstanceOf(ConflictException);
    expect(problem(error)).toEqual({ message: 'Contribution is no longer pending', code: 'exam.contribution_not_pending' });
  });

  it('đổi câu hỏi tại vị trí không có slot thì báo exam.slot_not_found kèm vị trí', async () => {
    const { service, repo, banks, quiz } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1') as never);
    repo.getVersionByNumber.mockResolvedValue(versionRow('v-1') as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    repo.listSlots.mockResolvedValue([]);
    const error = await capture(service.swapSlot(ACTOR, 'paper-1', { position: 3, questionId: 'q-2' }));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Paper slot 3 not found', code: 'exam.slot_not_found' });
    expect(quiz.cellPoolContains).not.toHaveBeenCalled();
  });

  it('ghim đề thi với phiên bản không thuộc đề thi thì báo exam.version_not_found kèm id phiên bản và id đề thi', async () => {
    const { service, repo, banks, quiz } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1') as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    repo.getVersion.mockResolvedValue(versionRow('v-9', { examId: 'paper-other' }) as never);
    const error = await capture(service.createPin(ACTOR, 'course-1', { sectionId: 'section-1', examId: 'paper-1', examVersionId: 'v-9' }));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Exam version v-9 not found for exam paper-1', code: 'exam.version_not_found' });
    expect(quiz.createPinRecord).not.toHaveBeenCalled();
  });

  it('in đề thi mà pin không thuộc đề thi thì báo exam.pin_not_found kèm id pin', async () => {
    const { service, repo, banks, quiz } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1') as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    quiz.getPinRow.mockResolvedValue(undefined as never);
    const error = await capture(service.printPaperHtml(ACTOR, 'paper-1', 'pin-9', 'A'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Pin pin-9 not found for this exam', code: 'exam.pin_not_found' });
    expect(repo.getVersion).not.toHaveBeenCalled();
  });

  it('in đề thi mà mã đề không tồn tại thì báo exam.variant_not_found kèm mã đề', async () => {
    const { service, repo, banks, quiz } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1') as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    quiz.getPinRow.mockResolvedValue({ id: 'pin-1', examId: 'paper-1', variants: [] } as never);
    const error = await capture(service.printPaperHtml(ACTOR, 'paper-1', 'pin-1', 'A'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Variant A not found in this deployment', code: 'exam.variant_not_found' });
    expect(repo.getVersion).not.toHaveBeenCalled();
  });

  it('in đề thi mà phiên bản đã triển khai không còn thì báo exam.version_not_found không kèm id', async () => {
    const { service, repo, banks, quiz } = buildService();
    repo.getPaper.mockResolvedValue(paperRow('paper-1') as never);
    banks.getBankOrThrow.mockResolvedValue(bankRow('bank-1') as never);
    quiz.getPinRow.mockResolvedValue({ id: 'pin-1', examId: 'paper-1', examVersionId: 'v-1', variants: [{ code: 'A', seed: 7 }] } as never);
    repo.getVersion.mockResolvedValue(undefined as never);
    const error = await capture(service.printPaperHtml(ACTOR, 'paper-1', 'pin-1', 'A'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Deployed paper version not found', code: 'exam.version_not_found' });
  });

  it('sao chép đề thi nguồn không tồn tại thì báo exam.not_found trước khi tìm ngân hàng đích', async () => {
    const { service, banks, evaluator } = buildService();
    const error = await capture(service.copyPaper(ACTOR, 'paper-9', {}));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Exam paper paper-9 not found', code: 'exam.not_found' });
    expect(banks.ensurePersonalBank).not.toHaveBeenCalled();
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
  });
});
