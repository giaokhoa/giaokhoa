import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ClassesService } from '../src/classes/service.js';
import { ClientError } from '../src/common/client-error.js';

const ACTOR = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22';
const STUDENT = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';
const CLASS = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d24';
const CODE = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d25';
const NOW = new Date('2026-10-21T09:00:00.000Z');

function setup() {
  const repository = {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    createJoinCode: vi.fn(),
    revokeJoinCode: vi.fn(),
    join: vi.fn(),
    listEnrolments: vi.fn(),
    changeEnrolment: vi.fn(),
  };
  const authorization = { assertAuthorized: vi.fn(async () => undefined) };
  const service = new ClassesService(repository as never, authorization as never, () => NOW);
  return { service, repository, authorization };
}

describe('Dịch vụ lớp học (ClassesService)', () => {
  it('từ chối tạo lớp khi không có quyền hệ thống trước khi ghi', async () => {
    const { service, repository, authorization } = setup();
    authorization.assertAuthorized.mockRejectedValueOnce(
      new ClientError('forbidden', 'authorization_denied', 'Không có quyền'),
    );
    await expect(
      service.createClass(ACTOR, { name: 'Toán', joinMode: 'AUTO' }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    expect(repository.create).not.toHaveBeenCalled();
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'class:create',
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });
  });

  it('không đọc lớp không tồn tại và kiểm tra quyền đúng phạm vi trước khi trả dữ liệu', async () => {
    const { service, repository, authorization } = setup();
    await expect(service.getClass(ACTOR, CLASS)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'class_not_found',
    });
    expect(authorization.assertAuthorized).not.toHaveBeenCalled();

    repository.findById.mockResolvedValue({ id: CLASS, name: 'Lớp kín' });
    authorization.assertAuthorized.mockRejectedValueOnce(
      new ClientError('forbidden', 'authorization_denied', 'Không có quyền'),
    );
    await expect(service.getClass(ACTOR, CLASS)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(service.getClass(ACTOR, CLASS)).resolves.toMatchObject({ name: 'Lớp kín' });
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'class:view',
      context: { kind: 'class', resourceKey: CLASS },
    });
  });

  it('chỉ trả mã tham gia dạng rõ khi kho dữ liệu đã lưu mã băm và thời hạn thành công', async () => {
    const { service, repository, authorization } = setup();
    repository.createJoinCode.mockResolvedValueOnce(undefined).mockResolvedValueOnce(CODE);
    await expect(
      service.createJoinCode(ACTOR, CLASS, { expiresInHours: 2, maxUses: 3 }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'class_not_joinable' });
    const result = await service.createJoinCode(ACTOR, CLASS, {
      expiresInHours: 2,
      maxUses: 3,
    });
    expect(result).toEqual({
      id: CODE,
      code: expect.any(String),
      expiresAt: new Date('2026-10-21T11:00:00.000Z'),
    });
    expect(result.code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.code).not.toBe(CODE);
    expect(repository.createJoinCode).toHaveBeenLastCalledWith(
      CLASS,
      ACTOR,
      createHash('sha256').update(result.code).digest('hex'),
      result.expiresAt,
      3,
    );
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'class:update',
      context: { kind: 'class', resourceKey: CLASS },
    });
  });

  it('chỉ gửi mã tham gia đã băm cùng thời điểm hiện tại sau khi có quyền gia nhập', async () => {
    const { service, repository, authorization } = setup();
    repository.join.mockResolvedValue({ classId: CLASS, status: 'pending' });
    await expect(service.joinClass(STUDENT, 'mã-bí-mật')).resolves.toEqual({
      classId: CLASS,
      status: 'pending',
    });
    expect(repository.join).toHaveBeenCalledWith(
      createHash('sha256').update('mã-bí-mật').digest('hex'),
      STUDENT,
      NOW,
    );
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: STUDENT,
      capability: 'class:join',
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });
    expect(repository.join.mock.calls[0]![0]).not.toBe('mã-bí-mật');
  });

  it('phê duyệt và đình chỉ phải kiểm quyền quản lý thành viên, trả đúng xung đột trạng thái', async () => {
    const { service, repository, authorization } = setup();
    repository.changeEnrolment
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ status: 'active' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ status: 'suspended' });
    await expect(service.approveMember(ACTOR, CLASS, STUDENT)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'class_member_not_pending',
    });
    await expect(service.approveMember(ACTOR, CLASS, STUDENT)).resolves.toMatchObject({
      status: 'active',
    });
    await expect(service.suspendMember(ACTOR, CLASS, STUDENT)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'class_member_not_active',
    });
    await expect(service.suspendMember(ACTOR, CLASS, STUDENT)).resolves.toMatchObject({
      status: 'suspended',
    });
    expect(repository.changeEnrolment.mock.calls.map((args) => args)).toEqual([
      [CLASS, STUDENT, ACTOR, 'approve'],
      [CLASS, STUDENT, ACTOR, 'approve'],
      [CLASS, STUDENT, ACTOR, 'suspend'],
      [CLASS, STUDENT, ACTOR, 'suspend'],
    ]);
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'class:enrolment_manage',
      context: { kind: 'class', resourceKey: CLASS },
    });
  });

  it('tự rời lớp không cần quyền quản lý thành viên và chỉ thay đổi ghi danh của chính mình', async () => {
    const { service, repository, authorization } = setup();
    repository.changeEnrolment.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      userId: STUDENT,
      status: 'left',
    });
    await expect(service.leaveClass(STUDENT, CLASS)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'class_membership_not_found',
    });
    await expect(service.leaveClass(STUDENT, CLASS)).resolves.toBeUndefined();
    expect(repository.changeEnrolment).toHaveBeenCalledWith(CLASS, STUDENT, STUDENT, 'leave');
    expect(authorization.assertAuthorized).not.toHaveBeenCalled();
  });

  it('không thu hồi mã tham gia nếu thiếu quyền lớp hoặc mã đã hết hiệu lực', async () => {
    const { service, repository, authorization } = setup();
    authorization.assertAuthorized.mockRejectedValueOnce(
      new ClientError('forbidden', 'authorization_denied', 'Không có quyền'),
    );
    await expect(service.revokeJoinCode(ACTOR, CLASS, CODE)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect(repository.revokeJoinCode).not.toHaveBeenCalled();

    repository.revokeJoinCode.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(service.revokeJoinCode(ACTOR, CLASS, CODE)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'class_join_code_not_found',
    });
    await expect(service.revokeJoinCode(ACTOR, CLASS, CODE)).resolves.toBeUndefined();
    expect(repository.revokeJoinCode).toHaveBeenCalledWith(CLASS, CODE, ACTOR);
  });
});
