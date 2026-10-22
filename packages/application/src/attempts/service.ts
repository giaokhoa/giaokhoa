import { attemptAnswerSchema, attemptGradeSchema } from '@giaokhoa/shared/attempts';
import type {
  Attempt,
  AttemptAnswer,
  AttemptGrade,
  AttemptResult,
  AttemptReview,
  AttemptSolutions,
  AttemptSummary,
} from '@giaokhoa/shared/attempts';
import type { AuthorizationService } from '../authorization/service.js';
import { ClientError } from '../common/client-error.js';
import type { AttemptsRepository } from './repository.js';

/** Áp dụng quyền của người làm và người chấm, vòng đời nộp bài và các mốc công bố độc lập. */
export class AttemptsService {
  constructor(
    private readonly repository: AttemptsRepository,
    private readonly authorization: AuthorizationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private assertAssignment(actorId: string, assignmentId: string, capability: string) {
    return this.authorization.assertAuthorized({
      actorId,
      capability,
      context: { kind: 'assignment', resourceKey: assignmentId },
    });
  }

  /**
   * Chủ lượt làm và capability là hai điều kiện độc lập, đều bắt buộc.
   * Đã nộp hay rời lớp không được biến quyết định từ chối thành cho phép.
   */
  private async assertAttempt(actorId: string, id: string, capability: string, teacher = false) {
    const context = await this.repository.findContext(id);
    if (!context)
      throw new ClientError('not_found', 'attempt_not_found', 'Lượt làm bài không tồn tại');
    if (!teacher && context.userId !== actorId)
      throw new ClientError('not_found', 'attempt_not_found', 'Lượt làm bài không tồn tại');
    await this.assertAssignment(actorId, context.assignmentId, capability);
    return context;
  }

  /** Quyền làm bài chỉ là điều kiện đầu; kho dữ liệu còn kiểm thời gian, số lượt và người nhận hợp lệ. */
  async start(actorId: string, assignmentId: string): Promise<Attempt> {
    const classId = await this.repository.findAssignmentClass(assignmentId);
    if (!classId)
      throw new ClientError('not_found', 'assignment_not_found', 'Bài giao không tồn tại');
    await this.assertAssignment(actorId, assignmentId, 'assignment:attempt');
    return this.repository.start(assignmentId, actorId, this.now());
  }

  async getOwn(actorId: string, id: string): Promise<Attempt> {
    await this.assertAttempt(actorId, id, 'assignment:attempt');
    const attempt = await this.repository.getOwn(id, actorId);
    if (!attempt)
      throw new ClientError('not_found', 'attempt_not_found', 'Lượt làm bài không khả dụng');
    return attempt;
  }

  /** Kiểm tra cấu trúc câu trả lời trước khi lưu; kho dữ liệu ngăn sửa lượt đã nộp hoặc quá hạn. */
  async save(
    actorId: string,
    id: string,
    position: number,
    answer: AttemptAnswer,
  ): Promise<Attempt> {
    const parsed = attemptAnswerSchema.safeParse(answer);
    if (!parsed.success)
      throw new ClientError(
        'invalid',
        'attempt_answer_invalid',
        'Câu trả lời không hợp lệ',
        parsed.error.issues,
      );
    await this.assertAttempt(actorId, id, 'assignment:attempt');
    return this.repository.save(id, actorId, position, parsed.data, this.now());
  }

  async submit(actorId: string, id: string): Promise<Attempt> {
    await this.assertAttempt(actorId, id, 'assignment:attempt');
    return this.repository.submit(id, actorId, this.now());
  }

  async listForTeacher(actorId: string, assignmentId: string): Promise<AttemptSummary[]> {
    const classId = await this.repository.findAssignmentClass(assignmentId);
    if (!classId)
      throw new ClientError('not_found', 'assignment_not_found', 'Bài giao không tồn tại');
    await this.assertAssignment(actorId, assignmentId, 'assignment:grade');
    const list = await this.repository.listForTeacher(assignmentId, actorId);
    if (!list) throw new ClientError('not_found', 'assignment_not_found', 'Bài giao không tồn tại');
    return list;
  }

  async review(actorId: string, id: string): Promise<AttemptReview> {
    await this.assertAttempt(actorId, id, 'assignment:grade', true);
    const attempt = await this.repository.review(id, actorId);
    if (!attempt)
      throw new ClientError('not_found', 'attempt_not_found', 'Lượt làm bài không tồn tại');
    return attempt;
  }

  /** Chỉ chấm lượt đã nộp bằng quyền lớp hiện tại; trả lỗi xung đột khi trạng thái không cho phép chấm. */
  async grade(actorId: string, id: string, input: AttemptGrade): Promise<AttemptReview> {
    const parsed = attemptGradeSchema.safeParse(input);
    if (!parsed.success)
      throw new ClientError(
        'invalid',
        'attempt_grade_invalid',
        'Điểm hoặc nhận xét không hợp lệ',
        parsed.error.issues,
      );
    await this.assertAttempt(actorId, id, 'assignment:grade', true);
    const graded = await this.repository.grade(id, actorId, parsed.data, this.now());
    if (!graded)
      throw new ClientError('conflict', 'attempt_not_submitted', 'Bài làm chưa được nộp');
    return graded;
  }

  /** Điểm và nhận xét được công bố theo mốc riêng; đã rời lớp vẫn phải là chủ lượt làm đã hoàn tất. */
  async result(actorId: string, id: string): Promise<AttemptResult> {
    await this.assertAttempt(actorId, id, 'result:view_own');
    const result = await this.repository.result(id, actorId, this.now());
    if (!result)
      throw new ClientError('not_found', 'result_not_released', 'Kết quả chưa được công bố');
    return result;
  }

  /** Mốc công bố lời giải độc lập với mốc xem điểm, không suy quyền từ khả năng đọc đề. */
  async solutions(actorId: string, id: string): Promise<AttemptSolutions> {
    await this.assertAttempt(actorId, id, 'result:view_own');
    const solutions = await this.repository.solutions(id, actorId, this.now());
    if (!solutions)
      throw new ClientError('not_found', 'solutions_not_released', 'Đáp án chưa được công bố');
    return solutions;
  }
}
