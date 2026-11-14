import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { QuestionBanksService } from './question-banks.service';

const ACTOR = 'actor-1';
const OTHER = 'actor-2';

function bankRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, tenantId: null, name: 'Ngân hàng', bankKind: 'question', scope: 'course',
    ownerId: null, scopeRefId: null, contextId: 'bctx', createdBy: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function categoryRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, name: 'Danh mục', contextId: 'cctx', bankId: null, info: '', parent: null,
    sortOrder: 0, stamp: 'qcat-1', createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function questionRow(id: string, categoryId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, category: categoryId, qtype: 'multichoice', createdBy: ACTOR, modifiedBy: ACTOR,
    derivedFromQuestionId: null, derivedFromVersionId: null, derivedFromBankId: null,
    originalAuthorId: null, sourceKind: 'manual', sourceRef: null, idnumber: null,
    copyCount: 0, ...overrides,
  };
}

function entryRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, questionCategoryId: 'cat-1', questionId: 'q-1', latestVersion: 1, status: 'ready', ...overrides };
}

function versionRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, questionBankEntryId: 'entry-1', questionId: 'q-1', version: 1,
    questionText: { type: 'doc', content: [] }, generalFeedback: null,
    defaultMark: 1, penalty: 0, stimulusId: null, status: 'ready', ...overrides,
  };
}

function buildService() {
  const repo = {
    getBank: vi.fn(async () => undefined),
    getBanksByIds: vi.fn(async () => []),
    getBankByScopeRef: vi.fn(async () => undefined),
    getPersonalBank: vi.fn(async () => undefined),
    getSchoolBank: vi.fn(async () => undefined),
    getPlatformBank: vi.fn(async () => undefined),
    listBanks: vi.fn(async () => []),
    listBanksByScopeRefs: vi.fn(async () => []),
    listSchoolBanksByTenantIds: vi.fn(async () => []),
    listCategoriesOfBank: vi.fn(async () => []),
    getUserDisplayNames: vi.fn(async () => new Map()),
    countSlotsByQuestionIds: vi.fn(async () => new Map()),
    listPinIdsUsingQuestion: vi.fn(async () => []),
    countAttemptsOfQuestion: vi.fn(async () => 0),
    updateEntry: vi.fn(async () => undefined),
    deleteQuestionRow: vi.fn(async () => undefined),
    listContributions: vi.fn(async () => []),
    getContribution: vi.fn(async () => undefined),
    insertContribution: vi.fn(async () => undefined),
    updateContribution: vi.fn(async () => undefined),
    listContainingExams: vi.fn(async () => []),
    listUserIdsWithArchetypes: vi.fn(async () => []),
    getCourseTenantId: vi.fn(async () => undefined),
    listQuestionsWithEntryInCategories: vi.fn(async () => []),
    listOutcomeIdsForNode: vi.fn(async () => []),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
  };
  const questionsRepo = {
    getQuestion: vi.fn(async () => undefined),
    getCategory: vi.fn(async () => undefined),
    getBankById: vi.fn(async () => undefined),
    getBankByContextId: vi.fn(async () => undefined),
    getEntryByQuestion: vi.fn(async () => undefined),
    getVersionByNumber: vi.fn(async () => undefined),
    getVersion: vi.fn(async () => undefined),
    listAnswers: vi.fn(async () => []),
    getAnswerKey: vi.fn(async () => undefined),
    listCategories: vi.fn(async () => []),
    getQuestionsByIds: vi.fn(async () => []),
    getEntriesByQuestionIds: vi.fn(async () => []),
    getCategoriesByIds: vi.fn(async () => []),
    listVersionsForEntries: vi.fn(async () => []),
    getStimulus: vi.fn(async () => undefined),
    updateEntry: vi.fn(async () => undefined),
    updateVersion: vi.fn(async () => undefined),
    updateQuestion: vi.fn(async () => undefined),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
  };
  const questions = {
    getQuestion: vi.fn(async () => undefined),
    getCategory: vi.fn(async () => undefined),
  };
  const contexts = {
    getContext: vi.fn(async () => undefined),
    getContextsByIds: vi.fn(async () => []),
    getByLevelInstance: vi.fn(async () => undefined),
    ensureSystemContext: vi.fn(async () => ({ id: 'ctx-system' })),
    ensureTenantContext: vi.fn(async () => ({ id: 'ctx-tenant' })),
    createContext: vi.fn(async () => ({ id: 'ctx-new' })),
    getPathContexts: vi.fn(async () => []),
  };
  const evaluator = {
    requireCapability: vi.fn(async () => undefined),
    hasCapability: vi.fn(async (_actor: string, _cap: string, _contextId: string) => true),
    isSiteAdmin: vi.fn(async () => false),
  };
  const roles = {
    getRoleByShortname: vi.fn(async () => undefined),
    createRole: vi.fn(async () => undefined),
    setCapabilityOverride: vi.fn(async () => undefined),
    listAssignments: vi.fn(async () => []),
    assignRole: vi.fn(async () => undefined),
    unassignRole: vi.fn(async () => undefined),
  };
  const groups = {
    getCohort: vi.fn(async () => undefined),
    listCohortMembers: vi.fn(async () => []),
  };
  const outbox = {
    enqueueStandalone: vi.fn(async () => undefined),
    enqueueKysely: vi.fn(async () => undefined),
  };
  const tenantContext = {
    currentTenantId: vi.fn((): string | undefined => undefined),
  };
  const tenantRepo = {
    getTenant: vi.fn(async () => undefined),
    listMembershipsForTenant: vi.fn(async () => []),
  };
  const tenants = {
    fallbackTenantId: vi.fn(async () => 'tenant-fallback'),
  };
  const service = new QuestionBanksService(
    repo as never, questionsRepo as never, questions as never, contexts as never,
    evaluator as never, roles as never, groups as never, outbox as never,
    tenantContext as never, tenantRepo as never, tenants as never,
  );
  return { service, repo, questionsRepo, questions, contexts, evaluator, roles, groups, outbox, tenantContext, tenantRepo, tenants };
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

function governableQuestion(built: ReturnType<typeof buildService>): void {
  built.questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
  built.questions.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
}

describe('QuestionBanksService — mã lỗi not-found giữ nguyên khi gom factory dùng chung', () => {
  it('bank không tồn tại thì getBankOrThrow báo question.bank_not_found kèm id', async () => {
    const { service } = buildService();
    const error = await capture(service.getBankOrThrow('bank-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question bank bank-9 not found', code: 'question.bank_not_found' });
  });

  it('bank tồn tại thì getBankOrThrow trả đúng bank', async () => {
    const { service, repo } = buildService();
    repo.getBank.mockResolvedValue(bankRow('bank-1') as never);
    await expect(service.getBankOrThrow('bank-1')).resolves.toMatchObject({ id: 'bank-1' });
  });

  it('bank không tồn tại thì getBank báo question.bank_not_found kèm id', async () => {
    const { service } = buildService();
    const error = await capture(service.getBank(ACTOR, 'bank-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question bank bank-9 not found', code: 'question.bank_not_found' });
  });

  it('bank thuộc tenant khác đang active thì getBank báo question.bank_not_found kèm id', async () => {
    const { service, repo, tenantContext } = buildService();
    tenantContext.currentTenantId.mockReturnValue('tenant-active');
    repo.getBank.mockResolvedValue(bankRow('bank-1', { scope: 'school', tenantId: 'tenant-other' }) as never);
    const error = await capture(service.getBank(ACTOR, 'bank-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question bank bank-1 not found', code: 'question.bank_not_found' });
  });

  it('bank cá nhân của người khác thì getBank báo question.bank_not_found kèm id', async () => {
    const { service, repo } = buildService();
    repo.getBank.mockResolvedValue(bankRow('bank-1', { scope: 'personal', ownerId: OTHER }) as never);
    const error = await capture(service.getBank(ACTOR, 'bank-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question bank bank-1 not found', code: 'question.bank_not_found' });
  });

  it('bank dùng được thì getBank trả view kèm quyền và danh mục mặc định', async () => {
    const { service, repo } = buildService();
    repo.getBank.mockResolvedValue(bankRow('bank-1') as never);
    const view = await service.getBank(ACTOR, 'bank-1');
    expect(view.id).toBe('bank-1');
    expect(view.capabilities.use).toBe(true);
    expect(view.defaultCategoryId).toBeNull();
    expect(view.categoryIds).toEqual([]);
  });

  it('câu hỏi không tồn tại thì kiểm tra dùng trong đề thi báo question.not_found', async () => {
    const { service } = buildService();
    const error = await capture(service.assertCanUseQuestionInExam(ACTOR, 'q-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-9 not found', code: 'question.not_found' });
  });

  it('câu hỏi có nhưng danh mục không tồn tại thì kiểm tra dùng trong đề thi báo question.not_found', async () => {
    const { service, questionsRepo } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-9') as never);
    const error = await capture(service.assertCanUseQuestionInExam(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
  });

  it('danh mục gắn bank nhưng bank không tồn tại thì kiểm tra dùng trong đề thi báo question.not_found', async () => {
    const { service, questionsRepo } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    questionsRepo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-9' }) as never);
    const error = await capture(service.assertCanUseQuestionInExam(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
  });

  it('actor không có quyền dùng bank thì kiểm tra dùng trong đề thi báo question.not_found thay vì forbidden', async () => {
    const { service, repo, questionsRepo, evaluator } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    questionsRepo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-1' }) as never);
    repo.getBank.mockResolvedValue(bankRow('bank-1') as never);
    evaluator.hasCapability.mockImplementation(async (_actor: string, _cap: string, ctx: string) => ctx !== 'bctx');
    const error = await capture(service.assertCanUseQuestionInExam(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
  });

  it('actor không có quyền dùng danh mục thì kiểm tra dùng trong đề thi báo question.not_found', async () => {
    const { service, questionsRepo, evaluator } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    questionsRepo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    evaluator.hasCapability.mockImplementation(async (_actor: string, _cap: string, ctx: string) => ctx !== 'cctx');
    const error = await capture(service.assertCanUseQuestionInExam(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
  });

  it('lỗi không phải guard khi kiểm tra bank thì kiểm tra dùng trong đề thi để lỗi đó lan ra nguyên vẹn', async () => {
    const { service, repo, questionsRepo, evaluator } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    questionsRepo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-1' }) as never);
    repo.getBank.mockResolvedValue(bankRow('bank-1') as never);
    evaluator.hasCapability.mockImplementation(async (_actor: string, _cap: string, ctx: string) => {
      if (ctx === 'bctx') throw new Error('boom');
      return true;
    });
    const error = await capture(service.assertCanUseQuestionInExam(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe('boom');
  });

  it('actor có quyền thì kiểm tra dùng trong đề thi cho qua không lỗi', async () => {
    const { service, repo, questionsRepo } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    questionsRepo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-1' }) as never);
    repo.getBank.mockResolvedValue(bankRow('bank-1') as never);
    await expect(service.assertCanUseQuestionInExam(ACTOR, 'q-1')).resolves.toBeUndefined();
  });

  it('câu hỏi không tồn tại thì getAttribution báo question.not_found kèm id', async () => {
    const { service } = buildService();
    const error = await capture(service.getAttribution('q-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-9 not found', code: 'question.not_found' });
  });

  it('câu hỏi tồn tại thì getAttribution trả nguồn gốc và số lần dùng', async () => {
    const { service, repo, questionsRepo } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1', { copyCount: 2 }) as never);
    repo.getUserDisplayNames.mockResolvedValue(new Map() as never);
    repo.countSlotsByQuestionIds.mockResolvedValue(new Map([['q-1', 3]]) as never);
    const view = await service.getAttribution('q-1');
    expect(view.questionId).toBe('q-1');
    expect(view.isCopy).toBe(false);
    expect(view.copyCount).toBe(2);
    expect(view.useCount).toBe(3);
  });

  it('câu hỏi không tồn tại thì getAttributionForViewer báo question.not_found kèm id', async () => {
    const { service } = buildService();
    const error = await capture(service.getAttributionForViewer(ACTOR, 'q-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-9 not found', code: 'question.not_found' });
  });

  it('danh mục không tồn tại thì getAttributionForViewer báo question.not_found kèm id câu hỏi', async () => {
    const { service, questionsRepo } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-9') as never);
    const error = await capture(service.getAttributionForViewer(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
  });

  it('câu hỏi thuộc bank cá nhân của người khác thì getAttributionForViewer báo question.not_found kèm id', async () => {
    const { service, repo, questionsRepo } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    questionsRepo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-1' }) as never);
    repo.getBank.mockResolvedValue(bankRow('bank-1', { scope: 'personal', ownerId: OTHER }) as never);
    const error = await capture(service.getAttributionForViewer(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
  });

  it('actor không có quyền dùng danh mục thì getAttributionForViewer báo question.not_found kèm id', async () => {
    const { service, questionsRepo, evaluator } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    questionsRepo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    evaluator.hasCapability.mockResolvedValue(false);
    const error = await capture(service.getAttributionForViewer(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
  });

  it('actor có quyền đọc thì getAttributionForViewer trả nguồn gốc câu hỏi', async () => {
    const { service, repo, questionsRepo } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    questionsRepo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-1' }) as never);
    repo.getBank.mockResolvedValue(bankRow('bank-1') as never);
    repo.getUserDisplayNames.mockResolvedValue(new Map() as never);
    repo.countSlotsByQuestionIds.mockResolvedValue(new Map([['q-1', 1]]) as never);
    const view = await service.getAttributionForViewer(ACTOR, 'q-1');
    expect(view.questionId).toBe('q-1');
    expect(view.useCount).toBe(1);
  });

  it('câu hỏi không có bank entry thì thu hồi báo question.entry_missing', async () => {
    const built = buildService();
    governableQuestion(built);
    const error = await capture(built.service.withdrawQuestion(ACTOR, 'q-1', 'lý do'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 has no bank entry', code: 'question.entry_missing' });
  });

  it('tác giả thu hồi câu hỏi có entry thì trả trạng thái hidden', async () => {
    const built = buildService();
    governableQuestion(built);
    built.questionsRepo.getEntryByQuestion.mockResolvedValue(entryRow('entry-1') as never);
    const result = await built.service.withdrawQuestion(ACTOR, 'q-1', 'lý do');
    expect(result).toEqual({ questionId: 'q-1', status: 'hidden', affectedPinIds: [] });
  });

  it('câu hỏi không có bank entry thì khôi phục báo question.entry_missing', async () => {
    const built = buildService();
    governableQuestion(built);
    const error = await capture(built.service.restoreQuestion(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 has no bank entry', code: 'question.entry_missing' });
  });

  it('câu hỏi không có bank entry thì đổi trạng thái báo question.entry_missing', async () => {
    const { service } = buildService();
    const error = await capture(service.setQuestionStatus('q-1', 'draft'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 has no bank entry', code: 'question.entry_missing' });
  });

  it('câu hỏi không có bank entry thì đổi trạng thái theo actor báo question.entry_missing', async () => {
    const built = buildService();
    governableQuestion(built);
    const error = await capture(built.service.setQuestionStatusForActor(ACTOR, 'q-1', 'draft'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 has no bank entry', code: 'question.entry_missing' });
  });

  it('câu hỏi không tồn tại thì duyệt nội dung ready báo question.not_found kèm id', async () => {
    const { service, questionsRepo } = buildService();
    questionsRepo.getEntryByQuestion.mockResolvedValue(entryRow('entry-1') as never);
    const error = await capture(service.setQuestionStatus('q-1', 'ready'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
  });

  it('phiên bản mới nhất thiếu thì duyệt nội dung ready báo question.version_missing', async () => {
    const { service, questionsRepo } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    questionsRepo.getEntryByQuestion.mockResolvedValue(entryRow('entry-1') as never);
    const error = await capture(service.setQuestionStatus('q-1', 'ready'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 latest version missing', code: 'question.version_missing' });
  });

  it('đổi trạng thái sang draft thì cập nhật entry và phiên bản hiện tại', async () => {
    const { service, questionsRepo } = buildService();
    questionsRepo.getEntryByQuestion.mockResolvedValue(entryRow('entry-1') as never);
    questionsRepo.getVersionByNumber.mockResolvedValue(versionRow('v-1') as never);
    await expect(service.setQuestionStatus('q-1', 'draft')).resolves.toBeUndefined();
    expect(questionsRepo.updateEntry).toHaveBeenCalledWith('entry-1', { status: 'draft' });
    expect(questionsRepo.updateVersion).toHaveBeenCalledWith('v-1', { status: 'draft' });
  });

  it('đóng góp không tồn tại thì duyệt đóng góp báo question.contribution_not_found kèm id', async () => {
    const { service, repo } = buildService();
    repo.getBank.mockResolvedValue(bankRow('bank-1') as never);
    const error = await capture(service.approveContribution(ACTOR, 'bank-1', 'c-9', {}));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Contribution c-9 not found', code: 'question.contribution_not_found' });
  });

  it('danh mục trong context bank cá nhân của người khác nhưng không gắn bankId thì người có quyền dùng vẫn xem được nguồn gốc câu hỏi', async () => {
    const { service, repo, questionsRepo } = buildService();
    questionsRepo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    questionsRepo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: null, contextId: 'pctx' }) as never);
    questionsRepo.getBankByContextId.mockResolvedValue(bankRow('bank-p', { scope: 'personal', ownerId: OTHER, contextId: 'pctx' }) as never);
    repo.getUserDisplayNames.mockResolvedValue(new Map() as never);
    repo.countSlotsByQuestionIds.mockResolvedValue(new Map([['q-1', 1]]) as never);
    const view = await service.getAttributionForViewer(ACTOR, 'q-1');
    expect(view.questionId).toBe('q-1');
    expect(view.useCount).toBe(1);
  });

  it('tác giả thu hồi câu hỏi của mình dù không có quyền moderate hay editall', async () => {
    const built = buildService();
    governableQuestion(built);
    built.evaluator.hasCapability.mockResolvedValue(false);
    built.evaluator.requireCapability.mockRejectedValue(new ForbiddenException({ message: 'Missing capability', code: 'question.capability_missing' }));
    built.questionsRepo.getEntryByQuestion.mockResolvedValue(entryRow('entry-1') as never);
    const result = await built.service.withdrawQuestion(ACTOR, 'q-1', 'lý do');
    expect(result).toEqual({ questionId: 'q-1', status: 'hidden', affectedPinIds: [] });
  });
});
