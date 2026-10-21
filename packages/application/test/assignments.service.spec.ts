import { describe, expect, it, vi } from 'vitest';
import { AssignmentsService } from '../src/assignments/service.js';
import { ClientError } from '../src/common/client-error.js';

const ACTOR = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22';
const CLASS = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';
const ASSIGNMENT = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d24';
const REVISION = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d25';
const STUDENT = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d26';
const NOW = new Date('2026-10-21T09:00:00.000Z');

function setup() {
  const repository = {
    create: vi.fn(),
    findById: vi.fn(),
    updateDraft: vi.fn(),
    publish: vi.fn(),
    listRecipients: vi.fn(),
    revokeRecipient: vi.fn(),
    getDelivery: vi.fn(),
  };
  const authorization = { assertAuthorized: vi.fn(async () => undefined) };
  const service = new AssignmentsService(repository as never, authorization as never, () => NOW);
  const assignment = { id: ASSIGNMENT, classId: CLASS, createdByUserId: ACTOR, status: 'draft' };
  const input = {
    classId: CLASS,
    examRevisionId: REVISION,
    audienceMode: 'SELECTED_USERS' as const,
    selectedUserIds: [STUDENT],
    openAt: '2026-10-21T08:00:00.000Z',
    closeAt: '2026-10-21T11:00:00.000Z',
  };
  return { service, repository, authorization, assignment, input };
}

describe('Dịch vụ giao bài (AssignmentsService)', () => {
  it('từ chối dữ liệu tạo bài sai trước khi xét quyền hay ghi kho dữ liệu', async () => {
    const { service, input, repository, authorization } = setup();
    await expect(service.create(ACTOR, { ...input, selectedUserIds: [] })).rejects.toMatchObject({
      kind: 'invalid',
      code: 'assignment_invalid',
    });
    await expect(service.create(ACTOR, { ...input, openAt: input.closeAt })).rejects.toMatchObject({
      kind: 'invalid',
      code: 'assignment_invalid',
    });
    expect(authorization.assertAuthorized).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('kiểm quyền tại lớp đích, áp dụng giá trị mặc định và không tạo nếu đề không hợp lệ', async () => {
    const { service, repository, authorization, input, assignment } = setup();
    repository.create.mockResolvedValueOnce(undefined).mockResolvedValueOnce(assignment);
    await expect(service.create(ACTOR, input)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'exam_revision_not_found',
    });
    await expect(service.create(ACTOR, input)).resolves.toEqual(assignment);
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'assignment:create',
      context: { kind: 'class', resourceKey: CLASS },
    });
    expect(repository.create).toHaveBeenLastCalledWith(
      ACTOR,
      expect.objectContaining({
        ...input,
        maxAttempts: 1,
        releaseScoreAt: null,
        releaseFeedbackAt: null,
        releaseSolutionsAt: null,
      }),
    );
  });

  it('không để người khác đọc bài giao dù đã có quyền tạo bài trong cùng lớp', async () => {
    const { service, repository, assignment } = setup();
    repository.findById.mockResolvedValue({ ...assignment, createdByUserId: STUDENT });
    await expect(service.get(ACTOR, ASSIGNMENT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_not_found',
    });
  });

  it('không truy cập kho dữ liệu ghi nếu thiếu quyền công bố', async () => {
    const { service, repository, authorization, assignment } = setup();
    repository.findById.mockResolvedValue(assignment);
    authorization.assertAuthorized.mockRejectedValueOnce(
      new ClientError('forbidden', 'authorization_denied', 'Không có quyền'),
    );
    await expect(service.publish(ACTOR, ASSIGNMENT)).rejects.toMatchObject({
      kind: 'forbidden',
      code: 'authorization_denied',
    });
    expect(repository.publish).not.toHaveBeenCalled();
  });

  it('không sửa bài giao đã công bố và không báo nhầm bài giao không tồn tại', async () => {
    const { service, repository, assignment } = setup();
    repository.findById.mockResolvedValue(assignment);
    repository.updateDraft.mockResolvedValue(undefined);
    await expect(service.update(ACTOR, ASSIGNMENT, { maxAttempts: 2 })).rejects.toMatchObject({
      kind: 'conflict',
      code: 'assignment_not_draft',
    });
    expect(repository.updateDraft).toHaveBeenCalledWith(ASSIGNMENT, ACTOR, { maxAttempts: 2 });
    repository.findById.mockResolvedValueOnce(undefined);
    await expect(service.publish(ACTOR, ASSIGNMENT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_not_found',
    });
    expect(repository.publish).not.toHaveBeenCalled();
  });

  it('thu hồi đúng người nhận, phân biệt thành viên không thuộc bài giao', async () => {
    const { service, repository, assignment, authorization } = setup();
    repository.findById.mockResolvedValue(assignment);
    repository.revokeRecipient.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(service.revokeRecipient(ACTOR, ASSIGNMENT, STUDENT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_recipient_not_found',
    });
    await expect(service.revokeRecipient(ACTOR, ASSIGNMENT, STUDENT)).resolves.toBeUndefined();
    expect(repository.revokeRecipient).toHaveBeenCalledWith(ASSIGNMENT, STUDENT, ACTOR);
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'assignment:publish',
      context: { kind: 'class', resourceKey: CLASS },
    });
  });

  it('chỉ trả đề được kho dữ liệu cho phép xem tại thời điểm yêu cầu', async () => {
    const { service, repository, assignment, authorization } = setup();
    repository.findById.mockResolvedValue(assignment);
    const delivery = { assignmentId: ASSIGNMENT, questions: [] };
    repository.getDelivery.mockResolvedValueOnce(undefined).mockResolvedValueOnce(delivery);
    await expect(service.getDelivery(STUDENT, ASSIGNMENT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_not_available',
    });
    await expect(service.getDelivery(STUDENT, ASSIGNMENT)).resolves.toEqual(delivery);
    expect(repository.getDelivery).toHaveBeenLastCalledWith(ASSIGNMENT, STUDENT, NOW);
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: STUDENT,
      capability: 'assignment:view_assigned',
      context: { kind: 'class', resourceKey: CLASS },
    });
  });

  it('không công bố hoặc tiết lộ danh sách người nhận khi kho dữ liệu báo bài giao không còn hợp lệ', async () => {
    const { service, repository, assignment, authorization } = setup();
    repository.findById.mockResolvedValue(assignment);
    repository.publish.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      ...assignment,
      status: 'published',
    });
    await expect(service.publish(ACTOR, ASSIGNMENT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_not_found',
    });
    await expect(service.publish(ACTOR, ASSIGNMENT)).resolves.toMatchObject({
      status: 'published',
    });
    expect(repository.publish).toHaveBeenCalledWith(ASSIGNMENT, ACTOR);
    repository.listRecipients.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
    await expect(service.listRecipients(ACTOR, ASSIGNMENT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'assignment_not_found',
    });
    await expect(service.listRecipients(ACTOR, ASSIGNMENT)).resolves.toEqual([]);
    expect(repository.listRecipients).toHaveBeenCalledWith(ASSIGNMENT, ACTOR);
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'assignment:publish',
      context: { kind: 'class', resourceKey: CLASS },
    });
  });
});
