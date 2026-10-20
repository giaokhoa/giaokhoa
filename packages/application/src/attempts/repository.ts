import type {
  Attempt,
  AttemptAnswer,
  AttemptGrade,
  AttemptResult,
  AttemptReview,
  AttemptSolutions,
  AttemptSummary,
} from '@giaokhoa/shared/attempts';

export type AttemptContext = {
  classId: string;
  userId: string;
  status: Attempt['status'];
  enrolmentStatus: string | null;
};

export interface AttemptsRepository {
  findAssignmentClass(assignmentId: string): Promise<string | undefined>;
  findContext(attemptId: string): Promise<AttemptContext | undefined>;
  start(assignmentId: string, actorId: string, now: Date): Promise<Attempt>;
  getOwn(id: string, actorId: string): Promise<Attempt | undefined>;
  save(
    id: string,
    actorId: string,
    position: number,
    answer: AttemptAnswer,
    now: Date,
  ): Promise<Attempt>;
  submit(id: string, actorId: string, now: Date): Promise<Attempt>;
  listForTeacher(assignmentId: string, actorId: string): Promise<AttemptSummary[] | undefined>;
  review(id: string, actorId: string): Promise<AttemptReview | undefined>;
  grade(
    id: string,
    actorId: string,
    input: AttemptGrade,
    now: Date,
  ): Promise<AttemptReview | undefined>;
  result(id: string, actorId: string, now: Date): Promise<AttemptResult | undefined>;
  solutions(id: string, actorId: string, now: Date): Promise<AttemptSolutions | undefined>;
}
