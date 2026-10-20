import { describe, expect, it, vi } from 'vitest';
import { ClientError } from '../src/common/client-error.js';
import { QuestionsService } from '../src/questions/service.js';

const USER_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22';
const QUESTION_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d24';
const FILE_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d21';
const VARIANT_FILE_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';

function image(variantFileId: string | null = null) {
  return {
    type: 'image' as const,
    attrs: {
      fileId: FILE_ID,
      variantFileId,
      alt: 'demo.png',
      title: null,
      width: 100,
      height: 80,
      align: 'center' as const,
      crop: variantFileId ? { x: 0, y: 0, width: 80, height: 80 } : null,
    },
  };
}

function storedQuestion(status: 'draft' | 'ready' = 'ready', version = 1) {
  return {
    id: QUESTION_ID,
    version,
    status,
    type: 'short_answer' as const,
    stimulusId: null,
    content: {
      type: 'doc' as const,
      content: [
        { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Câu hỏi' }] },
      ],
    },
    guidance: null,
    solution: { answer: '42' },
    createdByUserId: USER_ID,
  };
}

function createService() {
  const repository = {
    createQuestion: vi.fn(async (question) => ({
      id: QUESTION_ID,
      version: 1,
      ...question,
    })),
    findQuestion: vi.fn(),
    findLatestReadyQuestion: vi.fn(),
    findQuestionVersion: vi.fn(),
    listQuestionVersions: vi.fn(),
    findQuestionOwned: vi.fn(),
    createQuestionVersion: vi.fn(),
    changeQuestionStatus: vi.fn(),
    deleteQuestion: vi.fn(),
    createStimulus: vi.fn(),
    findStimulusOwned: vi.fn(),
    updateStimulus: vi.fn(),
    deleteStimulus: vi.fn(),
  };
  const authorization = { assertAuthorized: vi.fn(async () => undefined) };
  return {
    service: new QuestionsService(repository as never, authorization as never),
    repository,
    authorization,
  };
}

describe('QuestionsService', () => {
  it('collects each original and derived file reference once for ownership validation', async () => {
    const { service, repository } = createService();
    const original = image();
    const variant = image(VARIANT_FILE_ID);
    const question = {
      status: 'ready' as const,
      type: 'short_answer' as const,
      content: { type: 'doc' as const, content: [original, variant, variant] },
      guidance: { type: 'doc' as const, content: [variant] },
      solution: { answer: '42' },
    };

    await service.createQuestion(question, USER_ID);

    expect(repository.createQuestion).toHaveBeenCalledWith(
      question,
      [
        { fileId: FILE_ID, variantFileId: null },
        { fileId: FILE_ID, variantFileId: VARIANT_FILE_ID },
      ],
      USER_ID,
    );
  });

  it('creates a new Draft version for a content patch while preserving omitted fields', async () => {
    const { service, repository } = createService();
    const current = {
      id: QUESTION_ID,
      version: 1,
      stimulusId: null,
      status: 'draft' as const,
      type: 'short_answer' as const,
      content: {
        type: 'doc' as const,
        content: [
          { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Câu hỏi' }] },
        ],
      },
      guidance: null,
      solution: { answer: '42' },
    };
    repository.findQuestionOwned.mockResolvedValue(current);
    repository.createQuestionVersion.mockImplementation(async (id, _expectedVersion, question) => ({
      id,
      version: 2,
      ...question,
    }));

    const updated = await service.updateQuestion(
      QUESTION_ID,
      { solution: { answer: '7' } },
      1,
      USER_ID,
    );

    expect(updated).toEqual({
      ...current,
      version: 2,
      solution: { answer: '7' },
    });
    expect(repository.createQuestionVersion).toHaveBeenCalledWith(
      QUESTION_ID,
      1,
      expect.objectContaining({ status: 'draft', solution: { answer: '7' } }),
      [],
      USER_ID,
    );
  });

  it('does not expose latest draft or its solution to non-owners', async () => {
    const { service, repository } = createService();
    repository.findQuestionOwned.mockResolvedValue(undefined);

    await expect(service.getQuestion(QUESTION_ID, USER_ID)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'question_not_found',
    });
    expect(repository.findQuestion).not.toHaveBeenCalled();

    repository.findQuestionOwned.mockResolvedValue(storedQuestion('draft', 3));
    await expect(service.getQuestion(QUESTION_ID, USER_ID)).resolves.toMatchObject({
      id: QUESTION_ID,
      version: 3,
      status: 'draft',
      solution: { answer: '42' },
    });
    expect(repository.findQuestionOwned).toHaveBeenCalledWith(QUESTION_ID, USER_ID);
  });

  it('does not allow a non-owner to update a question', async () => {
    const { service, repository } = createService();
    repository.findQuestionOwned.mockResolvedValue(undefined);

    await expect(
      service.updateQuestion(QUESTION_ID, { solution: { answer: '7' } }, 1, USER_ID),
    ).rejects.toMatchObject({ kind: 'not_found', code: 'question_not_found' });

    expect(repository.createQuestionVersion).not.toHaveBeenCalled();
    expect(repository.changeQuestionStatus).not.toHaveBeenCalled();
  });

  it('rejects a patch that makes the whole question inconsistent', async () => {
    const { service, repository } = createService();
    repository.findQuestionOwned.mockResolvedValue({
      id: QUESTION_ID,
      version: 1,
      stimulusId: null,
      status: 'ready',
      type: 'short_answer',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Câu hỏi' }] }],
      },
      guidance: null,
      solution: { answer: '42' },
    });

    await expect(
      service.updateQuestion(QUESTION_ID, { type: 'essay' }, 1, USER_ID),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'question_invalid' });

    expect(repository.createQuestionVersion).not.toHaveBeenCalled();
    expect(repository.changeQuestionStatus).not.toHaveBeenCalled();
  });

  it('rejects invalid image references as a bad request', async () => {
    const { service, repository } = createService();
    repository.createQuestion.mockRejectedValueOnce(
      new ClientError(
        'invalid',
        'question_image_reference_invalid',
        'Question chứa ảnh không hợp lệ',
      ),
    );

    await expect(
      service.createQuestion(
        {
          status: 'ready',
          type: 'short_answer',
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Câu hỏi' }] }],
          },
          solution: { answer: '42' },
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'question_image_reference_invalid' });
  });

  it('creates a new Ready version on explicit content edit without mutating old Ready', async () => {
    const { service, repository } = createService();
    const published = storedQuestion('ready', 2);
    repository.findQuestionOwned.mockResolvedValue(published);
    repository.createQuestionVersion.mockImplementation(async (id, _expectedVersion, data) => ({
      id,
      version: 3,
      createdByUserId: USER_ID,
      ...data,
    }));

    const updated = await service.updateQuestion(
      QUESTION_ID,
      { solution: { answer: '7' }, status: 'ready' },
      2,
      USER_ID,
    );

    expect(updated).toMatchObject({ id: QUESTION_ID, version: 3, status: 'ready' });
    expect(repository.createQuestionVersion).toHaveBeenCalledWith(
      QUESTION_ID,
      2,
      expect.objectContaining({ status: 'ready', solution: { answer: '7' } }),
      [],
      USER_ID,
    );
    expect(published.version).toBe(2);
    expect(published.status).toBe('ready');
    expect(published.solution.answer).toBe('42');
  });

  it('toggles Draft→Ready and Ready→Draft on the same version', async () => {
    const { service, repository } = createService();
    repository.findQuestionOwned.mockResolvedValue(storedQuestion('draft', 2));
    repository.changeQuestionStatus.mockImplementation(async (id, _expectedVersion, status) => ({
      ...storedQuestion(status, 2),
      id,
    }));

    const ready = await service.updateQuestion(QUESTION_ID, { status: 'ready' }, 2, USER_ID);
    expect(ready).toMatchObject({ version: 2, status: 'ready' });
    expect(repository.changeQuestionStatus).toHaveBeenCalledWith(QUESTION_ID, 2, 'ready', USER_ID);

    repository.findQuestionOwned.mockResolvedValue(storedQuestion('ready', 2));
    const draft = await service.updateQuestion(QUESTION_ID, { status: 'draft' }, 2, USER_ID);
    expect(draft).toMatchObject({ version: 2, status: 'draft' });
    expect(repository.changeQuestionStatus).toHaveBeenCalledWith(QUESTION_ID, 2, 'draft', USER_ID);
    expect(repository.createQuestionVersion).not.toHaveBeenCalled();
  });

  it('checks expectedVersion under lock even for unchanged status', async () => {
    const { service, repository } = createService();
    repository.findQuestionOwned.mockResolvedValue(storedQuestion('ready', 2));
    repository.changeQuestionStatus.mockRejectedValueOnce(
      new ClientError('conflict', 'question_version_conflict', 'Phiên bản đã thay đổi'),
    );

    await expect(
      service.updateQuestion(QUESTION_ID, { status: 'ready' }, 2, USER_ID),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'question_version_conflict' });
    expect(repository.changeQuestionStatus).toHaveBeenCalledWith(QUESTION_ID, 2, 'ready', USER_ID);
    expect(repository.createQuestionVersion).not.toHaveBeenCalled();
  });

  it('inherits the current status when creating a content version without status', async () => {
    const { service, repository } = createService();
    repository.findQuestionOwned.mockResolvedValue(storedQuestion('ready', 4));
    repository.createQuestionVersion.mockImplementation(async (id, _expectedVersion, data) => ({
      id,
      version: 5,
      createdByUserId: USER_ID,
      ...data,
    }));

    const result = await service.updateQuestion(
      QUESTION_ID,
      { guidance: { type: 'doc', content: [] } },
      4,
      USER_ID,
    );
    expect(result).toMatchObject({ version: 5, status: 'ready' });
    expect(repository.createQuestionVersion.mock.calls[0]?.[2]).toMatchObject({ status: 'ready' });
  });

  it('rejects stale version preconditions before any write', async () => {
    const { service, repository } = createService();
    repository.findQuestionOwned.mockResolvedValue(storedQuestion('draft', 3));

    await expect(
      service.updateQuestion(QUESTION_ID, { status: 'ready' }, 2, USER_ID),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'question_version_conflict' });
    await expect(
      service.updateQuestion(QUESTION_ID, { solution: { answer: '7' } }, 2, USER_ID),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'question_version_conflict' });
    expect(repository.changeQuestionStatus).not.toHaveBeenCalled();
    expect(repository.createQuestionVersion).not.toHaveBeenCalled();
  });

  it('resolves the last Ready version even if the latest authoring version is Draft', async () => {
    const { service, repository } = createService();
    repository.findQuestionOwned.mockResolvedValue(storedQuestion('draft', 3));
    repository.findLatestReadyQuestion.mockResolvedValue(storedQuestion('ready', 2));

    await expect(service.getQuestion(QUESTION_ID, USER_ID)).resolves.toMatchObject({
      version: 3,
      status: 'draft',
    });
    await expect(service.getLatestReadyQuestion(QUESTION_ID, USER_ID)).resolves.toMatchObject({
      version: 2,
      status: 'ready',
    });
    expect(repository.findLatestReadyQuestion).toHaveBeenCalledWith(QUESTION_ID);

    repository.findLatestReadyQuestion.mockResolvedValue(undefined);
    await expect(service.getLatestReadyQuestion(QUESTION_ID, USER_ID)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'question_ready_not_found',
    });
    repository.findQuestionOwned.mockResolvedValue(undefined);
    await expect(service.getLatestReadyQuestion(QUESTION_ID, USER_ID)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'question_not_found',
    });
  });

  it('requires ownership when reading version history and old content', async () => {
    const { service, repository } = createService();
    repository.findQuestionOwned.mockResolvedValue(undefined);
    await expect(service.listQuestionVersions(QUESTION_ID, USER_ID)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'question_not_found',
    });
    await expect(service.getQuestionVersion(QUESTION_ID, 1, USER_ID)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'question_not_found',
    });
    expect(repository.listQuestionVersions).not.toHaveBeenCalled();
    expect(repository.findQuestionVersion).not.toHaveBeenCalled();

    repository.findQuestionOwned.mockResolvedValue(storedQuestion('ready', 2));
    repository.listQuestionVersions.mockResolvedValue([
      { version: 1, status: 'ready' },
      { version: 2, status: 'ready' },
    ]);
    repository.findQuestionVersion.mockResolvedValue(storedQuestion('ready', 1));
    await expect(service.listQuestionVersions(QUESTION_ID, USER_ID)).resolves.toHaveLength(2);
    await expect(service.getQuestionVersion(QUESTION_ID, 1, USER_ID)).resolves.toMatchObject({
      id: QUESTION_ID,
      version: 1,
    });
  });
});

describe('QuestionsService authorization', () => {
  const stimulus = {
    content: {
      type: 'doc' as const,
      content: [
        { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Ngữ liệu' }] },
      ],
    },
  };

  it('denies authoring without the System capability before writing', async () => {
    const { service, repository, authorization } = createService();
    authorization.assertAuthorized.mockRejectedValueOnce(
      new ClientError('forbidden', 'authorization_denied', 'Không đủ quyền'),
    );

    await expect(service.createStimulus(stimulus, USER_ID)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect(repository.createStimulus).not.toHaveBeenCalled();
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: USER_ID,
      capability: 'question:create_own',
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });
  });

  it('passes the server actor through every Stimulus operation and hides foreign IDs', async () => {
    const { service, repository, authorization } = createService();
    repository.createStimulus.mockResolvedValue({ id: QUESTION_ID, ...stimulus });
    await service.createStimulus(stimulus, USER_ID);
    expect(repository.createStimulus).toHaveBeenCalledWith(stimulus, [], USER_ID);

    repository.findStimulusOwned.mockResolvedValue(undefined);
    await expect(service.getStimulus(QUESTION_ID, USER_ID)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'stimulus_not_found',
    });
    expect(repository.findStimulusOwned).toHaveBeenCalledWith(QUESTION_ID, USER_ID);

    await expect(service.updateStimulus(QUESTION_ID, stimulus, USER_ID)).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect(repository.updateStimulus).toHaveBeenCalledWith(QUESTION_ID, stimulus, [], USER_ID);

    await expect(service.deleteStimulus(QUESTION_ID, USER_ID)).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect(repository.deleteStimulus).toHaveBeenCalledWith(QUESTION_ID, USER_ID);
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: USER_ID,
      capability: 'question:manage_own',
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });
  });
});
