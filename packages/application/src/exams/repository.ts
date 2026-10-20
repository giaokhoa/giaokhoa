import type {
  Exam,
  ExamCreate,
  ExamPatch,
  ExamRevision,
  ExamRevisionCreate,
  ExamRevisionSummary,
} from '@giaokhoa/shared/exams';

export interface ExamsRepository {
  create(actorId: string, input: ExamCreate): Promise<Exam>;
  listOwned(actorId: string): Promise<Exam[]>;
  findOwned(id: string, actorId: string): Promise<Exam | undefined>;
  updateOwned(id: string, actorId: string, input: ExamPatch): Promise<Exam | undefined>;
  createRevision(
    id: string,
    actorId: string,
    input: ExamRevisionCreate,
  ): Promise<ExamRevision | undefined>;
  listRevisions(id: string, actorId: string): Promise<ExamRevisionSummary[] | undefined>;
  findRevision(id: string, revision: number, actorId: string): Promise<ExamRevision | undefined>;
}
