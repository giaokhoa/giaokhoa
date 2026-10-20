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

export class AttemptsService {
  constructor(
    private readonly repository: AttemptsRepository,
    private readonly authorization: AuthorizationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private assertClass(actorId: string, classId: string, capability: string) {
    return this.authorization.assertAuthorized({
      actorId,
      capability,
      context: { kind: 'class', resourceKey: classId },
    });
  }

  /**
   * Giáo viên phải có capability của lớp; học sinh phải là chủ attempt.
   * Với bài đã kết thúc của người rời lớp, chỉ bỏ qua role lớp; repository vẫn kiểm
   * account hợp lệ và policy công bố khi đọc kết quả.
   */
  private async assertAttempt(actorId: string, id: string, capability: string, teacher = false) {
    const context = await this.repository.findContext(id);
    if (!context)
      throw new ClientError('not_found', 'attempt_not_found', 'Lượt làm bài không tồn tại');
    if (teacher) {
      await this.assertClass(actorId, context.classId, capability);
    } else {
      if (context.userId !== actorId)
        throw new ClientError('not_found', 'attempt_not_found', 'Lượt làm bài không tồn tại');
      // D06: sau khi rời lớp, chỉ mở lịch sử bài đã nộp của chính mình.
      if (!(context.enrolmentStatus === 'left' && context.status !== 'in_progress'))
        await this.assertClass(actorId, context.classId, capability);
    }
    return context;
  }

  async start(actorId: string, assignmentId: string): Promise<Attempt> {
    const classId = await this.repository.findAssignmentClass(assignmentId);
    if (!classId)
      throw new ClientError('not_found', 'assignment_not_found', 'Bài giao không tồn tại');
    await this.assertClass(actorId, classId, 'assignment:attempt');
    return this.repository.start(assignmentId, actorId, this.now());
  }

  async getOwn(actorId: string, id: string): Promise<Attempt> {
    await this.assertAttempt(actorId, id, 'assignment:attempt');
    const attempt = await this.repository.getOwn(id, actorId);
    if (!attempt)
      throw new ClientError('not_found', 'attempt_not_found', 'Lượt làm bài không khả dụng');
    return attempt;
  }

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
    await this.assertClass(actorId, classId, 'assignment:grade');
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

  async result(actorId: string, id: string): Promise<AttemptResult> {
    await this.assertAttempt(actorId, id, 'result:view_own');
    const result = await this.repository.result(id, actorId, this.now());
    if (!result)
      throw new ClientError('not_found', 'result_not_released', 'Kết quả chưa được công bố');
    return result;
  }

  async solutions(actorId: string, id: string): Promise<AttemptSolutions> {
    await this.assertAttempt(actorId, id, 'result:view_own');
    const solutions = await this.repository.solutions(id, actorId, this.now());
    if (!solutions)
      throw new ClientError('not_found', 'solutions_not_released', 'Đáp án chưa được công bố');
    return solutions;
  }
}
