import type { FileRef } from '@giaokhoa/shared/files';
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
  createQuestion(data: QuestionCreate, refs: FileRef[], userId: string): Promise<StoredQuestion>;
  findQuestion(id: string): Promise<StoredQuestion | undefined>;
  findLatestReadyQuestion(id: string): Promise<StoredQuestion | undefined>;
  findQuestionVersion(id: string, version: number): Promise<StoredQuestion | undefined>;
  listQuestionVersions(id: string): Promise<QuestionVersionSummary[]>;
  findQuestionOwned(id: string, userId: string): Promise<StoredQuestion | undefined>;
  createQuestionVersion(
    id: string,
    expectedVersion: number,
    data: QuestionCreate,
    refs: FileRef[],
    userId: string,
  ): Promise<StoredQuestion | undefined>;
  changeQuestionStatus(
    id: string,
    expectedVersion: number,
    status: QuestionStatus,
    userId: string,
  ): Promise<StoredQuestion | undefined>;
  deleteQuestion(id: string, userId: string): Promise<{ id: string } | undefined>;

  createStimulus(data: StimulusCreate, refs: FileRef[], userId: string): Promise<Stimulus>;
  findStimulusOwned(id: string, userId: string): Promise<Stimulus | undefined>;
  updateStimulus(
    id: string,
    data: StimulusPatch,
    refs: FileRef[] | null,
    userId: string,
  ): Promise<Stimulus | undefined>;
  deleteStimulus(id: string, userId: string): Promise<{ id: string } | undefined>;
}
