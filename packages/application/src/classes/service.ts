import { createHash, randomBytes } from 'node:crypto';
import type {
  Class,
  ClassCreate,
  ClassEnrolment,
  ClassJoinCodeCreate,
  ClassJoinResult,
  ClassPatch,
} from '@giaokhoa/shared/classes';
import type { AuthorizationService } from '../authorization/service.js';
import { ClientError } from '../common/client-error.js';
import type { ClassesRepository } from './repository.js';

export class ClassesService {
  constructor(
    private readonly repository: ClassesRepository,
    private readonly authorization: AuthorizationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private assertSystem(actorId: string, capability: 'class:create' | 'class:join') {
    return this.authorization.assertAuthorized({
      actorId,
      capability,
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });
  }

  private assertClass(
    actorId: string,
    classId: string,
    capability: 'class:view' | 'class:update' | 'class:enrolment_manage',
  ) {
    return this.authorization.assertAuthorized({
      actorId,
      capability,
      context: { kind: 'class', resourceKey: classId },
    });
  }

  async createClass(actorId: string, input: ClassCreate): Promise<Class> {
    await this.assertSystem(actorId, 'class:create');
    return this.repository.create(input, actorId);
  }

  async getClass(actorId: string, id: string): Promise<Class> {
    const found = await this.repository.findById(id);
    if (!found) throw new ClientError('not_found', 'class_not_found', 'Lớp không tồn tại');
    await this.assertClass(actorId, id, 'class:view');
    return found;
  }

  async updateClass(actorId: string, id: string, patch: ClassPatch): Promise<Class> {
    await this.assertClass(actorId, id, 'class:update');
    const updated = await this.repository.update(id, actorId, patch);
    if (!updated) throw new ClientError('not_found', 'class_not_found', 'Lớp không tồn tại');
    return updated;
  }

  async createJoinCode(actorId: string, id: string, input: ClassJoinCodeCreate) {
    await this.assertClass(actorId, id, 'class:update');
    const code = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + input.expiresInHours * 3_600_000);
    const created = await this.repository.createJoinCode(
      id,
      actorId,
      createHash('sha256').update(code).digest('hex'),
      expiresAt,
      input.maxUses,
    );
    if (!created) throw new ClientError('conflict', 'class_not_joinable', 'Lớp không cho tham gia');
    return { id: created, code, expiresAt };
  }

  async revokeJoinCode(actorId: string, classId: string, codeId: string): Promise<void> {
    await this.assertClass(actorId, classId, 'class:update');
    const revoked = await this.repository.revokeJoinCode(classId, codeId, actorId);
    if (!revoked)
      throw new ClientError('not_found', 'class_join_code_not_found', 'Mã tham gia không tồn tại');
  }

  async joinClass(actorId: string, code: string): Promise<ClassJoinResult> {
    await this.assertSystem(actorId, 'class:join');
    return this.repository.join(
      createHash('sha256').update(code).digest('hex'),
      actorId,
      this.now(),
    );
  }

  async listMembers(actorId: string, id: string): Promise<ClassEnrolment[]> {
    await this.assertClass(actorId, id, 'class:enrolment_manage');
    return this.repository.listEnrolments(id);
  }

  async approveMember(actorId: string, id: string, userId: string): Promise<ClassEnrolment> {
    await this.assertClass(actorId, id, 'class:enrolment_manage');
    const updated = await this.repository.changeEnrolment(id, userId, actorId, 'approve');
    if (!updated)
      throw new ClientError('conflict', 'class_member_not_pending', 'Thành viên không chờ duyệt');
    return updated;
  }

  async suspendMember(actorId: string, id: string, userId: string): Promise<ClassEnrolment> {
    await this.assertClass(actorId, id, 'class:enrolment_manage');
    const updated = await this.repository.changeEnrolment(id, userId, actorId, 'suspend');
    if (!updated)
      throw new ClientError(
        'conflict',
        'class_member_not_active',
        'Thành viên không thể bị tạm dừng',
      );
    return updated;
  }

  async leaveClass(actorId: string, id: string): Promise<void> {
    const updated = await this.repository.changeEnrolment(id, actorId, actorId, 'leave');
    if (!updated)
      throw new ClientError('not_found', 'class_membership_not_found', 'Bạn không tham gia lớp');
  }
}
