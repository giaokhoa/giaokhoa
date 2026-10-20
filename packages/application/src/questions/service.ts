import {
  collectImageRefs,
  questionCreateSchema,
  type Question,
  type QuestionCreate,
  type QuestionPatch,
  type QuestionVersionSummary,
  type Stimulus,
  type StimulusCreate,
  type StimulusPatch,
} from '@giaokhoa/shared/questions';
import { ClientError } from '../common/client-error.js';
import type { AuthorizationService } from '../authorization/service.js';
import type { QuestionsRepository, StoredQuestion } from './repository.js';

function validateMergedQuestion(value: unknown): QuestionCreate {
  const result = questionCreateSchema.safeParse(value);
  if (!result.success) {
    throw new ClientError(
      'invalid',
      'question_invalid',
      'Question không hợp lệ',
      result.error.issues.map(({ path, message }) => ({ path: [...path], message })),
    );
  }
  return result.data;
}

function withoutOwner(question: StoredQuestion): Question {
  const { createdByUserId: _createdByUserId, ...publicQuestion } = question;
  return publicQuestion;
}

export class QuestionsService {
  constructor(
    private readonly repository: QuestionsRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  private assertCapability(
    userId: string,
    capability: 'question:create_own' | 'question:manage_own',
  ) {
    return this.authorization.assertAuthorized({
      actorId: userId,
      capability,
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });
  }

  async createQuestion(question: QuestionCreate, userId: string): Promise<Question> {
    await this.assertCapability(userId, 'question:create_own');
    const refs = collectImageRefs(question);
    return withoutOwner(await this.repository.createQuestion(question, refs, userId));
  }

  async getQuestion(id: string, userId: string): Promise<Question> {
    await this.assertCapability(userId, 'question:manage_own');
    const question = await this.repository.findQuestionOwned(id, userId);
    if (!question)
      throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
    return withoutOwner(question);
  }

  async getLatestReadyQuestion(id: string, userId: string): Promise<Question> {
    await this.assertCapability(userId, 'question:manage_own');
    const owned = await this.repository.findQuestionOwned(id, userId);
    if (!owned) throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
    const question = await this.repository.findLatestReadyQuestion(id);
    if (!question)
      throw new ClientError('not_found', 'question_ready_not_found', 'Chưa có phiên bản sẵn sàng');
    return withoutOwner(question);
  }

  async getQuestionVersion(id: string, version: number, userId: string): Promise<Question> {
    await this.assertCapability(userId, 'question:manage_own');
    const owned = await this.repository.findQuestionOwned(id, userId);
    if (!owned) throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
    const question = await this.repository.findQuestionVersion(id, version);
    if (!question)
      throw new ClientError(
        'not_found',
        'question_version_not_found',
        'Phiên bản câu hỏi không tồn tại',
      );
    return withoutOwner(question);
  }

  async listQuestionVersions(id: string, userId: string): Promise<QuestionVersionSummary[]> {
    await this.assertCapability(userId, 'question:manage_own');
    const owned = await this.repository.findQuestionOwned(id, userId);
    if (!owned) throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
    return this.repository.listQuestionVersions(id);
  }

  async updateQuestion(
    id: string,
    patch: QuestionPatch,
    expectedVersion: number,
    userId: string,
  ): Promise<Question> {
    await this.assertCapability(userId, 'question:manage_own');
    const current = await this.repository.findQuestionOwned(id, userId);
    if (!current)
      throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
    if (current.version !== expectedVersion)
      throw new ClientError(
        'conflict',
        'question_version_conflict',
        'Phiên bản câu hỏi đã thay đổi',
      );

    const {
      id: questionId,
      version: _version,
      createdByUserId: _owner,
      ...currentQuestion
    } = current;
    const question = validateMergedQuestion({ ...currentQuestion, ...patch });

    // Chỉ thay đổi trạng thái mới được cập nhật trực tiếp trên phiên bản hiện tại.
    if (Object.keys(patch).length === 1 && patch.status !== undefined) {
      // Kể cả trạng thái không đổi vẫn phải qua kiểm tra phiên bản có khóa trong repository.
      const updated = await this.repository.changeQuestionStatus(
        questionId,
        expectedVersion,
        question.status,
        userId,
      );
      if (!updated)
        throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
      return withoutOwner(updated);
    }

    // Mọi chỉnh sửa nội dung đều tạo phiên bản bất biến, kể cả với bản nháp.
    // Nếu không chỉ định trạng thái mới, phiên bản mới kế thừa trạng thái trước đó.
    const refs = collectImageRefs(question);
    const updated = await this.repository.createQuestionVersion(
      questionId,
      expectedVersion,
      question,
      refs,
      userId,
    );
    if (!updated)
      throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
    return withoutOwner(updated);
  }

  async deleteQuestion(id: string, userId: string): Promise<void> {
    await this.assertCapability(userId, 'question:manage_own');
    if (!(await this.repository.deleteQuestion(id, userId)))
      throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
  }

  async createStimulus(input: StimulusCreate, userId: string): Promise<Stimulus> {
    await this.assertCapability(userId, 'question:create_own');
    return this.repository.createStimulus(input, userId);
  }

  async getStimulus(id: string, userId: string): Promise<Stimulus> {
    await this.assertCapability(userId, 'question:manage_own');
    const stimulus = await this.repository.findStimulusOwned(id, userId);
    if (!stimulus)
      throw new ClientError('not_found', 'stimulus_not_found', 'Stimulus không tồn tại');
    return stimulus;
  }

  async updateStimulus(id: string, patch: StimulusPatch, userId: string): Promise<Stimulus> {
    await this.assertCapability(userId, 'question:manage_own');
    const updated = await this.repository.updateStimulus(id, patch, userId);
    if (!updated)
      throw new ClientError('not_found', 'stimulus_not_found', 'Stimulus không tồn tại');
    return updated;
  }

  async deleteStimulus(id: string, userId: string): Promise<void> {
    await this.assertCapability(userId, 'question:manage_own');
    if (!(await this.repository.deleteStimulus(id, userId)))
      throw new ClientError('not_found', 'stimulus_not_found', 'Stimulus không tồn tại');
  }
}
