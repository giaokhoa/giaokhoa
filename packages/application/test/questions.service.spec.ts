import { describe, expect, it, vi } from 'vitest';
import { ClientError } from '../src/common/client-error.js';
import { QuestionsService } from '../src/questions/service.js';

const USER_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22';
const QUESTION_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d24';
const IMAGE_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d21';
const IMAGE_VARIANT_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';

function image(imageVariantId: string | null = null) {
  return {
    type: 'image' as const,
    attrs: {
      imageId: IMAGE_ID,
      imageVariantId,
      src: imageVariantId
        ? `/images/${IMAGE_ID}/variants/${imageVariantId}`
        : `/images/${IMAGE_ID}`,
      alt: 'demo.png',
      title: null,
      width: 100,
      height: 80,
      align: 'center' as const,
      crop: imageVariantId ? { x: 0, y: 0, width: 80, height: 80 } : null,
    },
  };
}

function createService() {
  const repository = {
    createQuestion: vi.fn(async (question) => ({
      id: QUESTION_ID,
      ...question,
    })),
    findQuestion: vi.fn(),
    findQuestionOwned: vi.fn(),
    updateQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    createStimulus: vi.fn(),
    findStimulus: vi.fn(),
    updateStimulus: vi.fn(),
    deleteStimulus: vi.fn(),
  };
  return { service: new QuestionsService(repository as never), repository };
}

describe('QuestionsService', () => {
  it('collects each original and derived image reference once for ownership validation', async () => {
    const { service, repository } = createService();
    const original = image();
    const variant = image(IMAGE_VARIANT_ID);
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
        { imageId: IMAGE_ID, imageVariantId: null },
        { imageId: IMAGE_ID, imageVariantId: IMAGE_VARIANT_ID },
      ],
      USER_ID,
    );
  });

  it('returns a patched question with unchanged fields preserved', async () => {
    const { service, repository } = createService();
    const current = {
      id: QUESTION_ID,
      stimulusId: null,
      status: 'ready' as const,
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
    repository.updateQuestion.mockImplementation(async (id, question) => ({ id, ...question }));

    const updated = await service.updateQuestion(
      QUESTION_ID,
      { solution: { answer: '7' } },
      USER_ID,
    );

    expect(updated).toEqual({
      ...current,
      solution: { answer: '7' },
    });
  });

  it('does not allow a non-owner to update a question', async () => {
    const { service, repository } = createService();
    repository.findQuestionOwned.mockResolvedValue(undefined);

    await expect(
      service.updateQuestion(QUESTION_ID, { solution: { answer: '7' } }, USER_ID),
    ).rejects.toMatchObject({ kind: 'not_found', code: 'question_not_found' });

    expect(repository.updateQuestion).not.toHaveBeenCalled();
  });

  it('rejects a patch that makes the whole question inconsistent', async () => {
    const { service, repository } = createService();
    repository.findQuestionOwned.mockResolvedValue({
      id: QUESTION_ID,
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
      service.updateQuestion(QUESTION_ID, { type: 'essay' }, USER_ID),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'question_invalid' });

    expect(repository.updateQuestion).not.toHaveBeenCalled();
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
});
