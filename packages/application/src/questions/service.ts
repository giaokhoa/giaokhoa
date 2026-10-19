import {
  collectImageRefs,
  questionCreateSchema,
  type Question,
  type QuestionCreate,
  type QuestionPatch,
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

  async getQuestion(id: string): Promise<Question> {
    const question = await this.repository.findQuestion(id);
    if (!question)
      throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');
    return withoutOwner(question);
  }

  async updateQuestion(id: string, patch: QuestionPatch, userId: string): Promise<Question> {
    const current = await this.repository.findQuestionOwned(id, userId);
    if (!current)
      throw new ClientError('not_found', 'question_not_found', 'Question không tồn tại');

    const { id: questionId, createdByUserId: _createdByUserId, ...currentQuestion } = current;
    const question = validateMergedQuestion({ ...currentQuestion, ...patch });
    const refs = collectImageRefs(question);
    const updated = await this.repository.updateQuestion(questionId, question, refs, userId);
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
