import type { ImageRef } from '@giaokhoa/shared/images';
import type {
  Question,
  QuestionCreate,
  Stimulus,
  StimulusCreate,
  StimulusPatch,
} from '@giaokhoa/shared/questions';

export type StoredQuestion = Question & { createdByUserId: string };

export interface QuestionsRepository {
  createQuestion(data: QuestionCreate, refs: ImageRef[], userId: string): Promise<StoredQuestion>;
  findQuestion(id: string): Promise<StoredQuestion | undefined>;
  findQuestionOwned(id: string, userId: string): Promise<StoredQuestion | undefined>;
  updateQuestion(
    id: string,
    data: QuestionCreate,
    refs: ImageRef[],
    userId: string,
  ): Promise<StoredQuestion | undefined>;
  deleteQuestion(id: string, userId: string): Promise<{ id: string } | undefined>;

  createStimulus(data: StimulusCreate): Promise<Stimulus>;
  findStimulus(id: string): Promise<Stimulus | undefined>;
  updateStimulus(id: string, data: StimulusPatch): Promise<Stimulus | undefined>;
  deleteStimulus(id: string): Promise<{ id: string } | undefined>;
}
