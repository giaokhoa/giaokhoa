import { describe, expect, it, vi } from 'vitest';
import { AttemptsService } from '../src/attempts/service.js';
import { ClientError } from '../src/common/client-error.js';

const ACTOR = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22';
const OTHER = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';
const CLASS = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d24';
const ASSIGNMENT = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d25';
const ATTEMPT = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d26';
const NOW = new Date('2026-10-21T09:00:00.000Z');
const forbidden = new ClientError('forbidden', 'authorization_denied', 'Không có quyền');

function setup() {
  const repository = {
    findAssignmentClass: vi.fn(),
    findContext: vi.fn(),
    start: vi.fn(),
    getOwn: vi.fn(),
    save: vi.fn(),
    submit: vi.fn(),
    listForTeacher: vi.fn(),
    review: vi.fn(),
    grade: vi.fn(),
    result: vi.fn(),
    solutions: vi.fn(),
  };
  const authorization = { assertAuthorized: vi.fn(async () => undefined) };
  const service = new AttemptsService(repository as never, authorization as never, () => NOW);
  const context = {
    classId: CLASS,
    userId: ACTOR,
    status: 'in_progress',
    enrolmentStatus: 'active',
  };
  return { service, repository, authorization, context };
}

describe('Dịch vụ bài làm (AttemptsService)', () => {
  it('không bắt đầu bài khi bài giao không tồn tại hoặc quyền làm bài bị từ chối', async () => {
    const { service, repository, authorization } = setup();
    await expect(service.start(ACTOR, ASSIGNMENT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_not_found',
    });
    expect(authorization.assertAuthorized).not.toHaveBeenCalled();
    repository.findAssignmentClass.mockResolvedValue(CLASS);
    authorization.assertAuthorized.mockRejectedValueOnce(forbidden);
    await expect(service.start(ACTOR, ASSIGNMENT)).rejects.toMatchObject({
      kind: 'forbidden',
      code: 'authorization_denied',
    });
    expect(repository.start).not.toHaveBeenCalled();
    repository.start.mockResolvedValueOnce({ id: ATTEMPT });
    await expect(service.start(ACTOR, ASSIGNMENT)).resolves.toEqual({ id: ATTEMPT });
    expect(repository.start).toHaveBeenCalledWith(ASSIGNMENT, ACTOR, NOW);
    expect(authorization.assertAuthorized).toHaveBeenLastCalledWith({
      actorId: ACTOR,
      capability: 'assignment:attempt',
      context: { kind: 'class', resourceKey: CLASS },
    });
  });

  it('không tiết lộ lượt làm của người khác, kể cả khi họ có quyền trong cùng lớp', async () => {
    const { service, repository, authorization, context } = setup();
    repository.findContext.mockResolvedValue(context);
    await expect(service.getOwn(OTHER, ATTEMPT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'attempt_not_found',
    });
    await expect(service.result(OTHER, ATTEMPT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'attempt_not_found',
    });
    await expect(service.solutions(OTHER, ATTEMPT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'attempt_not_found',
    });
    expect(authorization.assertAuthorized).not.toHaveBeenCalled();
    expect(repository.getOwn).not.toHaveBeenCalled();
    expect(repository.result).not.toHaveBeenCalled();
    expect(repository.solutions).not.toHaveBeenCalled();
  });

  it('chỉ bỏ qua quyền lớp cho lịch sử đã nộp của chính người đã rời lớp', async () => {
    const { service, repository, authorization, context } = setup();
    repository.findContext.mockResolvedValue({
      ...context,
      enrolmentStatus: 'left',
      status: 'submitted',
    });
    repository.getOwn.mockResolvedValue({ id: ATTEMPT });
    repository.result.mockResolvedValue({ attemptId: ATTEMPT });
    repository.solutions.mockResolvedValue({ attemptId: ATTEMPT });
    await expect(service.getOwn(ACTOR, ATTEMPT)).resolves.toMatchObject({ id: ATTEMPT });
    await expect(service.result(ACTOR, ATTEMPT)).resolves.toMatchObject({ attemptId: ATTEMPT });
    await expect(service.solutions(ACTOR, ATTEMPT)).resolves.toMatchObject({ attemptId: ATTEMPT });
    expect(authorization.assertAuthorized).not.toHaveBeenCalled();
    expect(repository.result).toHaveBeenCalledWith(ATTEMPT, ACTOR, NOW);
    expect(repository.solutions).toHaveBeenCalledWith(ATTEMPT, ACTOR, NOW);

    repository.findContext.mockResolvedValue({ ...context, enrolmentStatus: 'left' });
    authorization.assertAuthorized.mockRejectedValue(forbidden);
    await expect(service.getOwn(ACTOR, ATTEMPT)).rejects.toMatchObject({ kind: 'forbidden' });
    expect(repository.getOwn).toHaveBeenCalledTimes(1);

    repository.findContext.mockResolvedValue({
      ...context,
      enrolmentStatus: 'suspended',
      status: 'graded',
    });
    await expect(service.result(ACTOR, ATTEMPT)).rejects.toMatchObject({ kind: 'forbidden' });
    expect(repository.result).toHaveBeenCalledTimes(1);
  });

  it('từ chối câu trả lời sai trước khi đọc lượt làm và chỉ lưu câu trả lời đúng kiểu', async () => {
    const { service, repository, authorization, context } = setup();
    await expect(
      service.save(ACTOR, ATTEMPT, 1, { type: 'short_answer', answer: '' }),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'attempt_answer_invalid' });
    expect(repository.findContext).not.toHaveBeenCalled();
    expect(authorization.assertAuthorized).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();

    repository.findContext.mockResolvedValue(context);
    repository.save.mockResolvedValue({ id: ATTEMPT });
    const answer = { type: 'short_answer' as const, answer: '42' };
    await expect(service.save(ACTOR, ATTEMPT, 1, answer)).resolves.toEqual({ id: ATTEMPT });
    expect(repository.save).toHaveBeenCalledWith(ATTEMPT, ACTOR, 1, answer, NOW);
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'assignment:attempt',
      context: { kind: 'class', resourceKey: CLASS },
    });
  });

  it('phân biệt quyền giáo viên khi đọc bài làm và chấm, không cấp theo quyền người học', async () => {
    const { service, repository, authorization, context } = setup();
    repository.findContext.mockResolvedValue(context);
    authorization.assertAuthorized.mockRejectedValueOnce(forbidden);
    await expect(service.review(OTHER, ATTEMPT)).rejects.toMatchObject({ kind: 'forbidden' });
    expect(repository.review).not.toHaveBeenCalled();

    repository.review.mockResolvedValue({ id: ATTEMPT });
    await expect(service.review(OTHER, ATTEMPT)).resolves.toMatchObject({ id: ATTEMPT });
    expect(authorization.assertAuthorized).toHaveBeenLastCalledWith({
      actorId: OTHER,
      capability: 'assignment:grade',
      context: { kind: 'class', resourceKey: CLASS },
    });
    expect(repository.review).toHaveBeenCalledWith(ATTEMPT, OTHER);
  });

  it('không chấm điểm sai định dạng và báo xung đột khi bài chưa nộp', async () => {
    const { service, repository, authorization, context } = setup();
    await expect(
      service.grade(OTHER, ATTEMPT, { score: 101, feedback: null }),
    ).rejects.toMatchObject({ kind: 'invalid', code: 'attempt_grade_invalid' });
    expect(repository.findContext).not.toHaveBeenCalled();
    repository.findContext.mockResolvedValue({ ...context, status: 'submitted' });
    const grade = { score: 8.25, feedback: 'Đã nhận xét' };
    repository.grade.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: ATTEMPT });
    await expect(service.grade(OTHER, ATTEMPT, grade)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'attempt_not_submitted',
    });
    await expect(service.grade(OTHER, ATTEMPT, grade)).resolves.toMatchObject({ id: ATTEMPT });
    expect(repository.grade).toHaveBeenLastCalledWith(ATTEMPT, OTHER, grade, NOW);
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: OTHER,
      capability: 'assignment:grade',
      context: { kind: 'class', resourceKey: CLASS },
    });
  });

  it('không đồng nhất mốc công bố kết quả và lời giải', async () => {
    const { service, repository, context, authorization } = setup();
    repository.findContext.mockResolvedValue({ ...context, status: 'graded' });
    repository.result.mockResolvedValue(undefined);
    repository.solutions.mockResolvedValue({ attemptId: ATTEMPT, questions: [] });
    await expect(service.result(ACTOR, ATTEMPT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'result_not_released',
    });
    await expect(service.solutions(ACTOR, ATTEMPT)).resolves.toMatchObject({
      attemptId: ATTEMPT,
      questions: [],
    });
    expect(repository.result).toHaveBeenCalledWith(ATTEMPT, ACTOR, NOW);
    expect(repository.solutions).toHaveBeenCalledWith(ATTEMPT, ACTOR, NOW);
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'result:view_own',
      context: { kind: 'class', resourceKey: CLASS },
    });
    repository.result.mockResolvedValue({ attemptId: ATTEMPT, score: 8 });
    repository.solutions.mockResolvedValue(undefined);
    await expect(service.result(ACTOR, ATTEMPT)).resolves.toMatchObject({ score: 8 });
    await expect(service.solutions(ACTOR, ATTEMPT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'solutions_not_released',
    });
  });

  it('bảo vệ danh sách bài làm của giáo viên bằng quyền lớp tại thời điểm đọc', async () => {
    const { service, repository, authorization } = setup();
    await expect(service.listForTeacher(OTHER, ASSIGNMENT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_not_found',
    });
    repository.findAssignmentClass.mockResolvedValue(CLASS);
    authorization.assertAuthorized.mockRejectedValueOnce(forbidden);
    await expect(service.listForTeacher(OTHER, ASSIGNMENT)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect(repository.listForTeacher).not.toHaveBeenCalled();
    repository.listForTeacher.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
    await expect(service.listForTeacher(OTHER, ASSIGNMENT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_not_found',
    });
    await expect(service.listForTeacher(OTHER, ASSIGNMENT)).resolves.toEqual([]);
    expect(repository.listForTeacher).toHaveBeenLastCalledWith(ASSIGNMENT, OTHER);
  });
});
