import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { QuestionsService } from './questions.service';

const ACTOR = 'actor-1';
const OTHER = 'actor-2';
const CTX = 'ctx-1';
const SYSTEM_CTX = 'ctx-system';

function categoryRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, name: 'Danh mục', contextId: CTX, bankId: null, info: '', parent: null,
    sortOrder: 0, stamp: 'qcat-1', createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function questionRow(id: string, categoryId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, category: categoryId, qtype: 'multichoice', createdBy: ACTOR, modifiedBy: ACTOR,
    derivedFromQuestionId: null, derivedFromVersionId: null, derivedFromBankId: null,
    originalAuthorId: null, sourceKind: 'manual', sourceRef: null, idnumber: null, ...overrides,
  };
}

function bankRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, tenantId: null, name: 'Ngân hàng', bankKind: 'course', scope: 'course',
    ownerId: null, scopeRefId: null, contextId: CTX, status: 'ready',
    createdBy: ACTOR, createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function versionRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, questionBankEntryId: 'entry-1', questionId: 'q-1', version: 1,
    questionText: { type: 'doc', content: [] }, generalFeedback: null,
    defaultMark: 1, penalty: 0, stimulusId: null, status: 'ready', ...overrides,
  };
}

function entryRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, questionCategoryId: 'cat-1', questionId: 'q-1', latestVersion: 1, status: 'ready', ...overrides };
}

function buildService() {
  const repo = {
    getCategory: vi.fn(async () => undefined),
    getBankById: vi.fn(async () => undefined),
    getBankByContextId: vi.fn(async () => undefined),
    getQuestion: vi.fn(async () => undefined),
    getStimulus: vi.fn(async () => undefined),
    getUsage: vi.fn(async () => undefined),
    getUsagesByIds: vi.fn(async () => []),
    listAttemptsForUsages: vi.fn(async () => []),
    listStepsForAttempts: vi.fn(async () => []),
    listStepDataForSteps: vi.fn(async () => []),
    getAttempt: vi.fn(async () => undefined),
    getEntryByQuestion: vi.fn(async () => undefined),
    getVersionByNumber: vi.fn(async () => undefined),
    getVersion: vi.fn(async () => undefined),
    listAnswers: vi.fn(async () => []),
    getAnswerKey: vi.fn(async () => undefined),
    getMultichoiceOptions: vi.fn(async () => undefined),
    getShortanswerOptions: vi.fn(async () => undefined),
    getEssayOptions: vi.fn(async () => undefined),
    listVersions: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    listQuestionsInCategory: vi.fn(async () => []),
    insertCategory: vi.fn(async (input: Record<string, unknown>) => categoryRow('cat-new', input)),
    insertStimulus: vi.fn(async (input: Record<string, unknown>) => ({ id: 'stim-1', ...input })),
    updateStimulus: vi.fn(async () => undefined),
    deleteStimulus: vi.fn(async () => undefined),
    countVersionsReferencingStimulus: vi.fn(async () => 0),
    insertQuestion: vi.fn(async (input: Record<string, unknown>) => questionRow('q-1', 'cat-1', input)),
    insertEntry: vi.fn(async () => entryRow('entry-1')),
    insertVersion: vi.fn(async (input: Record<string, unknown>) => versionRow('v-1', input)),
    insertAnswer: vi.fn(async (input: Record<string, unknown>) => ({ id: 'a-1', ...input })),
    insertMultichoiceOptions: vi.fn(async () => undefined),
    insertShortanswerOptions: vi.fn(async () => undefined),
    insertEssayOptions: vi.fn(async () => undefined),
    insertAnswerKey: vi.fn(async () => undefined),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
    getOutcomeChain: vi.fn(async () => undefined),
    getSubjectRow: vi.fn(async () => undefined),
    getQuestionSubjectLink: vi.fn(async () => undefined),
    insertQuestionSubjectLink: vi.fn(async () => undefined),
    deleteQuestionSubjectLink: vi.fn(async () => true),
    getQuestionOutcomeLink: vi.fn(async () => undefined),
    insertQuestionOutcomeLink: vi.fn(async () => undefined),
    updateQuestionOutcomeLink: vi.fn(async () => undefined),
    deleteQuestionOutcomeLink: vi.fn(async () => true),
    listQuestionSubjectLinks: vi.fn(async () => []),
    listQuestionOutcomeLinks: vi.fn(async () => []),
    usageHasSnapshots: vi.fn(async () => false),
  };
  const contexts = {
    getContext: vi.fn(async (id: string) => ({ id })),
    ensureSystemContext: vi.fn(async () => ({ id: SYSTEM_CTX })),
  };
  const evaluator = {
    requireCapability: vi.fn(async () => undefined),
    hasCapability: vi.fn(async () => true),
    isSiteAdmin: vi.fn(async () => false),
  };
  const outbox = {
    enqueueStandalone: vi.fn(async () => undefined),
    enqueueKysely: vi.fn(async () => undefined),
  };
  const files = {
    resolveQuestionImageUrls: vi.fn(async (value: unknown) => value),
  };
  const service = new QuestionsService(repo as never, contexts as never, evaluator as never, outbox as never, files as never);
  return { service, repo, contexts, evaluator, outbox, files };
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

function multichoiceInput(categoryId: string): Record<string, unknown> {
  return {
    categoryId,
    qtype: 'multichoice',
    questionText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2 + 2 = ?' }] }] },
    answers: [
      { text: '4', correct: true },
      { text: '3', correct: false },
      { text: '5', correct: false },
      { text: '6', correct: false },
    ],
    guidance: 'Giải thích',
  };
}

function readableQuestion(repo: ReturnType<typeof buildService>['repo']): void {
  repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
  repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
  repo.getBankByContextId.mockResolvedValue(bankRow('bank-1') as never);
  repo.getEntryByQuestion.mockResolvedValue(entryRow('entry-1') as never);
  repo.getVersionByNumber.mockResolvedValue(versionRow('v-1') as never);
}

describe('QuestionsService — cổng guard và mã lỗi not-found giữ nguyên khi gom helper', () => {
  it('câu hỏi không tồn tại thì getQuestion báo question_not_found kèm id', async () => {
    const { service } = buildService();
    const error = await capture(service.getQuestion('q-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-9 not found', code: 'question.not_found' });
  });

  it('câu hỏi thiếu bank entry thì getQuestion báo question.entry_missing', async () => {
    const { service, repo } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    const error = await capture(service.getQuestion('q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 has no bank entry', code: 'question.entry_missing' });
  });

  it('câu hỏi thiếu phiên bản mới nhất thì getQuestion báo question.version_missing', async () => {
    const { service, repo } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getEntryByQuestion.mockResolvedValue(entryRow('entry-1') as never);
    const error = await capture(service.getQuestion('q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 latest version missing', code: 'question.version_missing' });
  });

  it('danh mục không tồn tại thì getCategory báo question.category_not_found kèm id', async () => {
    const { service } = buildService();
    const error = await capture(service.getCategory('cat-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question category cat-9 not found', code: 'question.category_not_found' });
  });

  it('stimulus không tồn tại thì getStimulus báo stimulus.not_found kèm id', async () => {
    const { service } = buildService();
    const error = await capture(service.getStimulus('stim-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Stimulus stim-9 not found', code: 'stimulus.not_found' });
  });

  it('attempt không tồn tại thì getAttempt báo question.attempt_not_found kèm id', async () => {
    const { service } = buildService();
    const error = await capture(service.getAttempt('att-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question attempt att-9 not found', code: 'question.attempt_not_found' });
  });

  it('usage không tồn tại thì getUsage báo question.usage_not_found kèm id', async () => {
    const { service } = buildService();
    const error = await capture(service.getUsage('u-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question usage u-9 not found', code: 'question.usage_not_found' });
  });

  it('câu hỏi thiếu bank entry thì listVersions báo question.entry_missing', async () => {
    const { service } = buildService();
    const error = await capture(service.listVersions('q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 has no bank entry', code: 'question.entry_missing' });
  });

  it('phiên bản thuộc câu hỏi khác thì getVersionContent báo question.version_missing kèm id phiên bản', async () => {
    const { service, repo } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getVersion.mockResolvedValue(versionRow('v-9', { questionId: 'q-2' }) as never);
    const error = await capture(service.getVersionContent('q-1', 'v-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question version v-9 not found', code: 'question.version_missing' });
  });

  it('người xem không có quyền dùng ngân hàng thì getQuestionForViewer báo question.not_found như không tồn tại', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    evaluator.hasCapability.mockResolvedValue(false);
    const error = await capture(service.getQuestionForViewer(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
  });

  it('người xem có quyền dùng ngân hàng thì getQuestionForViewer trả về câu hỏi', async () => {
    const { service, repo } = buildService();
    readableQuestion(repo);
    const view = await service.getQuestionForViewer(ACTOR, 'q-1');
    expect(view.question.id).toBe('q-1');
    expect(view.latestVersion.id).toBe('v-1');
  });

  it('người xem không có quyền dùng ngân hàng của context thì listCategoriesForViewer báo category_not_found theo contextId', async () => {
    const { service, evaluator } = buildService();
    evaluator.hasCapability.mockResolvedValue(false);
    const error = await capture(service.listCategoriesForViewer(ACTOR, CTX));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: `Question category ${CTX} not found`, code: 'question.category_not_found' });
  });

  it('stimulus thuộc ngân hàng không được phép đọc thì getStimulusForViewer báo stimulus.not_found', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getStimulus.mockResolvedValue({ id: 'stim-1', categoryId: 'cat-1', createdBy: ACTOR, content: {} } as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    evaluator.hasCapability.mockResolvedValue(false);
    const error = await capture(service.getStimulusForViewer(ACTOR, 'stim-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Stimulus stim-1 not found', code: 'stimulus.not_found' });
  });

  it('tạo danh mục khi context không tồn tại thì báo BadRequest trước khi kiểm tra capability', async () => {
    const { service, contexts, evaluator } = buildService();
    contexts.getContext.mockRejectedValue(new NotFoundException({ message: 'Context ctx-9 not found', code: 'access.context_not_found' }));
    const error = await capture(service.createCategory(ACTOR, { name: 'Mới', contextId: 'ctx-9' }));
    expect(problem(error)).toEqual({
      message: 'Context ctx-9 does not exist; a question category must be created in an existing context',
      code: 'question.category_context_not_found',
    });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
  });

  it('tạo danh mục gắn ngân hàng không tồn tại thì báo question.bank_not_found trước khi kiểm tra capability', async () => {
    const { service, evaluator } = buildService();
    const error = await capture(service.createCategory(ACTOR, { name: 'Mới', contextId: CTX, bankId: 'bank-9' }));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question bank bank-9 not found', code: 'question.bank_not_found' });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
  });

  it('tạo danh mục gắn ngân hàng cá nhân của người khác thì báo bank_not_found và không kiểm tra capability', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getBankById.mockResolvedValue(bankRow('bank-1', { scope: 'personal', ownerId: OTHER }) as never);
    const error = await capture(service.createCategory(ACTOR, { name: 'Mới', contextId: CTX, bankId: 'bank-1' }));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question bank bank-1 not found', code: 'question.bank_not_found' });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
  });

  it('tạo danh mục hợp lệ thì kiểm tra capability question:managecategory rồi mới ghi', async () => {
    const { service, repo, evaluator } = buildService();
    const row = await service.createCategory(ACTOR, { name: 'Mới', contextId: CTX });
    expect(row.id).toBe('cat-new');
    expect(evaluator.requireCapability).toHaveBeenCalledWith(ACTOR, 'question:managecategory', CTX);
    expect(repo.insertCategory).toHaveBeenCalled();
  });

  it('tạo stimulus khi danh mục không tồn tại thì báo category_not_found và không kiểm tra capability', async () => {
    const { service, evaluator, repo } = buildService();
    const error = await capture(service.createStimulus(ACTOR, { categoryId: 'cat-9', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung' }] }] } }));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question category cat-9 not found', code: 'question.category_not_found' });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
    expect(repo.insertStimulus).not.toHaveBeenCalled();
  });

  it('tạo stimulus trong danh mục cá nhân của người khác thì báo category_not_found và không kiểm tra capability', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-1' }) as never);
    repo.getBankById.mockResolvedValue(bankRow('bank-1', { scope: 'personal', ownerId: OTHER }) as never);
    const error = await capture(service.createStimulus(ACTOR, { categoryId: 'cat-1', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung' }] }] } }));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question category cat-1 not found', code: 'question.category_not_found' });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
  });

  it('tạo stimulus thiếu capability question:add thì lỗi capability thắng và không ghi stimulus', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    evaluator.requireCapability.mockRejectedValue(new ForbiddenException({ message: 'Capability denied', code: 'access.capability_denied' }));
    const error = await capture(service.createStimulus(ACTOR, { categoryId: 'cat-1', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung' }] }] } }));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(repo.insertStimulus).not.toHaveBeenCalled();
  });

  it('tạo stimulus hợp lệ thì kiểm tra capability question:add rồi ghi và phát sự kiện', async () => {
    const { service, repo, evaluator, outbox } = buildService();
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    const row = await service.createStimulus(ACTOR, { categoryId: 'cat-1', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung' }] }] } });
    expect(row.id).toBe('stim-1');
    expect(evaluator.requireCapability).toHaveBeenCalledWith(ACTOR, 'question:add', CTX);
    expect(outbox.enqueueStandalone).toHaveBeenCalledWith(expect.objectContaining({ type: 'stimulus_created' }));
  });

  it('sửa stimulus trong danh mục cá nhân của người khác thì báo stimulus.not_found chứ không phải category_not_found', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getStimulus.mockResolvedValue({ id: 'stim-1', categoryId: 'cat-1', createdBy: OTHER, content: {} } as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-1' }) as never);
    repo.getBankById.mockResolvedValue(bankRow('bank-1', { scope: 'personal', ownerId: OTHER }) as never);
    const error = await capture(service.updateStimulus(ACTOR, 'stim-1', { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung' }] }] } }));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Stimulus stim-1 not found', code: 'stimulus.not_found' });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
  });

  it('xoá stimulus trong danh mục cá nhân của người khác thì báo stimulus.not_found', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getStimulus.mockResolvedValue({ id: 'stim-1', categoryId: 'cat-1', createdBy: OTHER, content: {} } as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-1' }) as never);
    repo.getBankById.mockResolvedValue(bankRow('bank-1', { scope: 'personal', ownerId: OTHER }) as never);
    const error = await capture(service.deleteStimulus(ACTOR, 'stim-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Stimulus stim-1 not found', code: 'stimulus.not_found' });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
    expect(repo.deleteStimulus).not.toHaveBeenCalled();
  });

  it('sửa stimulus thiếu capability thì lỗi capability thắng kiểm tra stimulus đang được dùng', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getStimulus.mockResolvedValue({ id: 'stim-1', categoryId: 'cat-1', createdBy: ACTOR, content: {} } as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    repo.countVersionsReferencingStimulus.mockResolvedValue(2);
    evaluator.requireCapability.mockRejectedValue(new ForbiddenException({ message: 'Capability denied', code: 'access.capability_denied' }));
    const error = await capture(service.updateStimulus(ACTOR, 'stim-1', { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung' }] }] } }));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(repo.updateStimulus).not.toHaveBeenCalled();
  });

  it('sửa stimulus đang được phiên bản câu hỏi dùng thì báo stimulus_in_use', async () => {
    const { service, repo } = buildService();
    repo.getStimulus.mockResolvedValue({ id: 'stim-1', categoryId: 'cat-1', createdBy: ACTOR, content: {} } as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    repo.countVersionsReferencingStimulus.mockResolvedValue(1);
    const error = await capture(service.updateStimulus(ACTOR, 'stim-1', { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung' }] }] } }));
    expect(problem(error)).toEqual({
      message: 'Stimulus is already referenced by a question version and can no longer be changed or deleted; create a new stimulus instead',
      code: 'stimulus_in_use',
    });
  });

  it('tạo câu hỏi thiếu capability thì lỗi capability thắng kiểm tra qtype', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    evaluator.requireCapability.mockRejectedValue(new ForbiddenException({ message: 'Capability denied', code: 'access.capability_denied' }));
    const error = await capture(service.createQuestion(ACTOR, { ...multichoiceInput('cat-1'), qtype: 'unknown_qtype' } as never));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(repo.insertQuestion).not.toHaveBeenCalled();
  });

  it('tạo câu hỏi trong danh mục cá nhân của người khác thì báo category_not_found', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-1' }) as never);
    repo.getBankById.mockResolvedValue(bankRow('bank-1', { scope: 'personal', ownerId: OTHER }) as never);
    const error = await capture(service.createQuestion(ACTOR, multichoiceInput('cat-1') as never));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question category cat-1 not found', code: 'question.category_not_found' });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
  });

  it('tạo câu hỏi multichoice hợp lệ thì kiểm tra capability question:add rồi ghi đồ thị câu hỏi', async () => {
    const { service, repo, evaluator, outbox } = buildService();
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    const view = await service.createQuestion(ACTOR, multichoiceInput('cat-1') as never);
    expect(view.question.id).toBe('q-1');
    expect(view.latestVersion.id).toBe('v-1');
    expect(evaluator.requireCapability).toHaveBeenCalledWith(ACTOR, 'question:add', CTX);
    expect(repo.insertQuestion).toHaveBeenCalled();
    expect(outbox.enqueueStandalone).toHaveBeenCalledWith(expect.objectContaining({ type: 'question_created' }));
  });

  it('tạo bản sao câu hỏi khi learning outcome không tồn tại thì báo curriculum.outcome_not_found', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    const error = await capture(service.createQuestionCopies(ACTOR, 'cat-1', [{
      qtype: 'multichoice',
      content: {
        answers: [
          { text: '4', correct: true },
          { text: '3', correct: false },
          { text: '5', correct: false },
          { text: '6', correct: false },
        ],
      },
      outcomes: [{ outcomeId: 'o-9', cognitiveLevel: 'remember' }],
    }] as never, async () => 'done'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ code: 'curriculum.outcome_not_found' });
    expect(evaluator.requireCapability).toHaveBeenCalledWith(ACTOR, 'question:add', CTX);
    expect(repo.transaction).not.toHaveBeenCalled();
    expect(repo.insertQuestion).not.toHaveBeenCalled();
  });

  it('gắn môn học khi câu hỏi không tồn tại thì báo question.not_found', async () => {
    const { service } = buildService();
    const error = await capture(service.attachSubject(ACTOR, 'q-9', 'sub-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-9 not found', code: 'question.not_found' });
  });

  it('gắn môn học khi môn học không tồn tại thì báo curriculum.subject_not_found', async () => {
    const { service, repo } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    const error = await capture(service.attachSubject(ACTOR, 'q-1', 'sub-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Subject sub-9 not found', code: 'curriculum.subject_not_found' });
  });

  it('gắn môn học đã gắn rồi thì báo Conflict question.subject_link_exists', async () => {
    const { service, repo } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    repo.getSubjectRow.mockResolvedValue({ id: 'sub-1' } as never);
    repo.getQuestionSubjectLink.mockResolvedValue({ questionId: 'q-1', subjectId: 'sub-1' } as never);
    const error = await capture(service.attachSubject(ACTOR, 'q-1', 'sub-1'));
    expect(error).toBeInstanceOf(ConflictException);
    expect(problem(error)).toEqual({ message: 'Question is already linked to this subject', code: 'question.subject_link_exists' });
  });

  it('gắn môn học thiếu capability question:editall thì lỗi capability thắng kiểm tra môn học', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    evaluator.requireCapability.mockRejectedValue(new ForbiddenException({ message: 'Capability denied', code: 'access.capability_denied' }));
    const error = await capture(service.attachSubject(ACTOR, 'q-1', 'sub-1'));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(repo.getSubjectRow).not.toHaveBeenCalled();
  });

  it('tách môn học chưa gắn thì báo question.subject_link_not_found', async () => {
    const { service, repo } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    repo.deleteQuestionSubjectLink.mockResolvedValue(false);
    const error = await capture(service.detachSubject(ACTOR, 'q-1', 'sub-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question is not linked to this subject', code: 'question.subject_link_not_found' });
  });

  it('tách learning outcome chưa gắn thì báo question.outcome_link_not_found', async () => {
    const { service, repo } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    repo.deleteQuestionOutcomeLink.mockResolvedValue(false);
    const error = await capture(service.detachOutcome(ACTOR, 'q-1', 'o-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question is not linked to this learning outcome', code: 'question.outcome_link_not_found' });
  });

  it('kiểm tra quyền tạo usage khi câu hỏi không tồn tại thì báo question.not_found', async () => {
    const { service } = buildService();
    const error = await capture(service.assertCanCreateUsage(ACTOR, ['q-9']));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-9 not found', code: 'question.not_found' });
  });

  it('xem usage của người khác mà không có quyền dùng ngân hàng hệ thống thì báo usage_not_found như không tồn tại', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getUsage.mockResolvedValue({ id: 'u-1', userId: OTHER } as never);
    evaluator.hasCapability.mockResolvedValue(false);
    const error = await capture(service.getUsageForViewer(ACTOR, 'u-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question usage u-1 not found', code: 'question.usage_not_found' });
  });

  it('xem usage đã có snapshot thì báo usage_not_found dù là chủ sở hữu', async () => {
    const { service, repo } = buildService();
    repo.getUsage.mockResolvedValue({ id: 'u-1', userId: ACTOR } as never);
    repo.usageHasSnapshots.mockResolvedValue(true);
    const error = await capture(service.getUsageForViewer(ACTOR, 'u-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question usage u-1 not found', code: 'question.usage_not_found' });
  });

  it('xem usage của chính mình chưa có snapshot thì trả về usage', async () => {
    const { service, repo } = buildService();
    repo.getUsage.mockResolvedValue({ id: 'u-1', userId: ACTOR, component: 'quiz', instanceId: null, owningContextId: null, preferredBehaviour: 'deferredfeedback', createdAt: new Date(), updatedAt: new Date() } as never);
    repo.getUsagesByIds.mockResolvedValue([{ id: 'u-1', userId: ACTOR, component: 'quiz', instanceId: null, owningContextId: null, preferredBehaviour: 'deferredfeedback', createdAt: new Date(), updatedAt: new Date() }] as never);
    const view = await service.getUsageForViewer(ACTOR, 'u-1');
    expect(view.usage.id).toBe('u-1');
    expect(view.attempts).toEqual([]);
  });

  it('câu hỏi không tồn tại thì getQuestionForViewer báo question.not_found', async () => {
    const { service } = buildService();
    const error = await capture(service.getQuestionForViewer(ACTOR, 'q-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-9 not found', code: 'question.not_found' });
  });

  it('câu hỏi tồn tại nhưng danh mục không tồn tại thì getQuestionForViewer báo question.not_found', async () => {
    const { service, repo } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    const error = await capture(service.getQuestionForViewer(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
  });

  it('quản trị viên xem câu hỏi trong ngân hàng cá nhân của người khác thì được phép xem', async () => {
    const { service, repo, evaluator } = buildService();
    readableQuestion(repo);
    repo.getBankByContextId.mockResolvedValue(bankRow('bank-1', { scope: 'personal', ownerId: OTHER }) as never);
    evaluator.isSiteAdmin.mockResolvedValue(true);
    const view = await service.getQuestionForViewer(ACTOR, 'q-1');
    expect(view.question.id).toBe('q-1');
    expect(evaluator.isSiteAdmin).toHaveBeenCalledWith(ACTOR);
  });

  it('chủ ngân hàng cá nhân xem câu hỏi trong ngân hàng của chính mình thì được phép xem', async () => {
    const { service, repo, evaluator } = buildService();
    readableQuestion(repo);
    repo.getBankByContextId.mockResolvedValue(bankRow('bank-1', { scope: 'personal', ownerId: ACTOR }) as never);
    const view = await service.getQuestionForViewer(ACTOR, 'q-1');
    expect(view.question.id).toBe('q-1');
    expect(evaluator.isSiteAdmin).not.toHaveBeenCalled();
  });

  it('gắn môn học cho câu hỏi trong danh mục cá nhân của người khác thì báo question.not_found', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-1' }) as never);
    repo.getBankById.mockResolvedValue(bankRow('bank-1', { scope: 'personal', ownerId: OTHER }) as never);
    const error = await capture(service.attachSubject(ACTOR, 'q-1', 'sub-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
    expect(repo.getSubjectRow).not.toHaveBeenCalled();
  });

  it('gắn môn học khi danh mục của câu hỏi không tồn tại thì báo question.category_not_found', async () => {
    const { service, repo } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    const error = await capture(service.attachSubject(ACTOR, 'q-1', 'sub-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question category cat-1 not found', code: 'question.category_not_found' });
  });

  it('gắn learning outcome khi câu hỏi không tồn tại thì báo question.not_found', async () => {
    const { service } = buildService();
    const error = await capture(service.attachOutcome(ACTOR, 'q-9', 'o-1', 'remember'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-9 not found', code: 'question.not_found' });
  });

  it('gắn learning outcome thiếu capability question:editall thì lỗi capability thắng kiểm tra outcome', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    evaluator.requireCapability.mockRejectedValue(new ForbiddenException({ message: 'Capability denied', code: 'access.capability_denied' }));
    const error = await capture(service.attachOutcome(ACTOR, 'q-1', 'o-1', 'remember'));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(repo.getOutcomeChain).not.toHaveBeenCalled();
  });

  it('sửa câu hỏi trong danh mục cá nhân của người khác thì báo question.not_found', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getEntryByQuestion.mockResolvedValue(entryRow('entry-1') as never);
    repo.getVersionByNumber.mockResolvedValue(versionRow('v-1') as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1', { bankId: 'bank-1' }) as never);
    repo.getBankById.mockResolvedValue(bankRow('bank-1', { scope: 'personal', ownerId: OTHER }) as never);
    const error = await capture(service.updateQuestion(ACTOR, 'q-1', {} as never));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
    expect(evaluator.requireCapability).not.toHaveBeenCalled();
    expect(repo.insertVersion).not.toHaveBeenCalled();
  });

  it('chấm lại attempt với phiên bản thuộc câu hỏi khác thì báo question.version_not_found kèm id câu hỏi', async () => {
    const { service, repo } = buildService();
    repo.getAttempt.mockResolvedValue({ id: 'att-1', questionUsageId: 'u-1', questionId: 'q-1', questionVersionId: 'v-1', state: 'gradedright', fraction: 1, maxMark: 1 } as never);
    repo.getVersion.mockResolvedValue(versionRow('v-9', { questionId: 'q-2' }) as never);
    const error = await capture(service.regradeAttemptWithVersion(ACTOR, 'att-1', 'v-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question version v-9 not found for question q-1', code: 'question.version_not_found' });
  });

  it('danh mục không tồn tại thì listQuestionsForViewer báo question.category_not_found', async () => {
    const { service } = buildService();
    const error = await capture(service.listQuestionsForViewer(ACTOR, 'cat-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question category cat-9 not found', code: 'question.category_not_found' });
  });

  it('người xem không có quyền dùng ngân hàng thì listQuestionsForViewer báo question.category_not_found', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    repo.getBankByContextId.mockResolvedValue(bankRow('bank-1') as never);
    evaluator.hasCapability.mockResolvedValue(false);
    const error = await capture(service.listQuestionsForViewer(ACTOR, 'cat-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question category cat-1 not found', code: 'question.category_not_found' });
    expect(repo.listQuestionsInCategory).not.toHaveBeenCalled();
  });

  it('danh mục không tồn tại thì listStimuliForViewer báo question.category_not_found', async () => {
    const { service } = buildService();
    const error = await capture(service.listStimuliForViewer(ACTOR, 'cat-9'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question category cat-9 not found', code: 'question.category_not_found' });
  });

  it('người xem không có quyền dùng ngân hàng thì listStimuliForViewer báo question.category_not_found', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    repo.getBankByContextId.mockResolvedValue(bankRow('bank-1') as never);
    evaluator.hasCapability.mockResolvedValue(false);
    const error = await capture(service.listStimuliForViewer(ACTOR, 'cat-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question category cat-1 not found', code: 'question.category_not_found' });
  });

  it('câu hỏi tồn tại nhưng danh mục không tồn tại thì listVersionsForViewer báo question.not_found', async () => {
    const { service, repo } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    const error = await capture(service.listVersionsForViewer(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
  });

  it('người xem không có quyền dùng ngân hàng thì listVersionsForViewer báo question.not_found', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    repo.getBankByContextId.mockResolvedValue(bankRow('bank-1') as never);
    evaluator.hasCapability.mockResolvedValue(false);
    const error = await capture(service.listVersionsForViewer(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
    expect(repo.getEntryByQuestion).not.toHaveBeenCalled();
  });

  it('người xem có quyền dùng ngân hàng thì getCurriculumLinksForViewer trả về liên kết chương trình của câu hỏi', async () => {
    const { service, repo } = buildService();
    readableQuestion(repo);
    const links = await service.getCurriculumLinksForViewer(ACTOR, 'q-1');
    expect(links).toEqual({ questionId: 'q-1', subjectIds: [], outcomes: [] });
  });

  it('người xem không có quyền dùng ngân hàng thì getCurriculumLinksForViewer báo question.not_found', async () => {
    const { service, repo, evaluator } = buildService();
    repo.getQuestion.mockResolvedValue(questionRow('q-1', 'cat-1') as never);
    repo.getCategory.mockResolvedValue(categoryRow('cat-1') as never);
    repo.getBankByContextId.mockResolvedValue(bankRow('bank-1') as never);
    evaluator.hasCapability.mockResolvedValue(false);
    const error = await capture(service.getCurriculumLinksForViewer(ACTOR, 'q-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(problem(error)).toEqual({ message: 'Question q-1 not found', code: 'question.not_found' });
    expect(repo.listQuestionSubjectLinks).not.toHaveBeenCalled();
  });
});
