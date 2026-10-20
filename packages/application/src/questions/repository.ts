import type { ImageRef } from '@giaokhoa/shared/images';
import type {
  Question,
  QuestionCreate,
  QuestionStatus,
  QuestionVersionSummary,
  Stimulus,
  StimulusCreate,
  StimulusPatch,
} from '@giaokhoa/shared/questions';

export type StoredQuestion = Question & { createdByUserId: string };

export interface QuestionsRepository {
  createQuestion(data: QuestionCreate, refs: ImageRef[], userId: string): Promise<StoredQuestion>;
  findQuestion(id: string): Promise<StoredQuestion | undefined>;
  findLatestReadyQuestion(id: string): Promise<StoredQuestion | undefined>;
  findQuestionVersion(id: string, version: number): Promise<StoredQuestion | undefined>;
  listQuestionVersions(id: string): Promise<QuestionVersionSummary[]>;
  findQuestionOwned(id: string, userId: string): Promise<StoredQuestion | undefined>;
  createQuestionVersion(
    id: string,
    expectedVersion: number,
    data: QuestionCreate,
    refs: ImageRef[],
    userId: string,
  ): Promise<StoredQuestion | undefined>;
  changeQuestionStatus(
    id: string,
    expectedVersion: number,
    status: QuestionStatus,
    userId: string,
  ): Promise<StoredQuestion | undefined>;
  deleteQuestion(id: string, userId: string): Promise<{ id: string } | undefined>;

  createStimulus(data: StimulusCreate): Promise<Stimulus>;
  findStimulus(id: string): Promise<Stimulus | undefined>;
  updateStimulus(id: string, data: StimulusPatch): Promise<Stimulus | undefined>;
  deleteStimulus(id: string): Promise<{ id: string } | undefined>;
}
