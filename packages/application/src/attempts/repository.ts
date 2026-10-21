import type {
  Attempt,
  AttemptAnswer,
  AttemptGrade,
  AttemptResult,
  AttemptReview,
  AttemptSolutions,
  AttemptSummary,
} from '@giaokhoa/shared/attempts';

/** Dữ liệu tối thiểu để xét chủ lượt làm và ngoại lệ đọc lịch sử sau khi rời lớp. */
export type AttemptContext = {
  classId: string;
  userId: string;
  status: Attempt['status'];
  enrolmentStatus: string | null;
};

/** Kho dữ liệu bảo vệ thời gian, giới hạn lượt làm, trạng thái nộp và quyền sở hữu khi đọc/ghi. */
export interface AttemptsRepository {
  findAssignmentClass(assignmentId: string): Promise<string | undefined>;
  findContext(attemptId: string): Promise<AttemptContext | undefined>;
  start(assignmentId: string, actorId: string, now: Date): Promise<Attempt>;
  getOwn(id: string, actorId: string): Promise<Attempt | undefined>;
  /** Chỉ cập nhật câu trả lời khi lượt đang thực hiện và người nhận còn đủ điều kiện. */
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
  /** Trả rỗng khi mốc công bố điểm hoặc nhận xét chưa đến, kể cả khi bài đã nộp. */
  result(id: string, actorId: string, now: Date): Promise<AttemptResult | undefined>;
  solutions(id: string, actorId: string, now: Date): Promise<AttemptSolutions | undefined>;
}
