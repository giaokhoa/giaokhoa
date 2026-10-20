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
  constructor(private readonly repository: QuestionsRepository) {}

  async createQuestion(question: QuestionCreate, userId: string): Promise<Question> {
    const refs = collectImageRefs(question);
    return withoutOwner(await this.repository.createQuestion(question, refs, userId));
  }

  async getQuestion(id: string, userId: string): Promise<Question> {
    const question = await this.repository.findQuestionOwned(id, userId);
    if (!question)
      throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
    return withoutOwner(question);
  }

  async getLatestReadyQuestion(id: string, userId: string): Promise<Question> {
    const owned = await this.repository.findQuestionOwned(id, userId);
    if (!owned) throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
    const question = await this.repository.findLatestReadyQuestion(id);
    if (!question)
      throw new ClientError('not_found', 'question_ready_not_found', 'Chưa có phiên bản sẵn sàng');
    return withoutOwner(question);
  }

  async getQuestionVersion(id: string, version: number, userId: string): Promise<Question> {
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

    // Only a status change is mutable in-place on the current version.
    if (Object.keys(patch).length === 1 && patch.status !== undefined) {
      // Even an unchanged status must reach the repository's locked version check.
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

    // Any content edit creates a new immutable content version, including edits to a draft.
    // An explicit status applies to the new version; otherwise the previous status is inherited.
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
    if (!(await this.repository.deleteQuestion(id, userId)))
      throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
  }

  createStimulus(input: StimulusCreate): Promise<Stimulus> {
    return this.repository.createStimulus(input);
  }

  async getStimulus(id: string): Promise<Stimulus> {
    const stimulus = await this.repository.findStimulus(id);
    if (!stimulus)
      throw new ClientError('not_found', 'stimulus_not_found', 'Stimulus không tồn tại');
    return stimulus;
  }

  async updateStimulus(id: string, patch: StimulusPatch): Promise<Stimulus> {
    await this.getStimulus(id);
    const updated = await this.repository.updateStimulus(id, patch);
    if (!updated)
      throw new ClientError('not_found', 'stimulus_not_found', 'Stimulus không tồn tại');
    return updated;
  }

  async deleteStimulus(id: string): Promise<void> {
    if (!(await this.repository.deleteStimulus(id)))
      throw new ClientError('not_found', 'stimulus_not_found', 'Stimulus không tồn tại');
  }
}
